/**
 * 더보기 항목 — 체크 항목(켜고 끄는 보기 설정)은 menuitemcheckbox 로, 켜짐을 aria-checked · ✓ 로 말한다 (2026-10-10).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown }) => <a {...(rest as object)}>{children as never}</a> }));

import { MoreMenuEntry } from "./MoreMenu";

describe("MoreMenuEntry — 더보기 한 줄", () => {
  it("체크 항목 — role=menuitemcheckbox · aria-checked · 켜짐이면 ✓", () => {
    const on = renderToStaticMarkup(<MoreMenuEntry item={{ label: "수정 흔적 보기", checked: true, onSelect: () => undefined }} onPick={() => undefined} />);
    expect(on).toContain('role="menuitemcheckbox"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("✓");
    expect(on).toContain("수정 흔적 보기");
    const off = renderToStaticMarkup(<MoreMenuEntry item={{ label: "수정 흔적 보기", checked: false, onSelect: () => undefined }} onPick={() => undefined} />);
    expect(off).toContain('role="menuitemcheckbox"');
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain("✓");
  });

  it("보통 항목 — role=menuitem, aria-checked 없음", () => {
    const html = renderToStaticMarkup(<MoreMenuEntry item={{ label: "복제", onSelect: () => undefined }} onPick={() => undefined} />);
    expect(html).toContain('role="menuitem"');
    expect(html).not.toContain("aria-checked");
  });
});
