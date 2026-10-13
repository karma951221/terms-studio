import { describe, expect, it } from "vitest";

import type { ArticleNode, ParagraphNode } from "../../src/domain/document/nodes";

import { buildStructure, compactBoxes, convertText } from "./convert";
import { parseTerms } from "./parse";

describe("compactBoxes — 쓰지 않는 박스를 빼고 코드를 다시 매긴다", () => {
  it("보통약관 쪽(`front`)이 놓는 박스가 앞 코드 — 보통약관 자리는 사라지고 뒤 특약만 쓰는 박스는 뒤로 간다", () => {
    const records = ["BX000001", "BX000002", "BX000003", "BX000004"].map((code) => ({ code, name: code }));
    const general = { kind: "boxRef", boxCode: "BX000001" };
    const special = [{ kind: "boxRef", boxCode: "BX000002" }, { kind: "boxRef", boxCode: "BX000004" }];
    const out = compactBoxes(records, [general, special], [general]);
    expect(out.map((r) => [r.name, r.code])).toEqual([
      ["BX000001", "BX000001"],
      ["BX000002", "BX000002"],
      ["BX000004", "BX000003"],
    ]);
    expect(special.map((s) => s.boxCode)).toEqual(["BX000002", "BX000003"]);
    // 보통약관 몫으로 앞에 두었다가(`plannedFront`) 보통약관이 더 쓰지 않게 된 박스는 특약 박스 뒤 맨 끝으로 — 특약 박스 코드를 밀지 않는다
    const records2 = ["a", "b", "c", "d"].map((name, i) => ({ code: `BX00000${i + 1}`, name }));
    const again = compactBoxes(records2, [{ boxCode: "BX000001" }, { boxCode: "BX000002" }, { boxCode: "BX000004" }], [{ boxCode: "BX000001" }], new Set(["BX000001", "BX000002", "BX000003"]));
    expect(again.map((r) => [r.name, r.code])).toEqual([
      ["a", "BX000001"],
      ["d", "BX000002"],
      ["b", "BX000003"],
    ]);
  });
});

describe("buildStructure — 원문 구조 노드", () => {
  it("항 글과 첫 호 사이의 표는 호 목록 맨 앞에 선다 — 렌더 순서(항 → 표 → 호)가 원문과 같다", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 다음 각 호의 사항을 말합니다.", "", "```표", "제목: (없음)", "|항목|", "|---|", "|검사|", "```", "", "  - 첫째", "  - 둘째", "", "@ 둘째 항", ""].join("\n");
    const built = buildStructure(parseTerms(md), "t", "시험");
    const article = built.tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "paragraph"]);
    expect((article.children[0] as ParagraphNode).items?.map((i) => i.kind)).toEqual(["table", "item", "item"]);
  });

  it("첫 항 앞의 박스(통합형 특약 「세부보장에 관한 사항」의 세부보장 머리)는 조 직속에 선다", () => {
    const md = ["# 시험 특별약관", "", "## 제3조(세부보장에 관한 사항)", "", "```용어풀이", "- 대장 양성종양진단비", "```", "", "@ 첫 항", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["box", "paragraph"]);
  });

  it("제목만 있는 박스(줄 0)는 제목 「【…】」을 줄 하나로 — 박스 마스터는 줄이 하나 이상이다", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 첫 항", "", "```용어풀이", "【보상기간 예시】", "```", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children[1]).toMatchObject({ kind: "box", title: "", lines: ["【보상기간 예시】"] });
  });

  it("호가 없는 항 뒤의 표는 조 직속 그대로", () => {
    const md = ["# 시험 특별약관", "", "## 제1조(정의)", "", "@ 표를 봅니다.", "", "```표", "제목: (없음)", "|항목|", "|---|", "|검사|", "```", "", "@ 둘째 항", ""].join("\n");
    const article = buildStructure(parseTerms(md), "t", "시험").tree.children[0] as ArticleNode;
    expect(article.children.map((c) => c.kind)).toEqual(["paragraph", "table", "paragraph"]);
  });
});

describe("buildStructure · convertText — 통합형 특약의 소제목 · 종형 단위 항 번호 (restartGroups)", () => {
  /** 세부보장 둘(소제목 1. · 3.) — 세부보장마다 소제목 「1.」부터, 소제목마다 항을 1 부터 다시 센다. 납입면제는 [2종] 머리부터 다시. */
  const md = [
    "# 시험 특별약관",
    "",
    "## 제3조(세부보장에 관한 사항)",
    "",
    "```용어풀이",
    "- 가 진단비",
    "```",
    "",
    "```용어풀이",
    "**1.(보험금의 지급사유)**",
    "```",
    "",
    "@ 가 진단비를 지급합니다.",
    "",
    "@ 제1항의 가 진단비를 지급합니다. 다만, 3.(보장의 소멸) 제2항에 따라 지급한 경우에는 차감합니다.",
    "",
    "```용어풀이",
    "**3.(보장의 소멸)**",
    "```",
    "",
    "@ 지급사유가 발생한 경우 소멸됩니다. <!-- 원문번호: 1 -->",
    "",
    "@ 사망한 경우에는 소멸됩니다. <!-- 원문번호: 2 -->",
    "",
    "```용어풀이",
    "- 나 진단비",
    "```",
    "",
    "```용어풀이",
    "**1.(보험금의 지급사유)**",
    "```",
    "",
    "@ 나 진단비를 지급합니다. <!-- 원문번호: 1 -->",
    "",
    "@ 제1항의 나 진단비를 지급합니다. 다만, 3.(보장의 소멸) 제2항에 따라 지급한 경우에는 차감합니다. <!-- 원문번호: 2 -->",
    "",
    "```용어풀이",
    "**3.(보장의 소멸)**",
    "```",
    "",
    "@ 지급사유가 발생한 경우 소멸됩니다. <!-- 원문번호: 1 -->",
    "",
    "@ 사망한 경우에는 소멸됩니다. <!-- 원문번호: 2 -->",
    "",
    "```용어풀이",
    "5.(보험료의 납입면제)회사는 1종, 2종 중에서 한가지형만을 적용합니다.",
    "```",
    "",
    "@ 나 진단확정시 납입을 면제합니다. <!-- 원문번호: 3 -->",
    "",
    "```용어풀이",
    "[2종(보험료 납입면제형)]",
    "```",
    "",
    "@ 다음 중 어느 하나의 사유에 해당되면 납입을 면제합니다. <!-- 원문번호: 4 -->",
    "",
    "  - 암",
    "",
    "  - 장해",
    "",
    "@ 제1항에도 불구하고 연체가 있으면 납입하여야 합니다. <!-- 원문번호: 5 -->",
    "",
    "```용어풀이",
    "**6.(납입면제에 관한 세부규정)**",
    "```",
    "",
    "@ 5.(보험료의 납입면제) [2종(보험료 납입면제형)] 제1항 제2호에서 장해지급률을 정합니다. <!-- 원문번호: 1 -->",
    "",
  ].join("\n");
  const build = (restartGroups: boolean) => {
    const built = buildStructure(parseTerms(md), "t", "시험", undefined, { restartGroups });
    convertText(built, undefined, new Map(), []);
    const article = built.tree.children[0] as ArticleNode;
    const paragraphs = article.children.filter((c): c is ParagraphNode => c.kind === "paragraph");
    const refs = (p: ParagraphNode) => p.children.filter((c) => c.kind === "articleRef").map((c) => (c as { targets: { articleId: string }[] }).targets.map((t) => t.articleId));
    return { paragraphs, refs };
  };

  it("소제목 · 종형 머리(박스) 다음 항부터 번호를 다시 센다 — 그 항에 restart", () => {
    const { paragraphs } = build(true);
    expect(paragraphs.map((p) => (p.restart ? 1 : 0))).toEqual([0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1]);
  });

  it("세부보장 안 「제N항」은 그 소제목(종형)의 N번째 항을 가리킨다 — 조 전체의 N번째가 아니다", () => {
    const { paragraphs, refs } = build(true);
    const id = (i: number) => paragraphs[i].id;
    // 둘째 세부보장 1.② 「제1항」 → 1.① (조의 다섯째 항), 「3.(보장의 소멸) 제2항」 → 둘째 세부보장 3.②
    expect(refs(paragraphs[5])).toEqual([[id(4)], [id(7)]]);
    // 첫 세부보장도 제 세부보장의 3.② 를 가리킨다
    expect(refs(paragraphs[1])).toEqual([[id(0)], [id(3)]]);
    // [2종] ② 「제1항」 → [2종] ①
    expect(refs(paragraphs[10])).toEqual([[id(9)]]);
    // 6.① 「5.(보험료의 납입면제) [2종(보험료 납입면제형)] 제1항 제2호」 → [2종] ① 의 제2호
    expect(refs(paragraphs[11])).toEqual([[paragraphs[9].items![1].id]]);
  });

  it("끄면(2604 · 손으로 쓴 특약) 지금처럼 조 전체 번호 — restart 도 없다", () => {
    const { paragraphs, refs } = build(false);
    expect(paragraphs.some((p) => p.restart)).toBe(false);
    expect(refs(paragraphs[5])[0]).toEqual([paragraphs[0].id]);
  });
});
