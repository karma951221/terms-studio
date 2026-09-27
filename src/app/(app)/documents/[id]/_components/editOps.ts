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
 * 조건으로 감싸기 — 노드 자리에 조건 블록(가지 하나)을 세우고 노드를 그 가지 안으로 옮긴다.
 * 가지 안 허용 집합은 블록이 선 자리와 같다(투명) — 옮기는 명령이 자리 규칙을 다시 본다.
 */
export function wrapOps(tree: DocumentNode, nodeId: Id, when: string, newId: IdSource): EditOp[] {
  const e = indexTree(tree).nodes.get(nodeId);
  if (!e || e.parentId === undefined) return [];
  const b = nodeBuilders(newId);
  const branch = b.branch(when, []);
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
