import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { guardSelector, unguardedSelectors } from "./guard-legacy";

const G = ":where(:not([data-slot]))";

describe("guardSelector — 요소 선택자를 shadcn 위젯 밖으로 가둔다 (ADR-0085)", () => {
  it.each([
    ["button", `button${G}`],
    ["button:hover", `button${G}:hover`],
    ['input[type="radio"]', `input${G}[type="radio"]`],
    [".ts-cell-form input", `.ts-cell-form input${G}`],
    ["button.primary,\na.primary", `button${G}.primary,\na.primary`],
    ["input,\nselect,\ntextarea", `input${G},\nselect${G},\ntextarea${G}`],
    [":focus-visible", `${G}:focus-visible`],
  ])("%s", (input, expected) => {
    expect(guardSelector(input)).toBe(expected);
  });

  it("클래스 이름에 든 button 은 요소가 아니다", () => {
    expect(guardSelector(".ts-more-button")).toBe(".ts-more-button");
  });

  it("두 번 걸어도 한 번 건 것과 같다", () => {
    expect(guardSelector(guardSelector("button:hover"))).toBe(`button${G}:hover`);
  });
});

describe("globals.css — 가두지 않은 요소 선택자가 없다", () => {
  it("button · input · select · textarea · :focus-visible 은 모두 data-slot 밖으로 갇혀 있다", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(unguardedSelectors(css)).toEqual([]);
  });

  it("@keyframes 안의 from · to · % 는 건드리지 않는다", () => {
    expect(unguardedSelectors("@keyframes x { from { opacity: 0 } to { opacity: 1 } }")).toEqual([]);
  });
});
