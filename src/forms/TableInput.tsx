"use client";

/**
 * `table` 필드 입력 — 첫 행 머리글 · 셀 타이핑 · 엑셀 붙여넣기(줄 → 행 · 탭 → 열) · 행 추가/삭제 (기능/담보 §3.4).
 * 초안은 셀 원문(`TableDraft`)이고 파싱 · 검사는 `formReducer`(parseTableDraft · validateSlotValue) 몫이다.
 */
import type { ClipboardEvent } from "react";

import { formatPeriod, parseCell, pasteToDraft, type TableDraft } from "@/domain/master";
import type { TableColumn } from "@/domain/types";

import type { InputProps } from "./inputTypes";

function draftOf(field: InputProps["field"]): TableDraft {
  const d = field.draft;
  return Array.isArray(d) && (d.length === 0 || Array.isArray(d[0])) ? (d as TableDraft) : [];
}

/** 셀 옆 해석 힌트 — period 는 `1Y` 아래 「1년」. */
function hint(col: TableColumn, text: string): string | undefined {
  if (col.type !== "period" || text.trim() === "") return undefined;
  const v = parseCell("period", text);
  return typeof v === "number" ? formatPeriod(v) : "?";
}

export function TableInput({ id, field, onEdit, name }: InputProps) {
  const type = field.view.type;
  if (type.kind !== "table") return null;
  const columns = type.columns;
  const rows = draftOf(field);
  const set = (next: TableDraft) => onEdit(next);
  const edit = (r: number, c: number, text: string) => {
    const next = rows.map((row) => [...row]);
    while (next[r].length < columns.length) next[r].push("");
    next[r][c] = text;
    set(next);
  };
  const onPaste = (r: number, c: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // 셀 하나는 기본 붙여넣기
    e.preventDefault();
    const pasted = pasteToDraft(columns, text);
    const next = rows.map((row) => [...row]);
    pasted.forEach((prow, i) => {
      const target = r + i;
      while (next.length <= target) next.push(columns.map(() => ""));
      prow.forEach((cell, j) => {
        if (c + j < columns.length) next[target][c + j] = cell;
      });
    });
    set(next);
  };
  const addRow = () => set([...rows, columns.map(() => "")]);
  const removeRow = (r: number) => set(rows.filter((_, i) => i !== r));

  return (
    <div className="ts-table-input" aria-labelledby={`${id}-label`}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
            <th aria-label="행 삭제" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {columns.map((col, c) => {
                const text = row[c] ?? "";
                const h = hint(col, text);
                return (
                  <td key={col.key}>
                    <input
                      type="text"
                      name={`${name ?? field.view.path}[${r}][${col.key}]`}
                      value={text}
                      onChange={(e) => edit(r, c, e.target.value)}
                      onPaste={onPaste(r, c)}
                      aria-label={`${r + 1}행 ${col.label}`}
                    />
                    {h && <span className="ts-muted ts-table-hint">{h}</span>}
                  </td>
                );
              })}
              <td>
                <button type="button" onClick={() => removeRow(r)} aria-label={`${r + 1}행 삭제`}>
                  ⊖
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={addRow}>
        + 행
      </button>
      <p className="ts-muted">셀에 포커스를 두고 붙여넣으면 줄은 행, 탭은 열로 들어간다. 기간은 3M · 1Y.</p>
    </div>
  );
}
