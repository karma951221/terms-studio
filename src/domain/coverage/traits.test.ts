import { describe, expect, it } from "vitest";

import { entered } from "../types";
import { checkReductionPeriods, reductionPeriods, validateSlotValue } from "./traits";

describe("checkReductionPeriods — 엄격 오름차순 · 중복 거부 · 0 거부 (기능/담보 §3.4)", () => {
  it("오름차순이면 통과", () => {
    expect(checkReductionPeriods([{ end: 3, rate: 10 }, { end: 12, rate: 50 }])).toEqual([]);
  });
  it("같거나 역전이면 행 좌표 오류", () => {
    expect(checkReductionPeriods([{ end: 12, rate: 50 }, { end: 12, rate: 60 }])[0].message).toContain("2행");
    expect(checkReductionPeriods([{ end: 12, rate: 50 }, { end: 3, rate: 60 }])[0].message).toContain("2행");
  });
  it("기간 0 은 구간이 아니다", () => {
    expect(checkReductionPeriods([{ end: 0, rate: 50 }])[0].message).toContain("1행");
  });
});

describe("validateSlotValue — 경로별 규칙", () => {
  const enums = () => undefined;
  it("reduction.periods 는 표 검사 + 구간 규칙", () => {
    const type = { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }, { key: "rate", label: "지급률", type: "percent" }] } as const;
    expect(validateSlotValue("reduction.periods", type, [{ end: 12, rate: 50 }, { end: 3, rate: 10 }], enums)).toHaveLength(1);
    expect(validateSlotValue("reduction.periods", type, [{ end: 3, rate: 10 }, { end: 12, rate: 50 }], enums)).toEqual([]);
  });
  it("reduction.after_rate 는 0~100 정수 · exemption.months 는 0 이상 정수", () => {
    expect(validateSlotValue("reduction.after_rate", { kind: "number" }, 150, enums)).toHaveLength(1);
    expect(validateSlotValue("reduction.after_rate", { kind: "number" }, 100, enums)).toEqual([]);
    expect(validateSlotValue("exemption.months", { kind: "number" }, 1.5, enums)).toHaveLength(1);
    expect(validateSlotValue("exemption.months", { kind: "number" }, 3, enums)).toEqual([]);
  });
  it("다른 경로는 validateValue 그대로", () => {
    expect(validateSlotValue("pay.rate", { kind: "number" }, "x", enums)).toHaveLength(1);
  });
});

describe("reductionPeriods — 동적 표 창구", () => {
  it("안 연 폼은 undefined · 열렸으면 구간 + 이후 지급률(없으면 100)", () => {
    expect(reductionPeriods(() => undefined)).toBeUndefined();
    const read = (p: string) => (p === "reduction.periods" ? entered([{ end: 12, rate: 50 }]) : undefined);
    expect(reductionPeriods(read)).toEqual({ periods: [{ end: 12, rate: 50 }], afterRate: 100 });
  });
});
