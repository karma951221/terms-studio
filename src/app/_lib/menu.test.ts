import { describe, expect, it } from "vitest";

import { MENU_FLOW } from "./menu";

describe("메뉴 구성 (ADR-0073 — 항목 하나 = 기능 하나 = route 하나)", () => {
  it("정적 마스터 그룹 = 별표 · 박스 — 약관 조문의 재료라 그 앞에 선다 (최종 결정 9)", () => {
    expect(MENU_FLOW.map((g) => g.title)).toEqual(["기본정보", "담보 설계", "정적 마스터", "약관 조문", "상품"]);
    const staticMaster = MENU_FLOW.find((g) => g.title === "정적 마스터")!;
    expect(staticMaster.items.map((i) => [i.label, i.href])).toEqual([
      ["별표", "/appendices"],
      ["박스", "/boxes"],
    ]);
  });

  it("약관 조문에는 별표가 없다 — 함수조항 · 보통약관 템플릿 · 담보약관 템플릿", () => {
    expect(MENU_FLOW.find((g) => g.title === "약관 조문")!.items.map((i) => i.href)).toEqual(["/clauses", "/documents?kind=general", "/documents?kind=coverage"]);
  });
});
