/**
 * 블록 번호 머리 (ADR-0090 결정 8 · 기능/조립산출 §3.8) — 순수.
 *
 * 상품 기본정보의 「그룹 제목 표시」(책자 폼 `booklet.group_titles`, 기본 끔)가 정한다. 절 형태의 제2절 블록에만 작용한다
 * (제2절 골격은 미구현 — 지금은 독립특약의 탑재 상품담보를 특약 자리에 그룹마다 찍으며 이 머리를 붙인다, `booklet.ts` `assemble`).
 * - 켜면 그룹 제목 줄이 서고 로마 숫자로 매긴다 — 그룹 「Ⅰ.」 아래 블록 「Ⅰ-1.」 · 「Ⅰ-2.」, 다음 그룹 「Ⅱ.」 아래 「Ⅱ-1.」.
 *   번호는 찍히는 그룹(블록이 있고 제목 줄이 서는 그룹)만 센다 — 그룹 없는 자리(담보분류 미입력 · 지운 값, 결정 9)는 그룹이 아니라 세지 않고 머리도 없다.
 * - 끄면 그룹 제목 없이 같은 순서로 「1.」 「2.」 「3.」 — 형태(독립특약 · 기본계약 2+)와 상관없다. 그룹 없는 자리의 블록도 이어 센다.
 * 블록 지정 참조 렌더 · 오류 좌표 표시(「제2절 Ⅰ-1.」)도 같은 머리를 쓴다.
 */
import type { Id } from "../types";

const SINGLE = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"];
const PARTS: [number, string][] = [
  [1000, "Ⅿ"], [900, "ⅭⅯ"], [500, "Ⅾ"], [400, "ⅭⅮ"], [100, "Ⅽ"], [90, "ⅩⅭ"], [50, "Ⅼ"], [40, "ⅩⅬ"], [10, "Ⅹ"],
];

/** 로마 숫자 — 1 ~ 12 는 한 글자(Ⅰ ~ Ⅻ), 그 뒤는 십 단위 이상 글자 + 끝자리 한 글자(ⅩⅢ). */
export function romanNumeral(n: number): string {
  if (n >= 1 && n <= SINGLE.length) return SINGLE[n - 1]!;
  let rest = n;
  let out = "";
  for (const [value, glyph] of PARTS) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return rest > 0 ? out + SINGLE[rest - 1]! : out;
}

export interface BlockHeads {
  /** 그룹 id → 그룹 머리(「Ⅰ.」) — 켤 때만. */
  groups: ReadonlyMap<Id, string>;
  /** 블록(상품담보) id → 블록 머리(「Ⅰ-1.」 · 「1.」). */
  blocks: ReadonlyMap<Id, string>;
}

/** 그룹 순서대로 선 블록의 머리. `titled` = 제목 줄이 서는 그룹(제목 또는 제목 자리 오류 마커). */
export function blockHeads(groups: readonly { id: Id; titled: boolean; members: readonly Id[] }[], showTitles: boolean): BlockHeads {
  const groupHeads = new Map<Id, string>();
  const blocks = new Map<Id, string>();
  if (!showTitles) {
    let n = 0;
    for (const g of groups) for (const m of g.members) blocks.set(m, `${++n}.`);
    return { groups: groupHeads, blocks };
  }
  let g = 0;
  for (const group of groups) {
    if (!group.titled || group.members.length === 0) continue;
    const roman = romanNumeral(++g);
    groupHeads.set(group.id, `${roman}.`);
    group.members.forEach((m, i) => blocks.set(m, `${roman}-${i + 1}.`));
  }
  return { groups: groupHeads, blocks };
}
