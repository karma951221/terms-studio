import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand } from "./commands";
import { allowedIn, indexTree, type DocumentNode } from "./nodes";

/** 조 하나(항[호[목]]) — 글머리 목록을 넣어 본다. */
function doc() {
  const b = nodeBuilders(sequentialIds("n"));
  const subitem = b.subitem([b.text("목")]);
  const item = b.item([b.text("호")], [subitem]);
  const paragraph = b.paragraph([b.text("항")], [item]);
  const article = b.article("가", [paragraph]);
  const tree: DocumentNode = b.document("D", [article]);
  return { b, tree, article, paragraph, item, subitem };
}

describe("글머리 목록 — 자리 규칙 (기능/문면 §3.2 허용 자식, ADR-0012 확장 · 2026-09-28)", () => {
  it("조 직속 · 항의 호 목록 · 호의 목 목록에 선다 — 표 · 박스 자리 + 목 뒤", () => {
    expect(allowedIn("article", "children")).toContain("bulletList");
    expect(allowedIn("paragraph", "items")).toContain("bulletList");
    expect(allowedIn("item", "subitems")).toContain("bulletList");
    expect(allowedIn("bulletList", "children")).toEqual(["bullet", "condBlock"]);
  });

  it("넣기 — 항 뒤 · 호 뒤 · 목 뒤는 되고, 문서 자리 · 항목 안 목록은 거부", () => {
    const { b, tree, article, paragraph, item } = doc();
    const list = () => b.bulletList([b.bullet([b.text("가")])]);
    expect(applyCommand(tree, { type: "insert", node: list(), at: { parentId: article.id, index: 1 } }).ok).toBe(true);
    expect(applyCommand(tree, { type: "insert", node: list(), at: { parentId: paragraph.id, slot: "items" } }).ok).toBe(true);
    expect(applyCommand(tree, { type: "insert", node: list(), at: { parentId: item.id, slot: "subitems" } }).ok).toBe(true);
    expect(applyCommand(tree, { type: "insert", node: list(), at: { parentId: tree.id } }).ok).toBe(false);
    const inner = list();
    const withList = applyCommand(tree, { type: "insert", node: inner, at: { parentId: article.id } });
    if (!withList.ok) throw new Error("넣기 실패");
    expect(applyCommand(withList.value, { type: "insert", node: list(), at: { parentId: inner.id } }).ok).toBe(false);
  });

  it("항목이 없는 목록은 구조 오류 · 항목 문장 안의 칩도 색인된다", () => {
    const { b, tree, article } = doc();
    const slot = b.slot("D0001");
    const empty = b.bulletList([]);
    const full = b.bulletList([b.bullet([b.text("값 "), slot])]);
    article.children.push(empty, full);
    const ix = indexTree(tree);
    expect(ix.issues.map((i) => i.message)).toContain("글머리 목록에는 항목이 하나 이상 있어야 합니다");
    expect(ix.nodes.get(slot.id)?.allowed).toContain("slot");
  });
});
