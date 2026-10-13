import { describe, expect, it } from "vitest";

import { expectedLines, KNOWN_DIFFERENCES } from "./knownDifferences";

/** 알려진 차이 적용기 — 원문 줄 → 기대 줄. 대조기는 완화하지 않고 기대 줄만 만든다 (QA/인수기준 「알려진 차이」). */
describe("expectedLines — 알려진 차이를 원문 줄에 얹는다", () => {
  it("범위(span) — 기준 줄 앞뒤 줄까지 한 덩어리로 바꾼다(박스 · 표 블록이 통째로 다른 자리)", () => {
    const source = ["## 제1조(보험금의 지급사유)", "@ 첫 항", "```그림", "설명: 예시", "```", "@ 둘째 항", "## 제2조(다른 조)", "```그림", "설명: 예시", "```"];
    const out = expectedLines("테스트", "a.md", source, [
      { dir: "테스트", file: "a.md", article: "보험금의 지급사유", after: "설명: 예시", replace: true, span: [1, 1], lines: ["```표", "|가|", "```"], why: "표기" },
    ]);
    expect(out).toEqual(["## 제1조(보험금의 지급사유)", "@ 첫 항", "```표", "|가|", "```", "@ 둘째 항", "## 제2조(다른 조)", "```그림", "설명: 예시", "```"]);
  });

  it("범위가 조 밖으로 넘치면 던진다(목록이 원문과 어긋난 것)", () => {
    const source = ["## 제1조(보험금의 지급사유)", "설명: 예시", "## 제2조(다른 조)"];
    expect(() => expectedLines("테스트", "a.md", source, [{ dir: "테스트", file: "a.md", article: "보험금의 지급사유", after: "설명: 예시", replace: true, span: [0, 1], lines: [], why: "표기" }])).toThrow(/범위/);
  });

  it("줄 안 글 바꾸기(within) — 그 조의 모든 줄에서 글 조각을 바꾸고, 없으면 던진다", () => {
    const source = ["## 제1조(정의)", "@ 제6조(항암방사선ㆍ약물치료의 정의)에서 정한", "@ 제6조(항암방사선ㆍ약물치료의 정의)에 따라", "## 제2조(다른 조)", "= 제6조(항암방사선ㆍ약물치료의 정의)"];
    const swap = { dir: "테스트", file: "a.md", article: "정의", after: "항암방사선ㆍ약물치료", lines: ["항암방사선∙약물치료"], within: true as const, why: "표기" };
    expect(expectedLines("테스트", "a.md", source, [swap])).toEqual(["## 제1조(정의)", "@ 제6조(항암방사선∙약물치료의 정의)에서 정한", "@ 제6조(항암방사선∙약물치료의 정의)에 따라", "## 제2조(다른 조)", "= 제6조(항암방사선ㆍ약물치료의 정의)"]);
    expect(() => expectedLines("테스트", "a.md", source, [{ ...swap, after: "없는 글" }])).toThrow(/없다/);
  });

  it("목록의 차이는 모두 제 자리를 찾는다 — 범위는 바꾸기(replace)에만 쓴다", () => {
    for (const d of KNOWN_DIFFERENCES) if (d.span) expect(d.replace, d.why).toBe(true);
  });
});
