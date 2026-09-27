/**
 * 폼 렌더러 — 코드 폼 하나를 값 카드 하나로 그린다 (기능/마스터 §3.5 「폼 하나가 카드 하나」).
 *
 * - model.ts      : buildForm · formReducer · toSubmission · formProgress · zodSchemaFor (순수, React 없음)
 * - StructForm.tsx: 클라이언트 컴포넌트 — 6 타입을 타입별 매핑 하나로, 출처 문법(§1.2)과 함께 그린다
 * - ValueList.tsx : 읽기 전용 뷰 — 완결성 「N개 중 M개 입력」
 */
export * from "./model";
export * from "./StructForm";
export * from "./ValueList";
