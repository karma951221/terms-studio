/**
 * shadcn 위젯의 형태 규칙 — 디자인원칙 §3 · §5 · §8, ADR-0085.
 * shadcn 을 다시 add 하거나 손으로 고칠 때 기본값이 슬며시 돌아오는 것을 잡는다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "src/components/ui";
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
const read = (f: string) => readFileSync(`${DIR}/${f}`, "utf8");

const EXPECTED = [
  "badge", "button", "checkbox", "dialog", "dropdown-menu", "input", "native-select",
  "popover", "radio-group", "select", "switch", "table", "tabs", "textarea", "tooltip",
];
const FLOATING = ["dialog.tsx", "dropdown-menu.tsx", "popover.tsx", "select.tsx", "tooltip.tsx"];

describe("shadcn 위젯 형태 규칙", () => {
  it("위젯 15종이 있다", () => {
    expect(files.map((f) => f.replace(/\.tsx$/, "")).sort()).toEqual(EXPECTED);
  });

  it.each(files)("%s — 맑은 고딕에 없는 굵기(500 · 600)를 쓰지 않는다", (f) => {
    expect(read(f)).not.toMatch(/\bfont-(medium|semibold)\b/);
  });

  it.each(files)("%s — dark: 변형이 없다(토큰이 다크를 따라간다)", (f) => {
    expect(read(f)).not.toMatch(/\bdark:/);
  });

  it.each(files)("%s — 그림자는 shadow-float 하나뿐이다", (f) => {
    expect(read(f)).not.toMatch(/\bshadow-(xs|sm|md|lg|xl|2xl)\b/);
  });

  it.each(files.filter((f) => !FLOATING.includes(f)))("%s — 놓인 위젯에는 그림자가 없다", (f) => {
    expect(read(f)).not.toMatch(/\bshadow-float\b/);
  });

  it.each(FLOATING)("%s — 떠 있는 패널은 shadow-float · rounded-lg", (f) => {
    expect(read(f)).toMatch(/\bshadow-float\b/);
    expect(read(f)).toMatch(/\brounded-lg\b/);
  });

  it("button — 높이 32(h-8) · 아이콘 32(size-8) · 행 안 아이콘 24(size-6) · 반경 6(rounded-md)", () => {
    const src = read("button.tsx");
    expect(src).toMatch(/default:\s*"h-8\b/);
    expect(src).toMatch(/icon:\s*"size-8"/);
    expect(src).toMatch(/"icon-sm":\s*"size-6"/);
    expect(src).toMatch(/\brounded-md\b/);
  });

  it.each(["input.tsx", "native-select.tsx", "select.tsx"])("%s — 컨트롤 높이 32(h-8)", (f) => {
    expect(read(f)).toMatch(/\bh-8\b/);
  });

  it.each(["button.tsx", "input.tsx", "textarea.tsx", "native-select.tsx"])("%s — data-slot 이 붙는다(레거시 가두기의 열쇠)", (f) => {
    expect(read(f)).toMatch(/data-slot="/);
  });
});
