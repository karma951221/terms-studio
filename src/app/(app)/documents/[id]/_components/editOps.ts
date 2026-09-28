/**
 * 가운데 편집기의 조작 → 편집 명령 (순수 — React 없음. `editOps.test.ts`).
 *
 * 오른쪽 클릭 메뉴 · 셀 조작 줄 · 키보드(Enter · Backspace)가 여기서 명령을 만든다. 규칙 검사는 도메인 `applyCommand` 몫이다 —
 * 여기는 「어느 자리에 무엇을」만 정한다. 새 노드 id 는 브라우저에서 매겨 명령에 실린다(서버가 같은 id 로 다시 적용한다 — ADR-0074).
 */
import {
  indexTree,
  nodeBuilders,
  type BlockNode,
  type DocumentNode,
  type EditOp,
  type IdSource,
  type InlineAt,
  type InlineNode,
  type Node,
  type Position,
  type TableNode,
  type TreeIndex,
} from "@/domain/document";
import type { Id } from "@/domain/types";

import { moveTarget } from "../../lib";
import { parseGrid, runsReplacing, runsWithout } from "./inlineRuns";

/** 노드 바로 뒤 자리 (같은 부모 · 같은 목록). 루트면 undefined. */
export function afterOf(ix: TreeIndex, nodeId: Id): Position | undefined {
  const e = ix.nodes.get(nodeId);
  if (!e || e.parentId === undefined) return undefined;
  return { parentId: e.parentId, slot: e.slot, index: e.index + 1 };
}

/** 같은 부모 · 같은 목록의 형제 수와 자기 자리 — 위로 · 아래로를 막을지 정한다. */
export function siblingPlace(ix: TreeIndex, nodeId: Id): { index: number; count: number } | undefined {
  const e = ix.nodes.get(nodeId);
  if (!e || e.parentId === undefined) return undefined;
  const count = [...ix.nodes.values()].filter((o) => o.parentId === e.parentId && o.slot === e.slot).length;
  return { index: e.index, count };
}

/** 한 칸 위/아래 — 경계면 명령 없음. */
export function moveOps(tree: DocumentNode, nodeId: Id, dir: -1 | 1): EditOp[] {
  const to = moveTarget(tree, nodeId, dir);
  return to ? [{ type: "move", nodeId, to }] : [];
}

/** 빈 항 · 호 · 목 · 조 · 관(첫 조 하나를 품는다 — 조 없는 관은 목차에서 고를 수 없어 비워 두지 않는다). */
export function emptyNode(kind: "paragraph" | "item" | "subitem" | "article" | "section" | "box", newId: IdSource): BlockNode {
  const b = nodeBuilders(newId);
  switch (kind) {
    case "paragraph":
      return b.paragraph([]);
    case "item":
      return b.item([]);
    case "subitem":
      return b.subitem([]);
    case "article":
      return b.article("새 조", []);
    case "section":
      return b.section("새 관", [b.article("새 조", [])]);
    case "box":
      return b.box("용어풀이", []);
  }
}

/** 행 수 × 열 수 빈 표 — 첫 행을 제목줄로 둘 수 있다. */
export function newTable(rows: number, cols: number, headerFirst: boolean, newId: IdSource, title?: string): TableNode {
  const r = Math.max(1, Math.min(50, Math.floor(rows) || 1));
  const c = Math.max(1, Math.min(12, Math.floor(cols) || 1));
  return nodeBuilders(newId).table({
    ...(title ? { title } : {}),
    columns: Array.from({ length: c }, () => ({})),
    rows: Array.from({ length: r }, (_x, i) => ({ ...(headerFirst && i === 0 ? { header: true } : {}), cells: Array.from({ length: c }, (): InlineNode[] => []) })),
  });
}

/**
 * 조건으로 감싸기 — 노드 자리에 조건 블록(가지 하나)을 세우고 노드를 그 가지 안으로 옮긴다. `branchId` 를 주면 그 가지 id 로
 * (툴바가 새 가지의 머리 줄에 초점을 두려고 미리 정한다).
 * 가지 안 허용 집합은 블록이 선 자리와 같다(투명) — 옮기는 명령이 자리 규칙을 다시 본다.
 */
export function wrapOps(tree: DocumentNode, nodeId: Id, when: string, newId: IdSource, branchId?: Id): EditOp[] {
  const e = indexTree(tree).nodes.get(nodeId);
  if (!e || e.parentId === undefined) return [];
  const b = nodeBuilders(newId);
  const branch = { ...b.branch(when, []), ...(branchId ? { id: branchId } : {}) };
  const cond = b.condBlock([branch]);
  return [
    { type: "insert", node: cond, at: { parentId: e.parentId, slot: e.slot, index: e.index } },
    { type: "move", nodeId, to: { parentId: branch.id, index: 0 } },
  ];
}

/**
 * 조건 풀기 — 고른 가지의 내용을 조건이 서 있던 자리로 꺼내고 조건을 지운다(다른 가지의 내용은 함께 사라진다).
 * 문장 안 조건이면 가지의 인라인 노드를 그 문장 자리에 꺼낸다.
 */
export function unwrapOps(tree: DocumentNode, branchId: Id): EditOp[] {
  const ix = indexTree(tree);
  const br = ix.branches.get(branchId);
  if (!br) return [];
  const owner = ix.nodes.get(br.ownerId);
  if (!owner || owner.parentId === undefined) return [];
  if (owner.node.kind === "inlineCond") {
    const loc = inlineAtOf(tree, ix, owner.node.id);
    if (!loc) return [];
    return [{ type: "setInlines", at: loc.at, runs: runsReplacing(loc.list, owner.node.id, br.branch.children as InlineNode[]) }];
  }
  const children = br.branch.children as Node[];
  return [
    ...children.map((c, i): EditOp => ({ type: "move", nodeId: c.id, to: { parentId: owner.parentId!, slot: owner.slot, index: owner.index + i } })),
    { type: "remove", nodeId: owner.node.id },
  ];
}

/** 인라인 노드가 선 문장 자리 — 표 셀이면 셀 좌표로. */
export function inlineAtOf(tree: DocumentNode, ix: TreeIndex, nodeId: Id): { at: InlineAt; list: InlineNode[] } | undefined {
  const e = ix.nodes.get(nodeId);
  if (!e || e.parentId === undefined) return undefined;
  const branch = ix.branches.get(e.parentId);
  if (branch) return { at: { parentId: e.parentId }, list: branch.branch.children as InlineNode[] };
  const parent = ix.nodes.get(e.parentId)?.node;
  if (!parent) return undefined;
  if (parent.kind === "table") {
    for (const [row, r] of parent.rows.entries()) {
      for (const [col, cell] of r.cells.entries()) if (cell.some((n) => n.id === nodeId)) return { at: { tableId: parent.id, row, col }, list: cell };
    }
    return undefined;
  }
  return "children" in parent ? { at: { parentId: parent.id }, list: parent.children as InlineNode[] } : undefined;
}

/** 문장 자리의 지금 목록 (편집본에서). */
export function inlineListAt(tree: DocumentNode, at: InlineAt): InlineNode[] | undefined {
  const ix = indexTree(tree);
  if ("tableId" in at) {
    const t = ix.nodes.get(at.tableId)?.node;
    return t?.kind === "table" ? t.rows[at.row]?.cells[at.col] : undefined;
  }
  const br = ix.branches.get(at.parentId);
  if (br) return br.branch.children as InlineNode[];
  const n = ix.nodes.get(at.parentId)?.node;
  return n && "children" in n ? (n.children as InlineNode[]) : undefined;
}

/** 칩 삭제 — 그 문장 자리에서 칩을 뺀다. */
export function removeChipOps(tree: DocumentNode, chipId: Id): EditOp[] {
  const loc = inlineAtOf(tree, indexTree(tree), chipId);
  return loc ? [{ type: "setInlines", at: loc.at, runs: runsWithout(loc.list, chipId) }] : [];
}

/**
 * 표에 붙여넣기 — 탭 · 줄로 나뉜 글을 누른 셀부터 채운다. 모자란 행 · 열은 끝에 늘린다. 채운 셀의 내용은 글로 바뀐다.
 * 한 칸짜리 글이면 undefined (셀 안 문장으로 넣는다).
 */
export function pasteGridOps(table: TableNode, row: number, col: number, text: string, newId: IdSource): EditOp[] | undefined {
  const grid = parseGrid(text);
  if (!grid || grid.length === 0) return undefined;
  const ops: EditOp[] = [];
  const needRows = row + grid.length - table.rows.length;
  for (let i = 0; i < needRows; i++) ops.push({ type: "insertTableRow", tableId: table.id, index: table.rows.length + i });
  const needCols = col + Math.max(...grid.map((r) => r.length)) - table.columns.length;
  for (let i = 0; i < needCols; i++) ops.push({ type: "insertTableColumn", tableId: table.id, index: table.columns.length + i });
  grid.forEach((cells, ri) =>
    cells.forEach((value, ci) => {
      ops.push({ type: "setInlines", at: { tableId: table.id, row: row + ri, col: col + ci }, runs: value === "" ? [] : [{ id: newId(), text: value }] });
    }),
  );
  return ops;
}

// ───────────────────────────── 여러 블록 — 선택 범위 · 감싸기 · 옮기기 (2026-09-28) ─────────────────────────────

/** 잇닿은 형제 블록 범위 — 같은 부모 · 같은 목록, 순서대로. */
export interface SiblingRange {
  parentId: Id;
  slot: Position["slot"];
  ids: Id[];
}

/** 노드 하나의 범위. 루트면 undefined. */
function rangeOf(ix: TreeIndex, ids: readonly Id[]): SiblingRange | undefined {
  const first = ix.nodes.get(ids[0]);
  if (!first || first.parentId === undefined) return undefined;
  return { parentId: first.parentId, slot: first.slot, ids: [...ids] };
}

/** 같은 부모 · 목록의 형제 id — 자리 순서대로. */
function siblingsOf(ix: TreeIndex, parentId: Id, slot: Position["slot"]): Id[] {
  return [...ix.nodes.values()]
    .filter((e) => e.parentId === parentId && e.slot === slot)
    .sort((a, b) => a.index - b.index)
    .map((e) => e.node.id);
}

/**
 * 선택이 걸친 블록 → 그것을 다 덮는 **가장 작은 잇닿은 형제 범위** (기능/문면 §4.3 「조건식」 · 끌어 옮기기).
 * - 한 블록 안이면 그 블록. 한쪽이 다른 쪽의 조상이면(항과 그 항의 호) 조상 하나 — 호만 떼어 낼 수 없다.
 * - 아니면 공통 조상 바로 아래의 두 가지 사이 형제 전부. 서로 다른 조건 가지에 걸치면 그 조건 블록 하나.
 * - `canHold(nodeId)` 가 거짓인 자리(그 목록에 조건 블록이 설 수 없음 등)면 부모 블록으로 올라간다. 끝내 없으면 undefined.
 */
export function selectionRange(ix: TreeIndex, startId: Id, endId: Id, canHold: (nodeId: Id) => boolean = () => true): SiblingRange | undefined {
  const pathOf = (id: Id) => ix.nodes.get(id)?.path ?? ix.branches.get(id)?.path;
  const pa = pathOf(startId);
  const pb = pathOf(endId);
  if (!pa || !pb) return undefined;
  let k = 0;
  while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++;
  let ids: Id[];
  if (k === pa.length || k === pb.length) {
    // 한쪽이 다른 쪽의 조상(또는 같은 블록) — 짧은 쪽의 끝
    ids = [(k === pa.length ? pa : pb)[k - 1]];
  } else {
    const a = pa[k];
    const b = pb[k];
    const ea = ix.nodes.get(a);
    const eb = ix.nodes.get(b);
    if (!ea || !eb || ea.parentId !== eb.parentId || ea.slot !== eb.slot) {
      // 서로 다른 가지(조건 블록 아래) — 조건 블록 하나로
      ids = [pa[k - 1]];
    } else {
      const [lo, hi] = ea.index <= eb.index ? [ea.index, eb.index] : [eb.index, ea.index];
      ids = siblingsOf(ix, ea.parentId!, ea.slot).slice(lo, hi + 1);
    }
  }
  // 가지 id 면 그 조건 블록으로, 담을 수 없는 자리면 부모 블록으로
  for (;;) {
    if (ids.length === 1) {
      const br = ix.branches.get(ids[0]);
      if (br) ids = [br.ownerId];
    }
    if (ids.every((id) => ix.nodes.has(id) && canHold(id))) return rangeOf(ix, ids);
    const parent = ix.nodes.get(ids[0])?.parentId;
    if (parent === undefined) return undefined;
    ids = [parent];
  }
}

/**
 * 잇닿은 형제 블록들을 조건 블록 하나(가지 하나)로 감싼다 — 첫 블록 자리에 조건 블록을 세우고 블록들을 순서대로 가지 안으로.
 * 블록 하나면 `wrapOps` 와 같다.
 */
export function wrapRangeOps(tree: DocumentNode, ids: readonly Id[], when: string, newId: IdSource, branchId?: Id): EditOp[] {
  const ix = indexTree(tree);
  const first = ix.nodes.get(ids[0]);
  if (!first || first.parentId === undefined || ids.length === 0) return [];
  const b = nodeBuilders(newId);
  const branch = { ...b.branch(when, []), ...(branchId ? { id: branchId } : {}) };
  const cond = b.condBlock([branch]);
  return [
    { type: "insert", node: cond, at: { parentId: first.parentId, slot: first.slot, index: first.index } },
    ...ids.map((nodeId, i): EditOp => ({ type: "move", nodeId, to: { parentId: branch.id, index: i } })),
  ];
}

/**
 * 잇닿은 형제 블록들을 한 자리로 옮긴다 — `to` 는 **옮기기 전** 트리의 자리(그 목록의 몇 번째 앞). 순서는 그대로.
 * 제자리(범위 안 · 바로 뒤)면 명령 없음. 규칙(허용 자식 · 자기 하위로 옮기기)은 도메인 `move` 가 다시 본다.
 * 뒤에서부터 「바로 뒤에 올 것」 앞으로 넣는다 — 명령이 차례로 적용되며 자리가 밀려도 순서가 어긋나지 않는다.
 */
export function moveRangeOps(tree: DocumentNode, ids: readonly Id[], to: Position): EditOp[] {
  const ix = indexTree(tree);
  const range = ids.length > 0 ? rangeOf(ix, ids) : undefined;
  if (!range) return [];
  const moving = new Set(ids);
  const slot = to.slot ?? "children";
  const target = siblingsOf(ix, to.parentId, slot);
  const at = Math.max(0, Math.min(to.index ?? target.length, target.length));
  const same = range.parentId === to.parentId && range.slot === slot;
  if (same) {
    const first = target.indexOf(ids[0]);
    if (at >= first && at <= first + ids.length) return [];
  }
  // 바로 뒤에 올 것 — 목표 자리부터 옮기지 않는 첫 형제 (없으면 끝)
  let anchor: Id | undefined = target.slice(at).find((id) => !moving.has(id));
  const list = [...target];
  const ops: EditOp[] = [];
  for (const nodeId of [...ids].reverse()) {
    const cur = list.indexOf(nodeId);
    if (cur >= 0) list.splice(cur, 1);
    const index = anchor === undefined ? list.length : list.indexOf(anchor);
    ops.push({ type: "move", nodeId, to: { parentId: to.parentId, slot, index } });
    list.splice(index, 0, nodeId);
    anchor = nodeId;
  }
  return ops;
}

/** 고른 잇닿은 블록들을 한 칸 위 · 아래로 (툴바 위로 · 아래로 — 여럿을 골랐을 때). 끝이면 명령 없음. */
export function moveSelectionOps(tree: DocumentNode, ids: readonly Id[], dir: -1 | 1): EditOp[] {
  const ix = indexTree(tree);
  const first = ix.nodes.get(ids[0]);
  const last = ix.nodes.get(ids[ids.length - 1]);
  if (!first || !last || first.parentId === undefined) return [];
  const count = siblingsOf(ix, first.parentId, first.slot).length;
  const index = dir < 0 ? first.index - 1 : last.index + 2;
  if (index < 0 || index > count) return [];
  return moveRangeOps(tree, ids, { parentId: first.parentId, slot: first.slot, index });
}
