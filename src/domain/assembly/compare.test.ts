import { describe, expect, it } from "vitest";

import { diffArticlesUnordered, diffByArticle, normalizeLine, referenceNumberIssues, renderedToLines, sourceToLines } from "./compare";
import type { RenderedDoc } from "./types";

const doc: RenderedDoc = {
  kind: "document",
  id: "d",
  document: "general",
  ownerId: "g",
  title: "T",
  children: [
    {
      kind: "section",
      id: "s1",
      number: 1,
      label: "제1관",
      title: "목적",
      children: [
        {
          kind: "article",
          id: "a1",
          number: 1,
          label: "제1조",
          title: "목적",
          children: [
            {
              kind: "paragraph",
              id: "p1",
              number: 1,
              label: "",
              children: [
                { kind: "text", id: "t", text: "이 계약은 " },
                { kind: "articleRef", id: "r", targets: [{ nodeId: "a2", label: "제2조(정의)" }], connector: "및", label: "제2조(정의)" },
                { kind: "text", id: "t2", text: "를 따른다." },
              ],
            },
            {
              kind: "table",
              id: "tb",
              title: "용어",
              columns: [{}, {}],
              rows: [
                { header: true, cells: [[{ kind: "text", id: "h1", text: "용어" }], [{ kind: "text", id: "h2", text: "정의" }]] },
                { cells: [[{ kind: "text", id: "c1", text: "계약자" }], [{ kind: "text", id: "c2", text: "사람" }]] },
              ],
            },
            { kind: "box", id: "bx", title: "심신상실", lines: ["정신병"] },
          ],
        },
        {
          kind: "article",
          id: "a2",
          number: 2,
          label: "제2조",
          title: "정의",
          children: [
            {
              kind: "paragraph",
              id: "p2",
              number: 1,
              label: "①",
              children: [{ kind: "text", id: "x", text: "하나" }],
              items: [
                { kind: "item", id: "i1", number: 1, label: "1.", children: [{ kind: "text", id: "y", text: "호" }], subitems: [{ kind: "subitem", id: "u1", number: 1, label: "가.", children: [{ kind: "text", id: "z0", text: "목" }] }] },
                { kind: "box", id: "bx2", title: "민법", lines: ["줄"] },
              ],
            },
            { kind: "paragraph", id: "p3", number: 2, label: "②", children: [{ kind: "text", id: "z", text: "둘" }] },
          ],
        },
      ],
    },
  ],
};

describe("대조기 — 조립 결과 ↔ 원문 (파싱양식)", () => {
  it("렌더 문서를 파싱양식 줄로 되돌린다 (단항은 =, 다항은 @, 표·박스는 fence)", () => {
    expect(renderedToLines(doc)).toEqual([
      "# 제1관 목적",
      "## 제1조(목적)",
      "= 이 계약은 제2조(정의)를 따른다.",
      "```표",
      "제목: 용어",
      "|용어|정의|",
      "|---|---|",
      "|계약자|사람|",
      "```",
      "```용어풀이",
      "【심신상실】",
      "정신병",
      "```",
      "## 제2조(정의)",
      "@ 하나",
      "  - 호",
      "    - 목",
      "```용어풀이",
      "【민법】",
      "줄",
      "```",
      "@ 둘",
    ]);
  });

  it("원문은 머리·통계·주석·빈 줄을 버리고 관 헤딩은 남긴다", () => {
    expect(sourceToLines("# 제목\n\n> 출처: x\n\n# 제1관 목적\n\n## 제1조(목적)\n\n= 본문 <!-- 원문번호: 3 -->\n> 통계: 조 1\n")).toEqual(["# 제1관 목적", "## 제1조(목적)", "= 본문"]);
  });

  it("정규화는 조·관 번호와 별표 번호를 지우고 공백을 없앤다 (ADR-0063)", () => {
    expect(normalizeLine("## 제27조의1(보험료의 납입면제)")).toBe("##제§조(보험료의납입면제)");
    expect(normalizeLine("= 제9조(적립부분), 제10조(만기) 및 제38조(중도인출)은")).toBe("=제§조(적립부분),제§조(만기)및제§조(중도인출)은");
    expect(normalizeLine("【별표2(장해분류 표)】")).toBe("【별표§(장해분류표)】");
    expect(normalizeLine("# 제3관 계약자의")).toBe("#제§관계약자의");
  });

  it("참조 나열은 조립 표기로 맞춘다 (허용 차이 ⑤ · 기능/문면 §3.5) — 연속 셋 이상은 「부터 … 까지」, 쉼표뿐인 둘은 「및」", () => {
    expect(normalizeLine("제15조(가), 제17조(나), 제18조(다), 제19조(라) 및 제26조(마)를")).toBe(normalizeLine("제15조(가), 제17조(나)부터 제19조(라)까지 및 제26조(마)를"));
    expect(normalizeLine("제1항 제10호, 제11호에서")).toBe(normalizeLine("제1항 제10호 및 제11호에서"));
    expect(normalizeLine("제3조(가), 제4조(나) 또는 제5조(다)에")).toBe("제§조(가)부터제§조(다)까지에");
    // 이미 조립 표기인 쪽은 그대로 — 두 번 적용해도 같다
    expect(normalizeLine("제15조(가), 제17조(나)부터 제19조(라)까지 및 제26조(마)를")).toBe("제§조(가),제§조(나)부터제§조(라)까지및제§조(마)를");
    // 연속이 아니거나 가지번호가 끼면 묶지 않는다
    expect(normalizeLine("제9조(가), 제10조(나) 및 제38조(다)")).toBe("제§조(가),제§조(나)및제§조(다)");
    expect(normalizeLine("제27조(가), 제27조의1(나), 제27조의2(다) 및 제28조(라)")).toBe("제§조(가),제§조(나),제§조(다)및제§조(라)");
  });

  it("조 단위로 다른 곳만 보고한다", () => {
    const expected = ["## 제1조(목적)", "= 같다", "## 제2조(정의)", "@ 다르다"];
    const actual = ["## 제1조(목적)", "= 같다", "## 제2조(정의)", "@ 다르다!"];
    const diffs = diffByArticle(expected, actual);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ index: 1, title: "정의", expected: ["@ 다르다"], actual: ["@ 다르다!"] });
  });

  it("조 수가 다르면 없는 쪽이 빈 조로 보고된다", () => {
    const diffs = diffByArticle(["## 제1조(목적)", "= 같다"], ["## 제1조(목적)", "= 같다", "## 제2조(추가)", "= 더"]);
    expect(diffs).toEqual([{ index: 1, title: "추가", expected: [], actual: ["= 더"] }]);
  });
});

describe("조 순서 허용 대조 (2026-09-28)", () => {
  const source = ["# 제1관 목적", "## 제1조(목적)", "= 가.", "## 제2조(정의)", "@ 제1조(목적)에 따라 나.", "@ 다."];

  it("조 순서가 달라도 조 명 + 본문이 같으면 같다 — 참조 번호는 조 명 기준", () => {
    const actual = ["# 제1관 목적", "## 제1조(정의)", "@ 제2조(목적)에 따라 나.", "@ 다.", "## 제2조(목적)", "= 가."];
    expect(diffArticlesUnordered(source, actual)).toEqual({ missing: [], extra: [] });
  });

  it("본문이 다르면 양쪽에 남는다 · 같은 조가 두 번이면 한 번만 짝짓는다", () => {
    const actual = ["# 제1관 목적", "## 제1조(목적)", "= 가.", "## 제2조(목적)", "= 가.", "## 제3조(정의)", "@ 다른 글."];
    const d = diffArticlesUnordered(source, actual);
    expect(d.missing.map((c) => c.title)).toEqual(["정의"]);
    expect(d.extra.map((c) => c.title).sort()).toEqual(["목적", "정의"]);
  });

  it("관 제목 순서가 다르면 따로 보고한다", () => {
    expect(diffArticlesUnordered(["# 제1관 가", "# 제2관 나"], ["# 제1관 나", "# 제2관 가"]).sections).toEqual([["가", "나"], ["나", "가"]]);
  });

  it("조 번호 · 조 참조 번호는 조립 순서와 맞아야 한다 — 법령 인용과 보통약관 조는 통과", () => {
    const general = new Map([[5, "보험금을지급하지않는사유"]]);
    const ok = ["## 제1조(목적)", "= 의료법 제3조(의료기관)에 따라 보통약관 제5조(보험금을 지급하지 않는 사유) 및 제2조(정의)", "## 제2조(정의)", "= 가."];
    expect(referenceNumberIssues(ok, general)).toEqual([]);
    const bad = ["## 제1조(목적)", "= 제1조(정의)를 따른다", "## 제3조(정의)", "= 가."];
    expect(referenceNumberIssues(bad, general)).toEqual([
      "조 번호가 조립 순서와 다름: ## 제3조(정의) (기대 제2조)",
      "조 참조 「제1조(정의)」 — 제1조는 「목적」",
    ]);
  });
});
