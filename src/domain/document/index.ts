/**
 * 문면 도메인 (순수) — 노드 트리 · 허용 자식 규칙 · 트리 커맨드 · 번호 계산 · 참조 추출 · 식 검증 · 사전평가 · 별표 마스터.
 *
 * - nodes.ts       : 노드 타입 · allowedChildren · indexTree · validateTree · ClauseGate · TreeEnv
 * - builders.ts    : 노드 빌더 (id 공급원 주입)
 * - clauseTree.ts  : 공용조항 본문 ↔ 편집 트리 (공용조항 화면이 문면 에디터를 쓰는 어댑터)
 * - commands.ts    : Command · applyCommand(s) · cloneTree
 * - edit.ts        : 편집본 — EditOp · applyEdit · replayEdits (ADR-0074 브라우저 편집본 · 서버 재적용)
 * - validate.ts    : validateDocument (저장 검증 한 벌) · clauseGateFrom · catalogTypeResolver
 * - numbering.ts   : numberTree · 표기 함수 (임시 규칙)
 * - refs.ts        : collectRefs · requiredDiscriminators
 * - expressions.ts : validateExpressions (저장 시점 식 검사)
 * - evaluate.ts    : preEvaluate (부분 사전평가 — 반복 표는 행 문맥으로 펼친다)
 * - repeat.ts      : 행 반복 표 펼침 · 병합 · 저장 검사 (ADR-0070)
 * - appendix.ts    : 별표 마스터 규칙
 * - fixture.ts     : 관통 1 축약 픽스처
 * - conditionRows.ts : 조건 팝업의 줄 모델 ↔ 식 AST (ADR-0066 §5 §8)
 */
export * from "./appendix";
export * from "./builders";
export * from "./clauseTree";
export * from "./commands";
export * from "./conditionRows";
export * from "./edit";
export * from "./evaluate";
export * from "./expressions";
export * from "./fixture";
export * from "./nodes";
export * from "./numbering";
export * from "./refs";
export * from "./repeat";
export * from "./validate";
