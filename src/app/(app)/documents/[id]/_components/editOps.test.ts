import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, replayEdits, sequentialIds, type DocumentNode, type EditOp, type ParagraphNode } from "@/domain/document";

import { backspaceOps, enterOps, inlineAtOf, moveOps, moveRangeOps, newTable, pasteGridOps, removeChipOps, selectionRange, unwrapOps, wrapOps, wrapRangeOps } from "./editOps";

/** 편집본에 명령 목록을 적용한 트리 — 거부면 던진다. */
function run(tree: DocumentNode, ops: readonly EditOp[]): DocumentNode {
  const r = replayEdits({ tree }, ops, { env: {}, generalRefs: () => undefined });
  if (!r.ok) throw new Error(`거부: ${JSON.stringify(r.rejection)}`);
  return r.value.tree;
}

/** 조 하나(항 둘) — text n1 · slot n2 · paragraph n3 · text n4 · paragraph n5 · article n6 · document n7. */
function doc(): DocumentNode {
  const b = nodeBuilders(sequentialIds("n"));
  return b.document("D", [b.article("가", [b.paragraph([b.text("앞 "), b.slot("D0001")]), b.paragraph([b.text("둘째")])])]);
}

describe("가운데 편집기 조작 → 편집 명령", () => {
  it("조건으로 감싸기 → 풀기 — 항이 제자리로 돌아온다", () => {
    const d = doc();
    const wrapped = run(d, wrapOps(d, "n5", "D0001 = true", sequentialIds("w")));
    const article = indexTree(wrapped).nodes.get("n6")!.node as { children: { kind: string; id: string }[] };
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "condBlock"]);
    const branchId = indexTree(wrapped).nodes.get("n5")!.parentId!;
    const back = run(wrapped, unwrapOps(wrapped, branchId));
    expect((indexTree(back).nodes.get("n6")!.node as { children: { id: string }[] }).children.map((c) => c.id)).toEqual(["n3", "n5"]);
  });

  it("문장 안 조건 풀기 — 첫 가지 문장을 그 자리에 꺼낸다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const cond = b.inlineCond([b.inlineBranch("D0001 = true", [b.text("갱신계약")]), b.inlineBranch(undefined, [b.text("최초계약")])]); // n1 n2 n3 n4 n5
    const d = b.document("D", [b.article("가", [b.paragraph([b.text("이 "), cond])])]);
    const out = run(d, unwrapOps(d, "n2"));
    const p = [...indexTree(out).nodes.values()].find((e) => e.node.kind === "paragraph")!.node as ParagraphNode;
    expect(p.children.map((c) => (c.kind === "text" ? c.text : c.kind))).toEqual(["이 ", "갱신계약"]);
  });

  it("칩 삭제 · 문장 자리 찾기", () => {
    const d = doc();
    expect(inlineAtOf(d, indexTree(d), "n2")?.at).toEqual({ parentId: "n3" });
    const out = run(d, removeChipOps(d, "n2"));
    expect((indexTree(out).nodes.get("n3")!.node as ParagraphNode).children.map((c) => c.id)).toEqual(["n1"]);
  });

  it("위로 · 아래로 — 경계면 명령 없음", () => {
    const d = doc();
    expect(moveOps(d, "n3", -1)).toEqual([]);
    expect(moveOps(d, "n3", 1)).toEqual([{ type: "move", nodeId: "n3", to: { parentId: "n6", slot: "children", index: 1 } }]);
  });

  it("표 넣기 · 엑셀 붙여넣기 — 모자란 행 · 열을 늘리고 셀을 채운다", () => {
    const t = newTable(1, 1, true, sequentialIds("t"));
    expect(t.rows).toEqual([{ header: true, cells: [[]] }]);
    const b = nodeBuilders(sequentialIds("n"));
    const d = b.document("D", [b.article("가", [t])]);
    const ops = pasteGridOps(t, 0, 0, "용어\t정의\n계약자\t회사와…", sequentialIds("c"))!;
    const out = run(d, ops);
    const table = indexTree(out).nodes.get(t.id)!.node as { rows: { cells: { text?: string }[][] }[] };
    expect(table.rows.map((r) => r.cells.map((c) => c[0]?.text ?? ""))).toEqual([
      ["용어", "정의"],
      ["계약자", "회사와…"],
    ]);
    expect(pasteGridOps(t, 0, 0, "한 칸", sequentialIds("c"))).toBeUndefined();
  });
});

/**
 * 조 둘 — 가(제1항[호 1 · 2] · 제2항 · 제3항) · 나(제1항).
 * ids: 호 i1 i2 · 항 p1 p2 p3 · 조 a1 · 항 q1 · 조 a2 · 문서 d (글자 노드는 t*).
 */
function multi(): DocumentNode {
  let t = 0;
  const b = nodeBuilders(() => `t${++t}`);
  const with_ = <T extends { id: string }>(n: T, id: string): T => ({ ...n, id });
  const i1 = with_(b.item([b.text("호1")]), "i1");
  const i2 = with_(b.item([b.text("호2")]), "i2");
  const p1 = with_(b.paragraph([b.text("항1")], [i1, i2]), "p1");
  const p2 = with_(b.paragraph([b.text("항2")]), "p2");
  const p3 = with_(b.paragraph([b.text("항3")]), "p3");
  const q1 = with_(b.paragraph([b.text("나1")]), "q1");
  return with_(b.document("D", [with_(b.article("가", [p1, p2, p3]), "a1"), with_(b.article("나", [q1]), "a2")]), "d");
}

const childIds = (tree: DocumentNode, id: string) => ((indexTree(tree).nodes.get(id)!.node as { children: { id: string }[] }).children ?? []).map((c) => c.id);

describe("선택 범위 → 잇닿은 형제 블록 (조건식 · 끌어 옮기기, 2026-09-28)", () => {
  const d = multi();
  const ix = indexTree(d);
  it("한 항 안의 선택 → 그 항", () => {
    expect(selectionRange(ix, "p1", "p1")?.ids).toEqual(["p1"]);
  });
  it("제1항과 그 제2호에 걸친 선택 → 제1항 하나(호를 품은 채)", () => {
    expect(selectionRange(ix, "p1", "i2")?.ids).toEqual(["p1"]);
    expect(selectionRange(ix, "i2", "p1")?.ids).toEqual(["p1"]);
  });
  it("제1항의 호에서 제3항까지 → 제1항~제3항", () => {
    expect(selectionRange(ix, "i1", "p3")).toEqual({ parentId: "a1", slot: "children", ids: ["p1", "p2", "p3"] });
  });
  it("같은 항의 호 둘 → 호 둘", () => {
    expect(selectionRange(ix, "i2", "i1")?.ids).toEqual(["i1", "i2"]);
  });
  it("조를 넘는 선택 → 조 둘", () => {
    expect(selectionRange(ix, "p2", "q1")?.ids).toEqual(["a1", "a2"]);
  });
  it("담을 수 없는 자리면 부모 블록으로 — 함수조항 본문의 호는 조건 블록을 못 품는다", () => {
    const onlyParagraphs = (id: string) => ix.nodes.get(id)?.node.kind === "paragraph";
    expect(selectionRange(ix, "i1", "i2", onlyParagraphs)?.ids).toEqual(["p1"]);
  });
  it("서로 다른 조건 가지에 걸치면 그 조건 블록 하나", () => {
    const b = nodeBuilders(sequentialIds("c"));
    const x = b.paragraph([b.text("x")]);
    const y = b.paragraph([b.text("y")]);
    const cond = b.condBlock([b.branch("D0001 = true", [x]), b.branch(undefined, [y])]);
    const t = b.document("D", [b.article("가", [cond])]);
    expect(selectionRange(indexTree(t), x.id, y.id)?.ids).toEqual([cond.id]);
  });
});

describe("여러 블록 감싸기 · 옮기기", () => {
  it("제1항~제2항을 조건 블록 하나로 — 순서 그대로 가지 안에", () => {
    const d = multi();
    const out = run(d, wrapRangeOps(d, ["p1", "p2"], "", sequentialIds("w")));
    const kids = (indexTree(out).nodes.get("a1")!.node as { children: { kind: string; id: string; branches?: { children: { id: string }[] }[] }[] }).children;
    expect(kids.map((k) => k.kind)).toEqual(["condBlock", "paragraph"]);
    expect(kids[0].branches![0].children.map((c) => c.id)).toEqual(["p1", "p2"]);
  });

  it("아래로 — 제1·2항을 제3항 뒤로", () => {
    const d = multi();
    expect(childIds(run(d, moveRangeOps(d, ["p1", "p2"], { parentId: "a1", slot: "children", index: 3 })), "a1")).toEqual(["p3", "p1", "p2"]);
  });

  it("위로 — 제2·3항을 맨 앞으로", () => {
    const d = multi();
    expect(childIds(run(d, moveRangeOps(d, ["p2", "p3"], { parentId: "a1", slot: "children", index: 0 })), "a1")).toEqual(["p2", "p3", "p1"]);
  });

  it("제자리(범위 안 · 바로 뒤)면 명령 없음", () => {
    const d = multi();
    expect(moveRangeOps(d, ["p1", "p2"], { parentId: "a1", slot: "children", index: 1 })).toEqual([]);
    expect(moveRangeOps(d, ["p1", "p2"], { parentId: "a1", slot: "children", index: 2 })).toEqual([]);
  });

  it("다른 조로 — 제2·3항을 조 나의 제1항 앞으로", () => {
    const d = multi();
    const out = run(d, moveRangeOps(d, ["p2", "p3"], { parentId: "a2", slot: "children", index: 0 }));
    expect(childIds(out, "a2")).toEqual(["p2", "p3", "q1"]);
    expect(childIds(out, "a1")).toEqual(["p1"]);
  });

  it("조 둘 — 문서 목록 안에서 순서를 바꾼다", () => {
    const d = multi();
    expect(childIds(run(d, moveRangeOps(d, ["a2"], { parentId: "d", slot: "children", index: 0 })), "d")).toEqual(["a2", "a1"]);
  });
});

describe("글머리 목록 — Enter · Backspace (기능/문면 §4.3, 2026-09-28)", () => {
  /** 조 가: 항 p1 · 목록 L[항목 b1 「가」 · b2 빈 항목]. */
  function listDoc(): DocumentNode {
    let n = 0;
    const b = nodeBuilders(() => `z${++n}`);
    const as = <T extends { id: string }>(node: T, id: string): T => ({ ...node, id });
    return as(b.document("D", [as(b.article("가", [as(b.paragraph([b.text("항")]), "p1"), as(b.bulletList([as(b.bullet([b.text("가")]), "b1"), as(b.bullet([]), "b2")]), "L")]), "a1")]), "d");
  }
  const kinds = (tree: DocumentNode, id: string) => (indexTree(tree).nodes.get(id)!.node as { children: { kind: string }[] }).children.map((c) => c.kind);

  it("글이 있는 항목에서 Enter — 바로 뒤에 빈 항목, 커서는 거기", () => {
    const d = listDoc();
    const k = enterOps(d, "b1", sequentialIds("e"))!;
    const out = run(d, k.ops);
    expect(kinds(out, "L")).toEqual(["bullet", "bullet", "bullet"]);
    expect(indexTree(out).nodes.get(k.focus!)?.node.kind).toBe("bullet");
  });

  it("빈 항목에서 Enter — 목록을 끝낸다: 그 항목을 빼고 목록 뒤에 목록 앞과 같은 단계(항)의 빈 칸", () => {
    const d = listDoc();
    const k = enterOps(d, "b2", sequentialIds("e"))!;
    const out = run(d, k.ops);
    expect(kinds(out, "L")).toEqual(["bullet"]);
    expect(kinds(out, "a1")).toEqual(["paragraph", "bulletList", "paragraph"]);
    expect(indexTree(out).nodes.get(k.focus!)?.index).toBe(2);
  });

  it("빈 항목에서 Backspace — 그 항목을 지우고 앞 항목으로, 마지막 항목이면 목록째", () => {
    const d = listDoc();
    const k = backspaceOps(d, "b2")!;
    expect(k.focus).toBe("b1");
    const out = run(d, k.ops);
    expect(kinds(out, "L")).toEqual(["bullet"]);
    const k2 = backspaceOps(out, "b1")!;
    expect(k2.ops).toEqual([{ type: "remove", nodeId: "L" }]);
    expect(k2.focus).toBe("p1");
  });

  it("항 · 호 · 목의 Enter 는 그대로 — 같은 종류를 아래에", () => {
    const d = listDoc();
    const out = run(d, enterOps(d, "p1", sequentialIds("e"))!.ops);
    expect(kinds(out, "a1")).toEqual(["paragraph", "paragraph", "bulletList"]);
  });
});
