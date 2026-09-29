/**
 * 공용조항 도메인 (순수) — 정의 · 옵션 · 요구 구분자 · 참조 검사 · 인라인화.
 *
 * - nodes.ts       : 본문 노드 타입 (문면 노드 모델의 부분집합 — 통합 시 이 파일만 합친다)
 * - types.ts       : Clause · OptionDef · RequiredRefs · 생성 입력(New*, code 없음)
 * - codes.ts       : 코드 채번 규칙 (C0001 · O01 · V01)
 * - body.ts        : analyzeBody (허용 노드 규칙 · 식 파싱 · 요구 구분자 추출) · collectExpressions
 * - definitions.ts : 생성·변경·옵션·복제 규칙 (ClauseContext 주입)
 * - reference.ts   : 부착 검사 · 옵션 선택 검증 · 오버라이드 해소 · expandClause · 사용처 재검사
 * - params.ts      : 인자 · 인자 연결 · 기본 연결 (검사 ① 인자 표 · 검사 ② 사용처 연결)
 * - bind.ts        : applyBindings — 펼치기 전에 arg.X 를 연결로 바꿔 쓴다
 * - locals.ts      : 내부 변수 (검사 ① 내부 변수 표 · 펼칠 때 사용처 문맥 평가 localScope)
 */
export * from "./bind";
export * from "./body";
export * from "./codes";
export * from "./definitions";
export * from "./locals";
export * from "./nodes";
export * from "./params";
export * from "./pcode";
export * from "./reference";
export * from "./types";
