/**
 * 동적표 미리보기 — 표본 급부 · 인자 값으로 펼친 글 표 (기능/동적표 §4.2). 인수 케이스 1 의 글자 그대로를 기대한다.
 */
import { describe, expect, it } from "vitest";

import { dynTableFixtureA, dynTableFixtureAPrime, dynTableFixtureR } from "./fixture";
import { previewDynTable } from "./preview";
import type { DynBenefit } from "./types";

function benefit(sub: string, name: string, rate: number | undefined, periods: [number, number][] = [], afterRate = 100): DynBenefit {
  return {
    subCoverageKey: sub,
    subCoverageName: sub,
    key: `${sub}/${name}`,
    name,
    ...(rate !== undefined ? { payRate: rate } : {}),
    ...(periods.length > 0 ? { reduction: { periods: periods.map(([end, r]) => ({ end, rate: r })), afterRate } } : {}),
  };
}

describe("previewDynTable — 표본으로 펼친 글 표", () => {
  it("케이스 1 — 세부보장 1 · 급부 1 · 경계 1개, 비갱신: 첫 + 마지막 열, 「해당보장의」 없음", () => {
    const out = previewDynTable(dynTableFixtureA(), { benefits: [benefit("질병80%이상후유장해", "질병80%이상후유장해", 100, [[12, 50]])] }, { 갱신형: false });
    expect(out.issues).toEqual([]);
    expect(out.header).toEqual(["구 분", "계약일부터 1년경과시점 전일 이전", "계약일부터 1년경과시점 이후"]);
    expect(out.rows).toEqual([["질병80%이상후유장해", "보험가입금액의 50%", "보험가입금액의 100%"]]);
  });

  it("갱신형 = 예 면 기준일이 「최초계약일」, 세부보장 2개면 셀 앞에 「해당보장의」", () => {
    const red: [number, number][] = [[12, 50]];
    const out = previewDynTable(dynTableFixtureA(), { benefits: [benefit("대장", "대장 진단비", 100, red), benefit("위", "위 진단비", 100, red)] }, { 갱신형: true });
    expect(out.issues).toEqual([]);
    expect(out.header[1]).toBe("최초계약일부터 1년경과시점 전일 이전");
    expect(out.rows.map((r) => r[1])).toEqual(["해당보장의 보험가입금액의 50%", "해당보장의 보험가입금액의 50%"]);
  });

  it("인자 값을 안 주면 그 조건은 거짓 · 슬롯은 〔arg.X〕 로 드러나고 사유가 issues 에 선다", () => {
    const out = previewDynTable(dynTableFixtureAPrime(), { benefits: [benefit("S", "급부", 100, [[12, 50]])] }, {});
    expect(out.header[1]).toContain("〔arg.단서〕");
    expect(out.issues.some((m) => m.includes("단서"))).toBe(true);
  });

  it("열 기준 「없음」(R) — 단일 열 「지급금액」, 비율 = 지급률 · 표본이 비면 머리글만", () => {
    const out = previewDynTable(dynTableFixtureR(), { benefits: [benefit("S", "항암치료비", 20)] }, {});
    expect(out.header).toEqual(["구 분", "지급금액"]);
    expect(out.rows).toEqual([["항암치료비", "보험가입금액의 20%"]]);
    expect(previewDynTable(dynTableFixtureR(), { benefits: [] }, {}).rows).toEqual([]);
  });

  it("지급률 미입력 급부는 셀이 비고 사유가 선다", () => {
    const out = previewDynTable(dynTableFixtureR(), { benefits: [benefit("S", "급부", undefined)] }, {});
    expect(out.rows).toEqual([["급부", ""]]);
    expect(out.issues.some((m) => m.includes("지급률"))).toBe(true);
  });
});
