/**
 * 담보 도메인 (순수) — 담보 트리 · 담보 레벨 값 · 완결성 · 영향 · 자식 제공자.
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
 * - category.ts    : 담보의 담보분류 — 열거형 「담보분류」(E0009) 값 하나(필수) · 기본 그룹 제목 (ADR-0090)
 * - keys.ts        : 노드 키 — 빈 가장 작은 번호 채번 · 키 경로(`01` · `01.2`) 찾기 · 표기 (ADR-0087)
 * - children.ts    : coverageStructNode · coverageChildrenProviders — 반복 표 · 반복 블록의 담보 트리 열거 (ADR-0070)
 * - traits.ts      : 급부 특성(감액 · 면책) 값 규칙 · validateSlotValue · 동적 표 창구 reductionPeriods
 * - fixture.ts     : 관통 축약 픽스처 — surgery() (children.test · 문면 조건 팝업 test 공유)
 */
export * from "./category";
export * from "./code";
export * from "./children";
export * from "./fixture";
export * from "./impact";
export * from "./keys";
export * from "./plan";
export * from "./traits";
export * from "./tree";
export * from "./types";
export * from "./values";
