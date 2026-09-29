/**
 * 인자 연결 적용 (순수) — 조립이 함수조항을 펼치기 전에 본문의 `arg.<이름>` 을 사용처 연결로 바꿔 쓴다 (최종 결정 2 · 기능/함수조항 §3.7).
 *
 * - 구분자 연결: `arg.X` → 그 구분자 코드. 펼친 본문은 사용처 문맥에서 평가되므로 늦은 바인딩과 같은 결과다(사용처마다 다른 구분자).
 * - 상수 연결: 조건 · 비교 안의 `arg.X` → 리터럴, 슬롯 `arg.X` → 그 값의 글(`formatConst` — 조립의 값 표기 규칙).
 * - 원천 · 반복의 현재 원소: P7 본문은 읽을 수 없다(목록 연산은 P8, 반복은 P11) — 식에 닿으면 `unsupported`.
 * - 인자를 읽지 않는 식은 손대지 않는다(소스 그대로 — 스냅샷 무변동). 인자가 없는 함수조항은 그대로 돌려준다.
 *
 * 계획은 「평가 문맥(EvalContext) 래퍼」를 적었으나, 슬롯은 치환 단계(substitute)가 따로 평가하므로 펼칠 때 소스를 바꿔 쓰는 편이
 * 조립 파이프 뒤쪽(치환 · 렌더 · 원문 대조)을 건드리지 않는다 — 결과는 같다.
 */
import { format, parse, refPath, type Expr, type Literal, type Ref } from "../expression";
import { ok, reject } from "../types";
import type { Coordinate, Issue, Result, ScalarValue } from "../types";
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

export function applyBindings(clause: Clause, bindings: Bindings | undefined, formatConst: ConstFormatter, at: Coordinate = {}): Result<Clause> {
  const params = clause.params ?? [];
  if (params.length === 0) return ok(clause);
  const byName = new Map(params.map((p) => [p.name, p] as const));
  const bound = effectiveBindings(clause, bindings);
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
      default:
        fail({ kind: "unsupported", message: `함수조항 ${clause.code} 의 인자 ${ref.name} — ${b.kind === "source" ? "원천(세목 선택지 목록)" : "반복의 현재 원소"} 연결은 본문 식이 아직 읽지 못합니다`, at: here });
        return undefined;
    }
  };

  const rewriteExpr = (e: Expr): Expr => {
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

  /** 식 소스 → 바꾼 소스. 인자를 안 읽으면(또는 문법 오류면) 그대로. */
  const rewrite = (src: string): string => {
    if (!src.includes("arg.")) return src;
    const parsed = parse(src);
    if (!parsed.ok) return src;
    return format(rewriteExpr(parsed.value));
  };

  /** 슬롯 — 상수 연결이면 글로, 구분자 연결이면 코드로. */
  const slot = (n: Inline & { kind: "slot" }): Inline => {
    if (!n.ref.includes("arg.")) return n;
    const parsed = parse(n.ref);
    if (!parsed.ok || parsed.value.kind !== "ref" || parsed.value.ref.kind !== "param") return n;
    const param = byName.get(parsed.value.ref.name);
    const b = bound[parsed.value.ref.name];
    if (param && b?.kind === "const") return { id: n.id, kind: "text", text: formatConst(b.value, param) };
    const r = replacement(parsed.value.ref);
    return r ? { ...n, ref: format(r) } : n;
  };

  /** 노드 하나 — 모양을 몰라도 걷는다(가지 · 글 · 호 목록 · 목 목록). 슬롯과 가지 조건만 바꾼다. */
  type Loose = { kind: string; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: { when?: string; children: unknown[] }[] };
  const node = (n: ClauseNode): ClauseNode => {
    if (n.kind === "slot") return slot(n);
    const any = n as unknown as Loose;
    const walk = (list: unknown[]) => list.map((c) => node(c as ClauseNode));
    let out: Loose = any;
    if (any.branches) out = { ...out, branches: any.branches.map((br) => ({ ...br, ...(br.when !== undefined ? { when: rewrite(br.when) } : {}), children: walk(br.children) })) };
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

