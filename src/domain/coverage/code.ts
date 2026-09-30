/**
 * 담보코드 — 시스템 자동 채번 · 등록 후 불변 · 유일 (기능/담보 §3.1, 2026-09-27).
 *
 * - `COV000001` 부터. 옛 시스템의 담보코드(COV000496)와 같은 모양 — 접두 COV + 6자리, 넘치면 자연 확장(COV1000000).
 * - 순번은 카탈로그 · 함수조항 · 별표와 같은 `code_sequences` 를 kind `coverage` (scope 전역 "") 로 공유한다.
 *   순번은 오르기만 한다 — 지운 담보의 코드는 다시 태어나지 않는다.
 * - 이름을 먼저 검사하고 나서 채번한다 — 거절된 생성이 순번을 태워 코드에 구멍을 내지 않게 (별표와 같은 순서).
 * - 코드를 바꾸는 규칙은 없다. 저장소도 저장(`saveCoverage`) 때 코드를 쓰지 않는다.
 */
import { ok, type Code, type Result } from "../types";
import { createCoverageTree } from "./tree";
import type { Coverage, NewCoverage, NewId } from "./types";

export const COVERAGE_CODE_PREFIX = "COV";
export const COVERAGE_CODE_MIN_WIDTH = 6;

/** 유효한 담보코드의 모양 — `COV000001`. */
export const COVERAGE_CODE_PATTERN = /^COV(\d+)$/;

/** 순번의 출처 — 저장소가 구현한다 (`code_sequences` 의 kind `coverage` · scope 전역). */
export type CoverageNextSeq = () => Promise<number> | number;

export function formatCoverageCode(seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  }
  return COVERAGE_CODE_PREFIX + String(seq).padStart(COVERAGE_CODE_MIN_WIDTH, "0");
}

export function isValidCoverageCode(code: string): boolean {
  return COVERAGE_CODE_PATTERN.test(code);
}

/**
 * 담보 생성 + 채번 — 트리 규칙(`createCoverageTree`)이 통과한 뒤에만 순번을 받는다.
 * 입력에 코드 자리는 없다 (`NewCoverage` 에 code 없음 — 사용자가 코드를 고르지 않는다).
 */
export async function createCoverage(
  input: NewCoverage,
  newId: NewId,
  existingNames: readonly string[],
  nextSeq: CoverageNextSeq,
): Promise<Result<Coverage>> {
  const tree = createCoverageTree(input, newId, existingNames);
  if (!tree.ok) return tree;
  return ok({ ...tree.value, code: formatCoverageCode(await nextSeq()) });
}
