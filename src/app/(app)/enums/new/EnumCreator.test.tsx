/**
 * 열거형변수 생성 화면 (기능/열거형 §4.2) — 상세의 필드 표 · 값 표를 편집 모드로 재사용, 「생성」 하나 · ✕ 없음 · 빈 행 required 없음.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("../edit-actions", () => ({ createEnumEditAction: async () => ({ ok: true }) }));

import { duplicateValueCodes } from "../[code]/EnumTables";
import { EnumCreator } from "./EnumCreator";

describe("EnumCreator — 이름 · 필드 · 값 한 번에", () => {
  it("경로 「열거형 › 새 열거형변수」 · 「생성」 버튼 · ✕ 없음 · 필드 표와 값 표(빈 행 둘)가 편집 모드로", () => {
    const html = renderToStaticMarkup(<EnumCreator suggested="" />);
    expect(html).toContain("새 열거형변수");
    expect(html).toMatch(/<button[^>]*>생성<\/button>/);
    expect(html).not.toContain("편집 취소");
    expect(html).toContain('aria-label="행 추가 · 필드"');
    expect(html).toContain('aria-label="행 추가 · 값"');
    expect(html.match(/aria-label="값 이름"/g)).toHaveLength(2);
    expect(html).not.toContain("required");
  });

  it("목록 검색어가 넘어오면 이름 칸 프리필 + 「제안」 배지 — 고치지 않아도 「생성」을 누를 수 있다", () => {
    const html = renderToStaticMarkup(<EnumCreator suggested="간편심사" />);
    expect(html).toContain('value="간편심사"');
    expect(html).toContain("제안");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>생성<\/button>/);
  });

  it("값 이름 중복은 공백 · 대소문자 무시, 빈 칸끼리는 중복이 아니다", () => {
    expect(duplicateValueCodes([{ code: "new:1", label: "" }, { code: "new:2", label: " " }])).toEqual(new Set());
    expect(duplicateValueCodes([{ code: "new:1", label: "일반" }, { code: "new:2", label: " 일반 " }, { code: "V01", label: "간편" }])).toEqual(new Set(["new:1", "new:2"]));
  });
});
