/** 열 기준의 화면 말 — 목록 · 상세 · 띠가 같은 말을 쓴다 (기능/동적표 §3.2). */
import type { ColumnBasis } from "@/domain/dyntable/types";

export const COLUMN_BASIS_LABEL = {
  reduction: "감액 구간",
  none: "없음",
} as const satisfies Record<ColumnBasis, string>;

export const COLUMN_BASIS_OPTIONS = [
  { value: "reduction", label: COLUMN_BASIS_LABEL.reduction, hint: "모든 급부의 감액 경계 합집합으로 열을 나눈다 — 감액 지급금액 표" },
  { value: "none", label: COLUMN_BASIS_LABEL.none, hint: "열 하나(단일 열 템플릿) — 비율 = 지급률, (갱신) 표" },
] as const satisfies readonly { value: ColumnBasis; label: string; hint: string }[];
