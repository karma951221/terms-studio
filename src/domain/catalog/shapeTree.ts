/**
 * `/catalog` 조회의 5층 모양 트리 — ADR-0070 결정 8 「조회 화면은 모양 트리」.
 *
 * 문맥이 없으니 key(실제 노드)는 그리지 않는다. **가지 = 부착 레벨**(상품 › 세목 › 담보 › 세부보장 › 급부,
 * `structure.ts` 의 구조 상수에서 그대로 파생 — 여기서 다섯 층을 다시 나열하지 않는다), **잎 = 그 레벨의 구분자**.
 * 가지는 접기 · 펴기만 — 조회의 검색 · 필터로 좁힌 잎만 담아, 그 잎이 있는 가지만 펼친 상태로 낸다.
 *
 * 순수층 — DB · React 없음.
 */
import { childLevelOf, LEVEL_STRUCTURE } from "../structure";
import type { AttachLevel } from "../types";

/** 5층 사슬 그대로 — 구조 상수의 `child` 를 따라간 것 (상품 → … → 급부). */
export function shapeLevels(): readonly AttachLevel[] {
  const levels: AttachLevel[] = [];
  let level: AttachLevel | undefined = LEVEL_STRUCTURE[0]?.level;
  while (level) {
    levels.push(level);
    level = childLevelOf(level);
  }
  return levels;
}

/** 모양 트리의 가지 하나 — 그 레벨의 잎(필터링된 것)과 다음 가지. 잎이 없는 층도 가지는 그대로 있다(모양이라서). */
export interface ShapeBranch<T> {
  level: AttachLevel;
  leaves: readonly T[];
  /** 이 가지 또는 그 아래 어딘가에 잎이 있는가 — 검색 · 필터가 걸렸을 때 펼 가지를 고르는 신호. */
  hasMatch: boolean;
  child?: ShapeBranch<T>;
}

/**
 * 필터링된 구분자 목록 → 5층 모양 트리 (뿌리 = 상품 가지). `levelOf` 로 레벨을 읽어 그 레벨 가지의 잎에 담는다.
 * 입력 순서를 유지한다 — 정렬은 호출부(목록의 기존 정렬 · 페이지 슬라이스)가 이미 정한다.
 */
export function buildShapeTree<T>(items: readonly T[], levelOf: (item: T) => AttachLevel): ShapeBranch<T> {
  const levels = shapeLevels();
  const byLevel = new Map<AttachLevel, T[]>(levels.map((level) => [level, []]));
  for (const item of items) {
    byLevel.get(levelOf(item))?.push(item);
  }
  const build = (index: number): ShapeBranch<T> => {
    const level = levels[index]!;
    const leaves = byLevel.get(level) ?? [];
    const child = index + 1 < levels.length ? build(index + 1) : undefined;
    return { level, leaves, hasMatch: leaves.length > 0 || (child?.hasMatch ?? false), child };
  };
  return build(0);
}

/** 가지 사슬을 배열로 — 렌더가 재귀 대신 평평하게 돌 때. */
export function branchChain<T>(root: ShapeBranch<T>): ShapeBranch<T>[] {
  const out: ShapeBranch<T>[] = [];
  let branch: ShapeBranch<T> | undefined = root;
  while (branch) {
    out.push(branch);
    branch = branch.child;
  }
  return out;
}
