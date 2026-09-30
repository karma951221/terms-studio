/**
 * 화면 라벨 맵 — 도메인 enum 리터럴을 한글로. 영문 값이 화면에 새지 않게 여기만 통과시킨다
 * (디자인원칙 §9 · 리뷰 #64). 도메인 타입이 늘면 여기도 늘린다 (satisfies 로 누락을 잡는다).
 */
import { ATTACH_LEVELS, type AttachLevel, type FieldTypeKind } from "@/domain/types";
import type { OmissionRecord } from "@/domain/assembly/types";
import type { ClauseMode } from "@/domain/clause/types";
import type { CoverageNodeLevel } from "@/domain/coverage/types";
import type { EdgeVia } from "@/domain/refs";

/**
 * 화면에서 실체와 필드를 부르는 말. 목록 컬럼 · 생성 폼 · 상세 필드가 이 값을 함께 쓴다.
 * 도메인 속성명(`label`, `description`)은 화면에 직접 노출하지 않는다.
 */
export const ENTITY_LABEL = {
  discriminator: "구분자",
  form: "폼",
  enum: "열거형변수",
  clause: "함수조항",
  appendix: "별표",
  box: "박스",
  staticMaster: "정적 마스터",
  coverage: "담보",
  product: "상품",
  attribute: "담보속성",
  attributeType: "담보속성 유형",
  generalTemplate: "보통약관 템플릿",
  coverageTemplate: "담보약관 템플릿",
  namingTemplate: "상품담보명 규칙",
  relation: "관계정보",
} as const;

export const NAME_LABEL = {
  discriminator: "구분자명",
  form: "폼 이름",
  enum: "열거형변수 이름",
  clause: "함수조항명",
  appendix: "별표 이름",
  box: "박스 이름",
  coverage: "담보명",
  product: "상품명",
  attribute: "담보속성명",
} as const;

export const FIELD_LABEL = {
  code: "코드",
  type: "유형",
  valueType: "타입",
  level: "레벨",
  exposure: "노출",
  note: "주석",
  value: "값",
  values: "값",
  body: "본문",
  expression: "식",
  resultType: "결과 타입",
  defaultValue: "기본값",
  count: "수",
  field: "필드",
  fieldName: "필드 이름",
  valueName: "값 이름",
  usage: "사용처",
  usageCount: "사용 수",
  updatedAt: "최종수정",
  updatedBy: "수정자",
  template: "템플릿",
  currentName: "지금 이름",
  availableTokens: "쓸 수 있는 칩",
  missingTypes: "템플릿에 없는 유형",
  namingFragment: "상품담보명 표기",
  attributeCode: "담보속성 코드",
  valueCode: "값 코드",
  order: "순서",
  actions: "조작",
  subCoverageName: "세부보장명",
  benefitName: "급부명",
  title: "제목",
  suggested: "제안",
  listType: "list 타입",
} as const;

/** 「상품담보명 표기」 옆 ⓘ — 명명 규칙 용어 대신 무엇이 어디에 들어가는지로 말한다 (기능/담보속성 §3.4). */
export const NAMING_FRAGMENT_TIP = "상품담보명에 이 값 대신 들어갈 말 — 비우면 붙지 않는다";

export const ACTION_LABEL = {
  create: "생성",
  save: "저장",
  add: "추가",
  edit: "편집",
  cancel: "취소",
  close: "닫기",
} as const;

export function newLabel(entity: string): string {
  return `새 ${entity}`;
}

export function listLabel(entity: string): string {
  return `${entity} 목록`;
}

export function chooseLabel(entity: string): string {
  return `${entity} 고르기`;
}

export function addLabel(target: string): string {
  return `${target} 추가`;
}

export function searchPlaceholder(...fields: string[]): string {
  return fields.join(" · ");
}

export const LEVEL_LABEL = {
  product: "상품",
  plan: "세목",
  coverage: "담보",
  subCoverage: "세부보장",
  benefit: "급부",
} as const satisfies Record<AttachLevel, string>;

export const NODE_LEVEL_LABEL = {
  coverage: "담보",
  subCoverage: "세부보장",
  benefit: "급부",
} as const satisfies Record<CoverageNodeLevel, string>;

/** 표시용 — 도메인 타입 전부. `date` 는 새로 고를 수 없지만 이미 있는 값은 이 이름으로 보인다. */
export const TYPE_LABEL = {
  string: "문자열",
  number: "숫자",
  boolean: "참거짓",
  date: "날짜",
  enum: "목록값",
  "list<enum>": "목록값(복수)",
  table: "표",
} as const satisfies Record<FieldTypeKind, string>;

/**
 * 화면에서 **고를 수 있는** 타입 — 흔히 쓰는 순서.
 *
 * - 날짜는 뺐다 (2026-09-09). 도메인 `FieldType` 에는 남아 있어서 이미 날짜인 값은 그대로 읽히고 저장된다.
 * - `list<enum>` 도 없다 — 「목록값」을 고른 뒤 **복수 체크박스**로 정한다 (`_lib/fieldType`).
 */
export const SELECTABLE_TYPE_KINDS = ["string", "number", "boolean", "enum"] as const satisfies readonly FieldTypeKind[];

export const TYPE_OPTIONS = SELECTABLE_TYPE_KINDS.map((kind) => ({ value: kind, label: TYPE_LABEL[kind] }));

export const MODE_LABEL = {
  inline: "문구",
  block: "항",
  item: "호",
  subitem: "목",
} as const satisfies Record<ClauseMode, string>;

export const DOC_KIND_LABEL = {
  general: "보통약관",
  special: "특별약관",
} as const;

/** 조연결 판정 (ADR-0020 세 갈래 · 기능/조립산출 §3.5) — 조립 미리보기의 판정 배지. */
export const OMISSION_LABEL = {
  omitted: "생략",
  applied: "준용",
  full: "통째",
} as const satisfies Record<OmissionRecord["disposition"], string>;

/** 문서(약관 템플릿) 종류 → 실체 이름. `/documents` 목록·상세·생성 화면이 같은 말을 쓴다. */
export const DOC_TEMPLATE_LABEL = {
  general: ENTITY_LABEL.generalTemplate,
  special: ENTITY_LABEL.coverageTemplate,
} as const satisfies Record<keyof typeof DOC_KIND_LABEL, string>;

/** 함수조항 유형 = 출력 모양 — 넷의 차이가 「어디에 서느냐」라서, 고를 때 읽을 뜻풀이를 붙인다. */
export const MODE_OPTIONS = [
  { value: "inline", label: MODE_LABEL.inline, hint: "조 안 문장 중간에 끼어 들어간다 — 문장 조각 하나." },
  { value: "block", label: MODE_LABEL.block, hint: "조 안 항 자리에 선다 — 항 하나 또는 항 목록(호 · 목 포함)." },
  { value: "item", label: MODE_LABEL.item, hint: "항의 호 목록 자리에 선다 — 호 목록, 번호는 쓰는 곳에서 이어 매긴다." },
  { value: "subitem", label: MODE_LABEL.subitem, hint: "호의 목 목록 자리에 선다 — 목 목록, 번호는 쓰는 곳에서 이어 매긴다." },
] as const satisfies readonly { value: ClauseMode; label: string; hint: string }[];

/** 부착 레벨 2지선다가 아니라 5지선다 — 라디오로 늘어놓는다 (선택지가 짧고 개수가 고정이다). */
export const LEVEL_OPTIONS = ATTACH_LEVELS.map((value) => ({ value, label: LEVEL_LABEL[value] }));

export const ROLE_LABEL = { admin: "관리자", editor: "편집자" } as const;

/** 값별 분기(switch) 화면 단어 (화면단어 — 「switch」 · 「케이스」 · 「default」는 쓰지 않는다). */
export const SWITCH_WORD = { switch: "값별 분기", inlineSwitch: "문장 안 값별 분기", case: "칸", empty: "문구 없음", unassigned: "칸 없는 값" } as const;

export const REFERENCE_VIA_LABEL = {
  when: "조건식",
  slot: "치환 슬롯",
  expression: "파생식",
  local: "내부 변수",
  switchCase: "값별 분기",
  valueRestrict: "값 한정 참조",
  nodeQualifier: "노드 한정자",
  clauseRef: "함수조항 참조",
  optionSelect: "옵션 선택",
  override: "옵션 오버라이드",
  articleRef: "조 참조",
  link: "조연결",
  appendixRef: "별표 참조",
  boxRef: "박스 참조",
  defaultBinding: "인자 기본 연결",
  binding: "인자 연결",
  generalDocument: "대응 보통약관",
  document: "담보약관 연결",
  type: "타입",
  mount: "탑재",
  combination: "담보속성 조합",
} as const satisfies Record<EdgeVia, string>;

/** 맵에 없는 값이 오면 원문을 그대로 돌려준다 — 조용히 빈칸이 되는 것보다 낫다. */
export function label<K extends string>(map: Record<K, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? value;
}

/**
 * 구조 표기 칩 글자 — 반복 표 셀의 `structKey` (ADR-0070 결정 6). 행마다 이 자리에 key 표기(`keyLabel`)가 찍힌다.
 * 모양은 조립 결과의 표기 규칙과 같다 — 세부보장은 이름, 급부는 「급부 N 이름」.
 */
export const STRUCT_KEY_CHIP: Record<Exclude<AttachLevel, "product">, string> = {
  plan: "[세목명]",
  coverage: "[상품담보명]",
  subCoverage: "[세부보장명]",
  benefit: "[급부 N 급부명]",
};

/** 행 반복 깊이 → 표 속성 셀렉트 · for 띠 라벨 (담보 약관 템플릿 — 뿌리는 문맥 담보). */
export const REPEAT_DEPTH_LABEL: Record<1 | 2, { option: string; band: string }> = {
  1: { option: "세부보장마다", band: "세부보장마다" },
  2: { option: "세부보장 › 급부마다", band: "급부마다" },
};
