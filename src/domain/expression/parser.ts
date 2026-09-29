/**
 * 식 언어 파서 — 손으로 쓴 재귀하강 (외부 의존성 없음).
 *
 * 문법 (docs/공통/기술/식언어.md):
 *   expr     := or
 *   or       := and ('or' and)*
 *   and      := compare ('and' compare)*
 *   compare  := unary (cmpOp unary)?          — 연쇄 불가
 *   unary    := 'not' unary | primary
 *   primary  := literal | aggregate | ref | '(' expr ')'
 *   aggregate:= aggOp '(' path ')'
 *   path     := ident ('@' nodeId)?                    — 구분자 코드 (문면이 쓰는 참조). '@' 는 구분자에만 (ADR-0066 §1)
 *             | ident '.' ident                        — 마스터 필드 (폼키.필드키 · 구분자 식이 쓰는 참조)
 *             | 'builtin' '.' level '.' ident
 *             | 'attr' '.' ident
 *             | 'arg' '.' ident                        — 인자 (함수조항 본문 전용 — 쓸 수 있는 자리는 타입 검사의 문맥 플래그가 가른다)
 *             | 'var' '.' ident                        — 내부 변수 (함수조항 전용)
 *   postfix  := ('.' method | '.' fieldKey)*           — 인자 · 내부 변수 뒤에만 (함수조항 전용, 기능/식언어 §12)
 *   method   := '합치기' '(' form '.' field ')' | '있음' '(' string (',' string)* ')'
 *             | '거르기' '(' fieldKey '=' literal ')' | '비었음' ('(' ')')?
 *
 * 파서는 마스터를 **모른다** (기능/마스터 §3.2) — 머리가 attr · builtin 이 아닌 두 토막이면 마스터 참조로 모양만
 * 가른다. 존재 · 레벨은 검증기(catalog/expression `findMasterField`)와 문맥이 본다.
 *
 * 담보속성(attr) 제약(ADR-0015)은 문법 차원에서 건다 — 파서를 통과한 AST 에는
 * `exist/notexist(attr.X)` 와 `attr.X = / ≠ '문자열'` 두 형태만 남는다.
 */

import { ATTACH_LEVELS, reject, ok } from "../types";
import type { AttachLevel, Coordinate, Issue, Result } from "../types";
import { AGGREGATE_OPS, METHOD_OPS, refPath } from "./ast";
import type { AggregateOp, CompareOp, Expr, Literal, Ref } from "./ast";

// ───────────────────────────── 예약어 ─────────────────────────────

/** 구분자 코드로 쓸 수 없는 단어. 모두 소문자·대소문자 구분. */
export const RESERVED_WORDS: readonly string[] = [
  "and",
  "or",
  "not",
  "true",
  "false",
  ...AGGREGATE_OPS,
  "attr",
  "builtin",
  "arg",
  "var",
  // 부착 레벨 5개는 예약어가 아니다 — 마스터 경로의 머리가 폼키가 되면서(기능/마스터 §3.2) 레벨은 builtin 의 두 번째 토막에만 온다.
];

const RESERVED = new Set<string>(RESERVED_WORDS);
const AGGREGATES = new Set<string>(AGGREGATE_OPS);
/** builtin.<레벨>.<속성> 의 레벨 검사에만 쓴다. */
const LEVELS = new Set<string>(ATTACH_LEVELS);
/** 예약어이면서 경로의 머리로는 쓸 수 있는 것 — 네임스페이스 둘. */
const PATH_HEADS = new Set<string>(["attr", "builtin", "arg", "var"]);
/** 뒤에 필드 · 연산을 붙일 수 있는 머리 — 함수조항의 인자 · 내부 변수. */
const POSTFIX_HEADS = new Set<string>(["arg", "var"]);
const METHODS = new Set<string>(METHOD_OPS);

// ───────────────────────────── 토큰 ─────────────────────────────

type Token =
  | { type: "ident"; text: string; pos: number }
  | { type: "string"; value: string; pos: number }
  | { type: "number"; value: number; pos: number }
  | { type: "date"; value: string; pos: number }
  | { type: "op"; text: CompareOp; pos: number }
  | { type: "punct"; text: "(" | ")" | "." | ","; pos: number }
  | { type: "node"; id: string; pos: number }
  | { type: "eof"; pos: number };

/** 문법 오류. 파서 내부에서만 던지고 `parse` 가 Result 로 바꾼다. */
class SyntaxFailure extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

/** 식별자 시작 문자: 영문·밑줄·한글(자모·음절). 숫자는 두 번째 글자부터. */
const IDENT_START = /[A-Za-z_ㄱ-ㆎ가-힣]/;
const IDENT_PART = /[A-Za-z0-9_ㄱ-ㆎ가-힣]/;
const DIGIT = /[0-9]/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  /** `'...'` 를 읽는다. i 는 여는 따옴표 위치. 닫는 따옴표 다음 위치를 돌려준다. */
  const readString = (start: number): { value: string; end: number } => {
    let j = start + 1;
    let out = "";
    while (j < src.length) {
      const ch = src[j];
      if (ch === "\\") {
        const next = src[j + 1];
        if (next === "'" || next === "\\") {
          out += next;
          j += 2;
          continue;
        }
        throw new SyntaxFailure(`문자열 안의 이스케이프는 \\' 와 \\\\ 만 허용합니다`, j);
      }
      if (ch === "'") return { value: out, end: j + 1 };
      out += ch;
      j += 1;
    }
    throw new SyntaxFailure("문자열이 닫히지 않았습니다", start);
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "." || ch === ",") {
      tokens.push({ type: "punct", text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === "'") {
      const { value, end } = readString(i);
      tokens.push({ type: "string", value, pos: i });
      i = end;
      continue;
    }
    // 날짜 리터럴 d'YYYY-MM-DD'
    if (ch === "d" && src[i + 1] === "'") {
      const { value, end } = readString(i + 1);
      if (!isValidDate(value)) {
        throw new SyntaxFailure(`날짜 리터럴은 d'YYYY-MM-DD' 형식의 실재하는 날짜여야 합니다: '${value}'`, i);
      }
      tokens.push({ type: "date", value, pos: i });
      i = end;
      continue;
    }
    // 숫자 (음수 포함 — 산술이 없으므로 '-' 뒤 숫자는 항상 리터럴)
    if (DIGIT.test(ch) || (ch === "-" && src[i + 1] !== undefined && DIGIT.test(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && DIGIT.test(src[j])) j += 1;
      if (src[j] === "." && src[j + 1] !== undefined && DIGIT.test(src[j + 1])) {
        j += 1;
        while (j < src.length && DIGIT.test(src[j])) j += 1;
      }
      tokens.push({ type: "number", value: Number(src.slice(i, j)), pos: i });
      i = j;
      continue;
    }
    // 노드 한정자 @<id> — id 는 uuid 모양(영숫자 · 밑줄 · 하이픈). 구분자 참조 뒤에만 뜻이 있다 (파서가 본다).
    if (ch === "@") {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_-]/.test(src[j])) j += 1;
      if (j === i + 1) throw new SyntaxFailure("'@' 뒤에는 노드 id 가 와야 합니다", i);
      tokens.push({ type: "node", id: src.slice(i + 1, j), pos: i });
      i = j;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && IDENT_PART.test(src[j])) j += 1;
      tokens.push({ type: "ident", text: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // 비교 연산자
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=") {
      tokens.push({ type: "op", text: two, pos: i });
      i += 2;
      continue;
    }
    if (two === "!=") {
      tokens.push({ type: "op", text: "≠", pos: i });
      i += 2;
      continue;
    }
    if (ch === "=" || ch === "≠" || ch === "<" || ch === ">") {
      tokens.push({ type: "op", text: ch, pos: i });
      i += 1;
      continue;
    }
    throw new SyntaxFailure(`알 수 없는 문자 '${ch}'`, i);
  }
  tokens.push({ type: "eof", pos: src.length });
  return tokens;
}

// ───────────────────────────── 파서 ─────────────────────────────

class Parser {
  private idx = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.idx];
  }

  private next(): Token {
    const t = this.tokens[this.idx];
    this.idx += 1;
    return t;
  }

  private isKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.text === word;
  }

  private isPunct(text: "(" | ")" | "." | ","): boolean {
    const t = this.peek();
    return t.type === "punct" && t.text === text;
  }

  private expectPunct(text: "(" | ")" | "." | ","): void {
    const t = this.next();
    if (t.type !== "punct" || t.text !== text) {
      throw new SyntaxFailure(`'${text}' 가 필요합니다`, t.pos);
    }
  }

  parseExpr(): Expr {
    const expr = this.parseOr();
    const t = this.peek();
    if (t.type !== "eof") {
      throw new SyntaxFailure(`식 끝에 해석되지 않는 토큰이 남았습니다: ${describe(t)}`, t.pos);
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword("or")) {
      this.next();
      const right = this.parseAnd();
      left = { kind: "or", left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseCompare();
    while (this.isKeyword("and")) {
      this.next();
      const right = this.parseCompare();
      left = { kind: "and", left, right };
    }
    return left;
  }

  private parseCompare(): Expr {
    const left = this.parseUnary();
    const t = this.peek();
    if (t.type !== "op") {
      assertNotBareAttribute(left, t.pos);
      return left;
    }
    this.next();
    const right = this.parseUnary();
    const after = this.peek();
    if (after.type === "op") {
      throw new SyntaxFailure("비교는 연쇄할 수 없습니다 (a = b = c). 괄호와 and 로 나누세요", after.pos);
    }
    checkAttributeCompare(left, t.text, right, t.pos);
    return { kind: "compare", op: t.text, left, right };
  }

  private parseUnary(): Expr {
    if (this.isKeyword("not")) {
      const t = this.next();
      const operand = this.parseUnary();
      assertNotBareAttribute(operand, t.pos);
      return { kind: "not", operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.type) {
      case "string":
        return { kind: "literal", literal: { type: "string", value: t.value } };
      case "number":
        return { kind: "literal", literal: { type: "number", value: t.value } };
      case "date":
        return { kind: "literal", literal: { type: "date", value: t.value } };
      case "punct":
        if (t.text === "(") {
          const inner = this.parseOr();
          const close = this.peek();
          if (close.type !== "punct" || close.text !== ")") {
            throw new SyntaxFailure("')' 가 필요합니다", close.pos);
          }
          this.next();
          assertNotBareAttribute(inner, t.pos);
          return inner;
        }
        throw new SyntaxFailure(`예상치 못한 '${t.text}'`, t.pos);
      case "op":
        throw new SyntaxFailure(`연산자 '${t.text}' 앞에 피연산자가 없습니다`, t.pos);
      case "eof":
        throw new SyntaxFailure("식이 끝나기 전에 피연산자가 필요합니다", t.pos);
      case "node":
        throw new SyntaxFailure(`노드 한정자 '@${t.id}' 는 구분자 참조 뒤에만 올 수 있습니다`, t.pos);
      case "ident":
        return this.parseIdentStart(t);
    }
  }

  private parseIdentStart(t: Token & { type: "ident" }): Expr {
    if (t.text === "true" || t.text === "false") {
      return { kind: "literal", literal: { type: "boolean", value: t.text === "true" } };
    }
    if (AGGREGATES.has(t.text)) {
      const op = t.text as AggregateOp;
      const open = this.peek();
      if (open.type !== "punct" || open.text !== "(") {
        throw new SyntaxFailure(`'${op}' 는 예약어(집계)라 코드로 쓸 수 없습니다 — ${op}(경로) 형태여야 합니다`, t.pos);
      }
      this.next();
      const ref = this.parsePath("집계 인자는 참조 경로여야 합니다");
      const close = this.peek();
      if (close.type !== "punct" || close.text !== ")") {
        throw new SyntaxFailure(
          `집계 인자는 참조 경로 하나여야 합니다 — ')' 자리에 ${describe(close)}`,
          close.pos,
        );
      }
      this.next();
      if (ref.kind === "param" || ref.kind === "local") {
        throw new SyntaxFailure(`${refPath(ref)} 는 집계할 수 없습니다 — 집계 범위는 사용처 구조라 인자 · 내부 변수가 아니다`, t.pos);
      }
      if (ref.kind === "attr" && op !== "exist" && op !== "notexist") {
        throw new SyntaxFailure(
          `담보속성 attr.${ref.code} 는 exist·notexist 에만 쓸 수 있습니다 (${op} 불가)`,
          t.pos,
        );
      }
      return { kind: "aggregate", op, ref };
    }
    if (t.text === "not" || t.text === "and" || t.text === "or") {
      throw new SyntaxFailure(`'${t.text}' 는 예약어라 피연산자 자리에 올 수 없습니다`, t.pos);
    }
    this.idx -= 1;
    const ref = this.parsePath("참조 경로가 필요합니다");
    let expr: Expr = { kind: "ref", ref };
    if (ref.kind !== "param" && ref.kind !== "local") return expr;
    // 인자 · 내부 변수 뒤의 필드 읽기 · 연산 사슬 (함수조항 전용 — 쓸 수 있는 자리는 타입 검사의 문맥 플래그가 가른다)
    while (this.isPunct(".")) {
      this.next();
      const name = this.next();
      if (name.type !== "ident") throw new SyntaxFailure("'.' 뒤에는 필드 또는 연산 이름이 와야 합니다", name.pos);
      expr = METHODS.has(name.text) ? this.parseMethod(expr, name) : { kind: "member", target: expr, field: fieldKey(name.text, name.pos) };
    }
    return expr;
  }

  /** 연산 하나의 인자 — 연산마다 모양이 정해져 있다 (식 일반이 아니다). */
  private parseMethod(target: Expr, name: Token & { type: "ident" }): Expr {
    const op = name.text;
    const close = (what: string) => {
      const t = this.next();
      if (t.type !== "punct" || t.text !== ")") throw new SyntaxFailure(`${op} — ${what} 뒤에 ')' 가 필요합니다`, t.pos);
    };
    if (op === "비었음") {
      if (this.isPunct("(")) {
        this.next();
        close("'('");
      }
      return { kind: "call", op, target };
    }
    const open = this.next();
    if (open.type !== "punct" || open.text !== "(") throw new SyntaxFailure(`${op} 뒤에는 '(' 가 필요합니다`, open.pos);
    if (op === "합치기") {
      const at = this.peek().pos;
      const ref = this.isPunct(")") ? undefined : this.parsePath("합치기의 인자는 폼.필드 하나입니다");
      if (!ref || ref.kind !== "master") throw new SyntaxFailure("합치기의 인자는 폼.필드 하나입니다 (예: 합치기(waiver.reasons))", at);
      close("폼.필드");
      return { kind: "call", op, target, ref };
    }
    if (op === "있음") {
      const values: string[] = [];
      for (;;) {
        const v = this.next();
        if (v.type !== "string") throw new SyntaxFailure("있음의 인자는 열거값 코드 문자열 하나 이상입니다 (예: 있음('V01', 'V02'))", v.pos);
        values.push(v.value);
        if (!this.isPunct(",")) break;
        this.next();
      }
      close("값");
      return { kind: "call", op, target, values };
    }
    // 거르기(필드 = 값)
    const f = this.next();
    if (f.type !== "ident") throw new SyntaxFailure("거르기의 인자는 「필드 = 값」 입니다", f.pos);
    const eq = this.next();
    if (eq.type !== "op" || eq.text !== "=") throw new SyntaxFailure("거르기의 인자는 「필드 = 값」 입니다 — '=' 가 필요합니다", eq.pos);
    const value = this.parseLiteral("거르기의 값은 리터럴이어야 합니다");
    close("「필드 = 값」");
    return { kind: "call", op: "거르기", target, field: fieldKey(f.text, f.pos), value };
  }

  private parseLiteral(what: string): Literal {
    const t = this.next();
    if (t.type === "string") return { type: "string", value: t.value };
    if (t.type === "number") return { type: "number", value: t.value };
    if (t.type === "date") return { type: "date", value: t.value };
    if (t.type === "ident" && (t.text === "true" || t.text === "false")) return { type: "boolean", value: t.text === "true" };
    throw new SyntaxFailure(what, t.pos);
  }

  /** ident ('.' ident)* 를 읽어 Ref 로. 세그먼트 수·네임스페이스 규칙은 여기서. */
  private parsePath(whatIfNotIdent: string): Ref {
    const first = this.next();
    if (first.type !== "ident") {
      throw new SyntaxFailure(`${whatIfNotIdent} (${describe(first)})`, first.pos);
    }
    if (RESERVED.has(first.text) && !PATH_HEADS.has(first.text)) {
      throw new SyntaxFailure(
        `${whatIfNotIdent} — '${first.text}' 는 예약어라 코드로 쓸 수 없습니다`,
        first.pos,
      );
    }
    const segments: string[] = [first.text];
    // 인자 · 내부 변수는 두 토막에서 멈춘다 — 뒤의 '.' 는 필드 읽기 · 연산 (parseIdentStart 의 사슬)
    while (this.isPunct(".") && !(POSTFIX_HEADS.has(first.text) && segments.length === 2)) {
      this.next();
      const seg = this.next();
      if (seg.type !== "ident") {
        throw new SyntaxFailure("'.' 뒤에는 코드가 와야 합니다", seg.pos);
      }
      segments.push(seg.text);
    }
    const ref = toRef(segments, first.pos);
    const q = this.peek();
    if (q.type === "node") {
      this.next();
      if (ref.kind !== "discriminator") {
        throw new SyntaxFailure(`노드 한정자 @${q.id} 는 구분자 참조에만 붙일 수 있습니다 (${refPath(ref)} 불가)`, q.pos);
      }
      return { ...ref, node: { id: q.id } };
    }
    return ref;
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case "ident":
      return `'${t.text}'`;
    case "string":
      return `'${t.value}'`;
    case "number":
      return String(t.value);
    case "date":
      return `d'${t.value}'`;
    case "op":
    case "punct":
      return `'${t.text}'`;
    case "node":
      return `'@${t.id}'`;
    case "eof":
      return "식의 끝";
  }
}

function toRef(segments: string[], pos: number): Ref {
  const [head] = segments;
  if (head === "attr") {
    if (segments.length !== 2) {
      throw new SyntaxFailure("담보속성 경로는 attr.<속성종류코드> 두 단계입니다", pos);
    }
    assertCode(segments[1], pos);
    return { kind: "attr", code: segments[1] };
  }
  if (head === "arg") {
    if (segments.length !== 2) {
      throw new SyntaxFailure("인자 경로는 arg.<이름> 두 단계입니다", pos);
    }
    assertCode(segments[1], pos);
    return { kind: "param", name: segments[1] };
  }
  if (head === "var") {
    if (segments.length !== 2) {
      throw new SyntaxFailure("내부 변수 경로는 var.<이름> 두 단계입니다", pos);
    }
    assertCode(segments[1], pos);
    return { kind: "local", name: segments[1] };
  }
  if (head === "builtin") {
    if (segments.length !== 3) {
      throw new SyntaxFailure("내장 경로는 builtin.<레벨>.<속성> 세 단계입니다", pos);
    }
    if (!LEVELS.has(segments[1])) {
      throw new SyntaxFailure(
        `내장 경로의 레벨은 ${ATTACH_LEVELS.join("·")} 중 하나여야 합니다: '${segments[1]}'`,
        pos,
      );
    }
    return { kind: "builtin", level: segments[1] as AttachLevel, prop: segments[2] };
  }
  if (segments.length === 2) {
    assertCode(segments[0], pos);
    assertCode(segments[1], pos);
    return { kind: "master", form: segments[0], field: segments[1] };
  }
  if (segments.length > 2) {
    throw new SyntaxFailure(
      "마스터 필드 경로는 폼.필드 — <폼키>.<필드키> 두 토막입니다 (내장 경로만 builtin.<레벨>.<속성>)",
      pos,
    );
  }
  assertCode(segments[0], pos);
  return { kind: "discriminator", code: segments[0] };
}

/** 필드 키 — 예약어 · 연산 이름이 아닌 코드. */
function fieldKey(text: string, pos: number): string {
  assertCode(text, pos);
  return text;
}

function assertCode(text: string, pos: number): void {
  if (RESERVED.has(text)) {
    throw new SyntaxFailure(`'${text}' 는 예약어라 코드로 쓸 수 없습니다`, pos);
  }
}

/** 담보속성 참조가 비교 LHS 나 exist 밖에 홀로 서면 오류. */
function assertNotBareAttribute(expr: Expr, pos: number): void {
  if (expr.kind === "ref" && expr.ref.kind === "attr") {
    throw new SyntaxFailure(
      `담보속성 attr.${expr.ref.code} 는 exist(attr.X) · attr.X = '값' · attr.X ≠ '값' 형태로만 쓸 수 있습니다`,
      pos,
    );
  }
}

/** 담보속성 비교 규칙 (ADR-0015): LHS 만, = / ≠ 만, RHS 는 문자열 리터럴만. */
function checkAttributeCompare(left: Expr, op: CompareOp, right: Expr, pos: number): void {
  if (right.kind === "ref" && right.ref.kind === "attr") {
    throw new SyntaxFailure(
      `담보속성 attr.${right.ref.code} 는 비교의 왼쪽에만 올 수 있습니다`,
      pos,
    );
  }
  if (left.kind !== "ref" || left.ref.kind !== "attr") return;
  if (op !== "=" && op !== "≠") {
    throw new SyntaxFailure(`담보속성 비교는 = 와 ≠ 만 허용합니다 ('${op}' 불가)`, pos);
  }
  if (right.kind !== "literal" || right.literal.type !== "string") {
    throw new SyntaxFailure(
      `담보속성 비교의 오른쪽은 유효값 문자열 리터럴('값')만 허용합니다`,
      pos,
    );
  }
}

// ───────────────────────────── 진입점 ─────────────────────────────

/**
 * 소스 문자열 → AST. 문법 오류는 `Rejection{reason:'invalid', issues:[{kind:'syntax'}]}`.
 * 오류 메시지에 0-기반 문자 위치가 들어간다. `coordinate` 는 Issue 의 좌표로 그대로 실린다.
 */
export function parse(src: string, coordinate: Coordinate = {}): Result<Expr> {
  try {
    if (src.trim() === "") throw new SyntaxFailure("빈 식입니다", 0);
    const tokens = tokenize(src);
    return ok(new Parser(tokens).parseExpr());
  } catch (e) {
    if (e instanceof SyntaxFailure) {
      const issue: Issue = {
        kind: "syntax",
        message: `문법 오류 (위치 ${e.pos}): ${e.message}`,
        at: { ...coordinate },
      };
      return reject({ reason: "invalid", issues: [issue] });
    }
    throw e;
  }
}
