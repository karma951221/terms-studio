/**
 * 구분자 카탈로그 도메인 (순수) — 정의 · 구조체 · enum · const · 파생 · 값 규칙 · 영향.
 *
 * - types.ts       : Discriminator(식 하나) · EnumDef · 생성 입력(New*, code 없음)
 * - codes.ts       : 코드 채번 규칙 (D0001 · E0001 · V01)
 * - expression.ts  : 구분자 식 검증 (마스터 · 구분자 참조 · 하위는 집계 안 · 상위 금지 · 타입 · planFormOf)
 * - values.ts      : validateValue · 값 자리(마스터 경로) · prefill · missingSlots
 * - definitions.ts : 생성·변경 규칙 (CatalogContext 주입)
 * - impact.ts      : ImpactTarget · ImpactSource(주입) · computeImpact · cascadeOf · enumReferences
 * - shapeTree.ts   : `/catalog` 조회의 5층 모양 트리 (ADR-0070 결정 8) — 문맥 없는 가지 · 잎 묶기
 */
export * from "./codes";
export * from "./definitions";
export * from "./expression";
export * from "./impact";
export * from "./shapeTree";
export * from "./types";
export * from "./values";
