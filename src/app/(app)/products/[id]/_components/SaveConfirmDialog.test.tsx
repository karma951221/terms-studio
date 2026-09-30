/**
 * 기본정보 저장 확인 모달 (2026-10-01) — 화면 위쪽 모달 · 서비스가 준 줄을 그대로 · 취소 / 바꾸고 저장.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SaveConfirmDialog } from "./SaveConfirmDialog";

describe("SaveConfirmDialog", () => {
  const render = (impact: Parameters<typeof SaveConfirmDialog>[0]["impact"]) =>
    renderToStaticMarkup(<SaveConfirmDialog impact={impact} onCancel={() => {}} onConfirm={() => {}} />);

  it("화면 위쪽 모달 — 제목 · 영향 줄 · 취소 / 바꾸고 저장(위험)", () => {
    const html = render({ valueRowsLost: 2, brokenRefs: [], cascade: ["보험종목 삭제 · 제2종(형)", "기본계약 해제 · 일반상해사망 — 상품담보는 특별약관 표에 남습니다"] });
    expect(html).toContain('class="ts-dialog ts-dialog-top"');
    expect(html).toContain("저장하면 아래 내용이 함께 바뀝니다");
    expect(html).toContain("<li>입력한 값 2건이 함께 삭제됩니다</li>");
    expect(html).toContain("<li>보험종목 삭제 · 제2종(형)</li>");
    expect(html).toContain("<li>기본계약 해제 · 일반상해사망 — 상품담보는 특별약관 표에 남습니다</li>");
    expect(html).toMatch(/<button type="button"[^>]*>취소<\/button>/);
    expect(html).toMatch(/<button type="button" class="danger"[^>]*>바꾸고 저장<\/button>/);
  });

  it("잃는 값이 없으면 값 줄은 없다 — 기본계약 해제만", () => {
    const html = render({ valueRowsLost: 0, brokenRefs: [], cascade: ["기본계약 해제 · 일반상해사망 — 상품담보는 특별약관 표에 남습니다"] });
    expect(html).not.toContain("입력한 값");
    expect(html.match(/<li>/g)).toHaveLength(1);
  });
});
