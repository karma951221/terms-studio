/**
 * 담보 트리의 구조 노드 · 자식 제공자 (ADR-0070 결정 2 · 6) — 반복 표 · 반복 블록이 담보 트리를 열거하는 창구.
 *
 * 담보 마스터 트리에도, 조립의 스냅샷 트리(`snapshotTree` — 같은 모양 · 스냅샷 id)에도 쓴다.
 * 행 문맥(값 평가)은 쓰는 쪽이 댄다 — 조립 문맥(`assembly/context.ts`).
 */
import type { ChildrenProviders, StructNode, StructNodeRef } from "../structure";
import type { Coverage } from "./types";

/** 담보 트리의 뿌리 구조 노드. */
export function coverageStructNode(tree: Coverage): StructNode {
  return { level: "coverage", id: tree.id, name: tree.name, order: 0 };
}

/**
 * 담보 트리의 자식 제공자 — coverage → 세부보장 · subCoverage → 급부 (order 오름차순).
 * plan · product 제공자는 없다 (탑재 제공자는 이후 — 상품 문맥 반복).
 */
export function coverageChildrenProviders(tree: Coverage): ChildrenProviders {
  const byOrder = <T extends { order: number }>(xs: readonly T[]) => [...xs].sort((a, b) => a.order - b.order);
  return {
    coverage: {
      children: (node: StructNodeRef) =>
        node.id === tree.id ? byOrder(tree.subCoverages).map((s) => ({ level: "subCoverage" as const, id: s.id, name: s.name, order: s.order })) : [],
    },
    subCoverage: {
      children: (node: StructNodeRef) => {
        const sub = tree.subCoverages.find((s) => s.id === node.id);
        return sub ? byOrder(sub.benefits).map((b) => ({ level: "benefit" as const, id: b.id, name: b.name, order: b.order })) : [];
      },
    },
  };
}
