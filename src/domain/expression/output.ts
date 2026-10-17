/**
 * 작성위치 — 이 담보약관 문면이 찍히는 출력 위치 (ADR-0089 결정 3 · 4 · 기능/식언어 §3).
 *
 * - 식에서는 내장 경로 `builtin.output`(레벨 없는 한 토막) — 값 셋 `'replace'`(대치) · `'block'`(블록) · `'special'`(특약), `= ≠` 비교만.
 * - 범위 낱말 슬롯은 `builtin.output.scope` — 작성위치로 찍는 렌더 상수(특약 「이 특별약관의」 · 대치 빈 글 · 블록 「이 보장조항의」).
 *   슬롯 전용이다(비교에 못 쓴다). 블록 값은 추정 — 절 형태 구현 때 블록 본문 원문 대조(ADR-0089 결정 3).
 * - 값을 주는 것은 조립 문맥(`EvalContext.output`)이다. 모르면 미결, 작성위치가 없는 문맥(보통약관 · 구분자 파생식)이면 `structure` 오류.
 */

export const OUTPUT_POSITIONS = ["replace", "block", "special"] as const;

export type OutputPosition = (typeof OUTPUT_POSITIONS)[number];

/** 화면 말 — 조건 팝업 우변 · 식 표시. */
export const OUTPUT_LABEL: Record<OutputPosition, string> = { replace: "대치", block: "블록", special: "특약" };

/** 범위 낱말 — 작성위치별로 찍는 글. 대치는 빈 글(앞뒤 공백 하나를 조립이 접는다). */
export const SCOPE_WORDS: Record<OutputPosition, string> = { replace: "", block: "이 보장조항의", special: "이 특별약관의" };

/** 작성위치 경로 · 화면 말. */
export const OUTPUT_PATH = "builtin.output";
export const OUTPUT_DISPLAY = "작성위치";

/** 범위 낱말 슬롯의 저장 경로 · 편집 칩 표기. */
export const SCOPE_WORD_PATH = "builtin.output.scope";
export const SCOPE_WORD_CHIP = "이 약관의";

export function isOutputPosition(code: string): code is OutputPosition {
  return (OUTPUT_POSITIONS as readonly string[]).includes(code);
}
