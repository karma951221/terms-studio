export interface CatalogEditData extends Record<string, unknown> {
  label: string;
  description: string;
  expression: string;
  /** 명시 결과 타입 (기능/구분자 §3.1) — 폼 모양 그대로. `resultTypeKind === ""` 는 미지정. `lib.resultTypeFromForm` 이 도메인 타입으로 되돌린다. */
  resultTypeKind: string;
  resultTypeMulti: boolean;
  resultTypeEnum: string;
}
