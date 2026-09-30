"use client";

/**
 * 약관 에디터 툴바 — 본문 위에 늘 서 있는 넣기 버튼 줄 (기능/문면 §4.3, 2026-10-01 정리). 버튼 규칙 · 서는 곳은 `tools.ts`.
 *
 * - 누구나 아는 모양(표 · 글머리 목록 · 더보기)만 아이콘뿐이고, 이 시스템에만 있는 넣기(함수조항 · 박스 · 반복 · 슬롯 · 조 참조 · 별표 참조 ·
 *   문장 안 조건)는 아이콘 + 짧은 글자(`short`), 조 · 항 · 호 · 목은 한 글자, 「조건식」은 강조 글자 버튼이다. 온전한 이름은 aria-label,
 *   무엇을 · 어디에 하는지는 tooltip (디자인원칙 §1.6, 2026-10-01 유저 피드백).
 * - 조건 편집 · 고른 것 속성 묶음은 그 자리에서 켜질 때만 선다(`onBar`) — 꺼진 버튼이 줄줄이 서지 않는다.
 * - 드물게 쓰는 넣기(관 · 문장 안 함수조항)는 끝의 「더보기(⋯)」 안. 복제 · 삭제는 고른 블록 오른쪽 위(`DocBody` `BlockActs`), 위로 · 아래로는 오른쪽 클릭 메뉴.
 * - 버튼을 누르는 동안 문장 칸의 초점 · 선택을 뺏지 않는다(mousedown 을 막는다) — 커서 자리 · 고른 글에 넣기 위해서.
 * - 편집 모드에서만 선다(읽기 모드의 입구는 바의 「편집」). `editing` 이 거짓이면 전부 잠근다.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { IconAttach, IconBox, IconBranch, IconBulletList, IconClauseBlock, IconLink, IconMore, IconRepeat, IconSlot, IconTable } from "@/app/_components/icons";

import type { MenuSections } from "./menus";
import { onBar, toolState, type Tool, type ToolGroup, type ToolIcon, type ToolId, type ToolState } from "./tools";

const ICONS: Record<ToolIcon, ReactNode> = {
  table: <IconTable />,
  bulletList: <IconBulletList />,
  clauseBlock: <IconClauseBlock />,
  box: <IconBox />,
  repeat: <IconRepeat />,
  slot: <IconSlot />,
  link: <IconLink />,
  attach: <IconAttach />,
  branch: <IconBranch />,
};

export function EditorToolbar({
  groups,
  sections,
  editing,
  onRun,
  where,
}: {
  groups: readonly ToolGroup[];
  /** 지금 자리의 조작 목록 — 켜짐 · 꺼짐만 여기서 정한다(누르는 순간 다시 짓는다). */
  sections: MenuSections;
  editing: boolean;
  onRun: (tool: ToolId, button: HTMLElement) => void;
  /** 지금 자리 — 「항 ②」처럼. 툴바 끝에 작게. */
  where?: string;
}) {
  const stateOf = (tool: Tool): ToolState =>
    editing ? toolState(tool, sections) : { tool, items: [], disabled: true, title: `${tool.title} — 편집을 누르면 쓸 수 있다` };
  const shown = groups
    .map((group) => ({ name: group.name, tools: group.tools.map(stateOf).filter((s) => onBar(s.tool, s)) }))
    .filter((group) => group.tools.length > 0);
  const more = groups.flatMap((g) => g.tools).filter((t) => t.at === "more").map(stateOf);

  return (
    <div
      role="toolbar"
      aria-label="약관 편집 도구"
      className="ts-doc-toolbar"
      onMouseDown={(e) => {
        // 문장 칸의 초점 · 선택을 지킨다 — 버튼은 click 으로 동작한다
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {shown.map((group) => (
        <div key={group.name} role="group" aria-label={group.name} className="ts-tool-group">
          {group.tools.map((state) => (
            <ToolButton key={state.tool.id} state={state} onRun={onRun} />
          ))}
        </div>
      ))}
      {more.length > 0 && <MoreTools tools={more} onRun={onRun} />}
      {editing && where ? <span className="ts-tool-where">자리 — {where}</span> : null}
    </div>
  );
}

function ToolButton({ state, onRun }: { state: ToolState; onRun: (tool: ToolId, button: HTMLElement) => void }) {
  const { tool } = state;
  const icon = tool.icon ? ICONS[tool.icon] : undefined;
  const cls = ["ts-tool", icon && !tool.short ? "is-icon" : null, icon && tool.short ? "is-icon-text" : null, tool.id === "cond" ? "is-cond" : null, tool.multi ? "is-multi" : null].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      data-tool={tool.id}
      title={state.title}
      aria-label={tool.label}
      disabled={state.disabled}
      {...(tool.multi ? { "aria-haspopup": "menu" as const } : {})}
      onClick={(e) => onRun(tool.id, e.currentTarget)}
    >
      {icon ?? tool.label}
      {icon && tool.short ? <span className="ts-tool-short">{tool.short}</span> : null}
      {tool.multi ? (
        <span className="ts-tool-caret" aria-hidden="true">
          ▾
        </span>
      ) : null}
    </button>
  );
}

/**
 * 「더보기(⋯)」 — 드물게 쓰는 넣기. 항목은 버튼과 같은 길(`onRun`)로 돌고, 켜짐은 자리를 따른다(잠긴 항목은 사유 tooltip).
 * 바깥 누르기 · Esc 로 닫힌다. 메뉴는 툴바 안에 서므로 문장 칸의 초점을 뺏지 않는다.
 */
function MoreTools({ tools, onRun }: { tools: ToolState[]; onRun: (tool: ToolId, button: HTMLElement) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  return (
    <div ref={rootRef} className="ts-tool-more" role="group" aria-label="더보기">
      <button
        ref={buttonRef}
        type="button"
        className="ts-tool is-icon"
        data-tool="more"
        title="더보기 — 관 · 문장 안 함수조항"
        aria-label="더보기"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMore />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="더보기" className="ts-more-menu">
          {tools.map((state) => (
            <button
              key={state.tool.id}
              type="button"
              role="menuitem"
              className="ts-more-menu-item"
              data-tool={state.tool.id}
              aria-label={state.tool.label}
              title={state.title}
              disabled={state.disabled}
              onClick={() => {
                setOpen(false);
                // 메뉴 항목은 닫히며 사라진다 — 팝업 · 작은 메뉴는 「더보기」 버튼 자리에 선다
                if (buttonRef.current) onRun(state.tool.id, buttonRef.current);
              }}
            >
              {state.tool.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
