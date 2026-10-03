/**
 * 상품·탑재 도메인 (순수) — 담보속성 카탈로그 · 상품 · 세목 · 탑재 스냅샷 · 작명 · 기본계약 · 특약 그룹 안 정렬 · 완결성.
 *
 * - types.ts        : 도메인 타입 + 주입 인터페이스 (CoverageMasterSource · GeneralAttachmentCheck · OptionValidator …)
 * - articleCopies.ts : 조 사본 — 템플릿 + 사본 → 이 상품의 보통약관 트리 · 지문 · 「템플릿이 바뀜」 (ADR-0079)
 * - attributes.ts   : 담보속성 종류·유효값·작명 규칙·순서 (코드 A0001 · 유효값 1 · 2 …)
 * - naming.ts       : default 상품담보명 (작명 문법 확정 주석)
 * - plans.ts        : 세목유형·선택지·유효 조합 규칙
 * - mount.ts        : 조합 키·선택 검증·스냅샷 구조 대조(diffStructure)
 * - groups.ts       : sortInGroup — 특약 그룹 안 자동 정렬 (그룹 자체는 담보의 열거값, ADR-0080)
 * - completeness.ts : 노출 구분자 · 미입력 목록 · 기본계약 부착 검사
 */
export * from "./articleCopies";
export * from "./attributes";
export * from "./completeness";
export * from "./groups";
export * from "./mount";
export * from "./naming";
export * from "./plans";
export * from "./types";
