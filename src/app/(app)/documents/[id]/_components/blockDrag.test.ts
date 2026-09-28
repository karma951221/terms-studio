import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, replayEdits, type DocumentNode, type EditOp } from "@/domain/document";

import { dragIds, dropPosition, extendSelection } from "./blockDrag";
import { moveRangeOps, moveSelectionOps } from "./editOps";

function run(tree: DocumentNode, ops: readonly EditOp[]): DocumentNode {
  const r = replayEdits({ tree }, ops, { env: {}, generalRefs: () => undefined });
  if (!r.ok) throw new Error(`거부: ${JSON.stringify(r.rejection)}`);
  return r.value.tree;
}

/** 조 가(항 p1[호 i1 · i2] · p2 · p3 · 표 t1) · 조 나(항 q1). */
function doc(): DocumentNode {
  let n = 0;
  const b = nodeBuilders(() => `x${++n}`);
  const as = <T extends { id: string }>(node: T, id: string): T => ({ ...node, id });
  return as(
    b.document("D", [
      as(
        b.article("가", [
          as(b.paragraph([b.text("1")], [as(b.item([b.text("호1")]), "i1"), as(b.item([b.text("호2")]), "i2")]), "p1"),
          as(b.paragraph([b.text("2")]), "p2"),
          as(b.paragraph([b.text("3")]), "p3"),
          as(b.table({ columns: [{}], rows: [{ cells: [[b.text("셀")]] }] }), "t1"),
        ]),
        "a1",
      ),
      as(b.article("나", [as(b.paragraph([b.text("나1")]), "q1")]), "a2"),
    ]),
    "d",
  );
}

const kids = (tree: DocumentNode, id: string) => (indexTree(tree).nodes.get(id)!.node as { children: { id: string }[] }).children.map((c) => c.id);

describe("끌어 옮기기 · 여러 블록 고르기 (기능/문면 §4.3, 2026-09-28)", () => {
  it("고른 것 가운데 하나를 끌면 고른 것 전부, 아니면 그 블록 하나", () => {
    expect(dragIds("p2", ["p1", "p2"])).toEqual(["p1", "p2"]);
    expect(dragIds("p3", ["p1", "p2"])).toEqual(["p3"]);
  });

  it("Shift+누르기 — 처음 고른 것부터 잇닿은 형제까지(거꾸로 눌러도 자리 순서)", () => {
    const ix = indexTree(doc());
    expect(extendSelection(ix, [], "p2", true)).toEqual(["p2"]);
    expect(extendSelection(ix, ["p3"], "p1", true)).toEqual(["p1", "p2", "p3"]);
    expect(extendSelection(ix, ["p1", "p2"], "p3", false)).toEqual(["p3"]);
    // 다른 목록(호 → 항)이면 둘을 다 덮는 형제 범위
    expect(extendSelection(ix, ["i1"], "p2", true)).toEqual(["p1", "p2"]);
  });

  it("놓을 자리 — 블록 앞 · 뒤는 그 목록, 조 제목은 조 맨 앞, 목차의 조는 조 끝", () => {
    const ix = indexTree(doc());
    expect(dropPosition(ix, ["p1", "p2"], "t1", "after")).toEqual({ parentId: "a1", slot: "children", index: 4 });
    expect(dropPosition(ix, ["p3"], "p1", "before")).toEqual({ parentId: "a1", slot: "children", index: 0 });
    expect(dropPosition(ix, ["p2", "p3"], "a2", "start")).toEqual({ parentId: "a2", slot: "children", index: 0 });
    expect(dropPosition(ix, ["p2", "p3"], "a2", "end")).toEqual({ parentId: "a2", slot: "children", index: 1 });
    expect(dropPosition(ix, ["a2"], "a1", "before")).toEqual({ parentId: "d", slot: "children", index: 0 });
  });

  it("놓을 수 없는 자리 — 자기 자신 · 하위, 허용 자식에 없는 목록(항을 호 목록에 · 조를 조 안에)", () => {
    const ix = indexTree(doc());
    expect(dropPosition(ix, ["p1"], "i1", "after")).toBeUndefined();
    expect(dropPosition(ix, ["p1", "p2"], "p2", "after")).toBeUndefined();
    expect(dropPosition(ix, ["p2"], "i2", "after")).toBeUndefined();
    expect(dropPosition(ix, ["a2"], "a1", "end")).toBeUndefined();
  });

  it("여러 항을 끌어 다른 조로 — 순서 그대로, 원래 조에서는 빠진다", () => {
    const d = doc();
    const pos = dropPosition(indexTree(d), ["p2", "p3"], "q1", "after")!;
    const out = run(d, moveRangeOps(d, ["p2", "p3"], pos));
    expect(kids(out, "a2")).toEqual(["q1", "p2", "p3"]);
    expect(kids(out, "a1")).toEqual(["p1", "t1"]);
  });

  it("고른 여럿을 위로 · 아래로 한 칸 — 끝이면 명령 없음", () => {
    const d = doc();
    expect(kids(run(d, moveSelectionOps(d, ["p2", "p3"], -1)), "a1")).toEqual(["p2", "p3", "p1", "t1"]);
    expect(kids(run(d, moveSelectionOps(d, ["p2", "p3"], 1)), "a1")).toEqual(["p1", "t1", "p2", "p3"]);
    expect(moveSelectionOps(d, ["p1", "p2"], -1)).toEqual([]);
    expect(moveSelectionOps(d, ["p3", "t1"], 1)).toEqual([]);
  });
});
