/**
 * 조작의 자리를 DOM 에서 읽는다 — 가운데 본문의 `data-*` 표지(DocBody · Inline)와 문장 칸의 커서 · 선택.
 * 툴바 · 오른쪽 클릭 메뉴가 같은 자리 규칙을 쓴다 (기능/문면 §4.3). 목록 짓기는 순수 `menus.ts` 의 `placeMenu`.
 */
import { decodeAt, encodeAt } from "./ctx";
import { tokensOf } from "./Inline";
import type { Token } from "./inlineRuns";
import type { CondInput, Place } from "./menus";

/** 누른 요소 → 자리. 공용조항 블록 · 칩 · 조건 머리 · 조 제목 · 관 제목 · 문장 칸 · 블록 · 조 순으로 가까운 것. 본문 빈 곳이면 undefined. */
export function placeOf(target: Element): Place | undefined {
  const data = (selector: string, key: string): string | undefined => (target.closest(selector) as HTMLElement | null)?.dataset[key];
  // 공용조항 블록 안(그 공용조항의 본문)은 이 문서의 자리가 아니다 — 블록 하나로 모은다
  const clauseRef = data("[data-clause-ref]", "clauseRef");
  if (clauseRef) return { kind: "block", id: clauseRef };
  const chip = data("[data-chip]", "chip");
  if (chip) return { kind: "chip", id: chip };
  const head = data("[data-cond-head]", "condHead");
  if (head) return { kind: "head", id: head };
  const articleTitle = data("[data-article-title]", "articleTitle");
  if (articleTitle) return { kind: "articleTitle", id: articleTitle };
  const sectionTitle = data("[data-section-title]", "sectionTitle");
  if (sectionTitle) return { kind: "sectionTitle", id: sectionTitle };
  const inline = data("[data-inline]", "inline");
  const at = inline ? decodeAt(inline) : undefined;
  if (at) return { kind: "inline", at };
  const block = data("[data-block]", "block");
  if (block) return { kind: "block", id: block };
  const article = data("[data-article]", "article");
  if (article) return { kind: "article", id: article };
  return undefined;
}

/** 문장 자리의 조각 — 넣기 명령은 문장 전체를 조각에서 다시 짓는다(커서 자리에 칩). */
export interface InlineRead {
  tokens: Token[];
  /** 고른 글 — 한 글자 노드 안에서 고른 것만. 조각에서는 빠져 있다(그 자리에 넣을 칩이 품는다). */
  cut?: string;
}

/**
 * 그 문장 칸의 지금 조각 — 초점이 거기 있으면 커서 · 선택 자리까지, 아니면 커서 없이(넣으면 끝에).
 * 칸이 화면에 없으면 undefined — 조각 없이 넣으면 문장이 지워지므로 넣기를 하지 않는다.
 * 툴바는 mousedown 을 막아 누르는 동안에도 초점 · 선택이 문장 칸에 남는다.
 */
export function readInline(root: HTMLElement, place: Extract<Place, { kind: "inline" }>): InlineRead | undefined {
  const el = root.querySelector<HTMLElement>(`[data-inline="${CSS.escape(encodeAt(place.at))}"]`);
  if (!el) return undefined;
  const sel = window.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : undefined;
  if (!range || !el.contains(range.startContainer)) return { tokens: tokensOf(el) };
  const start = { node: range.startContainer, offset: range.startOffset };
  if (!range.collapsed && range.startContainer === range.endContainer && range.startContainer.nodeType === 3) {
    const cut = (range.startContainer.textContent ?? "").slice(range.startOffset, range.endOffset);
    if (cut.trim() !== "") return { tokens: tokensOf(el, start, range.endOffset), cut };
  }
  return { tokens: tokensOf(el, start) };
}

/**
 * DOM 자리 하나 → 그 자리를 품은 블록 id (공용조항 블록 · 항/호/목/표/박스 · 조 제목 → 조 · 관 제목 → 관 · 조건 머리 → 가지 · 조 본문 → 조).
 * 선택(드래그)의 두 끝을 블록으로 옮길 때 쓴다 — 조건식 감싸기 · 끌어 옮기기.
 */
export function blockAt(node: Node | null): string | undefined {
  const el = node ? (node.nodeType === 1 ? (node as Element) : node.parentElement) : null;
  if (!el) return undefined;
  const pick = (selector: string, key: string) => (el.closest(selector) as HTMLElement | null)?.dataset[key];
  return (
    pick("[data-clause-ref]", "clauseRef") ??
    pick("[data-block]", "block") ??
    pick("[data-article-title]", "articleTitle") ??
    pick("[data-section-title]", "sectionTitle") ??
    pick("[data-cond-head]", "condHead") ??
    pick("[data-article]", "article")
  );
}

/** 본문 안의 선택(드래그) — 비어 있지 않으면 두 끝의 블록. 선택이 없거나 본문 밖이면 undefined. */
export function selectionEnds(root: HTMLElement): { start: string; end: string } | undefined {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return undefined;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  if (range.toString().trim() === "") return undefined;
  const start = blockAt(range.startContainer);
  const end = blockAt(range.endContainer);
  return start && end ? { start, end } : undefined;
}

/**
 * 툴바 「조건식」의 입력 — 본문 안 선택(드래그)이 있으면 그 두 끝 블록, 없으면 커서가 선 블록(문장의 주인 · 표 셀이면 그 표 · 조 제목이면 그 조).
 * 규칙은 순수 `condInsertItem` 몫이다.
 */
export function condInput(root: HTMLElement | null, at: Place, inline?: CondInput["inline"]): CondInput {
  const selection = root ? selectionEnds(root) : undefined;
  const caret = selection ? undefined : at.kind === "inline" ? ("tableId" in at.at ? at.at.tableId : at.at.parentId) : at.kind === "articleTitle" ? at.id : undefined;
  return { ...(selection ? { selection } : {}), ...(caret !== undefined ? { caret } : {}), ...(inline ? { inline } : {}) };
}
