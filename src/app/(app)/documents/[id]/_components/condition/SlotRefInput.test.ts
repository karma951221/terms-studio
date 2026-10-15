import { describe, expect, it } from "vitest";

import { slotOptions, slotPathLabel } from "./SlotRefInput";
import type { ConditionContext } from "./types";

const context: ConditionContext = {
  coverage: { id: "cov", name: "암진단", nodes: [{ id: "cov", level: "coverage", name: "암진단" }, { id: "b1", level: "benefit", name: "급부1", parentId: "cov" }] },
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
  it("트리에서 고른 `코드@노드` 경로는 「이름 @노드이름」으로 보인다 — 모르는 코드는 경로 그대로(undefined)", () => {
    expect(slotPathLabel(context, "D0003@b1")).toBe("지급사유 @급부1");
    expect(slotPathLabel(context, "D0003@gone")).toBe("지급사유 @끊어진 노드");
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

describe("「현재 값」 묶음 (ADR-0088 결정 1)", () => {
  it("감싼 반복의 원소가 열거값이면 「현재 값」 묶음 — 값 이름 · 열거값 글 필드", () => {
    const inLoop: ConditionContext = { ...context, value: { name: "납입면제사유마다", fields: [{ key: "F01", label: "약관표시명" }] } };
    expect(slotOptions(inLoop).slice(0, 2)).toEqual([
      { value: "builtin.value.name", label: "값 이름", hint: "builtin.value.name", group: "현재 값 — 납입면제사유마다" },
      { value: "builtin.value.F01", label: "약관표시명", hint: "builtin.value.F01", group: "현재 값 — 납입면제사유마다" },
    ]);
    expect(slotPathLabel(inLoop, "builtin.value.F01")).toBe("현재 값 › 약관표시명");
    expect(slotPathLabel(context, "builtin.value.name")).toBe("현재 값 › 값 이름");
  });
});
