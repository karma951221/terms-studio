import { describe, expect, it } from "vitest";

import type { Block, Inline } from "@/domain/clause";

import { isNewCode, presetsForSave, remapOptionSlots, textBody, usedOptionCodes, valueText } from "./lib";

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

describe("프리셋 저장 모양 — 편집 코드(new:*) → 실제 옵션 · 선택지 코드 (ADR-0084)", () => {
  const finalOptions = [
    { code: "O01", values: [{ code: "V01" }, { code: "V03" }] }, // 있던 옵션 — V02 를 빼고 새 선택지 하나(V03)
    { code: "O02", values: [{ code: "V01" }, { code: "V02" }] }, // 새 옵션
  ];
  const edit = [
    { code: "O01", label: "기산", values: [{ code: "V01", label: "", text: "" }, { code: "new:3", label: "", text: "" }] },
    { code: "new:1", label: "어조", values: [{ code: "new:4", label: "", text: "" }, { code: "new:5", label: "", text: "" }] },
  ];

  it("있는 코드는 그대로 · 새 옵션은 만든 코드로 · 새 선택지는 그 옵션의 새로 생긴 코드로(순서대로) · 새 프리셋은 코드 없이", () => {
    const out = presetsForSave(
      [
        { code: "S01", name: "상해", options: { O01: "new:3", "new:1": "new:5" }, bindings: {}, fromUsage: [] },
        { code: "new:9", name: "질병", options: { O01: "V01", "new:1": "new:4" }, bindings: {}, fromUsage: ["사유"] },
      ],
      edit,
      finalOptions,
      new Map([["new:1", "O02"]]),
    );
    expect(out).toEqual([
      { code: "S01", name: "상해", options: { O01: "V03", O02: "V02" } },
      { name: "질병", options: { O01: "V01", O02: "V01" }, fromUsage: ["사유"] },
    ]);
  });
});
