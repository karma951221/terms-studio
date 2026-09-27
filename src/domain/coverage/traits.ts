/**
 * 급부 특성(감액 · 면책)의 값 규칙 — 시드 폼 `reduction` · `exemption` 전용 (ADR-0065 · 기능/담보 §3.4).
 *
 * 폼 시스템은 타입만 안다(`validateValue`). 「구간은 엄격 오름차순」 같은 뜻은 시스템 폼이라 코드가 안다 — 여기가 그 자리다.
 * 동적 표 엔진(P7)이 감액 구간을 읽는 창구도 여기(`reductionPeriods`) — 폼 키 · 필드 키를 다른 곳에 흘리지 않는다.
 */
import { isFormOpened, validateValue, type EnumLookup, type SlotPath, type SlotReader } from "../catalog";
import { findForm } from "../master";
import type { Coordinate, FieldType, Issue, TableRow } from "../types";

export const REDUCTION_PERIODS: SlotPath = "reduction.periods";
export const REDUCTION_AFTER_RATE: SlotPath = "reduction.after_rate";
export const EXEMPTION_MONTHS: SlotPath = "exemption.months";

function mismatch(message: string, at: Coordinate): Issue {
  return { kind: "typeMismatch", message, at };
}

/** 감액 구간표 — 기간(end) 은 1 이상 · 엄격 오름차순 (같으면 중복, 작으면 역전). */
export function checkReductionPeriods(rows: readonly TableRow[], at: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  let prev = 0;
  rows.forEach((row, i) => {
    const end = row.end;
    if (typeof end !== "number") return; // 타입은 validateValue 가 본다
    if (end <= 0) issues.push(mismatch(`${i + 1}행 기간: 0 은 구간이 아닙니다`, at));
    else if (end <= prev) issues.push(mismatch(`${i + 1}행 기간: 앞 행(${prev}개월)보다 커야 합니다 (같으면 중복 · 작으면 역전)`, at));
    prev = Math.max(prev, end);
  });
  return issues;
}

function integerIn(value: unknown, min: number, max: number | undefined, what: string, at: Coordinate): Issue[] {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || (max !== undefined && value > max)) {
    return [mismatch(max === undefined ? `${what} 는 ${min} 이상 정수여야 합니다` : `${what} 는 ${min}~${max} 정수여야 합니다`, at)];
  }
  return [];
}

/** 타입 검사 + 경로별 규칙. 값 쓰기(담보 마스터 · 상품 스냅샷 · 폼 제출)가 전부 이것을 부른다. */
export function validateSlotValue(path: SlotPath, type: FieldType, value: unknown, enums: EnumLookup, at: Coordinate = {}): Issue[] {
  const base = validateValue(type, value, enums, at);
  if (base.length > 0) return base;
  switch (path) {
    case REDUCTION_PERIODS:
      return checkReductionPeriods(value as TableRow[], at);
    case REDUCTION_AFTER_RATE:
      return integerIn(value, 0, 100, "이후 지급률", at);
    case EXEMPTION_MONTHS:
      return integerIn(value, 0, undefined, "면책 기간(개월)", at);
    default:
      return [];
  }
}

export interface ReductionPeriods {
  periods: { end: number; rate: number }[];
  /** 마지막 구간 이후 지급률. 자리가 비면 100. */
  afterRate: number;
}

/** 급부 하나의 감액 구간 — 폼을 안 열었으면 undefined (= 감액 없음). 동적 표 엔진의 창구. */
export function reductionPeriods(read: SlotReader): ReductionPeriods | undefined {
  const form = findForm("reduction");
  if (!form || !isFormOpened(form, read)) return undefined;
  const slot = read(REDUCTION_PERIODS);
  if (!slot?.entered || !Array.isArray(slot.value)) return undefined;
  const periods = (slot.value as TableRow[]).map((r) => ({ end: Number(r.end), rate: Number(r.rate) }));
  const after = read(REDUCTION_AFTER_RATE);
  return { periods, afterRate: after?.entered && typeof after.value === "number" ? after.value : 100 };
}
