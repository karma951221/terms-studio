import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, InlineCondNode, ParagraphNode, TableNode } from "../../src/domain/document/nodes";
import { validateTree } from "../../src/domain/document/nodes";

import { applyArticleConds, applyInlineConds, type NumberOf } from "./overlay";

const WHEN = "exist(attr.A0001) and attr.A0001 = 'V02'";

/** 변환 1차(구조) 직후 모양 — 항·표 셀의 본문은 아직 평문 텍스트 노드 하나다. */
function tree(): DocumentNode {
  const paragraph: ParagraphNode = {
    id: "s-a1-p1",
    kind: "paragraph",
    children: [{ id: "s-a1-p1-x0", kind: "text", text: "「연간」이라 함은 최초계약일부터 1년입니다." }],
  };
  const table: TableNode = {
    id: "s-a1-t1",
    kind: "table",
    columns: [{}, {}],
    rows: [{ cells: [[{ id: "s-a1-t1-r0c0", kind: "text", text: "최초계약일" }], [{ id: "s-a1-t1-r0c1", kind: "text", text: "2023.4.10" }]] }],
  };
  const first: ArticleNode = { id: "s-a1", kind: "article", title: "보험금의 지급사유", children: [paragraph, table] };
  const second: ArticleNode = {
    id: "s-a2",
    kind: "article",
    title: "보험기간",
    children: [{ id: "s-a2-p1", kind: "paragraph", children: [{ id: "s-a2-p1-x0", kind: "text", text: "3년으로 합니다." }] }],
  };
  return { id: "s-doc", kind: "document", title: "수술비 특별약관", children: [first, second] };
}

const numberOf: NumberOf = new Map([
  ["s-a1", "1"],
  ["s-a2", "2"],
]);

describe("applyInlineConds — 어구 자리를 담보속성 조건으로", () => {
  it("찾은 평문을 인라인 조건으로 바꾸고 앞뒤 텍스트는 남긴다 — 가지는 참(then)·else(else)", () => {
    const doc = tree();
    const report: string[] = [];
    applyInlineConds(doc, numberOf, [{ article: "1", find: "최초계약일부터", when: WHEN, then: "최초계약일부터", else: "계약일부터" }], report);

    const paragraph = (doc.children[0] as ArticleNode).children[0] as ParagraphNode;
    expect(paragraph.children.map((n) => n.kind)).toEqual(["text", "inlineCond", "text"]);
    expect(paragraph.children[0]).toMatchObject({ id: "s-a1-c1a", text: "「연간」이라 함은 " });
    expect(paragraph.children[2]).toMatchObject({ id: "s-a1-c1b", text: " 1년입니다." });
    const cond = paragraph.children[1] as InlineCondNode;
    expect(cond.id).toBe("s-a1-c1");
    expect(cond.branches).toEqual([
      { id: "s-a1-c1-t", when: WHEN, children: [{ id: "s-a1-c1-t-x0", kind: "text", text: "최초계약일부터" }] },
      { id: "s-a1-c1-e", children: [{ id: "s-a1-c1-e-x0", kind: "text", text: "계약일부터" }] },
    ]);
    expect(report).toEqual([]);
  });

  it("같은 조의 오버레이 둘 — 앞 오버레이가 바꾼 자리는 건너뛰고 다음 등장(표 셀)을 집는다, 순번 id 도 늘어난다", () => {
    const doc = tree();
    const report: string[] = [];
    const cond = { article: "1", when: WHEN, then: "최초계약일", else: "계약일" };
    applyInlineConds(doc, numberOf, [{ ...cond, find: "최초계약일부터", then: "최초계약일부터", else: "계약일부터" }, { ...cond, find: "최초계약일" }], report);

    const cell = ((doc.children[0] as ArticleNode).children[1] as TableNode).rows[0].cells[0];
    expect(cell.map((n) => n.kind)).toEqual(["inlineCond"]);
    expect(cell[0].id).toBe("s-a1-c2");
    expect((cell[0] as InlineCondNode).branches[1].children).toEqual([{ id: "s-a1-c2-e-x0", kind: "text", text: "계약일" }]);
    expect(report).toEqual([]);
  });

  it("조가 없거나 평문을 찾지 못하면 바꾸지 않고 보고한다", () => {
    const doc = tree();
    const report: string[] = [];
    applyInlineConds(doc, numberOf, [{ article: "9", find: "x", when: WHEN, then: "x", else: "y" }, { article: "1", find: "없는 말", when: WHEN, then: "x", else: "y" }], report);
    expect(report).toEqual(["조건 오버레이: 조 9 없음", "조건 오버레이: 조 1 에서 「없는 말」 을 찾지 못함"]);
    expect((doc.children[0] as ArticleNode).children[0]).toMatchObject({ children: [{ id: "s-a1-p1-x0" }] });
  });
});

describe("applyArticleConds — 조 자리를 담보속성 조건으로", () => {
  it("조를 조건 블록으로 감싼다 — 같은 자리, 가지는 참 하나뿐(else 없음 = 꺼지면 조가 사라진다)", () => {
    const doc = tree();
    const report: string[] = [];
    applyArticleConds(doc, numberOf, [{ article: "2", when: WHEN }], report);

    expect(doc.children.map((n) => n.kind)).toEqual(["article", "condBlock"]);
    expect(doc.children[1]).toMatchObject({ id: "s-a2-c", kind: "condBlock", branches: [{ id: "s-a2-c-t", when: WHEN }] });
    const branch = (doc.children[1] as { branches: { children: { id: string }[] }[] }).branches[0];
    expect(branch.children.map((n) => n.id)).toEqual(["s-a2"]);
    expect(report).toEqual([]);
    expect(validateTree(doc, { kind: "special" })).toEqual([]);
  });

  it("조가 없으면 보고한다", () => {
    const doc = tree();
    const report: string[] = [];
    applyArticleConds(doc, numberOf, [{ article: "9", when: WHEN }], report);
    expect(report).toEqual(["조 조건 오버레이: 조 9 없음"]);
    expect(doc.children.map((n) => n.kind)).toEqual(["article", "article"]);
  });
});
