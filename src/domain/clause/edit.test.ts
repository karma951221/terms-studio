import { describe, expect, it } from "vitest";

import {
  addItem,
  addParagraph,
  addSubitem,
  insertOptionSlot,
  isInlineBody,
  moveNode,
  newParagraph,
  removeNode,
  sequentialIds,
  setNodeText,
  textOf,
} from "./edit";
import type { Block, Inline } from "./nodes";

/** 항 하나 · 호 둘 · 목 하나짜리 본문. */
function fixture(): Block[] {
  return [
    {
      id: "p1",
      kind: "paragraph",
      children: [{ id: "p1t", kind: "text", text: "회사는 다음을 지급합니다." }],
      items: [
        { id: "i1", kind: "item", children: [{ id: "i1t", kind: "text", text: "사망" }] },
        {
          id: "i2",
          kind: "item",
          children: [{ id: "i2t", kind: "text", text: "장해" }],
          subitems: [{ id: "s1", kind: "subitem", children: [{ id: "s1t", kind: "text", text: "80% 이상" }] }],
        },
      ],
    },
  ];
}

describe("공용조항 본문 편집", () => {
  it("항을 끝에 더한다 — 새 항은 빈 문구 하나로 시작한다", () => {
    const next = addParagraph(fixture(), sequentialIds("x"));
    expect(next).toHaveLength(2);
    expect(next[1]!.kind).toBe("paragraph");
    expect(textOf((next[1] as { children: Inline[] }).children)).toBe("");
  });

  it("호는 그 항에, 목은 그 호에 달린다", () => {
    const withItem = addItem(fixture(), "p1", sequentialIds("x"));
    const paragraph = withItem[0] as { items?: { id: string }[] };
    expect(paragraph.items).toHaveLength(3);

    const withSub = addSubitem(fixture(), "i1", sequentialIds("y"));
    const items = (withSub[0] as { items: { id: string; subitems?: unknown[] }[] }).items;
    expect(items[0]!.subitems).toHaveLength(1);
  });

  it("문구는 항·호·목 어느 깊이든 바뀐다", () => {
    const body = setNodeText(setNodeText(fixture(), "p1", "고쳤다"), "s1", "90% 이상") as Block[];
    const paragraph = body[0] as { children: Inline[]; items: { children: Inline[]; subitems?: { children: Inline[] }[] }[] };
    expect(textOf(paragraph.children)).toBe("고쳤다");
    expect(textOf(paragraph.items[1]!.subitems![0]!.children)).toBe("90% 이상");
  });

  it("노드를 빼면 딸린 하위도 같이 빠진다", () => {
    const body = removeNode(fixture(), "i2");
    const items = (body[0] as { items: { id: string }[] }).items;
    expect(items.map((item) => item.id)).toEqual(["i1"]);
  });

  it("형제 사이에서 한 칸 옮긴다 — 끝에서는 그대로", () => {
    const moved = moveNode(fixture(), "i1", 1);
    expect((moved[0] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["i2", "i1"]);

    const stuck = moveNode(fixture(), "i1", -1);
    expect((stuck[0] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("옵션 자리는 block 이면 고른 노드 끝에, inline 이면 본문 끝에 들어간다", () => {
    const block = insertOptionSlot(fixture(), "i1", "O01", sequentialIds("o")) as Block[];
    const item = (block[0] as { items: { children: Inline[] }[] }).items[0]!;
    expect(item.children.at(-1)).toMatchObject({ kind: "optionSlot", optionCode: "O01" });

    const inline: Inline[] = [{ id: "t1", kind: "text", text: "보험금을 " }];
    const next = insertOptionSlot(inline, undefined, "O02", sequentialIds("o")) as Inline[];
    expect(next.at(-1)).toMatchObject({ kind: "optionSlot", optionCode: "O02" });
  });

  it("본문이 inline 인지 block 인지 가른다", () => {
    expect(isInlineBody([{ id: "t1", kind: "text", text: "가" }])).toBe(true);
    expect(isInlineBody(fixture())).toBe(false);
    expect(isInlineBody([newParagraph(sequentialIds("z"))])).toBe(false);
  });
});
