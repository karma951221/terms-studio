/**
 * 인자 · 내부 변수 이름 바꾸기 (순수) — 기능/함수조항 §3.7 「이름 변경」 (2026-10-15 사용자 결정: 안쪽 + 사용처).
 *
 * 편집본은 「옛 이름 → 새 이름」 표를 들고, 저장 때 함수조항 안쪽을 한 번에 고친다:
 * 본문의 식(조건 `when` · 슬롯 `ref` · 값별 분기 대상 `on`) · 조 참조 인자 슬롯(`targets[].param`) · 내부 변수(선언 이름 · 식) · 프리셋(연결 키 · `fromUsage`).
 * 사용처 문서의 연결 키는 `document/clausePresets.renameBindingsIn` 이 같은 저장 트랜잭션에서 고친다.
 * 출력이 바뀌지 않는 개명이라 재검사 대상이 아니다. 바꾸기는 한 번에(맞바꾸기도) — 차례로 바꾸지 않는다.
 */
import { renameExprRefs } from "../expression/parser";
import type { LocalDef } from "./locals";

/** 옛 이름 → 새 이름. */
export interface ClauseRenames {
  params: Record<string, string>;
  locals: Record<string, string>;
}

export const NO_RENAMES: ClauseRenames = { params: {}, locals: {} };

/**
 * 남길 바꾸기만 — 같은 이름 · 새 이름이 지금 선언에 없음(그 사이 지웠다) · 옛 이름이 아직 선언에 있음(같은 이름을 새로 더했다 — 어느 쪽을 읽는지 모른다)은 뺀다.
 */
export function normalizeRenames(renames: ClauseRenames, current: { params: readonly string[]; locals: readonly string[] }): ClauseRenames {
  const keep = (map: Record<string, string>, names: readonly string[]) => {
    const now = new Set(names);
    return Object.fromEntries(Object.entries(map).filter(([from, to]) => from !== to && now.has(to) && !now.has(from)));
  };
  return { params: keep(renames.params, current.params), locals: keep(renames.locals, current.locals) };
}

export function hasRenames(r: ClauseRenames): boolean {
  return Object.keys(r.params).length > 0 || Object.keys(r.locals).length > 0;
}

function maps(r: ClauseRenames) {
  return { params: new Map(Object.entries(r.params)), locals: new Map(Object.entries(r.locals)) };
}

const EXPR_KEYS = new Set(["when", "ref", "on"]);

/** 본문(어느 유형이든) — 식 칸과 조 참조 인자 슬롯. 원본은 바꾸지 않는다. 글(text)은 건드리지 않는다. */
export function renameInBody<B>(body: B, renames: ClauseRenames): B {
  const m = maps(renames);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (EXPR_KEYS.has(k) && typeof v === "string") out[k] = renameExprRefs(v, m);
      else if (k === "targets" && Array.isArray(v) && n.kind === "articleRef" && n.scope === "param")
        out[k] = v.map((t: { param?: string }) => (t.param !== undefined && m.params.has(t.param) ? { ...t, param: m.params.get(t.param)! } : t));
      else out[k] = walk(v);
    }
    return out;
  };
  return walk(body) as B;
}

/** 내부 변수 — 선언 이름과 식. */
export function renameInLocals(locals: readonly LocalDef[], renames: ClauseRenames): LocalDef[] {
  const m = maps(renames);
  return locals.map((l) => ({ ...l, name: m.locals.get(l.name) ?? l.name, expr: renameExprRefs(l.expr, m) }));
}

/** 프리셋 — 인자 연결 키 · 「사용처가 채움」 이름 (프리셋 값에는 인자 이름이 없다). */
export function renameInPresets<P extends { bindings?: Record<string, unknown>; fromUsage?: string[] }>(presets: readonly P[], renames: ClauseRenames): P[] {
  const to = (name: string) => renames.params[name] ?? name;
  return presets.map((p) => ({
    ...p,
    ...(p.bindings ? { bindings: Object.fromEntries(Object.entries(p.bindings).map(([k, v]) => [to(k), v])) } : {}),
    ...(p.fromUsage ? { fromUsage: p.fromUsage.map(to) } : {}),
  }));
}
