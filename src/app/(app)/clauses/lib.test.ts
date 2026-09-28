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

describe("박스 본문 — 옵션 자리 코드 바꾸기 · 쓰는 옵션 (2026-09-28)", () => {
  const box = [{ id: "b", kind: "box" as const, title: "용어풀이", lines: [{ id: "l1", kind: "line" as const, children: [{ id: "t", kind: "text" as const, text: "가 " }, { id: "o", kind: "optionSlot" as const, optionCode: "tmp1" }] }] }];
  it("박스 줄의 옵션 자리도 새 코드로 바뀌고, 쓰는 옵션으로 잡힌다(생성 저장이 던지지 않는다)", () => {
    const out = remapOptionSlots(box, new Map([["tmp1", "O01"]])) as typeof box;
    expect(out[0].lines[0].children[1]).toMatchObject({ kind: "optionSlot", optionCode: "O01" });
    expect([...usedOptionCodes(out)]).toEqual(["O01"]);
  });
});
