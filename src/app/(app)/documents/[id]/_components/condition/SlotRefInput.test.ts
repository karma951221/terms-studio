import { describe, expect, it } from "vitest";

import { slotOptions, slotPathLabel } from "./SlotRefInput";
import type { ConditionContext } from "./types";

const context: ConditionContext = {
  coverage: { id: "cov", name: "암진단", nodes: [
    { id: "cov", level: "coverage", name: "암진단" },
    { id: "s1", level: "subCoverage", name: "유사암", parentId: "cov", key: "01", keyPath: "01" },
    { id: "b1", level: "benefit", name: "진단비", parentId: "s1", key: "1", keyPath: "01.1" },
  ] },
  discriminators: [
    { code: "D0003", label: "지급사유", level: "benefit", type: { kind: "string" }, forms: [] },
    { code: "D0001", label: "갱신여부", level: "coverage", type: { kind: "boolean" }, forms: [] },
    { code: "D0002", label: "갱신유형", level: "coverage", type: { kind: "enum", enumCode: "E0001" }, forms: [] },
  ],
  openedForms: {},
  quick: [],
};

describe("슬롯 참조 후보 — 검색 입력(콤보박스)", () => {
  it("결과가 문자 · 열거형인 구분자만, 붙는 레벨 순으로 묶는다", () => {
    expect(slotOptions(context)).toEqual([
      { value: "D0002", label: "갱신유형", hint: "D0002", group: "담보" },
      { value: "D0003", label: "지급사유", hint: "D0003", group: "급부" },
    ]);
  });
  it("트리에서 고른 `코드@키경로` 는 「세부보장 01 · 이름 › 급부 1 · 이름 › 구분자」로 보인다 — 모르는 코드는 경로 그대로(undefined)", () => {
    expect(slotPathLabel(context, "D0003@01.1")).toBe("세부보장 01 · 유사암 › 급부 1 · 진단비 › 지급사유");
    expect(slotPathLabel(context, "D0003@09.9")).toBe("끊어진 노드 09.9 › 지급사유");
    expect(slotPathLabel(context, "D0002")).toBe("갱신유형");
    expect(slotPathLabel(context, "D9999")).toBeUndefined();
  });
  it("감싼 반복이 종 반복이면 맨 앞 「현재 종」 묶음 — 종형명 · 선택지 번호 (ADR-0077 결정 3)", () => {
    const inLoop: ConditionContext = { ...context, plan: { name: "납입면제종마다" } };
    expect(slotOptions(inLoop).slice(0, 2)).toEqual([
      { value: "builtin.plan.name", label: "종형명", hint: "builtin.plan.name", group: "현재 종 — 납입면제종마다" },
      { value: "builtin.plan.number", label: "선택지 번호", hint: "builtin.plan.number", group: "현재 종 — 납입면제종마다" },
    ]);
    expect(slotOptions(context).some((o) => o.value.startsWith("builtin."))).toBe(false);
    expect(slotPathLabel(inLoop, "builtin.plan.name")).toBe("현재 종 › 종형명");
    expect(slotPathLabel(context, "builtin.plan.number")).toBe("현재 종 › 선택지 번호");
  });
});
