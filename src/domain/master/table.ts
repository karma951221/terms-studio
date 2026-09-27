/**
 * `table` 필드의 셀 파서 · 붙여넣기 · 초안 변환 (ADR-0065 §1 · 기능/담보 §3.4).
 *
 * - period: 사람은 `3M` / `1Y` / `1Y6M` / `12` 로 적고 저장은 개월 정수, 표시는 `n년 n개월`.
 * - percent: `50%` / `50` → 0~100 정수. 소수 · 범위 밖은 해석 실패 (기능/담보 §3.4 정수 규칙).
 * - 초안(`TableDraft`)은 머리글을 뺀 셀 원문 2차원 배열 — 폼 편집 상태가 든다.
 * - 붙여넣기: 줄 = 행, 탭 = 열. 첫 행이 열 라벨과 같으면 머리글로 보고 버린다.
 */
import type { Issue, ScalarValue, TableColumn, TableColumnType, TableRow } from "../types";

const PERIOD_RE = /^(?:(\d+)\s*[yY])?\s*(?:(\d+)\s*[mM])?$/;

export function parsePeriod(text: string): number | undefined {
  const s = text.trim();
  if (s === "") return undefined;
  if (/^\d+$/.test(s)) return Number(s);
  const m = PERIOD_RE.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
  return Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0);
}

export function formatPeriod(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}개월`;
  return m === 0 ? `${y}년` : `${y}년 ${m}개월`;
}

/** 저장값 → 입력 원문 (`12` → `1Y`, `18` → `1Y6M`, `3` → `3M`). */
export function periodDraft(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}M`;
  return m === 0 ? `${y}Y` : `${y}Y${m}M`;
}

export function parsePercent(text: string): number | undefined {
  const s = text.replace(/%/g, "").trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : undefined;
}

export function parseCell(type: TableColumnType, text: string): ScalarValue | undefined {
  const s = text.trim();
  switch (type) {
    case "string":
      return s;
    case "number": {
      if (s === "") return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    }
    case "percent":
      return parsePercent(s);
    case "period":
      return parsePeriod(s);
    case "boolean":
      if (s === "true" || s === "예" || s === "Y") return true;
      if (s === "false" || s === "아니오" || s === "N") return false;
      return undefined;
  }
}

export function formatCell(type: TableColumnType, value: ScalarValue): string {
  switch (type) {
    case "period":
      return typeof value === "number" ? periodDraft(value) : String(value);
    case "boolean":
      return value === true ? "예" : "아니오";
    default:
      return String(value);
  }
}

/** 표 편집 초안 — 머리글 없이 셀 원문. */
export type TableDraft = string[][];

export function parseTableDraft(
  columns: readonly TableColumn[],
  draft: TableDraft,
  at: Issue["at"] = {},
): { value: TableRow[] } | { issue: Issue } {
  const rows: TableRow[] = [];
  if (draft.length === 0) return { issue: { kind: "typeMismatch", message: "표에 행이 하나 이상 있어야 합니다", at } };
  for (let i = 0; i < draft.length; i += 1) {
    const cells = draft[i];
    const row: TableRow = {};
    for (let c = 0; c < columns.length; c += 1) {
      const col = columns[c];
      const text = cells[c] ?? "";
      const v = parseCell(col.type, text);
      if (v === undefined) {
        return { issue: { kind: "typeMismatch", message: `${i + 1}행 ${col.label}: '${text}' 를 해석할 수 없습니다`, at } };
      }
      row[col.key] = v;
    }
    rows.push(row);
  }
  return { value: rows };
}

export function tableRowsToDraft(columns: readonly TableColumn[], rows: readonly TableRow[]): TableDraft {
  return rows.map((row) => columns.map((col) => (row[col.key] === undefined ? "" : formatCell(col.type, row[col.key]))));
}

export function pasteToDraft(columns: readonly TableColumn[], text: string): TableDraft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() !== "");
  const rows = lines.map((l) => l.split("\t").map((c) => c.trim()));
  const labels = columns.map((c) => c.label);
  if (rows.length > 0 && rows[0].length >= labels.length && labels.every((label, i) => rows[0][i] === label)) rows.shift();
  return rows;
}
