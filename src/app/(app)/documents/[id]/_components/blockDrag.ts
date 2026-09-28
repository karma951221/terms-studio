/**
 * 블록 끌어 옮기기 — 순수 규칙 (기능/문면 §4.3 「끌어 옮기기」, 2026-09-28). React 없음 (`blockDrag.test.ts`).
 *
 * - 끄는 것 = 블록 하나, 또는 **고른 잇닿은 형제 블록 여럿**(`blockSel`) — 고른 것 가운데 하나를 끌면 고른 것 전부가 간다.
 * - 놓는 자리 = 다른 블록의 앞 · 뒤(그 블록과 같은 목록), 조 제목 위(그 조 맨 앞), 목차의 조(그 조 끝). 조 · 관은 목차에서 끈다.
 * - 허용 자식 규칙(§3.2)에 맞지 않는 자리 · 끄는 블록 자신과 그 하위에는 놓을 수 없다 — 그 자리에서는 놓기 표시가 서지 않는다.
 * 명령은 `editOps.moveRangeOps`(옮기기 전 트리 자리 → 차례로 적용해도 순서가 어긋나지 않는 `move` 들).
 */
import { allowedIn, type NodeKind, type Position, type TreeIndex } from "@/domain/document";
import type { Id } from "@/domain/types";

import { selectionRange } from "./editOps";

/** 놓는 방식 — 블록 앞 · 뒤, 조 안 맨 앞(조 제목 위) · 맨 끝(목차의 조). */
export type DropWhere = "before" | "after" | "start" | "end";

/** 끄는 블록들 — 손잡이의 블록이 고른 것 안이면 고른 것 전부, 아니면 그 블록 하나. */
export function dragIds(handleId: Id, blockSel: readonly Id[]): Id[] {
  return blockSel.includes(handleId) ? [...blockSel] : [handleId];
}

/**
 * 고르기 — 손잡이를 누르면 그 블록 하나, Shift 를 누른 채면 처음 고른 것부터 그 블록까지 잇닿은 형제 전부
 * (다른 목록에 있으면 둘을 다 덮는 가장 작은 형제 범위 — `selectionRange`).
 */
export function extendSelection(ix: TreeIndex, blockSel: readonly Id[], id: Id, extend: boolean): Id[] {
  if (!extend || blockSel.length === 0 || !ix.nodes.has(blockSel[0])) return [id];
  const range = selectionRange(ix, blockSel[0], id);
  if (!range) return [id];
  // 처음 고른 것이 범위의 끝에 있으면 앞에서부터 — 범위는 늘 자리 순서
  return range.ids;
}

/** 노드가 끄는 블록 자신이거나 그 하위인가. */
function inside(ix: TreeIndex, dragging: readonly Id[], id: Id): boolean {
  const path = ix.nodes.get(id)?.path ?? ix.branches.get(id)?.path ?? [];
  return dragging.some((d) => path.includes(d));
}

/**
 * 놓을 자리 — 놓을 수 없으면 undefined. `overId` 는 포인터 아래의 블록(조 제목 · 목차면 조).
 * 앞 · 뒤는 그 블록의 목록에, 맨 앞 · 끝은 그 조의 본문에. 끄는 블록 종류가 모두 그 목록의 허용 자식이어야 한다.
 */
export function dropPosition(ix: TreeIndex, dragging: readonly Id[], overId: Id, where: DropWhere): Position | undefined {
  if (dragging.length === 0 || inside(ix, dragging, overId)) return undefined;
  const kinds = dragging.map((id) => ix.nodes.get(id)?.node.kind).filter((k): k is NodeKind => k !== undefined);
  if (kinds.length !== dragging.length) return undefined;
  const over = ix.nodes.get(overId);
  if (!over) return undefined;
  if (where === "start" || where === "end") {
    if (over.node.kind !== "article") return undefined;
    const children = [...ix.nodes.values()].filter((e) => e.parentId === overId && e.slot === "children");
    const allowed = allowedIn("article", "children") ?? [];
    if (!kinds.every((k) => allowed.includes(k))) return undefined;
    return { parentId: overId, slot: "children", index: where === "start" ? 0 : children.length };
  }
  if (over.parentId === undefined) return undefined;
  if (!kinds.every((k) => over.allowed.includes(k))) return undefined;
  return { parentId: over.parentId, slot: over.slot, index: where === "before" ? over.index : over.index + 1 };
}
