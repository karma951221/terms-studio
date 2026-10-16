// src/domain/coverage/keys.ts
/**
 * 담보 노드 키 (순수) — ADR-0087 결정 2 · 기능/담보 §3.8.
 *
 * - 세부보장 `01` · `02` …(두 자리, 99 를 넘으면 자릿수를 늘린다), 급부 `1` · `2` …(그 세부보장 안). 형제 사이에서 유일하다.
 * - 채번 = 비어 있는 가장 작은 번호. **저장의 최종 트리 기준** — 같은 저장에서 지운 노드의 키도 빈 번호다(지운 키 재사용).
 * - 사람이 고치지 않고, 순서(↑↓)와 무관하다. 키 경로 = `01`(세부보장) · `01.2`(급부).
 */
import type { AttachLevel, Id } from "../types";
import type { Coverage, CoverageNode, CoverageNodeRef } from "./types";

export type KeyedLevel = "subCoverage" | "benefit";

/** 키 경로 모양 — 세부보장 키(두 자리 이상) + 선택 급부 키. 정규형만(`001` · `01.02` 불가) — 식 토큰(`@01.2`)과 검사가 같은 규칙을 쓴다. */
export const NODE_KEY_PATH = /^(0[1-9]|[1-9]\d+)(?:\.([1-9]\d*))?$/;

export function formatNodeKey(level: KeyedLevel, n: number): string {
  return level === "subCoverage" && n < 100 ? String(n).padStart(2, "0") : String(n);
}

/** 빈 가장 작은 번호 — 키는 숫자로 비교한다(`"01"` = 1). */
export function smallestFreeKey(level: KeyedLevel, taken: Iterable<string>): string {
  const used = new Set<number>();
  for (const k of taken) used.add(Number(k));
  let n = 1;
  while (used.has(n)) n += 1;
  return formatNodeKey(level, n);
}

type KeyedNode = { id: Id; key: string };
export type KeyedTree = { subCoverages: (KeyedNode & { benefits: KeyedNode[] })[] };

/**
 * 형제 행에 키를 매긴다 — `isKept(id)` 인 행은 키를 지키고, 나머지는 순서대로 빈 가장 작은 키를 받는다.
 * assignNodeKeys(저장) · 초안 키 미리보기가 같은 루프를 쓴다.
 */
export function fillKeys<N extends KeyedNode>(level: KeyedLevel, rows: readonly N[], isKept: (id: Id) => boolean): N[] {
  const taken = rows.filter((x) => isKept(x.id)).map((x) => x.key);
  return rows.map((x) => {
    if (isKept(x.id)) return x;
    const key = smallestFreeKey(level, taken);
    taken.push(key);
    return { ...x, key };
  });
}

/**
 * 최종 트리에 키를 매긴다 — `keep(id)` 인 노드(원본에 있던 노드)는 키를 지키고, 나머지는 형제 순서대로 빈 가장 작은 키를 받는다.
 * 지운 노드는 이미 트리에 없으므로 그 키는 빈 번호다.
 */
export function assignNodeKeys<T extends KeyedTree>(tree: T, keep: (id: Id) => boolean): T {
  const subs = fillKeys("subCoverage", tree.subCoverages, keep).map((s) => ({ ...s, benefits: fillKeys("benefit", s.benefits, keep) }));
  return { ...tree, subCoverages: subs };
}

export function parseKeyPath(path: string): { sub: string; benefit?: string } | undefined {
  const m = NODE_KEY_PATH.exec(path);
  if (!m) return undefined;
  return m[2] === undefined ? { sub: m[1] } : { sub: m[1], benefit: m[2] };
}

export function keyPathOf(sub: { key: string }, benefit?: { key: string }): string {
  return benefit ? `${sub.key}.${benefit.key}` : sub.key;
}

/** 키 경로의 노드 — 세부보장 또는 급부. 없으면 undefined(끊어진 참조). */
export function nodeByKeyPath(tree: Coverage, path: string): CoverageNode | undefined {
  const p = parseKeyPath(path);
  if (!p) return undefined;
  const sub = tree.subCoverages.find((s) => s.key === p.sub);
  if (!sub) return undefined;
  const root: CoverageNodeRef = { level: "coverage", id: tree.id };
  if (p.benefit === undefined) return { level: "subCoverage", id: sub.id, name: sub.name, ancestors: [root], keyPath: sub.key };
  const b = sub.benefits.find((x) => x.key === p.benefit);
  return b ? { level: "benefit", id: b.id, name: b.name, ancestors: [root, { level: "subCoverage", id: sub.id }], keyPath: keyPathOf(sub, b) } : undefined;
}

/** 트리 깊이 — 담보 0 · 세부보장 1 · 급부 2 (담보 레벨은 키가 없어 뺀다). */
export const TREE_DEPTH: Record<KeyedLevel, number> = { subCoverage: 1, benefit: 2 };

/** 반복(`loopLevel` 레벨 행마다 도는 반복)이 `level` 레벨 노드를 푸는가 — 같거나 더 깊은 레벨의 반복이면 푼다. */
export function coveredByLoop(level: KeyedLevel, loopLevel: KeyedLevel): boolean {
  return TREE_DEPTH[level] <= TREE_DEPTH[loopLevel];
}

/** 구분자 레벨이 반복 레벨보다 **아래**인가 — 한정자 없이 읽으면 읽을 노드가 없다. 담보 이상 · 키 없는 레벨은 늘 읽힌다. */
export function belowLoop(level: AttachLevel, loopLevel: AttachLevel): boolean {
  if ((level !== "subCoverage" && level !== "benefit") || (loopLevel !== "subCoverage" && loopLevel !== "benefit")) return false;
  return !coveredByLoop(level, loopLevel);
}

export const LEVEL_WORD: Record<KeyedLevel, string> = { subCoverage: "세부보장", benefit: "급부" };

export function nodeKeyLabel(level: KeyedLevel, key: string, name?: string): string {
  return name ? `${LEVEL_WORD[level]} ${key} · ${name}` : `${LEVEL_WORD[level]} ${key}`;
}

/** 「세부보장 01 · 이름 › 급부 1 · 이름」 — 화면 · 오류 좌표 · 값 패널 공용. 없는 키 경로면 undefined. */
export function keyPathLabel(tree: Coverage, path: string): string | undefined {
  const p = parseKeyPath(path);
  const node = p ? nodeByKeyPath(tree, path) : undefined;
  if (!p || !node) return undefined;
  const sub = tree.subCoverages.find((s) => s.key === p.sub)!;
  const head = nodeKeyLabel("subCoverage", sub.key, sub.name);
  if (p.benefit === undefined) return head;
  const b = sub.benefits.find((x) => x.key === p.benefit)!;
  return `${head} › ${nodeKeyLabel("benefit", b.key, b.name)}`;
}
