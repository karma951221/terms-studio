/**
 * 조건 블록 머리 줄의 순수 재료 (기능/문면 §4.3 「조건식 = 블록 삽입 + 머리 줄 인라인 편집」, 2026-09-28). React 없음 — `rows.test.ts`.
 *
 * - 저장 형식은 그대로 식 소스(`when`) 하나다. 머리 줄은 줄 모델(`ConditionRows`, 도메인 `conditionRows.ts`)로 풀어 고치고
 *   다시 소스로 묶는다. 줄이 다 차지 않았으면 빈 소스(`""`) — 저장 검증이 그 가지를 오류로 잡아 그 자리로 안내한다.
 * - 줄로 풀 수 없는 식(괄호 중첩 · not · 집계 직접 사용)은 원문(`raw`) 읽기 전용 + 「줄로 다시 만들기」 (ADR-0066 결정 8).
 * - 변수 고르기는 목록 하나 — 담보약관이면 문맥 담보 트리의 노드마다 그 레벨 구분자(`@노드`), 반복 표 셀이면 「현재 행」,
 *   담보 문맥이 없으면(보통약관 · 함수조항) 레벨별 한정자 없는 구분자, 그 밖(상품 · 세목 레벨)은 「구분자」 묶음.
 *   값은 `코드` 또는 `코드@노드id` 글자다. 끝에 「담보속성」 묶음(값 `attr.코드`) — 있음 · 없음 · = · ≠ (2026-09-28).
 */
import { COVERAGE_NODE_LEVELS } from "@/domain/coverage";
import { ATTRIBUTE_OPS, emptyRows, operatorsFor, rowRefPath, toRows, toSource, type ConditionRows, type Join, type RowOp, type RowValueRef } from "@/domain/document";
import { parse, type AttributeRef } from "@/domain/expression";
import { ATTACH_LEVEL_LABEL } from "@/domain/types";

import type { ConditionContext, CtxDiscriminator } from "./types";

const TREE_LEVELS = new Set<string>(COVERAGE_NODE_LEVELS);

/** 줄 좌변 — 구분자 · 담보속성 · 인자(함수조항 본문, 최종 결정 2). */
export type LeftRef = RowValueRef | AttributeRef;

const ATTR_KEY = "attr.";
/** 인자 목록 값의 머리 — 조건 문맥의 인자 칸(`CtxDiscriminator.param`)은 코드가 `arg.<이름>` 이다. */
export const ARG_KEY = "arg.";
/** 내부 변수 목록 값의 머리 — 조건 문맥의 내부 변수 칸(`CtxDiscriminator.local`)은 코드가 `var.<이름>` 이다. */
export const VAR_KEY = "var.";

/** 참조 → 목록 값. 함수조항 칸(인자 · 내부 변수 · 필드 읽기)은 경로 글 그대로(`arg.X` · `var.X` · `arg.X.F01`). */
export function refKey(ref: LeftRef): string {
  if (ref.kind === "attr") return `${ATTR_KEY}${ref.code}`;
  if (ref.kind !== "discriminator") return rowRefPath(ref);
  return ref.node ? `${ref.code}@${ref.node.id}` : ref.code;
}

/** 값 참조 → 조건 문맥의 칸 코드 — 구분자는 코드, 함수조항 칸은 경로 글. */
export function ctxCodeOf(ref: RowValueRef): string {
  return ref.kind === "discriminator" ? ref.code : rowRefPath(ref);
}

/** 목록 값 → 참조. 빈 값이면 undefined. */
export function refOfKey(key: string): LeftRef | undefined {
  if (key === "") return undefined;
  if (key.startsWith(ATTR_KEY)) return { kind: "attr", code: key.slice(ATTR_KEY.length) };
  if (key.startsWith(ARG_KEY) || key.startsWith(VAR_KEY)) {
    const [head, name, field] = key.split(".");
    const target = head === "arg" ? ({ kind: "param", name } as const) : ({ kind: "local", name } as const);
    return field ? { kind: "field", target, field } : target;
  }
  const at = key.indexOf("@");
  return at < 0 ? { kind: "discriminator", code: key } : { kind: "discriminator", code: key.slice(0, at), node: { id: key.slice(at + 1) } };
}

export interface PickerGroup {
  label: string;
  options: { key: string; label: string }[];
}

/** 변수(구분자) 고르기 목록 — 묶음 순서가 곧 화면 순서. */
export function pickerGroups(context: ConditionContext): PickerGroup[] {
  const groups: PickerGroup[] = [];
  const at = (d: CtxDiscriminator, node?: { id: string; name: string }) => ({ key: node ? `${d.code}@${node.id}` : d.code, label: node ? `${d.label} @${node.name}` : d.label });
  // 함수조항 본문 — 인자가 맨 앞 묶음이다(본문은 인자만 읽는다, 최종 결정 2). 인자 칸은 아래 레벨 묶음에 섞지 않는다
  const params = context.discriminators.filter((d) => d.param);
  if (params.length > 0) groups.push({ label: "인자", options: params.map((d) => at(d)) });
  // 내부 변수(와 그 열거값 필드) — 인자 다음 묶음 (최종 결정 2)
  const locals = context.discriminators.filter((d) => d.local);
  if (locals.length > 0) groups.push({ label: "내부 변수", options: locals.map((d) => at(d)) });
  context = { ...context, discriminators: context.discriminators.filter((d) => !d.param && !d.local) };
  const row = context.row;
  if (row) {
    const readable = context.discriminators.filter((d) => TREE_LEVELS.has(d.level) && row.readable.includes(d.level));
    if (readable.length > 0) groups.push({ label: `현재 행 — ${row.levels.map((l) => ATTACH_LEVEL_LABEL[l]).join(" › ")}마다`, options: readable.map((d) => at(d)) });
  }
  const nodes = context.coverage?.nodes ?? [];
  // 트리 순서 — 뿌리부터 깊이 우선
  const ordered: typeof nodes = [];
  const walk = (parentId: string | undefined) => {
    for (const n of nodes.filter((x) => x.parentId === parentId)) {
      ordered.push(n);
      walk(n.id);
    }
  };
  walk(undefined);
  for (const node of ordered) {
    const leaves = context.discriminators.filter((d) => d.level === node.level);
    if (leaves.length === 0) continue;
    // 담보 뿌리 아래 잎은 한정자 없음, 세부보장 · 급부 아래 잎은 `@노드`
    groups.push({ label: `${ATTACH_LEVEL_LABEL[node.level]} — ${node.name}`, options: leaves.map((d) => (node.level === "coverage" ? at(d) : at(d, node))) });
  }
  // 담보 문맥이 없으면(보통약관 · 함수조항) 트리 레벨 구분자도 한정자 없이 레벨별로 — 사용처의 담보에서 읽힌다
  if (!context.coverage) {
    for (const level of COVERAGE_NODE_LEVELS) {
      const leaves = context.discriminators.filter((d) => d.level === level);
      if (leaves.length > 0) groups.push({ label: ATTACH_LEVEL_LABEL[level], options: leaves.map((d) => at(d)) });
    }
  }
  const flat = context.discriminators.filter((d) => !TREE_LEVELS.has(d.level));
  if (flat.length > 0) groups.push({ label: "구분자", options: flat.map((d) => at(d)) });
  const attributes = context.attributes ?? [];
  if (attributes.length > 0) groups.push({ label: "담보속성", options: attributes.map((a) => ({ key: `${ATTR_KEY}${a.code}`, label: a.label })) });
  return groups;
}

/** 머리 줄이 고치는 모양 — 줄들, 또는 줄로 풀 수 없는 식의 원문. */
export type HeadModel = { kind: "rows"; rows: ConditionRows } | { kind: "raw"; source: string };

/** 저장된 식 → 머리 줄. 빈 식은 빈 줄 하나(새 조건 블록). */
export function headOf(when: string | undefined): HeadModel {
  if (!when || when.trim() === "") return { kind: "rows", rows: emptyRows() };
  const parsed = parse(when);
  if (!parsed.ok) return { kind: "raw", source: when };
  const rows = toRows(parsed.value);
  return rows ? { kind: "rows", rows } : { kind: "raw", source: when };
}

/** 아무것도 고르지 않은 줄을 뺀다 — ⊕ 로 막 더한 빈 줄은 식을 바꾸지 않는다. */
export function compact(rows: ConditionRows): ConditionRows {
  const keep = rows.rows.map((r) => r.left !== undefined || r.op !== undefined || r.right !== undefined);
  const out: ConditionRows = { rows: [], joins: [] };
  rows.rows.forEach((r, i) => {
    if (!keep[i]) return;
    if (out.rows.length > 0) out.joins.push(rows.joins[i - 1] ?? "and");
    out.rows.push(r);
  });
  return out;
}

/** 머리 줄 → 저장할 식. 빈 줄은 빼고, 반쯤 찬 줄이 있으면 `""` (저장 검증이 그 가지를 오류로 잡는다). */
export function sourceOf(model: HeadModel): string {
  if (model.kind === "raw") return model.source.trim();
  const rows = compact(model.rows);
  return rows.rows.length === 0 ? "" : (toSource(rows) ?? "");
}

/** i 번째 줄 뒤에 빈 줄 — 새 줄의 결합은 `join`(기본 AND). */
export function addRow(rows: ConditionRows, after: number, join: Join = "and"): ConditionRows {
  const at = Math.max(0, Math.min(after + 1, rows.rows.length));
  const next = [...rows.rows];
  next.splice(at, 0, {});
  const joins = [...rows.joins];
  joins.splice(Math.max(0, at - 1), 0, join);
  return { rows: next, joins };
}

/** i 번째 줄 빼기 — 줄이 하나면 그대로. 첫 줄을 빼면 둘째 줄 앞 결합이 사라진다. */
export function removeRow(rows: ConditionRows, i: number): ConditionRows {
  if (rows.rows.length <= 1 || i < 0 || i >= rows.rows.length) return rows;
  return { rows: rows.rows.filter((_r, idx) => idx !== i), joins: rows.joins.filter((_j, idx) => idx !== Math.max(0, i - 1)) };
}

/** 좌변의 연산자 목록 — 담보속성이면 = · ≠ · 있음 · 없음, 구분자면 타입대로. */
export function opsOf(ref: LeftRef | undefined, typeOf: (ref: RowValueRef) => CtxDiscriminator["type"]): readonly RowOp[] {
  if (!ref) return [];
  if (ref.kind === "attr") return ATTRIBUTE_OPS;
  const t = typeOf(ref);
  return t ? operatorsFor(t.kind) : [];
}

/** 좌변을 바꾼다 — 타입이 같으면 연산자 · 우변을 두고, 다르면 첫 연산자 · 빈 우변. 담보속성은 속성이 바뀌면 늘 새로. */
export function setLeft(rows: ConditionRows, i: number, ref: LeftRef | undefined, typeOf: (ref: RowValueRef) => CtxDiscriminator["type"]): ConditionRows {
  return {
    ...rows,
    rows: rows.rows.map((r, idx) => {
      if (idx !== i) return r;
      if (!ref) return {};
      if (ref.kind === "attr" || r.left?.kind === "attr") {
        const ops = opsOf(ref, typeOf);
        return { left: ref, ...(ops[0] ? { op: ops[0] } : {}) };
      }
      const before = r.left ? typeOf(r.left)?.kind : undefined;
      const after = typeOf(ref)?.kind;
      if (before !== undefined && before === after) return { ...r, left: ref };
      const ops = after ? operatorsFor(after) : [];
      return { left: ref, ...(ops[0] ? { op: ops[0] } : {}) };
    }),
  };
}

/** 연산자 표시 — 옛 화면처럼 「일치(=)」. 있음 · 없음은 담보속성 전용. */
export const OP_LABEL: Record<RowOp, string> = { "=": "일치(=)", "≠": "불일치(≠)", "<": "미만(<)", "<=": "이하(≤)", ">": "초과(>)", ">=": "이상(≥)", exist: "있음", notexist: "없음" };

/** 머리 줄의 짧은 표시 — 읽기 모드 · 칩. 빈 식이면 「조건 없음」. */
export function headLabel(label: string, when: string | undefined, text: string): string {
  if (when === undefined) return label;
  return when.trim() === "" ? `${label} (조건 없음 — 머리 줄을 채운다)` : `${label} ${text}`;
}
