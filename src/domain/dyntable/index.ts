/**
 * 동적표 도메인 (순수) — 기능/동적표.
 *
 * - types.ts   : DynTable · 템플릿 · 표 슬롯(`builtin.table.*`) · 펼침 입력 · 결과
 * - codes.ts   : DT000001 코드 규칙 (formatDynTableCode)
 * - check.ts   : checkDynTable — 저장 검사(인자 표 · 템플릿이 읽는 것 · 표 슬롯 자리 · 값별 분기)
 * - expand.ts  : expandDynTable — 경계 합집합 · 행 묶기 · 셀 계산 · 템플릿 바꿔 쓰기
 * - fixture.ts : 표본 정의 A · A′ · R (인수기준 · 시드)
 * - preview.ts : previewDynTable — 표본 급부 · 인자 값으로 펼친 글 표(화면 미리보기)
 */
export * from "./check";
export * from "./codes";
export * from "./expand";
export * from "./fixture";
export * from "./preview";
export * from "./types";
