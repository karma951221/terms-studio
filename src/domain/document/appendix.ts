/**
 * 별표 마스터 (도메인모델 §3 · 기능/문면 §3.5 · 기능/별표).
 *
 * - 전상품 superset. 문면에는 코드 참조만 들어가고 번호는 책자별 계산값 (조립).
 * - 코드는 **시스템 자동 채번 · 등록 후 불변** — `AX000001` 부터
 *   (기능/별표 §3.1 — D-P4-23 의 「유저 입력」을 뒤집었다).
 *   순번 테이블은 카탈로그 · 공용조항과 같은 `code_sequences` 를 kind `appendix` 로 공유한다.
 * - 내용(표 본문) 출력은 MVP 밖 — 코드 · 이름 · 설명만.
 */

import { ok, reject } from "../types";
import type { Code, Result } from "../types";

export interface Appendix {
  code: Code;
  name: string;
  description: string;
}

/** 생성 입력에 code 는 없다 — 코드는 시스템이 채번한다 (타입으로 강제). */
export interface NewAppendix {
  name: string;
  description?: string;
}

function invalid<T>(message: string): Result<T> {
  return reject({ reason: "invalid", issues: [{ kind: "typeMismatch", message, at: {} }] });
}

/* ── 채번 ─────────────────────────────────────────────────────────────────── */

export const APPENDIX_CODE_PREFIX = "AX";
export const APPENDIX_CODE_MIN_WIDTH = 6;

/** 유효한 별표 코드의 모양 — `AX000001`. 자리수를 넘으면 자연 확장한다 (AX1000000). */
export const APPENDIX_CODE_PATTERN = /^AX(\d+)$/;

/** 순번의 출처 — 저장소가 구현한다 (`code_sequences` 의 kind `appendix` · scope 전역). */
export type AppendixNextSeq = () => Promise<number> | number;

export function formatAppendixCode(seq: number): Code {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new RangeError(`코드 순번은 1 이상의 정수여야 합니다: ${seq}`);
  }
  return APPENDIX_CODE_PREFIX + String(seq).padStart(APPENDIX_CODE_MIN_WIDTH, "0");
}

export function isValidAppendixCode(code: string): boolean {
  return APPENDIX_CODE_PATTERN.test(code);
}

/* ── 규칙 ─────────────────────────────────────────────────────────────────── */

/**
 * 별표 등록. 이름을 먼저 검사하고 나서 채번한다 — 거절된 등록이 순번을 태워
 * 코드에 구멍을 내지 않게. 코드가 시스템 것이 되면서 중복 거부는 사라졌다
 * (순번은 오르기만 하므로 같은 코드가 두 번 태어나지 않는다).
 */
export async function createAppendix(input: NewAppendix, nextSeq: AppendixNextSeq): Promise<Result<Appendix>> {
  const name = input.name.trim();
  if (name === "") return invalid("별표 이름은 비울 수 없습니다");
  return ok({ code: formatAppendixCode(await nextSeq()), name, description: input.description ?? "" });
}

export function renameAppendix(a: Appendix, name: string): Result<Appendix> {
  if (name.trim() === "") return invalid("별표 이름은 비울 수 없습니다");
  return ok({ ...a, name: name.trim() });
}

export function setAppendixDescription(a: Appendix, description: string): Result<Appendix> {
  return ok({ ...a, description });
}
