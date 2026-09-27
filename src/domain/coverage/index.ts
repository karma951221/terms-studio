/**
 * 담보 도메인 (순수) — 담보 트리 · 담보 레벨 값 · 완결성 · 영향 · 평가 문맥.
 *
 * 2026-09-12 — 부착(노출여부)은 없다. 값 자리는 「노드 × 마스터 필드」고 그 레벨 필드는
 * 모든 노드에 항상 있다 (ADR-0037). `attachment.ts` 는 그래서 사라졌다.
 *
 * - code.ts        : 담보코드 COV000001 채번 (formatCoverageCode · createCoverage)
 * - types.ts       : Coverage · SubCoverage · Benefit · CoverageNodeRef/Level · 생성 입력(New*)
 * - tree.ts        : 트리 편집 규칙 (최소 구조 · 형제 이름 · 순서) · 열거 헬퍼(nodesOf · descendants · cascadeNames)
 * - values.ts      : MasterValues · 값 쓰기 검사 · 폼 프리필 · 완결성(CompletenessFilter 주입)
 * - impact.ts      : UsageSource(주입) · 노드 삭제 영향
 * - plan.ts        : 구조 초안(StructureDraft*) · 저장 계획(structurePlan) · 메모리 드라이런 (ADR-0075)
 * - evalContext.ts : masterEvalContext · nodeEvalContext — 식 언어 EvalContext 구성
 * - traits.ts      : 급부 특성(감액 · 면책) 값 규칙 · validateSlotValue · 동적 표 창구 reductionPeriods
 * - fixture.ts     : 관통 축약 픽스처 — surgery() (evalContext.test · 문면 조건 팝업 test 공유)
 */
export * from "./code";
export * from "./evalContext";
export * from "./fixture";
export * from "./impact";
export * from "./plan";
export * from "./traits";
export * from "./tree";
export * from "./types";
export * from "./values";
