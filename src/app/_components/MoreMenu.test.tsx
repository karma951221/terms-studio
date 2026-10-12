// @vitest-environment jsdom
/**
 * 더보기 메뉴 — 링크 · 화면 안 조작 · 체크 항목, 키보드로 열고 닫기 (디자인원칙 「상세 화면 버튼 정리」, 2026-10-10 체크 항목).
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown }) => <a {...(rest as object)}>{children as never}</a> }));

import { MoreMenu } from "./MoreMenu";

afterEach(cleanup);

describe("MoreMenu", () => {
  it("트리거는 ts-more-button · 닫혀 있으면 aria-expanded=false", () => {
    render(<MoreMenu items={[{ label: "복제", onSelect: () => undefined }]} />);
    const trigger = screen.getByRole("button", { name: /더보기/ });
    expect(trigger.className).toContain("ts-more-button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("키보드로 열면 항목 역할이 menuitem · menuitemcheckbox 이고 켜짐은 aria-checked", async () => {
    const user = userEvent.setup();
    render(
      <MoreMenu
        items={[
          { label: "미리보기", href: "/p/1/preview" },
          { label: "수정 흔적 보기", checked: true, onSelect: () => undefined },
          { label: "삭제", href: "?confirm=delete", danger: true },
        ]}
      />,
    );
    screen.getByRole("button", { name: /더보기/ }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "미리보기" }).getAttribute("href")).toBe("/p/1/preview");
    expect(screen.getByRole("menuitemcheckbox", { name: /수정 흔적 보기/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "삭제" })).toBeTruthy();
  });

  it("링크 항목은 위젯(data-slot) 앵커 — 밑줄 없음 · 레거시 a 규칙(밑줄 · hover 주칠) 밖", async () => {
    const user = userEvent.setup();
    render(<MoreMenu items={[{ label: "미리보기", href: "/p/1/preview" }]} />);
    screen.getByRole("button", { name: /더보기/ }).focus();
    await user.keyboard("{Enter}");
    const link = screen.getByRole("menuitem", { name: "미리보기" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("data-slot")).toBe("dropdown-menu-item");
    expect(link.className.split(/\s+/)).toContain("no-underline");
  });

  it("onSelect 는 트리거 자리(DOMRect)를 받고, 고르면 닫힌다", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MoreMenu items={[{ label: "복제", onSelect }]} />);
    screen.getByRole("button", { name: /더보기/ }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBeInstanceOf(DOMRect);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 로 닫히면 초점이 트리거로 돌아온다", async () => {
    const user = userEvent.setup();
    render(<MoreMenu items={[{ label: "복제", onSelect: () => undefined }]} />);
    const trigger = screen.getByRole("button", { name: /더보기/ });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("trigger 를 주면 label 이 버튼 이름(tooltip)이 된다", () => {
    render(<MoreMenu label="새로 만들기" trigger={<svg />} items={[{ label: "문구", onSelect: () => undefined }]} />);
    const trigger = screen.getByRole("button", { name: "새로 만들기" });
    expect(trigger.getAttribute("title")).toBe("새로 만들기");
  });
});

describe("globals.css — .ts-more 상자 규칙이 DropdownMenu 를 덮지 않는다", () => {
  it(".ts-more-menu · .ts-more-menu-item · .ts-more-button 기본 규칙이 없다", () => {
    const selectors: string[] = [];
    postcss.parse(readFileSync("src/app/globals.css", "utf8")).walkRules((r) => {
      selectors.push(...r.selectors);
    });
    const bare = selectors.map((s) => s.trim().replaceAll(":where(:not([data-slot]))", ""));
    expect(bare.filter((s) => /^\.ts-more-(menu|menu-item|button)\b/.test(s))).toEqual([]);
  });
});
