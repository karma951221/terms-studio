import { describe, expect, it } from "vitest";

import type { ArticleNode, DocumentNode, InlineNode } from "../../src/domain/document/nodes";

import { articlesDeep, autoFixtures, canonicalArticle, claimOf, collapseRenewal, coverageNameOf, mergeRenewal, textNodesOf, wordClusters } from "./auto";
import { foldTitle, titleNodes } from "../../src/domain/document/title";

const WHEN = "exist(attr.A0001) and attr.A0001 = '2'";
const text = (id: string, t: string): InlineNode => ({ id, kind: "text", text: t });
const article = (id: string, title: string, ...paragraphs: InlineNode[][]): ArticleNode => ({
  id,
  kind: "article",
  title: titleNodes(title, id),
  children: paragraphs.map((children, i) => ({ id: `${id}-p${i + 1}`, kind: "paragraph", children })),
});
const doc = (id: string, ...children: ArticleNode[]): DocumentNode => ({ id: `${id}-doc`, kind: "document", title: id, children });
const ref = (id: string, target: string): InlineNode => ({ id, kind: "articleRef", scope: "self", targets: [{ articleId: target }], connector: "및" });
const outside = { withTitle: false, outside: () => "OUT" };

describe("coverageNameOf — 특약 제목 → 담보명 · 갱신형", () => {
  it("「갱신형 」 · 「특별약관」을 뗀다 — 붙어 있어도, 뒤에 괄호가 와도", () => {
    expect(coverageNameOf("갱신형 상해수술비보장 특별약관")).toEqual({ name: "상해수술비보장", renewal: true });
    expect(coverageNameOf("상해수술비보장 특별약관")).toEqual({ name: "상해수술비보장", renewal: false });
    expect(coverageNameOf("안전사고피해치료비보장 특별약관(폭력치료비, 유괴･인신매매피해치료비)")).toEqual({ name: "안전사고피해치료비보장(폭력치료비, 유괴･인신매매피해치료비)", renewal: false });
  });
});

describe("autoFixtures — 자동 탑재 특약의 책자 제목 · fixture", () => {
  it("갱신형 짝은 두 줄, 갱신형만 있는 특약은 「갱신형 」 제목 한 줄, 손으로 설정한 특약은 뺀다", () => {
    const heads: Record<string, string> = { "a.md": "# 상해수술비보장 특별약관", "b.md": "# 갱신형 질병수술비보장 특별약관", "c.md": "# 화재벌금보장 특별약관" };
    const specs = [{ file: "a.md", auto: { renewal: "갱신형_a.md" } }, { file: "b.md", auto: {} }, { file: "c.md", auto: {} }, { file: "x.md" }];
    expect(autoFixtures(specs, (f) => heads[f])).toEqual([
      ["상해수술비보장 특별약관", "a.md"],
      ["갱신형 상해수술비보장 특별약관", "갱신형_a.md"],
      ["갱신형 질병수술비보장 특별약관", "b.md"],
      ["화재벌금보장 특별약관", "c.md"],
    ]);
  });
});

describe("wordClusters — 낱말만 다른 조를 옵션 함수조항 한 무리로", () => {
  it("다른 자리의 낱말 구간(낱말 경계로 넓힌다)이 짧으면 한 무리 — 자리마다 순번별 구간", () => {
    const texts = [
      ["이 특별약관에서 「입원」이라 함은 종합병원에 입원하는 것을 말합니다.", "끝"],
      ["이 특별약관에서 「입원」이라 함은 상급종합병원에 입원하는 것을 말합니다.", "끝"],
      ["전혀 다른 글입니다. 길고 긴 설명이 붙어 있어 낱말 차이가 아닙니다.", "끝"],
    ];
    expect(wordClusters(texts)).toEqual([{ members: [0, 1], places: [{ at: 0, prefix: 19, regions: ["종합병원에", "상급종합병원에"] }] }]);
  });

  it("띄어쓰기만 다르면 · 구간이 길면 · 글 노드 수가 다르면 무리가 아니다", () => {
    expect(wordClusters([["보험금을 지급 합니다."], ["보험금을 지급합니다."]])).toEqual([]);
    expect(wordClusters([["가 " + "x".repeat(40)], ["가 " + "y".repeat(40)]])).toEqual([]);
    expect(wordClusters([["가 나"], ["가 다", "더"]])).toEqual([]);
  });

  it("textNodesOf — 항 · 호 · 목 글을 문서 순으로", () => {
    const blocks = [{ kind: "paragraph", children: [text("a", "항"), ref("r", "x")], items: [{ kind: "item", children: [text("b", "호")], subitems: [{ kind: "subitem", children: [text("c", "목")] }] }] }, { kind: "boxRef" }];
    expect(textNodesOf(blocks).map((t) => t.text)).toEqual(["항", "호", "목"]);
  });
});

describe("claimOf — 소멸 첫 항의 보험금명", () => {
  it("「제1조(보험금의 지급사유)에서 정한 ○○ 지급사유가 발생한 경우」의 ○○", () => {
    expect(claimOf("제1조(보험금의 지급사유)에서 정한 상해흉터복원수술비 지급사유가 발생한 경우에는 이 특별약관은 그 때부터 소멸됩니다.")).toBe("상해흉터복원수술비");
    expect(claimOf("에서 정한 일반상해입원일당 지급사유가 발생한 경우에는")).toBe("일반상해입원일당");
    expect(claimOf("이 특별약관의 피보험자가 사망한 경우에는")).toBeUndefined();
  });
});

describe("canonicalArticle — 조째 같은 글의 열쇠", () => {
  it("노드 id 는 보지 않고, 조 안 참조는 경로로 · 조 밖 참조는 `outside` 표기로 본다", () => {
    const a = article("x-a4", "특별약관의 소멸", [text("t1", "제1항에 따라 "), ref("r1", "x-a4-p1")], [text("t2", "보험금 "), ref("r2", "x-a1")]);
    const b = article("y-a5", "특별약관의 소멸", [text("u1", "제1항에 따라 "), ref("s1", "y-a5-p1")], [text("u2", "보험금 "), ref("s2", "y-a2")]);
    expect(canonicalArticle(a, outside)).toBe(canonicalArticle(b, outside));
    // 조 안 다른 항을 가리키면 다르다
    const c = article("z-a5", "특별약관의 소멸", [text("v1", "제1항에 따라 "), ref("w1", "z-a5-p2")], [text("v2", "보험금 "), ref("w2", "z-a2")]);
    expect(canonicalArticle(c, outside)).not.toBe(canonicalArticle(a, outside));
  });

  it("제목은 `withTitle` 일 때만 본다", () => {
    const a = article("x-a1", "보험기간", [text("t", "3년")]);
    const b = article("y-a1", "보장기간", [text("u", "3년")]);
    expect(canonicalArticle(a, outside)).toBe(canonicalArticle(b, outside));
    expect(canonicalArticle(a, { ...outside, withTitle: true })).not.toBe(canonicalArticle(b, { ...outside, withTitle: true }));
  });
});

describe("mergeRenewal — 비갱신 · 갱신형 원문 두 벌 → 템플릿 한 벌", () => {
  // 비갱신: 지급사유 · 소멸(→ 제1조) · 준용(세 조) / 갱신형: 지급사유 · 보험기간 · 소멸(→ 제1조) · 준용(다섯 조)
  const base = () =>
    doc(
      "b",
      article("b-a1", "보험금의 지급사유", [text("b1", "지급합니다.")]),
      article("b-a2", "특별약관의 소멸", [ref("b2r", "b-a1"), text("b2", "에서 정한 지급사유")]),
      article("b-a3", "준용규정", [text("b3", "세 조는 제외")]),
    );
  const renewal = () =>
    doc(
      "r",
      article("r-a1", "보험금의 지급사유", [text("r1", "지급합니다.")]),
      article("r-a2", "보험기간", [text("r2", "3년")]),
      article("r-a3", "특별약관의 소멸", [ref("r3r", "r-a1"), text("r3", "에서 정한 지급사유")]),
      article("r-a4", "준용규정", [text("r4", "다섯 조는 제외")]),
    );

  it("같은 조는 비갱신 쪽 하나 · 갱신형에만 있는 조는 갱신형 IF · 다른 조는 IF 둘(조 자리 조건은 IF 하나만)", () => {
    const merged = mergeRenewal(base(), renewal(), WHEN, "m");
    expect(merged.children.map((c) => (c.kind === "article" ? c.id : `${c.id}:${(c as { branches: { when?: string; children: { id: string }[] }[] }).branches.map((b) => `${b.when === WHEN ? "R" : b.when === `not (${WHEN})` ? "B" : b.when}[${b.children.map((x) => x.id)}]`).join("|")}`))).toEqual([
      "b-a1",
      "m-m1:R[r-a2]",
      "b-a2",
      "m-m2:R[r-a4]",
      "m-m2n:B[b-a3]",
    ]);
    expect(articlesDeep(merged)).toHaveLength(5);
  });

  it("갱신형 쪽 조의 참조가 합친 조를 가리키면 비갱신 쪽 같은 자리로 옮긴다", () => {
    const r = renewal();
    (r.children[3] as ArticleNode).children[0] = { id: "r-a4-p1", kind: "paragraph", children: [ref("r4r", "r-a3-p1"), text("r4", " 다섯 조는 제외")] };
    const merged = mergeRenewal(base(), r, WHEN, "m");
    const kept = articlesDeep(merged).find((a) => a.id === "r-a4")!;
    expect(JSON.stringify(kept)).toContain('"articleId":"b-a2-p1"');
  });

  it("합친 조의 참조가 갈리는 조를 가리키면 갱신형 쪽 같은 제목 · 같은 자리도 대상에 더한다(가지마다 하나만 남는다)", () => {
    const b = base();
    const r = renewal();
    (b.children[0] as ArticleNode).children[0] = { id: "b-a1-p1", kind: "paragraph", children: [ref("b1r", "b-a3-p1"), text("b1", " 지급합니다.")] };
    (r.children[0] as ArticleNode).children[0] = { id: "r-a1-p1", kind: "paragraph", children: [ref("r1r", "r-a4-p1"), text("r1", " 지급합니다.")] };
    const merged = mergeRenewal(b, r, WHEN, "m");
    const first = merged.children[0] as ArticleNode;
    expect(first.id).toBe("b-a1");
    expect(JSON.stringify(first)).toContain('"targets":[{"articleId":"b-a3-p1"},{"articleId":"r-a4-p1"}]');
  });

  it("비갱신에만 있는 조 무리는 `not (when)` 가지 하나", () => {
    const b = base();
    const r = doc("r", article("r-a1", "보험금의 지급사유", [text("r1", "지급합니다.")]), article("r-a3", "준용규정", [text("r3", "세 조는 제외")]));
    (b.children[2] as ArticleNode).children[0] = { id: "b-a3-p1", kind: "paragraph", children: [text("b3", "세 조는 제외")] };
    const merged = mergeRenewal(b, r, WHEN, "m");
    const cond = merged.children[1] as unknown as { branches: { when?: string }[] };
    expect(cond.branches.map((x) => x.when)).toEqual([`not (${WHEN})`]);
  });
});

describe("collapseRenewal — 함수조항을 얹은 뒤 같은 글이 된 두 가지의 조를 꺼낸다", () => {
  it("앞 · 뒤 같은 조를 비갱신 쪽으로 꺼내고 빈 조건 블록은 지운다 · 가리키는 참조가 있는 조는 두지 않는다", () => {
    const merged = mergeRenewal(
      doc("b", article("b-a1", "보험금의 지급사유", [text("b1", "지급")]), article("b-a2", "준용규정", [text("b2", "세 조")])),
      doc("r", article("r-a1", "보험금의 지급사유", [text("r1", "지급")]), article("r-a2", "보험기간", [text("r2", "3년")]), article("r-a3", "준용규정", [text("r3", "다섯 조")])),
      WHEN,
      "m",
    );
    // 함수조항을 얹은 모양 — 두 준용규정이 같은 함수조항 블록 하나가 된다
    for (const a of articlesDeep(merged).filter((x) => foldTitle(x.title) === "준용규정")) a.children = [{ id: `${a.id}-p1-k`, kind: "clauseBlockRef", clauseCode: "C0068", options: {} }];
    expect(collapseRenewal(merged, "m", () => false)).toBe(1);
    expect(merged.children.map((c) => c.id)).toEqual(["b-a1", "m-m1", "b-a2"]);
    const kept = mergeRenewal(
      doc("b", article("b-a1", "가", [text("b1", "x")])),
      doc("r", article("r-a1", "가", [text("r1", "y")])),
      WHEN,
      "m",
    );
    for (const a of articlesDeep(kept)) a.children = [{ id: `${a.id}-k`, kind: "clauseBlockRef", clauseCode: "C0001", options: {} }];
    expect(collapseRenewal(kept, "m", () => true)).toBe(0);
  });
});
