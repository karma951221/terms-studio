/**
 * 관계정보 화면의 쿼리스트링 → RefNodeKey 파싱 + 화면 라벨 — 순수 함수. `*.test.ts` 로 검증.
 * 영문 enum 값을 화면에 내보내지 않는다 (리뷰 #64).
 */
import type { EdgeVia, RefNodeKey } from "@/domain/refs";
import type { CoverageNodeLevel } from "@/domain/coverage";
import { ENTITY_LABEL, REFERENCE_VIA_LABEL } from "@/app/_lib/labels";

export interface RelationQuery {
  kind?: string;
  code?: string;
  id?: string;
  level?: string;
  fieldCode?: string;
  valueCode?: string;
  depth?: string | string[];
  dir?: string | string[];
  kinds?: string | string[];
  vias?: string | string[];
  containment?: string | string[];
}

const COVERAGE_LEVELS: readonly string[] = ["coverage", "subCoverage", "benefit"];

/** 화면이 지원하는 실체 종류만 (구분자·입력항목·enum·enum값·공용조항·별표·담보 노드·담보속성(값)·상품·상품담보). */
export function parseRefTarget(q: RelationQuery): RefNodeKey | undefined {
  switch (q.kind) {
    case "discriminator":
      return q.code ? { kind: "discriminator", code: q.code } : undefined;
    case "masterField":
      return q.code ? { kind: "masterField", path: q.code } : undefined;
    case "enum":
      return q.code ? { kind: "enum", enumCode: q.code } : undefined;
    case "enumValue":
      return q.code && q.valueCode ? { kind: "enumValue", enumCode: q.code, valueCode: q.valueCode } : undefined;
    case "enumField":
      return q.code && q.fieldCode ? { kind: "enumField", enumCode: q.code, key: q.fieldCode } : undefined;
    case "clause":
      return q.code ? { kind: "clause", code: q.code } : undefined;
    case "clauseOption":
      return q.code && q.fieldCode ? { kind: "clauseOption", clauseCode: q.code, optionCode: q.fieldCode } : undefined;
    case "clauseOptionValue":
      return q.code && q.fieldCode && q.valueCode ? { kind: "clauseOptionValue", clauseCode: q.code, optionCode: q.fieldCode, valueCode: q.valueCode } : undefined;
    case "article":
      return q.code && q.id ? { kind: "article", documentId: q.code, articleId: q.id } : undefined;
    case "appendix":
      return q.code ? { kind: "appendix", code: q.code } : undefined;
    case "box":
      return q.code ? { kind: "box", code: q.code } : undefined;
    case "coverageNode":
      return q.level && COVERAGE_LEVELS.includes(q.level) && q.id ? { kind: "coverageNode", level: q.level as CoverageNodeLevel, id: q.id } : undefined;
    case "attribute":
      return q.code ? { kind: "attribute", code: q.code } : undefined;
    case "attributeValue":
      return q.code && q.valueCode ? { kind: "attributeValue", code: q.code, valueCode: q.valueCode } : undefined;
    case "product":
      return q.id ? { kind: "product", id: q.id } : undefined;
    case "productCoverage":
      return q.id ? { kind: "productCoverage", id: q.id } : undefined;
    case "document":
      return q.id ? { kind: "document", id: q.id } : undefined;
    case "entity":
      return q.code && q.id ? { kind: "entity", entityKind: q.code, id: q.id } : undefined;
    default:
      return undefined;
  }
}

// ───────────────────────────── 화면 라벨 ─────────────────────────────

/** 조회 종류 선택지 — 값은 `parseRefTarget` 의 `kind`, 글자는 사람 말. */
export const KIND_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "discriminator", label: "구분자" },
  { value: "masterField", label: "구분자 필드" },
  { value: "enum", label: ENTITY_LABEL.enum },
  { value: "enumValue", label: "열거형변수 값" },
  { value: "enumField", label: "열거형변수 필드" },
  { value: "clause", label: "함수조항" },
  { value: "clauseOption", label: "함수조항 옵션" },
  { value: "clauseOptionValue", label: "옵션 선택지" },
  { value: "article", label: "조" },
  { value: "appendix", label: "별표" },
  { value: "box", label: "박스" },
  { value: "coverageNode", label: "담보 노드" },
  { value: "attribute", label: "담보속성" },
  { value: "attributeValue", label: "담보속성 값" },
  { value: "product", label: "상품" },
  { value: "productCoverage", label: "상품담보" },
  { value: "document", label: "약관 템플릿" },
  { value: "entity", label: "기타 실체" },
];

/** RefNodeKey 를 관계정보의 기존 kind/code/id/level/fieldCode/valueCode 계약으로 직렬화한다. */
export function refTargetParams(key: RefNodeKey): Record<string, string> {
  const params: Record<string, string> = { kind: key.kind };
  switch (key.kind) {
    case "discriminator":
    case "clause":
    case "appendix":
    case "box":
    case "attribute":
      params.code = key.code;
      break;
    case "masterField":
      params.code = key.path;
      break;
    case "enum":
      params.code = key.enumCode;
      break;
    case "enumValue":
      params.code = key.enumCode;
      params.valueCode = key.valueCode;
      break;
    case "enumField":
      params.code = key.enumCode;
      params.fieldCode = key.key;
      break;
    case "clauseOption":
      params.code = key.clauseCode;
      params.fieldCode = key.optionCode;
      break;
    case "clauseOptionValue":
      params.code = key.clauseCode;
      params.fieldCode = key.optionCode;
      params.valueCode = key.valueCode;
      break;
    case "document":
    case "product":
    case "productCoverage":
      params.id = key.id;
      break;
    case "article":
      params.code = key.documentId;
      params.id = key.articleId;
      break;
    case "coverageNode":
      params.level = key.level;
      params.id = key.id;
      break;
    case "attributeValue":
      params.code = key.code;
      params.valueCode = key.valueCode;
      break;
    case "entity":
      params.code = key.entityKind;
      params.id = key.id;
      break;
  }
  return params;
}

/** 참조의 형태(`EdgeVia`) — 화면 표기. */
export const VIA_LABEL = REFERENCE_VIA_LABEL satisfies Record<EdgeVia, string>;
