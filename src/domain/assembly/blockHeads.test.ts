import { describe, expect, it } from "vitest";

import { blockHeads, romanNumeral } from "./blockHeads";

/**
 * 블록 번호 머리 (ADR-0090 결정 8 · 기능/조립산출 §3.8) — 상품 기본정보 「그룹 제목 표시」가 정한다.
 * 켜면 그룹 제목 줄 「Ⅰ.」 아래 블록 「Ⅰ-1.」 · 「Ⅰ-2.」(로마 숫자는 찍히는 그룹만 센다), 끄면 그룹 제목 없이 「1.」 「2.」 「3.」.
 */

describe("로마 숫자", () => {
  it("1 ~ 12 는 한 글자(Ⅰ ~ Ⅻ), 그 뒤는 글자를 잇는다", () => {
    expect([1, 2, 3, 4, 9, 10, 12].map(romanNumeral)).toEqual(["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅸ", "Ⅹ", "Ⅻ"]);
    expect(romanNumeral(13)).toBe("ⅩⅢ");
    expect(romanNumeral(40)).toBe("ⅩⅬ");
  });
});

describe("blockHeads", () => {
  const groups = [
    { id: "g-brain", titled: true, members: ["pc-stroke", "pc-cerebro"] },
    { id: "g-heart", titled: true, members: ["pc-ami"] },
    { id: "ungrouped", titled: false, members: ["pc-loose"] },
  ];

  it("켜면 — 그룹 머리 「Ⅰ.」 「Ⅱ.」 · 블록 머리 「Ⅰ-1.」 「Ⅰ-2.」 「Ⅱ-1.」. 제목 없는 자리(그룹 아님)는 세지 않고 머리도 없다", () => {
    const heads = blockHeads(groups, true);
    expect([...heads.groups]).toEqual([["g-brain", "Ⅰ."], ["g-heart", "Ⅱ."]]);
    expect([...heads.blocks]).toEqual([["pc-stroke", "Ⅰ-1."], ["pc-cerebro", "Ⅰ-2."], ["pc-ami", "Ⅱ-1."]]);
  });

  it("끄면 — 그룹 머리 없이 블록 순서대로 「1.」 「2.」 … (제목 없는 자리도 이어 센다)", () => {
    const heads = blockHeads(groups, false);
    expect(heads.groups.size).toBe(0);
    expect([...heads.blocks]).toEqual([["pc-stroke", "1."], ["pc-cerebro", "2."], ["pc-ami", "3."], ["pc-loose", "4."]]);
  });
});
