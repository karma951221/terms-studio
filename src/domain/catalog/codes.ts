/**
 * 코드 채번 규칙 (ADR-0005 — 코드는 시스템 자동 채번 · 유저 입력 불가 · 불변).
 *
 * | 종류        | 접두 | 최소 자리수 | 순번 범위(scope)     | 예      |
 * |-------------|------|-------------|----------------------|---------|
 * | 구분자      | D    | 4           | 전역                 | D0001   |
 * | enum        | E    | 4           | 전역                 | E0001   |
 * | enum 값     | V    | 2           | 소속 enum 코드마다   | V01     |
 * | enum 필드   | F    | 2           | 소속 enum 코드마다   | F01     |
 *
 * 마스터 필드 코드는 여기서 채번하지 않는다 — 코드(소스)에 사람이 적는다 (ADR-0037).
 *
 * - 순번은 1부터. 자리수를 넘으면 자연 확장한다 (F100). 잘라내지 않는다.
 * - 순번의 출처는 저장소가 준다 (`nextSeq(kind, scope)` 주입). 삭제된 코드의 순번은
 *   재사용하지 않는다 — 순번은 오르기만 한다. 따라서 코드는 삭제 후에도 다시 태어나지 않는다.
 * - 참조 경로: 구분자는 `D0001` 한 마디, 마스터 필드는 `폼키.필드키` 두 마디 (기능/마스터 §3.2).
 *   enum 값은 식 안에서 `'V01'` 리터럴로 쓴다.
 */
import type { Code } from "../types";

export type CodeKind = "discriminator" | "enum" | "enumValue" | "enumField";

export const CODE_PREFIX: Record<CodeKind, string> = {
  discriminator: "D",
  enum: "E",
  enumValue: "V",
  enumField: "F",
};

export const CODE_MIN_WIDTH: Record<CodeKind, number> = {
  discriminator: 4,
  enum: 4,
  enumValue: 2,
  enumField: 2,
};

/** 유효한 코드 문자열의 모양. */
export const CODE_PATTERN = /^([DEVF])(\d+)$/;

const PREFIX_TO_KIND: Record<string, CodeKind> = {
  D: "discriminator",
  E: "enum",
  V: "enumValue",
  F: "enumField",
};

/**
 * 순번의 출처 — 저장소가 구현한다. scope 는 enumValue · enumField 면 소속 enum 코드, 그 외는 "" (전역).
 * 호출마다 1 씩 오르는 정수를 돌려준다.
 */
export type NextSeq = (kind: CodeKind, scope: string) => Promise<number> | number;

export function formatCode(kind: CodeKind, seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  }
  return CODE_PREFIX[kind] + String(seq).padStart(CODE_MIN_WIDTH[kind], "0");
}

export function parseCode(code: string): { kind: CodeKind; seq: number } | undefined {
  const m = CODE_PATTERN.exec(code);
  if (!m) return undefined;
  return { kind: PREFIX_TO_KIND[m[1]], seq: Number(m[2]) };
}

export function isValidCode(code: string): boolean {
  return parseCode(code) !== undefined;
}

/** 채번 한 번 — 저장소의 순번을 받아 코드 문자열로. */
export async function allocateCode(kind: CodeKind, scope: string, nextSeq: NextSeq): Promise<Code> {
  return formatCode(kind, await nextSeq(kind, scope));
}
