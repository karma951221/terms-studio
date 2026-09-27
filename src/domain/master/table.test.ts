import { describe, expect, it } from "vitest";

import type { TableColumn } from "../types";
import { formatPeriod, parseCell, parsePercent, parsePeriod, parseTableDraft, pasteToDraft, tableRowsToDraft } from "./table";

const 구간: TableColumn[] = [
  { key: "end", label: "기간", type: "period" },
  { key: "rate", label: "지급률", type: "percent" },
];

describe("period — 3M/1Y 표기 (기능/담보 §3.4)", () => {
  it("M 은 개월 · Y 는 년 · 숫자만이면 개월", () => {
    expect(parsePeriod("3M")).toBe(3);
    expect(parsePeriod("1Y")).toBe(12);
    expect(parsePeriod("1y6m")).toBe(18);
    expect(parsePeriod(" 12 ")).toBe(12);
  });
  it("해석 못 하면 undefined", () => {
    for (const bad of ["", "3X", "1.5Y", "-3M", "Y"]) expect(parsePeriod(bad)).toBeUndefined();
  });
  it("표시는 n년 · n개월 · n년 n개월", () => {
    expect(formatPeriod(12)).toBe("1년");
    expect(formatPeriod(3)).toBe("3개월");
    expect(formatPeriod(18)).toBe("1년 6개월");
    expect(formatPeriod(0)).toBe("0개월");
  });
});

describe("percent", () => {
  it("% 와 공백을 떼고 0~100 정수만", () => {
    expect(parsePercent("50%")).toBe(50);
    expect(parsePercent(" 100 ")).toBe(100);
    expect(parsePercent("101")).toBeUndefined();
    expect(parsePercent("12.5")).toBeUndefined();
    expect(parsePercent("")).toBeUndefined();
  });
});

describe("parseCell — 열 타입별", () => {
  it("boolean 은 true/false · 예/아니오, number 는 유한수, string 은 그대로", () => {
    expect(parseCell("boolean", "예")).toBe(true);
    expect(parseCell("boolean", "false")).toBe(false);
    expect(parseCell("boolean", "글쎄")).toBeUndefined();
    expect(parseCell("number", "1.5")).toBe(1.5);
    expect(parseCell("number", "x")).toBeUndefined();
    expect(parseCell("string", " a ")).toBe("a");
  });
});

describe("parseTableDraft / tableRowsToDraft", () => {
  it("셀 원문을 행으로 · 다시 원문으로 (왕복)", () => {
    const parsed = parseTableDraft(구간, [["1Y", "50%"], ["3M", "10"]]);
    expect(parsed).toEqual({ value: [{ end: 12, rate: 50 }, { end: 3, rate: 10 }] });
    expect(tableRowsToDraft(구간, [{ end: 12, rate: 50 }])).toEqual([["1Y", "50"]]);
  });
  it("해석 실패는 행 · 열 좌표 메시지", () => {
    const r = parseTableDraft(구간, [["1Y", "50"], ["3X", "10"]]);
    expect(r).toMatchObject({ issue: { kind: "typeMismatch", message: expect.stringContaining("2행 기간") } });
  });
  it("열 수가 모자란 행은 오류 · 남는 열은 버린다 (3열 붙여넣기의 첫 열, 기능/담보 §3.4)", () => {
    expect(parseTableDraft(구간, [["1Y"]])).toMatchObject({ issue: { message: expect.stringContaining("1행 지급률") } });
    expect(parseTableDraft(구간, [["1Y", "50", "extra"]])).toEqual({ value: [{ end: 12, rate: 50 }] });
  });
  it("빈 초안(행 없음)은 오류", () => {
    expect(parseTableDraft(구간, [])).toMatchObject({ issue: { message: expect.stringContaining("행") } });
  });
});

describe("pasteToDraft — 엑셀 붙여넣기 (기능/담보 §3.4)", () => {
  it("줄 → 행 · 탭 → 열 · 머리글 행은 버림 · 빈 줄 무시", () => {
    expect(pasteToDraft(구간, "기간\t지급률\n1Y\t50%\n\n3M\t10%\n")).toEqual([["1Y", "50%"], ["3M", "10%"]]);
    expect(pasteToDraft(구간, "1Y\t50%")).toEqual([["1Y", "50%"]]);
  });
});
