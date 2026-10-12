import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { guardSelector, unguardedSelectors } from "./guard-legacy";

const G = ":where(:not([data-slot]))";

describe("guardSelector — 요소 선택자를 shadcn 위젯 밖으로 가둔다 (ADR-0085)", () => {
  it.each([
    ["button", `button${G}`],
    ["button:hover", `button${G}:hover`],
    ['input[type="radio"]', `input${G}[type="radio"]`],
    [".ts-cell-form input", `.ts-cell-form input${G}`],
    ["button.primary,\na.primary", `button${G}.primary,\na${G}.primary`],
    ["a", `a${G}`],
    ["a:hover", `a${G}:hover`],
    [".ts-table a", `.ts-table a${G}`],
    [".ts-graph-nodes > a:focus-visible", `.ts-graph-nodes > a${G}:focus-visible`],
    [".ts-nav a .ts-badge", ".ts-nav a .ts-badge"],
    ["input,\nselect,\ntextarea", `input${G},\nselect${G},\ntextarea${G}`],
    [":focus-visible", `${G}:focus-visible`],
  ])("%s", (input, expected) => {
    expect(guardSelector(input)).toBe(expected);
  });

  it("클래스 이름에 든 button 은 요소가 아니다", () => {
    expect(guardSelector(".ts-more-button")).toBe(".ts-more-button");
  });

  it.each([
    [".a:has(input:checked)"],
    ["button > span"],
    [".x:not(button)"],
    [":is(input, select) + label"],
    ["button:focus-visible .icon"],
  ])("주어(마지막 compound)가 아니거나 의사 클래스 인자 안이면 그대로 둔다 — %s", (input) => {
    expect(guardSelector(input)).toBe(input);
  });

  it("주어 compound 의 :focus-visible 만 가둔다", () => {
    expect(guardSelector(".ts-nodes > a:focus-visible .node > circle")).toBe(".ts-nodes > a:focus-visible .node > circle");
    expect(guardSelector(".ts-drag:focus-visible")).toBe(`.ts-drag${G}:focus-visible`);
  });

  it("두 번 걸어도 한 번 건 것과 같다 — 주어 · 비주어가 섞여도", () => {
    const once = guardSelector(".a:has(input:checked) > button:hover, .ts-cell-form input");
    expect(once).toBe(`.a:has(input:checked) > button${G}:hover, .ts-cell-form input${G}`);
    expect(guardSelector(once)).toBe(once);
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

  it("주어가 아닌 자리(조상 · :has() 인자 등)에는 가드가 없다 — 가드를 걷고 다시 걸면 지금과 같다", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const overGuarded: string[] = [];
    postcss.parse(css).walkRules((rule) => {
      if (guardSelector(rule.selector.replaceAll(G, "")) !== rule.selector) overGuarded.push(rule.selector);
    });
    expect(overGuarded).toEqual([]);
  });

  it("@keyframes 안의 from · to · % 는 건드리지 않는다", () => {
    expect(unguardedSelectors("@keyframes x { from { opacity: 0 } to { opacity: 1 } }")).toEqual([]);
  });
});
