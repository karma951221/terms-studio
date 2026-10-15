/**
 * 문서 트리의 함수조항 프리셋 사용 (순수) — ADR-0084 결정 7 · 8.
 *
 * - `unfoldPresetsIn` : 지운 프리셋을 쓰던 함수조항 참조를 프리셋 값의 직접 연결 · 옵션 선택으로 푼다(출력 불변). 원본은 바꾸지 않는다.
 *   문면 템플릿 트리 · 상품 조 사본(조 하나) 어느 모양이든 걷는다.
 * - `presetUses` : 함수조항 하나의 프리셋별 사용 수 (관계정보).
 * - `renameBindingsIn` : 함수조항 인자 이름 바꾸기 — 그 함수조항 참조의 인자 연결 키를 새 이름으로(출력 불변, 기능/함수조항 §3.7).
 */
import { unfoldPreset } from "../clause/presets";
import type { Clause } from "../clause/types";
import type { Code } from "../types";

type ClauseRefLike = { kind: string; clauseCode: Code; options: Record<Code, Code>; bindings?: Record<string, unknown>; preset?: Code };

function walk(node: unknown, visit: (ref: ClauseRefLike) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== "object") return;
  const n = node as { kind?: string };
  if (n.kind === "clauseBlockRef" || n.kind === "clauseInlineRef") visit(node as ClauseRefLike);
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, visit);
}

export function unfoldPresetsIn<T>(root: T, clause: Clause, removed: ReadonlySet<Code>): { node: T; count: number } {
  const copy = structuredClone(root);
  let count = 0;
  walk(copy, (ref) => {
    if (ref.clauseCode !== clause.code || ref.preset === undefined || !removed.has(ref.preset)) return;
    const direct = unfoldPreset(clause, ref as Parameters<typeof unfoldPreset>[1]);
    delete ref.preset;
    ref.options = direct.options;
    if (direct.bindings && Object.keys(direct.bindings).length > 0) ref.bindings = direct.bindings;
    else delete ref.bindings;
    count += 1;
  });
  return { node: copy, count };
}

export function presetUses(root: unknown, clauseCode: Code): Map<Code, number> {
  const out = new Map<Code, number>();
  walk(root, (ref) => {
    if (ref.clauseCode === clauseCode && ref.preset !== undefined) out.set(ref.preset, (out.get(ref.preset) ?? 0) + 1);
  });
  return out;
}

/** 인자 이름 바꾸기의 사용처 몫 — 그 함수조항 참조의 `bindings` 키를 한 번에 바꾼다(맞바꾸기도). 원본은 바꾸지 않는다. `count` = 고친 참조 수. */
export function renameBindingsIn<T>(root: T, clauseCode: Code, renames: ReadonlyMap<string, string>): { node: T; count: number } {
  const copy = structuredClone(root);
  let count = 0;
  if (renames.size === 0) return { node: copy, count };
  walk(copy, (ref) => {
    if (ref.clauseCode !== clauseCode || !ref.bindings) return;
    const keys = Object.keys(ref.bindings);
    if (!keys.some((k) => renames.has(k))) return;
    ref.bindings = Object.fromEntries(keys.map((k) => [renames.get(k) ?? k, ref.bindings![k]]));
    count += 1;
  });
  return { node: copy, count };
}
