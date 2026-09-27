/**
 * 값 규칙 — ValueSlot 검증 · 값 자리 목록 · 기본값 프리필 · 미입력 계산 (ADR-0004 · ADR-0037 · ADR-0065 §4).
 *
 * - **값 자리 = 노드 × 마스터 필드.** 경로는 마스터 경로 그대로 (`waiver.applies`).
 *   그 레벨의 마스터 필드는 **모든 노드에 항상 있다** — 부착 · 노출여부 · 선택 필드가 없다.
 * - 기본값은 `prefill()` 로 폼 초기값을 돌려줄 뿐 저장소에 들어가지 않는다.
 * - 미입력은 값이 아니라 상태 — 저장소가 자리를 모르거나(undefined) `entered:false` 면 미입력.
 * - **여는 폼(`MasterForm.optional`)** — 값 행이 하나도 없으면 그 폼의 자리 자체가 없다: `missingSlots` 는
 *   세지 않고(`countedSlotsOf`), 직접 읽으면 자리 없음. 값 행이 하나라도 있으면 나머지 필드는 보통 자리다.
 * - **선택 필드(`MasterField.optional`)** — 값이 없으면 `missingSlots` 가 세지 않는다. 식이 읽는 뜻은 그대로(미입력)다.
 */
import { fieldsOfLevel, findMasterField, formsOfLevel, masterPath, type MasterForm, type MasterTree } from "../master";
import type { AttachLevel, Coordinate, FieldType, Issue, TableColumn, Value, ValueSlot } from "../types";
import type { EnumLookup, SlotPath } from "./types";

// ───────────────────────────── 값 검증 ─────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function mismatch(message: string, at: Coordinate): Issue {
  return { kind: "typeMismatch", message, at };
}

function broken(message: string, at: Coordinate): Issue {
  return { kind: "brokenRef", message, at };
}

/**
 * 타입에 맞는 값인가. 빈 배열이면 유효.
 * - enum 값은 표시명이 아니라 **값 코드**(`V01`)여야 한다.
 * - 없는 enum · 없는 값 코드는 `brokenRef`, 모양이 틀리면 `typeMismatch`.
 */
export function validateValue(
  type: FieldType,
  value: unknown,
  enums: EnumLookup,
  at: Coordinate = {},
): Issue[] {
  switch (type.kind) {
    case "string":
      return typeof value === "string" ? [] : [mismatch("문자열이어야 합니다", at)];
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? []
        : [mismatch("숫자여야 합니다", at)];
    case "boolean":
      return typeof value === "boolean" ? [] : [mismatch("참/거짓이어야 합니다", at)];
    case "date":
      return typeof value === "string" && isRealDate(value)
        ? []
        : [mismatch("YYYY-MM-DD 형식의 실제 날짜여야 합니다", at)];
    case "enum": {
      const def = enums(type.enumCode);
      if (!def) return [broken(`enum ${type.enumCode} 이(가) 없습니다`, at)];
      if (typeof value !== "string") return [mismatch("enum 값 코드여야 합니다", at)];
      return def.values.some((v) => v.code === value)
        ? []
        : [broken(`enum ${def.label}(${def.code}) 에 값 코드 ${value} 이(가) 없습니다`, at)];
    }
    case "list<enum>": {
      const def = enums(type.enumCode);
      if (!def) return [broken(`enum ${type.enumCode} 이(가) 없습니다`, at)];
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return [mismatch("enum 값 코드 배열이어야 합니다", at)];
      }
      if (new Set(value).size !== value.length) {
        return [mismatch("같은 enum 값을 두 번 고를 수 없습니다", at)];
      }
      const codes = new Set(def.values.map((v) => v.code));
      const unknown = value.filter((v) => !codes.has(v));
      return unknown.length === 0
        ? []
        : [broken(`enum ${def.label}(${def.code}) 에 값 코드 ${unknown.join(", ")} 이(가) 없습니다`, at)];
    }
    case "table": {
      if (!Array.isArray(value)) return [mismatch("표는 행 배열이어야 합니다", at)];
      if (value.length === 0) return [mismatch("표에 행이 하나 이상 있어야 합니다 (열고 비운 표는 저장하지 않는다)", at)];
      const issues: Issue[] = [];
      value.forEach((row, i) => {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          issues.push(mismatch(`${i + 1}행: 행은 열 키 → 값 객체여야 합니다`, at));
          return;
        }
        const keys = new Set(Object.keys(row));
        for (const col of type.columns) {
          keys.delete(col.key);
          const cell = (row as Record<string, unknown>)[col.key];
          const bad = cellIssue(col, cell);
          if (bad) issues.push(mismatch(`${i + 1}행 ${col.label}: ${bad}`, at));
        }
        for (const extra of keys) issues.push(mismatch(`${i + 1}행: 정의에 없는 열 ${extra}`, at));
      });
      return issues;
    }
  }
}

/** 열 하나의 값 검사 — 통과면 undefined, 아니면 이유. */
function cellIssue(col: TableColumn, cell: unknown): string | undefined {
  switch (col.type) {
    case "string":
      return typeof cell === "string" ? undefined : "문자열이어야 합니다";
    case "boolean":
      return typeof cell === "boolean" ? undefined : "참/거짓이어야 합니다";
    case "number":
      return typeof cell === "number" && Number.isFinite(cell) ? undefined : "숫자여야 합니다";
    case "percent":
      if (typeof cell !== "number" || !Number.isInteger(cell)) return "0~100 정수여야 합니다";
      return cell >= 0 && cell <= 100 ? undefined : "0~100 정수여야 합니다";
    case "period":
      if (typeof cell !== "number" || !Number.isInteger(cell)) return "개월 수는 정수여야 합니다";
      return cell >= 0 ? undefined : "개월 수는 0 이상이어야 합니다";
  }
}

// ───────────────────────────── 값 자리 ─────────────────────────────

/** 이 레벨 노드가 갖는 값 자리 전부 — 마스터가 정한다. */
export function valueSlotsOf(level: AttachLevel, master?: MasterTree): SlotPath[] {
  return fieldsOfLevel(level, master).map((f) => f.path);
}

/** 경로가 가리키는 자리의 타입. 그 레벨의 자리가 아니면 undefined. */
export function slotType(level: AttachLevel, path: SlotPath, master?: MasterTree): FieldType | undefined {
  const ref = findMasterField(path, master);
  return ref && ref.level === level ? ref.field.type : undefined;
}

// ───────────────────────────── 프리필 · 미입력 ─────────────────────────────

/**
 * 폼 초기값 — 기본값이 있는 자리만. 사람이 보고 저장해야 명시 값이 된다.
 * 여기서 돌려준 값은 어떤 경로로도 저장소에 자동 유입되지 않는다.
 */
export function prefill(level: AttachLevel, master?: MasterTree): Record<SlotPath, Value> {
  const out: Record<SlotPath, Value> = {};
  for (const ref of fieldsOfLevel(level, master)) {
    if (ref.field.defaultValue !== undefined) out[ref.path] = ref.field.defaultValue;
  }
  return out;
}

/** 저장소 조회 — 자리를 모르면 undefined (= 미입력). */
export type SlotReader = (path: SlotPath) => ValueSlot | undefined;

/** 여는 폼이 열려 있는가 — 그 폼의 필드 중 하나라도 입력됨. */
export function isFormOpened(form: MasterForm, read: SlotReader): boolean {
  return form.fields.some((f) => read(masterPath(form.key, f.key))?.entered === true);
}

/**
 * 이 노드에서 실제로 세는 값 자리 — 안 연 여는 폼의 자리 · 값 없는 선택 필드는 뺀다 (ADR-0065 §4 · 2026-09-27).
 * `missingSlots` 의 분모이자 완결성 총량(`services/coverage.ts` `completenessSummary`)의 분모 재료.
 */
export function countedSlotsOf(level: AttachLevel, read: SlotReader, master?: MasterTree): SlotPath[] {
  const out: SlotPath[] = [];
  for (const form of formsOfLevel(level, master)) {
    if (form.optional && !isFormOpened(form, read)) continue;
    for (const f of form.fields) {
      const path = masterPath(form.key, f.key);
      // 선택 필드는 더했을 때(값이 있을 때)만 자리다 — 안 더한 것은 「없음」이지 미입력이 아니다
      if (f.optional && read(path)?.entered !== true) continue;
      out.push(path);
    }
  }
  return out;
}

/** 미입력 자리 목록. 기본값 지정 여부와 무관하다. 안 연 여는 폼의 자리는 세지 않는다 (ADR-0065 §4). */
export function missingSlots(level: AttachLevel, read: SlotReader, master?: MasterTree): SlotPath[] {
  return countedSlotsOf(level, read, master).filter((p) => {
    const slot = read(p);
    return slot === undefined || !slot.entered;
  });
}
