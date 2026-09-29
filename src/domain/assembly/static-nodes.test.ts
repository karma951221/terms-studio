import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "../document/builders";
import type { ArticleNode, ParagraphNode } from "../document/nodes";
import { assemble } from "./booklet";
import { alphaPlusFixture } from "./fixture";
import { renderedToLines } from "./compare";
import type { AssemblyInput, RenderedArticle, RenderedArticleRef, RenderedParagraph, RenderedSection } from "./types";

/** 픽스처를 한 객체로 다루는 테스트 진입 — 조립 서명 `assemble(master, product)` 에 같은 객체를 두 번 넘긴다 (AssemblyInput = MasterBundle & ProductInput). */
const assembleInput = (input: AssemblyInput) => assemble(input, input);

describe("관·표·박스가 조립을 통과한다 (기능/문면 §3.2)", () => {
  it("보통약관의 관 제목·표·박스가 그대로 렌더되고 조 번호는 관을 넘어 이어진다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("s"));
    const general = input.generalDocuments.get("g-doc")!;
    const [first, ...rest] = general.children as ArticleNode[];
    const table = b.textTable({ title: "용어", columns: [{ width: 30 }, { width: 70 }], rows: [{ header: true, cells: ["용어", "정의"] }, { cells: ["계약자", "…"] }] });
    const box = b.box("심신상실", ["정신병 등"]);
    const withSections = {
      ...general,
      children: [b.section("목적 및 용어의 정의", [{ ...first, children: [...first.children, table, box] }]), b.section("보험금의 지급", rest)],
    };
    const booklet = assembleInput({ ...input, generalDocuments: new Map([["g-doc", withSections]]) });
    expect(booklet.issues).toEqual([]);
    const [s1, s2] = booklet.general!.children as RenderedSection[];
    expect(s1).toMatchObject({ kind: "section", label: "제1관", title: "목적 및 용어의 정의" });
    expect(s2.label).toBe("제2관");
    const a1 = s1.children[0] as RenderedArticle;
    expect(a1.label).toBe("제1조");
    expect((s2.children[0] as RenderedArticle).label).toBe("제2조");
    expect(a1.children.map((c) => c.kind)).toEqual(["paragraph", "table", "box"]);
    expect(a1.children[1]).toMatchObject({ kind: "table", title: "용어", columns: [{ width: 30 }, { width: 70 }] });
    const rendered = a1.children[1] as Extract<typeof a1.children[number], { kind: "table" }>;
    expect(rendered.rows.map((row) => row.cells.map((cell) => cell.map((n) => (n.kind === "text" ? n.text : n.kind))))).toEqual([[["용어"], ["정의"]], [["계약자"], ["…"]]]);
    expect(a1.children[2]).toMatchObject({ kind: "box", title: "심신상실", lines: ["정신병 등"] });
    // 항 하나뿐인 조는 마커가 없다
    expect((a1.children[0] as RenderedParagraph).label).toBe("");
  });

  it("항의 호 목록 뒤에 붙은 박스도 그 자리에 남는다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("s"));
    const general = input.generalDocuments.get("g-doc")!;
    const first = general.children[0] as ArticleNode;
    const paragraph = first.children[0] as ParagraphNode;
    paragraph.items = [b.item([b.text("첫 호")]), b.box("민법 제27조", ["부재자의 생사가"])];
    const booklet = assembleInput(input);
    expect(booklet.issues).toEqual([]);
    const a1 = booklet.general!.children[0] as RenderedArticle;
    const p = a1.children[0] as RenderedParagraph;
    expect(p.items?.map((i) => i.kind)).toEqual(["item", "box"]);
  });

  it("기본계약 조 안의 자기 조 참조는 대치된 보통약관 조 번호로 찍힌다 (「보통약관 」 접두 없음)", () => {
    const input = alphaPlusFixture();
    const baseDoc = input.specialDocuments.get("cov-base-death")!;
    const [pay, detail] = baseDoc.children as ArticleNode[];
    const b = nodeBuilders(sequentialIds("r"));
    (detail.children[0] as ParagraphNode).children.unshift(b.articleRef(pay.id, "self"), b.text("에서 정한 "));
    const booklet = assembleInput(input);
    expect(booklet.issues).toEqual([]);
    const detailArticle = booklet.general!.children.find((c): c is RenderedArticle => c.kind === "article" && c.title === "보험금 지급에 관한 세부규정")!;
    const ref = (detailArticle.children[0] as RenderedParagraph).children[0] as RenderedArticleRef;
    expect(ref.kind).toBe("articleRef");
    expect(ref.label).toBe("제2조(보험금의 지급사유)");
  });
});

describe("글머리 목록이 조립을 통과한다 (기능/문면 §3.2, 2026-09-28)", () => {
  it("조 직속 · 호 뒤 · 목 뒤의 글머리 목록 — 번호를 먹지 않고, 조건으로 빠진 항목은 없고, 대조 양식은 `* `", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("u"));
    const general = input.generalDocuments.get("g-doc")!;
    const first = general.children[0] as ArticleNode;
    const paragraph = first.children[0] as ParagraphNode;
    const off = b.condBlock([b.branch("1 = 2", [b.bullet([b.text("빠지는 항목")])])]);
    const sub = b.bulletList([b.bullet([b.text("목 뒤 항목")])]);
    paragraph.items = [b.item([b.text("첫 호")], [b.subitem([b.text("첫 목")]), sub]), b.bulletList([b.bullet([b.text("호 뒤 항목")])]), b.item([b.text("둘째 호")])];
    first.children = [...first.children, b.bulletList([b.bullet([b.text("가")]), off, b.bullet([b.text("나")])])];
    const booklet = assembleInput(input);
    expect(booklet.issues).toEqual([]);
    const a1 = booklet.general!.children[0] as RenderedArticle;
    expect(a1.children.map((c) => c.kind)).toEqual(["paragraph", "bulletList"]);
    const list = a1.children[1] as Extract<(typeof a1.children)[number], { kind: "bulletList" }>;
    expect(list.items.map((i) => i.children.map((c) => (c.kind === "text" ? c.text : c.kind)).join(""))).toEqual(["가", "나"]);
    const p = a1.children[0] as RenderedParagraph;
    expect(p.label).toBe("");
    expect(p.items?.map((i) => i.kind)).toEqual(["item", "bulletList", "item"]);
    // 글머리 목록은 호 번호를 먹지 않는다 — 둘째 호는 2.
    expect((p.items![2] as { label: string }).label).toBe("2.");
    const item = p.items![0] as { subitems: { kind: string; label?: string }[] };
    expect(item.subitems.map((x) => x.kind)).toEqual(["subitem", "bulletList"]);
    const lines = renderedToLines(booklet.general!);
    expect(lines).toEqual(expect.arrayContaining(["  * 호 뒤 항목", "    * 목 뒤 항목", "* 가", "* 나"]));
  });
});

describe("기본계약 대치 — 보통약관이 대치되는 조의 항을 가리키는 참조 (실물: 제8조 → 제4조 제4항)", () => {
  it("대치된 조의 항 참조는 같은 자리(순번)의 기본계약 항으로 풀린다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("q"));
    const general = input.generalDocuments.get("g-doc")!;
    // 마스터 「보험금 지급에 관한 세부규정」(g-art-detail) 에 항 둘을 두고, 다른 조에서 그 둘째 항을 가리킨다
    const detail = general.children.find((c): c is ArticleNode => c.kind === "article" && c.id === "g-art-detail")!;
    const gp1 = { ...b.paragraph([b.text("마스터 첫 항")]), code: "P0100" };
    const gp2 = { ...b.paragraph([b.text("마스터 둘째 항")]), code: "P0200" };
    detail.children = [gp1, gp2];
    const refund = general.children.find((c): c is ArticleNode => c.kind === "article" && c.id === "g-art-refund")!;
    (refund.children[0] as ParagraphNode).children.push(b.text(" "), b.articleRef({ articleId: detail.id, code: gp2.code }, "self"), b.text("에 따라"));
    // 기본계약 문면의 세부규정 조는 항 둘 — 대치되면 둘째 항이 「제3조(…) 제2항」 으로 찍혀야 한다
    const baseDoc = input.specialDocuments.get("cov-base-death")!;
    const baseDetail = baseDoc.children.find((c): c is ArticleNode => c.kind === "article" && c.linkedArticleId === "g-art-detail")!;
    baseDetail.children.push(b.paragraph([b.text("기본계약 둘째 항")]));

    const booklet = assembleInput(input);
    expect(booklet.issues).toEqual([]);
    const rendered = booklet.general!.children.find((c): c is RenderedArticle => c.kind === "article" && c.id === "g-art-refund")!;
    const ref = (rendered.children[0] as RenderedParagraph).children.find((n) => n.kind === "articleRef") as RenderedArticleRef;
    expect(ref.label).toBe("제3조(보험금 지급에 관한 세부규정) 제2항");
  });
});

describe("순번 별칭은 구조가 같음을 증명한 경우에만 만든다 (2026-09-08 리뷰 3)", () => {
  /** 마스터 조와 기본계약 조의 항 수가 다르면 별칭을 만들지 않는다 — 조용한 오연결 대신 articleGone 오류. */
  it("항 수가 다르면 별칭 없이 articleGone 오류를 낸다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("m"));
    const general = input.generalDocuments.get("g-doc")!;
    const detail = general.children.find((c): c is ArticleNode => c.kind === "article" && c.id === "g-art-detail")!;
    const gp1 = { ...b.paragraph([b.text("마스터 첫 항")]), code: "P0100" };
    const gp2 = { ...b.paragraph([b.text("마스터 둘째 항")]), code: "P0200" };
    detail.children = [gp1, gp2];
    const refund = general.children.find((c): c is ArticleNode => c.kind === "article" && c.id === "g-art-refund")!;
    (refund.children[0] as ParagraphNode).children.push(b.articleRef({ articleId: detail.id, code: gp2.code }, "self"));
    // 기본계약 조는 항이 하나뿐 — 마스터의 둘째 항에 대응하는 자리가 없다
    const booklet = assembleInput(input);
    expect(booklet.issues.map((i) => i.kind)).toEqual(["articleGone"]);
    expect(booklet.complete).toBe(false);
  });

  it("마스터 조에 조건 블록이 있으면 별칭을 만들지 않는다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("c"));
    const general = input.generalDocuments.get("g-doc")!;
    const detail = general.children.find((c): c is ArticleNode => c.kind === "article" && c.id === "g-art-detail")!;
    const gp1 = { ...b.paragraph([b.text("마스터 첫 항")]), code: "P0100" };
    detail.children = [gp1, b.condBlock([b.branch("D0001 = true", [b.paragraph([b.text("조건 항")])])])];
    const refund = general.children.find((c): c is ArticleNode => c.kind === "article" && c.id === "g-art-refund")!;
    // 기본계약 조의 첫 항도 코드가 P0100 이지만(열쇠가 기본계약 조 앞마디로 갈린다) 별칭이 없으면 풀리지 않는다
    (refund.children[0] as ParagraphNode).children.push(b.articleRef({ articleId: detail.id, code: gp1.code }, "self"));
    const booklet = assembleInput(input);
    expect(booklet.issues.map((i) => i.kind)).toEqual(["articleGone"]);
  });
});

describe("정적 마스터 박스 참조가 조립에서 박스 내용으로 펼쳐진다 (최종 결정 9)", () => {
  const boxes = [
    { code: "BX000001", name: "암 정의 박스", title: "암의 정의", lines: ["암이란 …", "", "유사암 제외"] },
    { code: "BX000002", name: "예시", title: "", lines: ["예시 줄"] },
  ];

  it("boxRef가 박스 내용으로 펼쳐진다 — 조 자리 · 항 뒤(호 목록 자리) 모두, 제목 · 줄은 마스터 그대로", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("x"));
    const general = input.generalDocuments.get("g-doc")!;
    const first = general.children[0] as ArticleNode;
    const paragraph = first.children[0] as ParagraphNode;
    paragraph.items = [b.item([b.text("첫 호")]), b.boxRef("BX000002")];
    first.children = [...first.children, b.boxRef("BX000001")];
    const booklet = assembleInput({ ...input, boxes });
    expect(booklet.issues).toEqual([]);
    const a1 = booklet.general!.children[0] as RenderedArticle;
    expect(a1.children.map((c) => c.kind)).toEqual(["paragraph", "box"]);
    expect(a1.children[1]).toMatchObject({ kind: "box", title: "암의 정의", lines: ["암이란 …", "", "유사암 제외"] });
    expect((a1.children[0] as RenderedParagraph).items?.map((i) => i.kind)).toEqual(["item", "box"]);
  });

  it("함수조항 본문 안의 boxRef도 사용처 자리에서 박스로 펼쳐진다 (박스는 잎 — 중첩 금지에 걸리지 않는다)", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("y"));
    const clause = { code: "C0900", label: "암 정의", mode: "block" as const, options: [], required: { discriminators: [], attributes: [] }, body: [{ id: "p1", kind: "paragraph" as const, children: [{ id: "t1", kind: "text" as const, text: "암이란" }] }, { id: "bx", kind: "boxRef" as const, boxCode: "BX000001" }] };
    const general = input.generalDocuments.get("g-doc")!;
    const first = general.children[0] as ArticleNode;
    first.children = [...first.children, b.clauseBlock("C0900")];
    const booklet = assembleInput({ ...input, clauses: [...input.clauses, clause], boxes });
    expect(booklet.issues).toEqual([]);
    const a1 = booklet.general!.children[0] as RenderedArticle;
    expect(a1.children.at(-1)).toMatchObject({ kind: "box", title: "암의 정의" });
  });

  it("없는 박스를 가리키면 그 자리가 brokenRef 오류 마커가 된다", () => {
    const input = alphaPlusFixture();
    const b = nodeBuilders(sequentialIds("z"));
    const general = input.generalDocuments.get("g-doc")!;
    const first = general.children[0] as ArticleNode;
    first.children = [...first.children, b.boxRef("BX000099")];
    const booklet = assembleInput({ ...input, boxes });
    expect(booklet.issues.map((i) => [i.kind, i.message])).toEqual([["brokenRef", "박스 BX000099 이(가) 정적 마스터에 없습니다"]]);
  });
});
