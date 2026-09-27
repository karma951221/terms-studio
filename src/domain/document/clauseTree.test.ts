import { describe, expect, it } from "vitest";

import type { Block, Inline } from "../clause/nodes";
import { CLAUSE_ARTICLE_ID, CLAUSE_LINE_ID, clauseBodyToTree, optionCarrier, optionCodeOf, treeToClauseBody } from "./clauseTree";
import { applyEdit, generalRefsOf, type EditEnv } from "./edit";
import type { DocumentNode } from "./nodes";

const block: Block[] = [
  {
    id: "p1",
    kind: "paragraph",
    children: [
      { id: "t1", kind: "text", text: "이 특별약관은 " },
      { id: "o1", kind: "optionSlot", optionCode: "O01" },
      { id: "r1", kind: "articleRef", targets: [{ nodeId: "g-a1" }], connector: "및" },
    ],
    items: [{ id: "i1", kind: "item", children: [{ id: "t2", kind: "text", text: "호" }], subitems: [{ id: "s1", kind: "subitem", children: [] }] }],
  },
  { id: "c1", kind: "condBlock", branches: [{ id: "b1", when: "D0001 = true", children: [{ id: "p2", kind: "paragraph", children: [] }] }] },
];

const inline: Inline[] = [
  { id: "t1", kind: "text", text: "지급기일은 " },
  { id: "q1", kind: "inlineCond", branches: [{ id: "qb", when: "D0001 = true", children: [{ id: "o1", kind: "optionSlot", optionCode: "O02" }] }] },
];

describe("공용조항 본문 ↔ 편집 트리", () => {
  it("「항」 본문은 조 하나의 자식으로 싸이고, 되돌리면 그대로다 — 옵션 자리는 운반체, 조 참조는 보통약관 범위", () => {
    const tree = clauseBodyToTree("block", block, "특별약관의 소멸");
    const article = tree.children[0];
    expect(article?.id).toBe(CLAUSE_ARTICLE_ID);
    const p1 = article?.kind === "article" ? article.children[0] : undefined;
    expect(p1?.kind === "paragraph" && p1.children[1]).toEqual(optionCarrier("o1", "O01"));
    expect(p1?.kind === "paragraph" && p1.children[2]).toMatchObject({ kind: "articleRef", scope: "general" });
    expect(treeToClauseBody("block", tree)).toEqual({ ok: true, value: block });
  });

  it("「문구」 본문은 항 하나의 문장이다 — 인라인 조건 안의 옵션 자리도 되돌아온다", () => {
    const tree = clauseBodyToTree("inline", inline);
    const article = tree.children[0];
    expect(article?.kind === "article" && article.children.map((c) => c.id)).toEqual([CLAUSE_LINE_ID]);
    expect(treeToClauseBody("inline", tree)).toEqual({ ok: true, value: inline });
    expect(treeToClauseBody("inline", clauseBodyToTree("inline", []))).toEqual({ ok: true, value: [] });
  });

  it("옵션 운반체는 옵션 코드를 알아보고, 진짜 공용조항 참조는 운반체가 아니다", () => {
    expect(optionCodeOf(optionCarrier("x", "O03"))).toBe("O03");
    expect(optionCodeOf({ id: "x", kind: "clauseInlineRef", clauseCode: "C0001", options: {} })).toBeUndefined();
  });

  it("공용조항에 없는 노드(표 · 공용조항 참조 · 둘째 조)는 되돌릴 때 거부한다", () => {
    const base = clauseBodyToTree("block", block);
    const withTable: DocumentNode = {
      ...base,
      children: [{ id: CLAUSE_ARTICLE_ID, kind: "article", title: "", children: [{ id: "tb", kind: "table", columns: [{}], rows: [{ cells: [[]] }] }] }],
    };
    expect(treeToClauseBody("block", withTable).ok).toBe(false);
    const nested = clauseBodyToTree("inline", []);
    const line = nested.children[0]!.kind === "article" ? nested.children[0]!.children[0] : undefined;
    if (line?.kind === "paragraph") line.children.push({ id: "cr", kind: "clauseInlineRef", clauseCode: "C0002", options: {} });
    const r = treeToClauseBody("inline", nested);
    expect(!r.ok && r.rejection.reason === "invalid" && r.rejection.issues[0]?.message).toContain("중첩 금지");
    const twoArticles: DocumentNode = { ...base, children: [...base.children, { id: "a2", kind: "article", title: "", children: [] }] };
    expect(treeToClauseBody("block", twoArticles).ok).toBe(false);
  });

  it("문면 편집 명령이 그대로 먹는다 — 항을 넣고 보통약관 조 참조 대상은 보통약관 한 벌로 검사된다", () => {
    const general: DocumentNode = { id: "g", kind: "document", title: "보통약관", children: [{ id: "g-a1", kind: "article", title: "목적", children: [] }] };
    const env: EditEnv = { env: { kind: "special" }, generalRefs: (id) => (id === "g" ? generalRefsOf(general) : undefined) };
    const state = { tree: clauseBodyToTree("block", block), generalDocumentId: "g" };
    const added = applyEdit(state, { type: "insert", node: { id: "p3", kind: "paragraph", children: [] }, at: { parentId: CLAUSE_ARTICLE_ID } }, env);
    expect(added.ok).toBe(true);
    const back = added.ok ? treeToClauseBody("block", added.value.state.tree) : undefined;
    expect(back?.ok && (back.value as Block[]).map((b) => b.id)).toEqual(["p1", "c1", "p3"]);
    const broken = applyEdit(state, { type: "setArticleRef", nodeId: "r1", targets: [{ nodeId: "없는조" }], connector: "및", scope: "general" }, env);
    expect(broken.ok).toBe(false);
  });
});
