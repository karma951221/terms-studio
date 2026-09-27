/**
 * 공용조항 본문 편집 — 노드 트리를 고치는 순수 함수들.
 *
 * 화면(구조 에디터)이 이 함수만 부른다. 서버 액션을 거치지 않는 이유는 공용조항의 저장 단위가
 * **화면 하나에 저장 하나**(디자인원칙 §2 L2)이기 때문이다 — 편집 중에는 트리가 화면 안에 있고,
 * 저장할 때 한 번만 나간다. 문면 편집기가 조작마다 서버로 나가는 것과 여기가 갈린다.
 *
 * 모든 함수는 **새 트리를 돌려준다**(제자리 수정 없음). id 는 주입받은 공급원이 만든다.
 *
 * DB·React import 금지 (순수층).
 */

import type { Id } from "../types";

import type { Block, Inline, ItemNode, ParagraphNode, SubitemNode } from "./nodes";
import type { ClauseBody } from "./types";

export type IdSource = () => Id;

export const randomIds: IdSource = () => globalThis.crypto.randomUUID();

/** `${prefix}1`, `${prefix}2`, … 결정적 id — 테스트가 쓴다. */
export function sequentialIds(prefix = "n"): IdSource {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** 빈 문구 하나 — 새로 만든 항·호·목은 빈 텍스트런 하나로 시작한다(빈 children 은 검증에서 걸린다). */
function emptyText(newId: IdSource): Inline[] {
  return [{ id: newId(), kind: "text", text: "" }];
}

export function newParagraph(newId: IdSource): ParagraphNode {
  return { id: newId(), kind: "paragraph", children: emptyText(newId) };
}

export function newItem(newId: IdSource): ItemNode {
  return { id: newId(), kind: "item", children: emptyText(newId) };
}

export function newSubitem(newId: IdSource): SubitemNode {
  return { id: newId(), kind: "subitem", children: emptyText(newId) };
}

/* ── 찾기 ────────────────────────────────────────────────────────────────── */

/** 트리 어디에 있든 그 노드를 품은 형제 목록과 자리를 찾는다. */
interface Spot {
  /** 그 노드가 속한 배열 (블록 목록 · 호 목록 · 목 목록 중 하나). */
  siblings: readonly { id: Id }[];
  index: number;
}

function findInBlocks(blocks: readonly Block[], id: Id): Spot | undefined {
  const index = blocks.findIndex((node) => node.id === id);
  if (index >= 0) return { siblings: blocks, index };
  for (const block of blocks) {
    if (block.kind === "condBlock") {
      for (const branch of block.branches) {
        const found = findInBlocks(branch.children, id);
        if (found) return found;
      }
      continue;
    }
    const items = block.items ?? [];
    const itemIndex = items.findIndex((item) => item.id === id);
    if (itemIndex >= 0) return { siblings: items, index: itemIndex };
    for (const item of items) {
      const subitems = item.subitems ?? [];
      const subIndex = subitems.findIndex((sub) => sub.id === id);
      if (subIndex >= 0) return { siblings: subitems, index: subIndex };
    }
  }
  return undefined;
}

/* ── 고치기 ──────────────────────────────────────────────────────────────── */

/** 블록 트리를 훑으며 노드를 갈아 끼운다. `undefined` 를 돌려주면 그 노드는 빠진다. */
function mapBlocks(blocks: readonly Block[], fn: (node: Block) => Block | undefined): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "condBlock") {
      const branches = block.branches.map((branch) => ({ ...branch, children: mapBlocks(branch.children, fn) }));
      const next = fn({ ...block, branches });
      if (next) out.push(next);
      continue;
    }
    const next = fn(block);
    if (next) out.push(next);
  }
  return out;
}

/** 항·호·목 어디든 그 노드의 문구를 바꾼다. */
export function setNodeText(body: ClauseBody, id: Id, text: string): ClauseBody {
  const replaceIn = (children: readonly Inline[]): Inline[] => {
    const first = children[0];
    if (first && first.kind === "text") return [{ ...first, text }, ...children.slice(1)];
    return [{ id: `${id}-t`, kind: "text", text }, ...children];
  };

  if (isInlineBody(body)) {
    return body.map((node) => (node.id === id && node.kind === "text" ? { ...node, text } : node));
  }

  return mapBlocks(body, (block) => {
    if (block.kind === "condBlock") return block;
    if (block.id === id) return { ...block, children: replaceIn(block.children) };
    if (!block.items) return block;
    return {
      ...block,
      items: block.items.map((item) => {
        if (item.id === id) return { ...item, children: replaceIn(item.children) };
        if (!item.subitems) return item;
        return {
          ...item,
          subitems: item.subitems.map((sub) => (sub.id === id ? { ...sub, children: replaceIn(sub.children) } : sub)),
        };
      }),
    };
  });
}

/** 본문 끝에 항을 더한다. */
export function addParagraph(body: readonly Block[], newId: IdSource): Block[] {
  return [...body, newParagraph(newId)];
}

/** 그 항에 호를 더한다. */
export function addItem(body: readonly Block[], paragraphId: Id, newId: IdSource): Block[] {
  return mapBlocks(body, (block) =>
    block.kind === "paragraph" && block.id === paragraphId
      ? { ...block, items: [...(block.items ?? []), newItem(newId)] }
      : block,
  );
}

/** 그 호에 목을 더한다. */
export function addSubitem(body: readonly Block[], itemId: Id, newId: IdSource): Block[] {
  return mapBlocks(body, (block) => {
    if (block.kind === "condBlock" || !block.items) return block;
    return {
      ...block,
      items: block.items.map((item) =>
        item.id === itemId ? { ...item, subitems: [...(item.subitems ?? []), newSubitem(newId)] } : item,
      ),
    };
  });
}

/** 항·호·목 하나를 뺀다 (딸린 하위도 같이 빠진다). */
export function removeNode(body: readonly Block[], id: Id): Block[] {
  return mapBlocks(body, (block) => {
    if (block.id === id) return undefined;
    if (block.kind === "condBlock" || !block.items) return block;
    const items = block.items
      .filter((item) => item.id !== id)
      .map((item) => (item.subitems ? { ...item, subitems: item.subitems.filter((sub) => sub.id !== id) } : item));
    return { ...block, items };
  });
}

/** 형제 사이에서 한 칸 옮긴다. 끝이면 그대로 둔다. */
export function moveNode(body: readonly Block[], id: Id, delta: -1 | 1): Block[] {
  const spot = findInBlocks(body, id);
  if (!spot) return [...body];
  const target = spot.index + delta;
  if (target < 0 || target >= spot.siblings.length) return [...body];

  const swap = <T extends { id: Id }>(list: readonly T[]): T[] => {
    const next = [...list];
    [next[spot.index], next[target]] = [next[target]!, next[spot.index]!];
    return next;
  };

  if (spot.siblings === body) return swap(body as readonly Block[]);

  return mapBlocks(body, (block) => {
    if (block.kind === "condBlock" || !block.items) return block;
    if (spot.siblings === block.items) return { ...block, items: swap(block.items) };
    return {
      ...block,
      items: block.items.map((item) =>
        item.subitems && spot.siblings === item.subitems ? { ...item, subitems: swap(item.subitems) } : item,
      ),
    };
  });
}

/* ── 인라인 넣기 ─────────────────────────────────────────────────────────── */

/** inline 본문인지 (모드 판별을 호출부가 다시 하지 않게). */
export function isInlineBody(body: ClauseBody): body is Inline[] {
  return body.every((node: Inline | Block) => node.kind !== "paragraph" && node.kind !== "condBlock");
}

/**
 * 옵션 자리를 넣는다 — inline 본문이면 끝에, block 본문이면 `targetId` 가 가리키는 항·호·목 끝에.
 * 사용처가 고른 선택지의 본문이 이 자리에 들어간다 (기능/공용조항 §3.2).
 */
export function insertOptionSlot(body: ClauseBody, targetId: Id | undefined, optionCode: string, newId: IdSource): ClauseBody {
  const slot: Inline = { id: newId(), kind: "optionSlot", optionCode };

  if (isInlineBody(body)) return [...body, slot];
  if (!targetId) return body;

  return mapBlocks(body, (block) => {
    if (block.kind === "condBlock") return block;
    if (block.id === targetId) return { ...block, children: [...block.children, slot] };
    if (!block.items) return block;
    return {
      ...block,
      items: block.items.map((item) => {
        if (item.id === targetId) return { ...item, children: [...item.children, slot] };
        if (!item.subitems) return item;
        return {
          ...item,
          subitems: item.subitems.map((sub) => (sub.id === targetId ? { ...sub, children: [...sub.children, slot] } : sub)),
        };
      }),
    };
  });
}

/** 노드의 문구만 이어 붙인 것 — 에디터의 한 줄이 무엇을 담고 있는지 읽을 때. */
export function textOf(children: readonly Inline[]): string {
  const first = children.find((node) => node.kind === "text");
  return first && first.kind === "text" ? first.text : "";
}
