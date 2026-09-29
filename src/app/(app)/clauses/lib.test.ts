import { describe, expect, it } from "vitest";

import type { Block, Inline } from "@/domain/clause";

import { isNewCode, remapOptionSlots, textBody, usedOptionCodes, valueText } from "./lib";

const body: Block[] = [
  {
    id: "p",
    kind: "paragraph",
    children: [{ id: "o", kind: "optionSlot", optionCode: "new:1" }],
    items: [{ id: "i", kind: "item", children: [{ id: "q", kind: "inlineCond", branches: [{ id: "b", children: [{ id: "o2", kind: "optionSlot", optionCode: "O01" }] }] }] }],
  },
];

describe("clauses lib — 순수", () => {
  it("선택지 문구는 평문 — 글 노드만 잇고, 빈 글은 빈 본문", () => {
    const value: Inline[] = [{ id: "a", kind: "text", text: "15일" }, { id: "s", kind: "slot", ref: "D0001" }, { id: "b", kind: "text", text: " 이내" }];
    expect(valueText(value)).toBe("15일 이내");
    expect(textBody("", "t")).toEqual([]);
    expect(textBody("30일", "t")).toEqual([{ id: "t", kind: "text", text: "30일" }]);
  });

  it("옵션 자리의 임시 코드를 실제 코드로 — 호 · 인라인 조건 안까지", () => {
    const remapped = remapOptionSlots(body, new Map([["new:1", "O02"]]));
    expect([...usedOptionCodes(remapped)].sort()).toEqual(["O01", "O02"]);
    expect([...usedOptionCodes(body)].sort()).toEqual(["O01", "new:1"]);
  });

  it("isNewCode", () => {
    expect(isNewCode("new:3")).toBe(true);
    expect(isNewCode("O01")).toBe(false);
  });
});
