/**
 * 인자 연결 적용 (순수) — 조립이 함수조항을 펼치기 전에 본문의 `arg.<이름>` 을 사용처 연결로 바꿔 쓴다 (최종 결정 2 · 기능/함수조항 §3.7).
 *
 * - 구분자 연결: `arg.X` → 그 구분자 코드. 펼친 본문은 사용처 문맥에서 평가되므로 늦은 바인딩과 같은 결과다(사용처마다 다른 구분자).
 * - 상수 연결: 조건 · 비교 안의 `arg.X` → 리터럴, 슬롯 `arg.X` → 그 값의 글(`formatConst` — 조립의 값 표기 규칙).
 * - 함수조항 전용 식(내부 변수 · 열거값 필드 읽기 · 연산 · 원천 인자, P8): 평가 재료(`LocalEnv` — 사용처 문맥)를 주면 그 자리에서
 *   값으로 바꾼다(조건 · 비교 안 = 리터럴, 슬롯 = 글, locals.ts `localScope`). 재료가 없으면(편집기 미리보기) 그 부분은 손대지 않는다.
 * - 반복의 현재 원소(ADR-0077 결정 3): 원천처럼 값으로만 읽힌다 — 평가 재료의 `current`(조립이 넣는 자리를 감싼 반복의 원소)로 풀고, 재료가 없으면 그대로 둔다.
 * - 인자 · 내부 변수를 읽지 않는 식은 손대지 않는다(소스 그대로 — 스냅샷 무변동). 인자 · 내부 변수가 없는 함수조항은 그대로 돌려준다.
 *
 * 계획은 「평가 문맥(EvalContext) 래퍼」를 적었으나, 슬롯은 치환 단계(substitute)가 따로 평가하므로 펼칠 때 소스를 바꿔 쓰는 편이
 * 조립 파이프 뒤쪽(치환 · 렌더 · 원문 대조)을 건드리지 않는다 — 결과는 같다.
 */
import { format, parse, refPath, type Expr, type Literal, type Ref } from "../expression";
import { ok, reject } from "../types";
import type { Coordinate, Issue, Result, ScalarValue } from "../types";
import { hasClauseOnly, localScope, type LocalEnv } from "./locals";
import type { ClauseNode, Inline } from "./nodes";
import { effectiveBindings, type Binding, type Bindings, type ParamDef } from "./params";
import type { Clause, ClauseBody } from "./types";

/** 상수 → 슬롯 글. 타입은 인자 선언 타입(enum 이면 표시명을 찍는 쪽이 안다). */
export type ConstFormatter = (value: ScalarValue, param: ParamDef) => string;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function literalOf(value: ScalarValue, param: ParamDef): Literal {
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "number") return { type: "number", value };
  if (param.type.kind === "date" && DATE.test(value)) return { type: "date", value };
  return { type: "string", value };
}

export function applyBindings(clause: Clause, bindings: Bindings | undefined, formatConst: ConstFormatter, at: Coordinate = {}, env?: LocalEnv): Result<Clause> {
  const params = clause.params ?? [];
  const locals = clause.locals ?? [];
  if (params.length === 0 && locals.length === 0) return ok(clause);
  const byName = new Map(params.map((p) => [p.name, p] as const));
  const bound = effectiveBindings(clause, bindings);
  const scope = env ? localScope(params, locals, bound, env, at) : undefined;
  const isSource = (name: string) => bound[name]?.kind === "source" || bound[name]?.kind === "current";
  const issues: Issue[] = [];
  const reported = new Set<string>();
  const fail = (issue: Issue) => {
    const key = `${issue.kind}:${issue.at.refPath}`;
    if (reported.has(key)) return;
    reported.add(key);
    issues.push(issue);
  };

  /** 인자 참조 하나 → 바꿀 식. undefined 면 바꿀 수 없음(오류 보고됨). */
  const replacement = (ref: Ref & { kind: "param" }): Expr | undefined => {
    const param = byName.get(ref.name);
    const b: Binding | undefined = bound[ref.name];
    const here: Coordinate = { ...at, refPath: refPath(ref) };
    if (!param) {
      fail({ kind: "brokenRef", message: `함수조항 ${clause.code} 에 선언되지 않은 인자입니다: ${ref.name}`, at: here });
      return undefined;
    }
    if (!b) {
      fail({ kind: "argUnbound", message: `함수조항 ${clause.code} 의 인자 ${ref.name} 이(가) 연결되지 않았습니다`, at: here });
      return undefined;
    }
    switch (b.kind) {
      case "discriminator":
        return { kind: "ref", ref: { kind: "discriminator", code: b.code } };
      case "const":
        return { kind: "literal", literal: literalOf(b.value, param) };
      case "source":
        return undefined; // 원천은 값으로만 읽힌다 — 평가 재료가 있으면 localScope 가, 없으면(미리보기) 그대로 둔다
      case "current":
        return undefined; // 현재 원소도 값으로만 읽힌다 — 조립(재료 있음)은 localScope 가 원소 값으로, 미리보기는 그대로 둔다
    }
  };

  /** 평가 재료 없이 바꿔 쓰기 — 함수조항 전용 부분(필드 읽기 · 연산 · 내부 변수)은 그대로 둔다(안의 인자를 구분자 코드로 바꾸면 모양이 깨진다). */
  const rewriteExpr = (e: Expr): Expr => {
    if (hasClauseOnly(e, isSource) && (e.kind === "member" || e.kind === "call" || e.kind === "ref")) return e;
    switch (e.kind) {
      case "ref":
        return e.ref.kind === "param" ? (replacement(e.ref) ?? e) : e;
      case "not":
        return { ...e, operand: rewriteExpr(e.operand) };
      case "and":
      case "or":
      case "compare":
        return { ...e, left: rewriteExpr(e.left), right: rewriteExpr(e.right) };
      default:
        return e;
    }
  };

  const readsArgs = (src: string) => src.includes("arg.") || src.includes("var.");

  /** 식 소스 → 바꾼 소스. 인자 · 내부 변수를 안 읽으면(또는 문법 오류면) 그대로. */
  const rewrite = (src: string): string => {
    if (!readsArgs(src)) return src;
    const parsed = parse(src);
    if (!parsed.ok) return src;
    if (scope) {
      const r = scope.reduce(parsed.value);
      if (r.ok) return format(r.value);
      fail(r.issue);
      return src;
    }
    return format(rewriteExpr(parsed.value));
  };

  /** 슬롯 — 함수조항 전용 식(필드 읽기 등)이면 값 글로, 상수 연결이면 글로, 구분자 연결이면 코드로. */
  const slot = (n: Inline & { kind: "slot" }): Inline => {
    if (!readsArgs(n.ref)) return n;
    const parsed = parse(n.ref);
    if (!parsed.ok) return n;
    if (scope && hasClauseOnly(parsed.value, isSource)) {
      const t = scope.slotText(parsed.value);
      if (t.ok && t.value !== undefined) return { id: n.id, kind: "text", text: t.value };
      if (!t.ok) fail(t.issue);
      return n;
    }
    if (parsed.value.kind !== "ref" || parsed.value.ref.kind !== "param") return n;
    const param = byName.get(parsed.value.ref.name);
    const b = bound[parsed.value.ref.name];
    if (param && b?.kind === "const") return { id: n.id, kind: "text", text: formatConst(b.value, param) };
    const r = replacement(parsed.value.ref);
    return r ? { ...n, ref: format(r) } : n;
  };

  /** 노드 하나 — 모양을 몰라도 걷는다(가지 · 글 · 호 목록 · 목 목록). 슬롯과 가지 조건만 바꾼다. */
  type Loose = { kind: string; on?: string; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: { when?: string; children: unknown[] }[]; cases?: { children: unknown[] }[] };
  const node = (n: ClauseNode): ClauseNode => {
    if (n.kind === "slot") return slot(n);
    const any = n as unknown as Loose;
    const walk = (list: unknown[]) => list.map((c) => node(c as ClauseNode));
    let out: Loose = any;
    if (any.branches) out = { ...out, branches: any.branches.map((br) => ({ ...br, ...(br.when !== undefined ? { when: rewrite(br.when) } : {}), children: walk(br.children) })) };
    // 값별 분기 — 대상(arg.X · var.X)도 조건처럼 사용처 연결로 바꿔 쓴다(구분자 코드 · 값 리터럴). 칸은 가지처럼 걷는다
    if (typeof any.on === "string") out = { ...out, on: rewrite(any.on) };
    if (any.cases) out = { ...out, cases: any.cases.map((k) => ({ ...k, children: walk(k.children) })) };
    if (any.children) out = { ...out, children: walk(any.children) };
    if (any.items) out = { ...out, items: walk(any.items) };
    if (any.subitems) out = { ...out, subitems: walk(any.subitems) };
    return out as unknown as ClauseNode;
  };

  const body = (clause.body as ClauseNode[]).map(node) as ClauseBody;
  const options = clause.options.map((o) => ({ ...o, values: o.values.map((v) => ({ ...v, body: v.body.map(node) as Inline[] })) }));
  if (issues.length > 0) return reject({ reason: "invalid", issues });
  return ok({ ...clause, body, options } as Clause);
}

/** 기본 상수 표기 — 숫자는 천 단위 쉼표, 참거짓은 예/아니오, 나머지는 글 그대로(enum 은 코드 — 조립은 표시명 표기를 넘긴다). */
export function plainConst(value: ScalarValue): string {
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return value;
}

