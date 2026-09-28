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
});
