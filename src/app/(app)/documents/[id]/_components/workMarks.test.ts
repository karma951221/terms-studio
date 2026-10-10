import { describe, expect, it } from "vitest";

import { marksShownAfterPick } from "./workMarks";

describe("글자색을 칠하면 「수정 흔적 보기」를 켠다 (기능/문면 §3.2 보기, 2026-10-10 사용자 QA)", () => {
  it("꺼져 있을 때 색을 고르면 켠다 — 칠한 글이 보통 글색에 묻히지 않게", () => {
    expect(marksShownAfterPick(false, "red")).toBe(true);
    expect(marksShownAfterPick(false, "blue")).toBe(true);
  });

  it("「색 지우기」는 보기를 바꾸지 않는다", () => {
    expect(marksShownAfterPick(false, undefined)).toBe(false);
    expect(marksShownAfterPick(true, undefined)).toBe(true);
  });

  it("이미 켜져 있으면 그대로", () => {
    expect(marksShownAfterPick(true, "green")).toBe(true);
  });
});
