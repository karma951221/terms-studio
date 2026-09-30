"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";

import { IconButton, IconGrip, IconMinusCircle, IconPlusCircle } from "@/app/_components/icons";
import { FIELD_LABEL } from "@/app/_lib/labels";

/**
 * 값 행 표 — 열거형변수 값 · 필드, 담보속성 유효값, 새 열거형변수 값이 같이 쓰는 편집 표 (디자인원칙 §2 L2 「값 행 표」, 2026-10-01).
 *
 * - 편집이면 행 맨 앞에 ⊖ 「행 삭제 · {이름}」, 이어서 순서를 바꿀 수 있으면 끌기 손잡이 ⋮⋮.
 *   마지막 행 아래 ⊕ 「행 추가」 한 줄 — 머리의 「개수 +」 는 없다. 새 행이 생기면 그 행의 첫 입력칸에 커서가 간다.
 * - 순서 바꾸기: 손잡이를 위아래로 끌거나(HTML5 끌어 놓기 · 지나가는 동안 순서 칸이 바로 바뀐다, Esc 로 끌기를 그만두면 제자리),
 *   손잡이에서 ↑ ↓, 행 안 어디서든 Alt+↑ ↓. 옮기면 「{이름} — N번째」를 알린다(aria-live).
 * - 읽기면 조작 칸 · 손잡이 · 추가 줄이 없는 평범한 표다.
 * - 행을 빼거나 옮기는 것은 초안 조작이다 — 저장된 값의 영향 확인은 화면 저장 때 한 번(§2 L2 저장 단위). 이 표는 확인을 묻지 않는다.
 */

export type ValueRowsColumn<T> = {
  key: string;
  header: ReactNode;
  className?: string;
  cell: (row: T, index: number) => ReactNode;
};

export type ValueRowsTableProps<T> = {
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** 조작 이름에 들어갈 행 이름 — 비었으면 「새 값」 같은 자리 이름을 준다. */
  rowName: (row: T) => string;
  columns: readonly ValueRowsColumn<T>[];
  editing: boolean;
  /** 순서 칸(1부터) — 순서가 곧 데이터인 표만. */
  order?: boolean;
  /** 있으면 편집 모드에서 끌기 손잡이 · 키보드로 순서를 바꾼다. */
  onMove?: (from: number, to: number) => void;
  onRemove?: (row: T, index: number) => void;
  onAdd?: () => void;
  /** 추가 버튼 이름 — 한 화면에 표가 둘이면 무엇의 행인지 붙인다 (「행 추가 · 필드」). */
  addLabel?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  rowClassName?: (row: T) => string | undefined;
  /** 행이 없을 때 본문 한 줄. */
  empty?: ReactNode;
};

export const ADD_ROW_LABEL = "행 추가";
export const removeRowLabel = (name: string) => `행 삭제 · ${name}`;
export const moveRowLabel = (name: string) => `순서 옮기기 · ${name}`;
export const moveRowTip = (name: string) => `${moveRowLabel(name)} — 끌거나 ↑ ↓ 키`;
export const movedAnnouncement = (name: string, index: number) => `${name} — ${index + 1}번째`;

/** `from` 의 항목을 빼서 `to` 자리에 넣는다. 범위 밖이면 그대로. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const out = [...items];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}

/**
 * 키 하나가 옮길 자리 — 손잡이에서는 ↑ ↓ · Alt+↑ ↓, 행의 다른 칸에서는 Alt+↑ ↓ 만. 옮기지 않으면 `null`.
 * 끝에서는 돌지 않는다.
 */
export function keyboardMoveTarget(key: string, altKey: boolean, onHandle: boolean, index: number, length: number): number | null {
  if (!onHandle && !altKey) return null;
  const delta = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  if (delta === 0) return null;
  const target = index + delta;
  return target < 0 || target >= length ? null : target;
}

/** 앞 렌더에 없던 키 중 마지막 것 — 새로 더한 행. 처음 그릴 때(`prev` 없음)는 없다. */
export function addedRowKey(prev: ReadonlySet<string> | null, keys: readonly string[]): string | undefined {
  if (!prev) return undefined;
  for (let i = keys.length - 1; i >= 0; i--) if (!prev.has(keys[i]!)) return keys[i];
  return undefined;
}

/** 끌기 전용 형식 — `text/plain` 이면 입력칸이 끌린 글을 받아 넣는다. */
const DRAG_TYPE = "application/x-ts-value-row";

export function ValueRowsTable<T>({ rows, rowKey, rowName, columns, editing, order, onMove, onRemove, onAdd, addLabel = ADD_ROW_LABEL, disabled, className, ariaLabel, rowClassName, empty }: ValueRowsTableProps<T>) {
  const keys = rows.map(rowKey);
  const trs = useRef(new Map<string, HTMLTableRowElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const seen = useRef<Set<string> | null>(null);
  const refocus = useRef<string | undefined>(undefined);
  const drag = useRef<{ key: string; start: number; at: number } | null>(null);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [announce, setAnnounce] = useState("");
  const movable = editing && Boolean(onMove);
  const controls = editing && Boolean(onRemove || movable);
  const signature = keys.join("\u0000");

  // 새 행 → 첫 입력칸에 커서. 옮긴 행 → 손잡이에 다시 초점(DOM 이 옮겨지며 초점을 잃는 브라우저가 있다).
  useLayoutEffect(() => {
    const current = signature ? signature.split("\u0000") : [];
    const added = editing ? addedRowKey(seen.current, current) : undefined;
    seen.current = new Set(current);
    if (added) trs.current.get(added)?.querySelector<HTMLElement>("td.ts-vrows-cell input, td.ts-vrows-cell select, td.ts-vrows-cell textarea")?.focus();
    if (refocus.current) {
      const handle = handles.current.get(refocus.current);
      if (handle && document.activeElement !== handle) handle.focus();
      refocus.current = undefined;
    }
  }, [signature, editing]);

  useEffect(() => {
    if (!announce) return;
    const timer = setTimeout(() => setAnnounce(""), 3000);
    return () => clearTimeout(timer);
  }, [announce]);

  const move = (from: number, to: number, focusHandle: boolean) => {
    if (!onMove || from === to) return;
    const row = rows[from];
    if (row === undefined) return;
    if (focusHandle) refocus.current = rowKey(row);
    onMove(from, to);
    setAnnounce(movedAnnouncement(rowName(row), to));
  };

  const onKey = (event: KeyboardEvent<HTMLElement>, index: number, onHandle: boolean) => {
    if (!movable || disabled || event.nativeEvent.isComposing) return;
    const target = keyboardMoveTarget(event.key, event.altKey, onHandle, index, rows.length);
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    move(index, target, true);
  };

  const dragStart = (event: DragEvent<HTMLButtonElement>, key: string, index: number) => {
    drag.current = { key, start: index, at: index };
    setDragging(key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, key);
    const tr = trs.current.get(key);
    if (tr) event.dataTransfer.setDragImage(tr, 12, tr.offsetHeight / 2);
  };
  const dragOverRow = (event: DragEvent<HTMLTableRowElement>, index: number) => {
    const state = drag.current;
    if (!state) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (index === state.at) return;
    // 가운데를 넘어야 자리를 바꾼다 — 높이가 다른 행 사이에서 되튀지 않게
    const rect = event.currentTarget.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    if (index < state.at && event.clientY > middle) return;
    if (index > state.at && event.clientY < middle) return;
    move(state.at, index, false);
    state.at = index;
  };
  const dragOverTable = (event: DragEvent<HTMLTableElement>) => {
    if (!drag.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };
  const drop = (event: DragEvent<HTMLTableElement>) => {
    if (!drag.current) return;
    event.preventDefault();
    const row = rows[drag.current.at];
    drag.current = null;
    setDragging(undefined);
    if (row !== undefined) refocus.current = rowKey(row);
  };
  const dragEnd = (event: DragEvent<HTMLButtonElement>) => {
    const state = drag.current;
    drag.current = null;
    setDragging(undefined);
    // 표 밖에 놓거나 Esc 로 그만두면 제자리로
    if (state && event.dataTransfer.dropEffect === "none" && state.at !== state.start) move(state.at, state.start, false);
  };

  const span = columns.length + (order ? 1 : 0) + (controls ? 1 : 0);
  const cls = ["ts-table", "ts-vrows", editing ? "is-editing" : null, className].filter(Boolean).join(" ");
  return <>
    <table className={cls} aria-label={ariaLabel} onDragOver={movable ? dragOverTable : undefined} onDrop={movable ? drop : undefined}>
      <thead><tr>
        {controls ? <th className="ts-vrows-ctl"><span className="sr-only">{FIELD_LABEL.actions}</span></th> : null}
        {order ? <th className="col-num">{FIELD_LABEL.order}</th> : null}
        {columns.map((column) => <th key={column.key} className={column.className}>{column.header}</th>)}
      </tr></thead>
      <tbody>
        {rows.length === 0 && empty ? <tr><td colSpan={span} className="ts-empty-cell">{empty}</td></tr> : null}
        {rows.map((row, index) => {
          const key = keys[index]!;
          const name = rowName(row);
          const rowCls = [dragging === key ? "is-dragging" : null, rowClassName?.(row)].filter(Boolean).join(" ") || undefined;
          return <tr key={key} className={rowCls} ref={(el) => { if (el) trs.current.set(key, el); else trs.current.delete(key); }} onKeyDown={movable ? (event) => onKey(event, index, false) : undefined} onDragOver={movable ? (event) => dragOverRow(event, index) : undefined}>
            {controls ? <td className="ts-vrows-ctl"><span className="ts-vrows-ctl-inner">
              {onRemove ? <IconButton icon={<IconMinusCircle />} danger label={removeRowLabel(name)} disabled={disabled} onClick={() => onRemove(row, index)} /> : null}
              {movable ? <button
                type="button"
                className="ts-iconbtn ts-vrows-handle"
                ref={(el) => { if (el) handles.current.set(key, el); else handles.current.delete(key); }}
                draggable={!disabled}
                disabled={disabled}
                title={moveRowTip(name)}
                aria-label={moveRowLabel(name)}
                aria-keyshortcuts="ArrowUp ArrowDown Alt+ArrowUp Alt+ArrowDown"
                onKeyDown={(event) => onKey(event, index, true)}
                onDragStart={(event) => dragStart(event, key, index)}
                onDragEnd={dragEnd}
              ><IconGrip /></button> : null}
            </span></td> : null}
            {order ? <td className="col-num">{index + 1}</td> : null}
            {columns.map((column) => <td key={column.key} className={[column.className, "ts-vrows-cell"].filter(Boolean).join(" ")}>{column.cell(row, index)}</td>)}
          </tr>;
        })}
      </tbody>
      {editing && onAdd ? <tfoot><tr className="ts-vrows-add">
        <td className="ts-vrows-ctl" colSpan={controls ? 1 : span}><IconButton icon={<IconPlusCircle />} label={addLabel} disabled={disabled} onClick={onAdd} /></td>
        {controls && span > 1 ? <td colSpan={span - 1} /> : null}
      </tr></tfoot> : null}
    </table>
    {movable ? <span className="sr-only" role="status" aria-live="polite">{announce}</span> : null}
  </>;
}
