import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: unknown }) => <a {...(rest as object)}>{children as never}</a> }));

import { Confirm } from "./Confirm";
import { InfoTip } from "./InfoTip";
import { RadioGroup } from "./RadioGroup";
import { Toggle } from "./Toggle";

const impact = { valueRowsLost: 2, cascade: [], brokenRefs: [] };

describe("Confirm — 확인 카드", () => {
  it("실행은 submit 버튼(destructive) · 취소는 링크 버튼 — E2E 의 .ts-confirm button[type=submit] 유지", () => {
    const html = renderToStaticMarkup(<Confirm impact={impact as never} action={() => undefined} actionLabel="D0003 삭제" />);
    expect(html).toContain('class="ts-confirm');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*data-slot="button"|<button[^>]*data-slot="button"[^>]*type="submit"/);
    expect(html).toContain("hover:text-destructive");
    const cancel = html.match(/<a\b[^>]*>취소<\/a>/)?.[0] ?? "";
    expect(cancel).toContain('data-slot="button"');
    expect(cancel).toContain('href="?"');
  });
});

describe("Toggle — 네이티브 checkbox(role=switch) 에 스위치 모양", () => {
  it("폼 제출용 name 과 role=switch 가 남는다", () => {
    const html = renderToStaticMarkup(<Toggle name="alwaysShown" label="항상 노출" defaultChecked />);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*role="switch"[^>]*name="alwaysShown"/);
    expect(html).toContain("checked");
    expect(html).toContain('data-slot="switch-native"');
  });
});

describe("RadioGroup — 네이티브 radio 에 shadcn 모양", () => {
  it("name · value 가 실리는 radio 둘", () => {
    const html = renderToStaticMarkup(<RadioGroup name="kind" label="유형" options={[{ value: "a", label: "가" }, { value: "b", label: "나" }]} defaultValue="a" />);
    expect(html.match(/<input[^>]*type="radio"[^>]*name="kind"/g)?.length).toBe(2);
    expect(html).toContain('data-slot="radio-native"');
  });
});

describe("InfoTip — 툴팁 트리거", () => {
  it("접근성 이름을 유지하고 native title 은 없앤다(툴팁 이중 표시 방지)", () => {
    const html = renderToStaticMarkup(<InfoTip text="기준일 — 오늘" />);
    expect(html).toContain('aria-label="기준일 — 오늘"');
    expect(html).not.toContain("title=");
    expect(html).toContain('tabindex="0"');
  });
});

describe("globals.css — 레거시가 새 모양을 덮지 않는다", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  it("토글 트랙 · 숨김 input 규칙이 없다", () => {
    expect(css).not.toContain(".ts-toggle-track");
    expect(css).not.toMatch(/\.ts-toggle\s*>\s*input/);
  });
  it("비활성 토글은 라벨이 흐려진다", () => {
    expect(css).toMatch(/\.ts-toggle:has\(> \[data-slot="switch-native"\]:disabled\) \.ts-toggle-label\s*\{[^}]*opacity/);
  });
  it(".ts-infotip 규칙에 색 선언이 없다", () => {
    const rules = css.match(/[^{}]*\.ts-infotip[^{}]*\{[^}]*\}/g) ?? [];
    for (const rule of rules) expect(rule).not.toMatch(/\bcolor:/);
  });
});
