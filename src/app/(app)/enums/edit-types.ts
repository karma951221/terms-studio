import type { EnumFieldType, EnumFieldValue } from "@/domain/catalog";

/** 값 한 행 — `fields` 는 필드 키(새 필드는 `new:N`) → 값. 빈 칸은 키 없음 · 빈 문자열. */
export interface EnumEditValue { code: string; label: string; fields?: Record<string, EnumFieldValue> }
/** 필드 한 행 — 저장된 필드는 `F01`, 새 필드는 `new:N` (저장 때 채번). */
export interface EnumEditField { key: string; label: string; type: EnumFieldType }
export interface EnumEditData extends Record<string, unknown> { label: string; description: string; fields?: EnumEditField[]; values: EnumEditValue[] }
