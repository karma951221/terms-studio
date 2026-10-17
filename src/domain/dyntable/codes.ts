/**
 * 동적표 코드 채번 규칙 (기능/동적표 §3.1 — 시스템 발급 · 불변).
 *
 * 박스(`BX000001`)와 같은 접두 + 6자리 규칙. 순번은 code_sequences (kind `dynTable` · scope 전역 "") 에서 받는다 —
 * 1부터, 오르기만 한다 (삭제된 코드는 다시 태어나지 않는다).
 */
import type { Code } from "../types";

export const DYN_TABLE_CODE_PREFIX = "DT";
export const DYN_TABLE_CODE_WIDTH = 6;

export function formatDynTableCode(seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  return DYN_TABLE_CODE_PREFIX + String(seq).padStart(DYN_TABLE_CODE_WIDTH, "0");
}

export function isDynTableCode(code: string): boolean {
  return new RegExp(`^${DYN_TABLE_CODE_PREFIX}\\d{${DYN_TABLE_CODE_WIDTH},}$`).test(code);
}
