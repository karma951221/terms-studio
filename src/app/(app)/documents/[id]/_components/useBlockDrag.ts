"use client";

/**
 * 블록 끌어 옮기기 · 여러 블록 고르기 — 문면 편집기와 공용조항 편집기가 같이 쓴다 (기능/문면 §4.3 「끌어 옮기기」, 2026-09-28).
 *
 * - 고르기: 블록 손잡이(⠿)를 누르면 그 블록, Shift 를 누른 채면 잇닿은 형제까지 늘린다. 글을 끌어 두 블록 이상에 걸쳐 고르면
 *   그 선택이 걸친 형제 블록들이 골린다(조건식 감싸기와 같은 범위 — `selectionRange`). 손잡이 밖을 누르면 풀린다.
 * - 끌기: 손잡이를 끌어 다른 블록의 앞 · 뒤, 조 제목(그 조 맨 앞), 목차의 조(그 조 끝)에 놓는다. 고른 블록 가운데 하나를 끌면 고른 것 전부.
 *   목차에서는 조 · 관을 끈다. 놓을 수 없는 자리(허용 자식 · 자기 하위)에는 놓기 표시가 서지 않는다.
 * 이벤트는 본문 · 목차 뿌리에서 한 번에 받는다(위임) — 규칙은 순수 `blockDrag.ts` · `editOps.moveRangeOps`.
 */
import { useCallback, useRef, useState, type DragEvent, type MouseEvent } from "react";

import { indexTree, type DocumentNode, type EditOp } from "@/domain/document";
import type { Id } from "@/domain/types";

import { dragIds, dropPosition, extendSelection, type DropWhere } from "./blockDrag";
import { moveRangeOps, selectionRange } from "./editOps";
import { selectionEnds } from "./place";

const MARKS = ["is-drop-before", "is-drop-after", "is-drop-into"] as const;

export interface BlockDrag {
  /** 고른 잇닿은 형제 블록 — 자리 순서. */
  blockSel: readonly Id[];
  selectBlock: (id: Id, extend: boolean) => void;
  clearSel: () => void;
  /** 본문 · 목차 뿌리에 펼친다. */
  props: {
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: (e: DragEvent<HTMLElement>) => void;
    onMouseUp: (e: MouseEvent<HTMLElement>) => void;
  };
}

interface Over {
  el: Element;
  id: Id;
  where: DropWhere;
}

export function useBlockDrag({ latest, apply, enabled }: { latest: () => DocumentNode; apply: (ops: readonly EditOp[]) => boolean; enabled: boolean }): BlockDrag {
  const [blockSel, setBlockSel] = useState<readonly Id[]>([]);
  const selRef = useRef<readonly Id[]>([]);
  const dragging = useRef<Id[] | undefined>(undefined);
  const marked = useRef<Element | undefined>(undefined);

  const setSel = useCallback((ids: readonly Id[]) => {
    selRef.current = ids;
    setBlockSel(ids);
  }, []);

  const unmark = () => {
    marked.current?.classList.remove(...MARKS);
    marked.current = undefined;
  };
  const mark = (el: Element, where: DropWhere) => {
    if (marked.current !== el) unmark();
    el.classList.remove(...MARKS);
    el.classList.add(where === "before" ? "is-drop-before" : where === "after" ? "is-drop-after" : "is-drop-into");
    marked.current = el;
  };
  const cleanup = () => {
    unmark();
    for (const el of document.querySelectorAll(".is-dragging")) el.classList.remove("is-dragging");
    dragging.current = undefined;
  };

  /** 포인터 아래의 놓을 자리 후보 — 목차 줄 · 공용조항 블록 · 블록 · 조 제목 순. */
  const overOf = (e: DragEvent<HTMLElement>): Over | undefined => {
    const target = e.target as Element | null;
    if (!target?.closest) return undefined;
    const half = (el: Element): "before" | "after" => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2 ? "before" : "after";
    };
    const ix = indexTree(latest());
    const structural = (dragging.current ?? []).every((id) => {
      const kind = ix.nodes.get(id)?.node.kind;
      return kind === "article" || kind === "section";
    });
    const toc = target.closest<HTMLElement>("[data-toc-node]");
    if (toc) {
      const id = toc.dataset.tocNode!;
      const isArticle = ix.nodes.get(id)?.node.kind === "article";
      return { el: toc, id, where: structural || !isArticle ? half(toc) : "end" };
    }
    // 가장 가까운 블록 — 조건 블록은 가지 상자(`data-drop-block`)가 받는다(안의 항 · 호가 더 가까우면 그것)
    const block = target.closest<HTMLElement>("[data-clause-ref], [data-block], [data-drop-block]");
    if (block) {
      const id = block.dataset.clauseRef ?? block.dataset.block ?? block.dataset.dropBlock!;
      return { el: block, id, where: half(block) };
    }
    const title = target.closest<HTMLElement>("[data-article-title]");
    if (title) return { el: title, id: title.dataset.articleTitle!, where: structural ? half(title) : "start" };
    return undefined;
  };

  const props: BlockDrag["props"] = {
    onDragStart: (e) => {
      if (!enabled) return;
      const handle = (e.target as Element | null)?.closest?.<HTMLElement>("[data-drag]");
      if (!handle) return;
      const ids = dragIds(handle.dataset.drag!, selRef.current);
      dragging.current = ids;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", ids.join(","));
      for (const id of ids) for (const el of document.querySelectorAll(`[data-node="${CSS.escape(id)}"], [data-toc-node="${CSS.escape(id)}"]`)) el.classList.add("is-dragging");
    },
    onDragOver: (e) => {
      if (!dragging.current) return;
      const over = overOf(e);
      const pos = over && dropPosition(indexTree(latest()), dragging.current, over.id, over.where);
      if (!over || !pos) {
        unmark();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      mark(over.el, over.where);
    },
    onDrop: (e) => {
      const ids = dragging.current;
      const over = ids && overOf(e);
      const tree = latest();
      const pos = ids && over ? dropPosition(indexTree(tree), ids, over.id, over.where) : undefined;
      cleanup();
      if (!ids || !pos) return;
      e.preventDefault();
      const ops = moveRangeOps(tree, ids, pos);
      if (ops.length > 0) apply(ops);
    },
    onDragEnd: () => cleanup(),
    onMouseUp: (e) => {
      if (!enabled) return;
      // 글을 끌어 두 블록 이상에 걸쳐 골랐으면 그 블록들을 고른다
      const ends = selectionEnds(e.currentTarget);
      if (!ends || ends.start === ends.end) return;
      const range = selectionRange(indexTree(latest()), ends.start, ends.end);
      if (range && range.ids.length > 1) setSel(range.ids);
    },
  };

  return {
    blockSel,
    selectBlock: (id, extend) => setSel(extendSelection(indexTree(latest()), selRef.current, id, extend)),
    clearSel: () => {
      if (selRef.current.length > 0) setSel([]);
    },
    props,
  };
}
