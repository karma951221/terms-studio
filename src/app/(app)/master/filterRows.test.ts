import { describe, expect, it } from "vitest";

import { filterRows, type MasterRow } from "./filterRows";

const rows: MasterRow[] = [
  { path: "waiver.applies", label: "적용여부", formKey: "waiver", formLabel: "납입면제", level: "plan", levelLabel: "세목", typeLabel: "참거짓" },
  { path: "waiver.reasons", label: "납입면제사유", formKey: "waiver", formLabel: "납입면제", level: "plan", levelLabel: "세목", typeLabel: "목록값(복수)", enumLabel: "납입면제사유", enumCode: "E0001" },
  { path: "pay.rate", label: "지급률", formKey: "pay", formLabel: "보험금지급", level: "benefit", levelLabel: "급부", typeLabel: "숫자" },
];

const paths = (out: MasterRow[]) => out.map((r) => r.path);

describe("filterRows — 마스터 표 검색 (기능/마스터 §4.1 검색)", () => {
  it("빈 검색어면 그대로 (순서 유지)", () => {
    expect(filterRows(rows, "")).toEqual(rows);
    expect(filterRows(rows, "   ")).toEqual(rows);
  });

  it("필드 코드 · 표시명 부분 일치 — 맞는 행만 남는다", () => {
    expect(paths(filterRows(rows, "rate"))).toEqual(["pay.rate"]);
    expect(paths(filterRows(rows, "적용"))).toEqual(["waiver.applies"]);
  });

  it("폼 표시명이 맞으면 그 폼의 행 전부", () => {
    expect(paths(filterRows(rows, "납입"))).toEqual(["waiver.applies", "waiver.reasons"]);
  });

  it("폼 코드(폼키)가 맞아도 그 폼의 행 전부 — 대소문자 무시", () => {
    expect(paths(filterRows(rows, "WAIV"))).toEqual(["waiver.applies", "waiver.reasons"]);
  });

  it("맞는 것이 없으면 빈 배열", () => {
    expect(filterRows(rows, "zzz")).toEqual([]);
  });

  it("대소문자 무시", () => {
    expect(paths(filterRows(rows, "RATE"))).toEqual(["pay.rate"]);
    expect(paths(filterRows(rows, "Waiver.APPLIES"))).toEqual(["waiver.applies"]);
  });
});
