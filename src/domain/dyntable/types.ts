/**
 * 동적표 정의 타입 (순수) — 기능/동적표 §3.1 ~ §3.3.
 *
 * - 동적표는 함수조항과 같은 뼈대의 독립 객체: 코드(시스템 발급) · 이름 · 인자(값 인자만 — `ParamDef`) · 본문 대신 **표 규칙**.
 * - 표 규칙 = 행 기준(급부명, 고정) · 열 기준(감액 구간 / 없음) · 구분 칸 머리글 · 열 머리글 템플릿 네 벌(첫 · 가운데 · 마지막 · 단일) · 셀 템플릿.
 * - 템플릿은 인라인 노드(`Inline[]`, clause/nodes.ts) — 글 + 슬롯 + 조건 · 값별 분기. 조건 · 분기는 `arg.X` 만 읽고(§3.1),
 *   셀 템플릿의 「해당보장의」 조건만 담보 구조 내장값(`count(builtin.subCoverage.name) >= 2`)을 읽는다 — 그것은 조립이 담보 문맥에서 평가한다.
 * - 표 슬롯은 내장 경로 `builtin.table.<슬롯>` 으로 적는다(`DYN_TABLE_SLOTS`) — 펼침(`expandDynTable`)이 글로 바꾼 뒤 돌려주므로 평가 문맥에는 오지 않는다.
 *
 * DB·React import 금지 (순수층).
 */
import type { Inline } from "../clause/nodes";
import type { ParamDef } from "../clause/params";
import type { ReductionPeriods } from "../coverage/traits";
import type { Code, Id, Issue } from "../types";

/** 열 기준 — 감액 구간(경계 합집합으로 열을 나눈다) 또는 없음(열 하나, 단일 열 템플릿). */
export type ColumnBasis = "reduction" | "none";

/** 열 머리글 템플릿 네 벌 — 열 하나 = 단일, 둘 = 첫 + 마지막, 셋 이상 = 첫 + 가운데(열마다) + 마지막 (§3.3). */
export interface DynTableHeaders {
  first: Inline[];
  middle: Inline[];
  last: Inline[];
  single: Inline[];
}

export interface DynTable {
  id: Id;
  /** 시스템 발급 코드 (`T0001` — 채번은 서비스 단계). */
  code: Code;
  label: string;
  /** 값 인자만 (§3.1) — 조 참조 인자는 저장 검사가 거부한다. */
  params: ParamDef[];
  columnBasis: ColumnBasis;
  /** 구분 칸 머리글 — 기본 「구 분」. */
  rowHeader: string;
  headers: DynTableHeaders;
  /** 셀 템플릿 — 기본 「보험가입금액의 {비율}%」(`defaultCellTemplate`). */
  cell: Inline[];
  createdAt?: Date;
  updatedAt?: Date;
  /** 마지막으로 저장한 사람의 id — 이름은 화면이 붙인다. */
  updatedBy?: Id;
}

/** 생성 입력 — 코드 · id · 저장 메타 없음. */
export type NewDynTable = Omit<DynTable, "id" | "code" | "createdAt" | "updatedAt" | "updatedBy">;

/** 목록 화면용 요약. */
export interface DynTableSummary {
  code: Code;
  label: string;
  columnBasis: ColumnBasis;
  updatedAt?: Date;
  updatedBy?: Id;
}

/** 펼침 입력의 급부 하나 — 담보 트리 순서(세부보장 순 → 급부 순)로 준다. */
export interface DynBenefit {
  subCoverageKey: string;
  subCoverageName: string;
  key: string;
  /** 급부명 — 행 기준. 같으면 한 행으로 묶인다 (§3.2 · §3.4). */
  name: string;
  /** 지급률 `pay.rate` (%). undefined = 미입력. */
  payRate?: number;
  /** 감액 구간 — undefined = 감액 폼을 열지 않음(모든 열 100). */
  reduction?: ReductionPeriods;
}

export interface ExpandedDynTableRow {
  name: string;
  /** 이 행에 묶인 급부 키 (트리 순). */
  benefitKeys: string[];
  /** `[급부명 글, 셀1 .. 셀N]` — 셀은 템플릿을 바꿔 쓴 인라인(표 슬롯은 글로, `arg.X` 는 연결로). */
  cells: Inline[][];
}

export interface ExpandedDynTable {
  /** `[구분 칸 머리글, 열1 머리글 .. 열N 머리글]`. */
  header: Inline[][];
  rows: ExpandedDynTableRow[];
  /** 연결 오류(argUnbound 등) · 미입력(notEntered) · 묶기 충돌 경고(dynTableMergeConflict). 표 구조는 그래도 돌려준다. */
  issues: Issue[];
}

/** 표 슬롯의 내장 경로 — 머리글 `{경계}` · `{앞경계}`, 셀 `{비율}` (§3.3). */
export const DYN_TABLE_SLOTS = {
  boundary: "builtin.table.boundary",
  prevBoundary: "builtin.table.prevBoundary",
  rate: "builtin.table.rate",
} as const;

export type DynTableSlotRef = (typeof DYN_TABLE_SLOTS)[keyof typeof DYN_TABLE_SLOTS];

/** 표 슬롯의 표시명 — 편집기 칩 · 오류 문구용 (경로 → 「경계」 · 「앞경계」 · 「비율」). */
export const DYN_TABLE_SLOT_LABEL: Record<DynTableSlotRef, string> = {
  [DYN_TABLE_SLOTS.boundary]: "경계",
  [DYN_TABLE_SLOTS.prevBoundary]: "앞경계",
  [DYN_TABLE_SLOTS.rate]: "비율",
};

export type DynTableTemplateKey = keyof DynTableHeaders | "cell";

/** 템플릿마다 쓸 수 있는 표 슬롯 (§3.3 표) — 첫 · 마지막: 경계, 가운데: 경계 + 앞경계, 단일: 없음, 셀: 비율. */
export const DYN_TABLE_ALLOWED_SLOTS: Record<DynTableTemplateKey, readonly DynTableSlotRef[]> = {
  first: [DYN_TABLE_SLOTS.boundary],
  middle: [DYN_TABLE_SLOTS.boundary, DYN_TABLE_SLOTS.prevBoundary],
  last: [DYN_TABLE_SLOTS.boundary],
  single: [],
  cell: [DYN_TABLE_SLOTS.rate],
};

export function isDynTableSlotRef(ref: string): ref is DynTableSlotRef {
  return ref === DYN_TABLE_SLOTS.boundary || ref === DYN_TABLE_SLOTS.prevBoundary || ref === DYN_TABLE_SLOTS.rate;
}

export const DEFAULT_ROW_HEADER = "구 분";

/** 기본 셀 템플릿 「보험가입금액의 {비율}%」 — 새 정의의 씨앗. `idPrefix` 로 노드 id 를 정한다. */
export function defaultCellTemplate(idPrefix = "cell"): Inline[] {
  return [
    { id: `${idPrefix}-t1`, kind: "text", text: "보험가입금액의 " },
    { id: `${idPrefix}-rate`, kind: "slot", ref: DYN_TABLE_SLOTS.rate },
    { id: `${idPrefix}-t2`, kind: "text", text: "%" },
  ];
}

/** 기본 단일 열 머리글 「지급금액」 — 새 정의의 씨앗. */
export function defaultSingleHeader(idPrefix = "single"): Inline[] {
  return [{ id: `${idPrefix}-t1`, kind: "text", text: "지급금액" }];
}
