"use client";

/**
 * 약관 에디터 툴바 — 본문 위에 늘 서 있는 넣기 · 조작 버튼 줄 (기능/문면 §4.3). 버튼 규칙은 `tools.ts`.
 *
 * - 버튼을 누르는 동안 문장 칸의 초점 · 선택을 뺏지 않는다(mousedown 을 막는다) — 커서 자리 · 고른 글에 넣기 위해서.
 * - 편집 모드에서만 선다(읽기 모드의 입구는 바의 「편집」). `editing` 이 거짓이면 전부 잠근다.
 */
import type { MenuSections } from "./menus";
import { toolState, type ToolGroup, type ToolId } from "./tools";

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
      {groups.map((group) => (
        <div key={group.name} role="group" aria-label={group.name} className="ts-tool-group">
          {group.tools.map((tool) => {
            const state = editing ? toolState(tool, sections) : { disabled: true, title: `${tool.title} — 편집을 누르면 쓸 수 있다` };
            return (
              <button
                key={tool.id}
                type="button"
                className={`ts-tool${tool.id === "cond" ? " is-cond" : ""}`}
                data-tool={tool.id}
                title={state.title}
                aria-label={tool.label}
                disabled={state.disabled}
                onClick={(e) => onRun(tool.id, e.currentTarget)}
              >
                {tool.label}
                {tool.multi ? " ▾" : ""}
              </button>
            );
          })}
        </div>
      ))}
      {editing && where ? <span className="ts-tool-where">자리 — {where}</span> : null}
    </div>
  );
}
