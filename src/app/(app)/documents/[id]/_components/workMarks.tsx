"use client";

/**
 * 작업용 글자색 — 작업자가 차수별로 고친 글에 칠하는 표시 (기능/문면 §3.2 「작업 표시」 · §4.3, 2026-10-01).
 * 산출물 서식이 아니다: 조립 산출물 · 미리보기 · 준용 비교에 나오지 않는다(도메인 조립이 문장 조각을 새로 지으며 색을 버린다).
 *
 * - 툴바 「글자색」(`MarkPicker`) — 네 색 + 색 지우기. 고른 글(문장 칸 여럿에 걸쳐도)에만 칠한다. 칩은 색을 갖지 않는다.
 *   「수정 흔적 보기」가 꺼져 있으면 색을 고를 때 켠다 — 칠해도 보이지 않으면 칠했는지 모른다(2026-10-10 사용자 QA). 「색 지우기」는 보기를 바꾸지 않는다.
 * - 바 더보기의 체크 항목 「수정 흔적 보기」(`marksMenuItem`) — 켜면 색, 끄면 보통 글색. 읽기 · 편집 모두. 브라우저마다 마지막 선택을 기억한다.
 *   바의 아이콘 토글은 툴바 「글자색」과 같은 그림이라 헷갈려 더보기로 옮겼다 (2026-10-10 사용자 QA).
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import type { MoreMenuItem } from "@/app/_components/MoreMenu";
import type { DocumentNode, EditOp, IdSource } from "@/domain/document";
import { WORK_MARK_LABEL, WORK_MARKS, type WorkMark } from "@/domain/types";

import { decodeAt } from "./ctx";
import { inlineListAt } from "./editOps";
import { markedTokensOf } from "./Inline";
import { identityRuns, runsFromTokens, sameRuns } from "./inlineRuns";

export const MARK_TOOL_TITLE = "작업용 글자색 — 산출물에는 나오지 않습니다";

// ───────────────────────────── 고른 글에 칠하기 ─────────────────────────────

/**
 * 지금 고른 글(브라우저 선택)에 색을 칠하는 명령 — 선택이 걸친 문장 칸마다 `setInlines` 하나. `mark` 가 없으면 색 지우기.
 * 고른 글이 없거나(커서만) 바뀌는 것이 없으면 빈 목록. 본문 · 팝업(문장 안 조건 가지) 어디의 문장 칸이든 된다.
 */
export function markSelectionOps(tree: DocumentNode, mark: WorkMark | undefined, newId: IdSource): EditOp[] {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const el = common.nodeType === 1 ? (common as Element) : common.parentElement;
  if (!el) return [];
  const own = el.closest<HTMLElement>("[data-inline]");
  const slots = own ? [own] : [...el.querySelectorAll<HTMLElement>("[data-inline]")].filter((s) => range.intersectsNode(s));
  const ops: EditOp[] = [];
  for (const slot of slots) {
    const at = decodeAt(slot.dataset.inline ?? "");
    const list = at ? inlineListAt(tree, at) : undefined;
    const tokens = markedTokensOf(slot, range, mark);
    if (!at || !list || !tokens) continue;
    const runs = runsFromTokens(list, tokens, newId);
    if (!sameRuns(runs, identityRuns(list))) ops.push({ type: "setInlines", at, runs });
  }
  return ops;
}

// ───────────────────────────── 수정 흔적 보기 ─────────────────────────────

const SHOW_KEY = "ts.workMarks.shown";
const listeners = new Set<() => void>();
/** 저장소가 막혀 있을 때(사생활 창 등) 이 탭 안에서만 기억하는 값. */
let chosen: boolean | undefined;

function readShown(): boolean {
  if (chosen !== undefined) return chosen;
  try {
    return window.localStorage.getItem(SHOW_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 「수정 흔적 보기」 — 기본 켬, 브라우저마다 마지막 선택을 기억한다(저장소가 막혀 있으면 기본값). 서버 렌더는 켬. */
export function useMarksShown(): [boolean, (next: boolean) => void] {
  const shown = useSyncExternalStore(subscribe, readShown, () => true);
  const set = (next: boolean) => {
    chosen = next;
    try {
      window.localStorage.setItem(SHOW_KEY, next ? "on" : "off");
    } catch {
      /* 기억만 못 한다 */
    }
    listeners.forEach((l) => l());
  };
  return [shown, set];
}

/** 글자색을 고른 뒤의 「수정 흔적 보기」 — 색을 고르면 켠다(꺼져 있으면 칠한 글이 보통 글색에 묻힌다), 「색 지우기」(`undefined`)는 그대로. */
export function marksShownAfterPick(shown: boolean, mark: WorkMark | undefined): boolean {
  return mark !== undefined ? true : shown;
}

/** 바 더보기의 「수정 흔적 보기」 체크 항목 — 켜짐이 곧 체크, 누르면 뒤집는다. 더보기 첫 줄에 둔다. */
export function marksMenuItem(shown: boolean, onChange: (next: boolean) => void): MoreMenuItem {
  return { label: "수정 흔적 보기", checked: shown, onSelect: () => onChange(!shown) };
}

// ───────────────────────────── 툴바 「글자색」 ─────────────────────────────

/** 글자 「가」 + 색 밑줄 — 툴바 글자색 도구의 그림. 밑줄 색은 `currentColor` 가 아니라 자리에서 준다. */
function MarkGlyph({ swatch }: { swatch?: WorkMark }) {
  return (
    <span className="ts-mark-glyph" aria-hidden="true">
      <span className="ts-mark-glyph-letter">가</span>
      <span className="ts-mark-glyph-bar" {...(swatch ? { "data-mark": swatch } : {})} />
    </span>
  );
}

/**
 * 툴바 「글자색」 — 작은 팝오버에 네 색 + 색 지우기. 누르면 고른 글에 칠하고 닫힌다.
 * 버튼 · 팝오버 모두 툴바 안이라 누르는 동안 문장 칸의 고른 글을 뺏지 않는다(툴바가 mousedown 을 막는다). 마지막에 쓴 색을 버튼 밑줄에 보인다.
 */
export function MarkPicker({ onMark }: { onMark: (mark: WorkMark | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<WorkMark>("red");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // 「수정 흔적 보기」 — 문면 · 함수조항 · 상품 조 사본 편집기가 같은 저장소를 본다(바의 더보기 체크 항목도 따라 바뀐다)
  const [shown, setShown] = useMarksShown();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (mark: WorkMark | undefined) => {
    setOpen(false);
    if (mark) setLast(mark);
    if (marksShownAfterPick(shown, mark) !== shown) setShown(true);
    onMark(mark);
  };

  return (
    <div ref={rootRef} className="ts-tool-marks" role="group" aria-label="서식">
      <button
        type="button"
        className="ts-tool is-icon-text"
        data-tool="workMark"
        title={MARK_TOOL_TITLE}
        aria-label="글자색"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <MarkGlyph swatch={last} />
        <span className="ts-tool-short">글자색</span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="작업용 글자색" className="ts-more-menu ts-mark-menu">
          <div className="ts-mark-swatches">
            {WORK_MARKS.map((mark) => (
              <button
                key={mark}
                type="button"
                role="menuitem"
                className="ts-mark-swatch"
                data-mark={mark}
                aria-label={`${WORK_MARK_LABEL[mark]} — 고른 글에 칠한다`}
                title={`${WORK_MARK_LABEL[mark]} — 고른 글에 칠한다`}
                onClick={() => pick(mark)}
              >
                <span className="ts-mark-swatch-dot" aria-hidden="true" />
              </button>
            ))}
          </div>
          <button type="button" role="menuitem" className="ts-more-menu-item" data-mark-clear="" title="고른 글의 작업용 글자색을 지운다" onClick={() => pick(undefined)}>
            색 지우기
          </button>
          <p className="ts-mark-menu-note">작업용 — 산출물에는 나오지 않습니다</p>
        </div>
      )}
    </div>
  );
}
