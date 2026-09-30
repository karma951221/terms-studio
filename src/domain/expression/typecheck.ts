/**
 * 타입 검사 — 언어 밖 규칙(ADR-0013 「조건식 자리는 boolean」)을 식 위에서 검사한다.
 *
 * 타입 조회는 주입받는다 (`TypeResolver`) — 언어는 카탈로그를 모른다.
 * 오류는 하위 식마다 모아 한 번에 돌려주고, 오류가 난 하위 식의 타입은 「모름」으로 두어
 * 위로 연쇄 오류를 내지 않는다.
 */

import { ok, reject } from "../types";
import type { Code, Coordinate, FieldType, Issue, Result } from "../types";
import { refPath } from "./ast";
import type { CompareOp, Expr, Literal, Ref } from "./ast";

// ───────────────────────────── 타입 ─────────────────────────────

/**
 * 식의 타입. 필드 타입 6종(types.ts) + 담보속성.
 * 담보속성은 값 타입이 아니라 「탑재의 좌표」라 별도 종류다 — `validValues` 를 알면
 * `attr.X = '값'` 의 리터럴을 유효값 목록으로 검사한다.
 */
export type ExprType =
  | FieldType
  | { kind: "attribute"; validValues?: Code[] }
  /** 세목 선택지 목록 — 함수조항 인자 타입 (최종 결정 2). 비교 · 조건 자리에 서지 않는다 — 가공은 내부 변수의 연산 몫. */
  | { kind: "planOptions"; form: Code };

/** 참조 → 타입. undefined 면 존재하지 않는 참조(brokenRef). 인자(`arg.X`)는 여기로 오지 않는다 — `CheckOptions.params` 가 푼다. */
export type TypeResolver = (ref: Ref) => ExprType | undefined;

/** 인자 이름 → 선언 타입. undefined 면 선언되지 않은 인자. */
export type ParamTypes = (name: string) => ExprType | undefined;

/** 내부 변수 이름 → 타입(앞에 선언한 것만). undefined 면 선언되지 않았거나 뒤에 선언한 내부 변수. */
export type LocalTypes = (name: string) => ExprType | undefined;

/** 열거형 모양 — 값 코드 · 유저 정의 필드(키 · 타입). 필드 읽기 · 있음 · 거르기 검사 재료 (ADR-0078). */
export type EnumInfo = (enumCode: Code) => { values: readonly Code[]; fields: readonly { key: Code; type: "string" | "boolean" }[] } | undefined;

export interface CheckOptions {
  /** 오류 좌표의 기본값. refPath 는 검사기가 얹는다. */
  coordinate?: Coordinate;
  /** 루트 식이 이 타입이어야 한다 (조건 자리면 boolean). */
  expect?: ExprType["kind"];
  /**
   * **문맥 플래그** — 함수조항 본문의 식일 때만 준다(선언된 인자 타입). 없으면 인자 참조(`arg.X`)는 structure 오류다 —
   * 구분자 식 · 문면 식이 인자를 읽지 못하게 막는 경계 (계획 위험 3 · ADR-0013 한 벌).
   */
  params?: ParamTypes;
  /** 함수조항 내부 변수 타입 — 없으면 `var.X` 는 structure 오류(함수조항 안에서만). */
  locals?: LocalTypes;
  /** 열거형 모양 — 필드 읽기 · 있음 · 거르기가 쓴다. */
  enums?: EnumInfo;
  /** 세목 폼 필드 타입 — `합치기(폼.필드)` 가 쓴다. */
  planField?: (form: Code, field: Code) => ExprType | undefined;
}

// ───────────────────────────── 검사 ─────────────────────────────

const BOOLEAN: ExprType = { kind: "boolean" };
const NUMBER: ExprType = { kind: "number" };

function literalType(lit: Literal): ExprType {
  return { kind: lit.type };
}

function describeType(t: ExprType): string {
  switch (t.kind) {
    case "enum":
    case "list<enum>":
      return `${t.kind}<${t.enumCode}>`;
    case "planOptions":
      return `세목 선택지 목록<${t.form}>`;
    default:
      return t.kind;
  }
}

/** = / ≠ 로 비교 가능한 쌍인가. enum 은 string 리터럴(코드)과 비교한다. */
function equatable(a: ExprType, b: ExprType): boolean {
  if (a.kind === "list<enum>" || b.kind === "list<enum>" || a.kind === "table" || b.kind === "table") return false;
  if (a.kind === "attribute" || b.kind === "attribute") return false;
  if (a.kind === "planOptions" || b.kind === "planOptions") return false;
  if (a.kind === "enum" && b.kind === "enum") return a.enumCode === b.enumCode;
  if (a.kind === "enum") return b.kind === "string";
  if (b.kind === "enum") return a.kind === "string";
  return a.kind === b.kind;
}

/** < <= > >= 로 비교 가능한 쌍인가 — number 끼리, date 끼리만. */
function orderable(a: ExprType, b: ExprType): boolean {
  return a.kind === b.kind && (a.kind === "number" || a.kind === "date");
}

/**
 * 식의 타입을 계산하고 규칙 위반을 모은다.
 * 통과하면 `ok(타입)`, 아니면 `Rejection{reason:'invalid', issues}` (typeMismatch · brokenRef).
 */
export function checkTypes(
  expr: Expr,
  resolve: TypeResolver,
  options: CheckOptions = {},
): Result<ExprType> {
  const issues: Issue[] = [];
  const base = options.coordinate ?? {};

  const report = (kind: Issue["kind"], message: string, ref?: Ref) => {
    issues.push({
      kind,
      message,
      at: ref === undefined ? { ...base } : { ...base, refPath: refPath(ref) },
    });
  };

  /** 참조 타입 조회. 없으면 brokenRef 보고 후 undefined. */
  const typeOfRef = (ref: Ref): ExprType | undefined => {
    if (ref.kind === "local") {
      if (!options.locals) {
        report("structure", `내부 변수 ${refPath(ref)} 는 함수조항 안에서만 쓸 수 있습니다`, ref);
        return undefined;
      }
      const lt = options.locals(ref.name);
      if (lt === undefined) report("brokenRef", `선언되지 않은 내부 변수입니다: ${refPath(ref)} — 내부 변수 표에서 앞에 선언한 것만 읽는다`, ref);
      return lt;
    }
    if (ref.kind === "param") {
      if (!options.params) {
        report("structure", `인자 ${refPath(ref)} 는 함수조항 본문에서만 쓸 수 있습니다`, ref);
        return undefined;
      }
      const pt = options.params(ref.name);
      if (pt === undefined) report("brokenRef", `선언되지 않은 인자입니다: ${refPath(ref)} — 함수조항의 인자 표에 먼저 선언한다`, ref);
      return pt;
    }
    const t = resolve(ref);
    if (t === undefined) {
      report("brokenRef", `참조 ${refPath(ref)} 를 찾을 수 없습니다`, ref);
      return undefined;
    }
    if (ref.kind === "attr" && t.kind !== "attribute") {
      report("typeMismatch", `attr.${ref.code} 는 담보속성이어야 하는데 ${describeType(t)} 입니다`, ref);
      return undefined;
    }
    if (ref.kind !== "attr" && t.kind === "attribute") {
      report("typeMismatch", `${refPath(ref)} 는 담보속성 타입일 수 없습니다 (attr.<코드> 로 참조)`, ref);
      return undefined;
    }
    return t;
  };

  /** 담보속성 비교(ADR-0015): LHS attr · = ≠ 만 · RHS 는 문자열 리터럴 · 유효값 안. */
  const checkAttributeCompare = (
    ref: Ref & { kind: "attr" },
    op: CompareOp,
    right: Expr,
  ): ExprType | undefined => {
    const t = typeOfRef(ref);
    if (t === undefined) return undefined;
    if (op !== "=" && op !== "≠") {
      report("typeMismatch", `담보속성 attr.${ref.code} 에는 = 와 ≠ 만 쓸 수 있습니다 ('${op}' 불가)`, ref);
      return undefined;
    }
    if (right.kind !== "literal" || right.literal.type !== "string") {
      report("typeMismatch", `담보속성 attr.${ref.code} 의 비교 대상은 유효값 문자열 리터럴이어야 합니다`, ref);
      return undefined;
    }
    if (t.kind === "attribute" && t.validValues && !t.validValues.includes(right.literal.value)) {
      report(
        "typeMismatch",
        `'${right.literal.value}' 는 담보속성 attr.${ref.code} 의 유효값이 아닙니다 (${t.validValues.join("·")})`,
        ref,
      );
      return undefined;
    }
    return BOOLEAN;
  };

  const expectBoolean = (t: ExprType | undefined, what: string, ref?: Ref): boolean => {
    if (t === undefined) return false;
    if (t.kind === "boolean") return true;
    report("typeMismatch", `${what} 는 boolean 이어야 하는데 ${describeType(t)} 입니다`, ref);
    return false;
  };

  /** 함수조항 전용 식(필드 읽기 · 연산)의 문맥 — 문맥 플래그가 없으면 structure (구분자 식 · 문면 식 경계). */
  const inClause = (what: string): boolean => {
    if (options.params) return true;
    report("structure", `${what} 는 함수조항 안에서만 쓸 수 있습니다`);
    return false;
  };

  /** 열거형 모양. 없으면(검사 재료를 안 줌) structure. */
  const enumOf = (enumCode: Code) => {
    const info = options.enums?.(enumCode);
    if (!info) report(options.enums ? "brokenRef" : "structure", options.enums ? `열거형 ${enumCode} 이(가) 없습니다` : `열거형 ${enumCode} 의 모양을 알 수 없어 검사할 수 없습니다`);
    return info;
  };

  const listOf = (t: ExprType | undefined, what: string): (ExprType & { kind: "list<enum>" }) | undefined => {
    if (t === undefined) return undefined;
    if (t.kind === "list<enum>") return t;
    report("typeMismatch", `${what} 은(는) 열거형 목록(list<enum>)에만 쓸 수 있습니다 (${describeType(t)} 불가)`);
    return undefined;
  };

  const walkCall = (e: Expr & { kind: "call" }): ExprType | undefined => {
    if (!inClause(`연산 .${e.op}`)) return undefined;
    const t = walk(e.target);
    switch (e.op) {
      case "합치기": {
        if (t === undefined) return undefined;
        if (t.kind !== "planOptions") {
          report("typeMismatch", `합치기는 세목 선택지 목록에만 쓸 수 있습니다 (${describeType(t)} 불가)`);
          return undefined;
        }
        if (e.ref.form !== t.form) {
          report("typeMismatch", `합치기(${refPath(e.ref)}) — 세목 선택지 목록<${t.form}> 의 필드가 아닙니다`, e.ref);
          return undefined;
        }
        const ft = options.planField?.(e.ref.form, e.ref.field);
        if (ft === undefined) {
          report("brokenRef", `합치기(${refPath(e.ref)}) — 폼 ${e.ref.form} 에 그 필드가 없습니다`, e.ref);
          return undefined;
        }
        if (ft.kind !== "enum" && ft.kind !== "list<enum>") {
          report("typeMismatch", `합치기(${refPath(e.ref)}) — 열거형 · 열거형 목록 필드만 합칩니다 (${describeType(ft)} 불가)`, e.ref);
          return undefined;
        }
        return { kind: "list<enum>", enumCode: ft.enumCode };
      }
      case "있음": {
        const list = listOf(t, "있음");
        if (!list) return undefined;
        const info = enumOf(list.enumCode);
        if (!info) return undefined;
        const missing = e.values.filter((v) => !info.values.includes(v));
        if (missing.length > 0) {
          report("brokenRef", `없는 값 ${missing.join(" · ")} — 열거형 ${list.enumCode} 에 없습니다`);
          return undefined;
        }
        return BOOLEAN;
      }
      case "거르기": {
        const list = listOf(t, "거르기");
        if (!list) return undefined;
        const info = enumOf(list.enumCode);
        if (!info) return undefined;
        const field = info.fields.find((f) => f.key === e.field);
        if (!field) {
          report("brokenRef", `열거형 ${list.enumCode} 에 필드 ${e.field} 이(가) 없습니다`);
          return undefined;
        }
        if (e.value.type !== field.type) {
          report("typeMismatch", `거르기(${e.field} = …) — 필드 ${e.field} 은(는) ${field.type} 인데 값이 ${e.value.type} 입니다`);
          return undefined;
        }
        return list;
      }
      case "비었음":
        return listOf(t, "비었음") ? BOOLEAN : undefined;
    }
  };

  const walk = (e: Expr): ExprType | undefined => {
    switch (e.kind) {
      case "member": {
        if (!inClause(`필드 읽기 .${e.field}`)) return undefined;
        const t = walk(e.target);
        if (t === undefined) return undefined;
        if (t.kind !== "enum") {
          report("typeMismatch", `필드 읽기 .${e.field} 는 열거값(enum)에만 쓸 수 있습니다 (${describeType(t)} 불가)`);
          return undefined;
        }
        const info = enumOf(t.enumCode);
        if (!info) return undefined;
        const field = info.fields.find((f) => f.key === e.field);
        if (!field) {
          report("brokenRef", `열거형 ${t.enumCode} 에 필드 ${e.field} 이(가) 없습니다`);
          return undefined;
        }
        return { kind: field.type };
      }
      case "call":
        return walkCall(e);
      case "literal":
        return literalType(e.literal);

      case "ref": {
        if (e.ref.kind === "attr") {
          report(
            "typeMismatch",
            `담보속성 attr.${e.ref.code} 는 exist(attr.X) · attr.X = '값' · attr.X ≠ '값' 형태로만 쓸 수 있습니다`,
            e.ref,
          );
          return undefined;
        }
        return typeOfRef(e.ref);
      }

      case "not": {
        const t = walk(e.operand);
        return expectBoolean(t, "not 의 피연산자") ? BOOLEAN : undefined;
      }

      case "and":
      case "or": {
        const l = walk(e.left);
        const r = walk(e.right);
        const lok = expectBoolean(l, `${e.kind} 의 왼쪽`);
        const rok = expectBoolean(r, `${e.kind} 의 오른쪽`);
        return lok && rok ? BOOLEAN : undefined;
      }

      case "compare": {
        if (e.left.kind === "ref" && e.left.ref.kind === "attr") {
          return checkAttributeCompare(e.left.ref, e.op, e.right);
        }
        const l = walk(e.left);
        const r = walk(e.right);
        if (l === undefined || r === undefined) return undefined;
        const fine = e.op === "=" || e.op === "≠" ? equatable(l, r) : orderable(l, r);
        if (!fine) {
          const leftRef = e.left.kind === "ref" ? e.left.ref : undefined;
          report(
            "typeMismatch",
            `'${e.op}' 의 양변 타입이 맞지 않습니다: ${describeType(l)} ${e.op} ${describeType(r)}`,
            leftRef,
          );
          return undefined;
        }
        return BOOLEAN;
      }

      case "aggregate": {
        if (e.op === "count" && options.params) {
          report("typeMismatch", "함수조항 식에는 개수 연산(count)이 없습니다 — 목록은 있음 · 비었음 · 거르기로 가공한다", e.ref);
          return undefined;
        }
        const t = typeOfRef(e.ref);
        if (t === undefined) return undefined;
        switch (e.op) {
          case "exist":
          case "notexist":
            return BOOLEAN;
          case "any":
          case "all":
            return expectBoolean(t, `${e.op} 의 경로 ${refPath(e.ref)}`, e.ref) ? BOOLEAN : undefined;
          case "sum":
            if (t.kind !== "number") {
              report("typeMismatch", `sum 의 경로 ${refPath(e.ref)} 는 number 여야 하는데 ${describeType(t)} 입니다`, e.ref);
              return undefined;
            }
            return NUMBER;
          case "count":
            if (t.kind === "list<enum>" || t.kind === "attribute" || t.kind === "table" || t.kind === "planOptions") {
              report("typeMismatch", `count 의 경로 ${refPath(e.ref)} 는 스칼라여야 하는데 ${describeType(t)} 입니다`, e.ref);
              return undefined;
            }
            return NUMBER;
        }
      }
    }
  };

  const type = walk(expr);
  if (type !== undefined && options.expect !== undefined && type.kind !== options.expect) {
    report("typeMismatch", `식의 결과는 ${options.expect} 이어야 하는데 ${describeType(type)} 입니다`);
  }
  if (issues.length > 0 || type === undefined) {
    return reject({ reason: "invalid", issues });
  }
  return ok(type);
}

/** 조건 자리(if/elif · 인라인 조건) 검사 — 결과가 boolean 이어야 한다. */
export function checkCondition(
  expr: Expr,
  resolve: TypeResolver,
  coordinate?: Coordinate,
  params?: ParamTypes,
): Result<ExprType> {
  return checkTypes(expr, resolve, { coordinate, expect: "boolean", ...(params ? { params } : {}) });
}
