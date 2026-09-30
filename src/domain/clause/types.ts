/**
 * 함수조항 도메인 타입.
 *
 * 근거: docs/기능/함수조항/함수조항.md §3.1 (참조 + 옵션 + 유형 = 출력 모양 넷) ·
 * §3.2 (옵션 선택·오버라이드) · §3.7 · ADR-0076 (인자 · 인자 연결 · 기본 연결).
 *
 * - 코드는 시스템 채번·불변 (`C0001`). 옵션 `O01`, 선택지 `V01` 은 소속 안에서 유일.
 * - 본문은 유형에 따라 `Inline[]` · `Block[]` · `ItemBodyNode[]` · `SubitemBodyNode[]` — 판별 합집합으로 타입이 갈린다.
 * - 요구 구분자(`required`)는 저장할 때 식에서 계산해 함께 둔다 (선언 아님).
 */
import type { Code, Id } from "../types";
import type { Block, Inline, ItemBodyNode, SubitemBodyNode } from "./nodes";
import type { LocalDef } from "./locals";
import type { ParamDef } from "./params";

/**
 * 유형 = 출력 모양 (최종 결정 4) — 문구(문장 조각) · 항(항 목록) · 호(호 목록) · 목(목 목록). 유형과 넣는 자리가 맞아야 넣는다.
 * 박스는 유형이 아니라 정적 마스터다(최종 결정 9 · 기능/박스).
 */
export type ClauseMode = "inline" | "block" | "item" | "subitem";

export const CLAUSE_MODES: readonly ClauseMode[] = ["inline", "block", "item", "subitem"];

/** 옵션 자리의 선택지 — 문구 수준의 대안 (기능/함수조항 §3.1 「옵션은 문구 수준」). */
export interface OptionValue {
  /** 옵션 안에서 유일 (`V01`). */
  code: Code;
  label: string;
  /** 이 선택지를 고르면 옵션 자리에 들어가는 문구. */
  body: Inline[];
  /** 선택 UI 표시 순서 (D-P3-6). */
  order: number;
}

/** 옵션 정의 — 본문의 `optionSlot` 이 가리키는 자리. 기본 선택지는 없다 (D-P3-7). */
export interface OptionDef {
  /** 함수조항 안에서 유일 (`O01`). */
  code: Code;
  label: string;
  /** 유효 옵션 집합. 2개 이상 (D-P3-4). */
  values: OptionValue[];
  order: number;
}

/**
 * 요구 참조 — 저장할 때 계산해 둔다. 함수조항은 구분자를 직접 읽지 않으므로(최종 결정 2) 구분자는 **인자의 기본 연결**이다 —
 * 정의가 기대는 구분자(존재 검사 · 삭제 영향의 단위). 사용처가 실제로 읽는 구분자는 연결이 정한다(`boundDiscriminators`).
 */
export interface RequiredRefs {
  /** 본문이 읽는 인자의 기본 연결 구분자 코드 (처음 읽는 순, 중복 없음). */
  discriminators: Code[];
  /** 담보속성 종류 코드 (ADR-0015). 탑재 문맥에서 확정된다. */
  attributes: Code[];
}

interface ClauseBase {
  code: Code;
  label: string;
  options: OptionDef[];
  /** 인자 — 본문이 `arg.<이름>` 으로 읽는 입력 선언 (최종 결정 2 · 기능/함수조항 §3.7). 없거나 빈 목록 = 인자 0개(고정 문장). */
  params?: ParamDef[];
  /** 내부 변수 — 인자를 가공한 값에 붙인 이름, 본문이 `var.<이름>` 으로 읽는다 (최종 결정 2). 앞 이름만 읽는다. 없거나 빈 목록 = 내부 변수 0개. */
  locals?: LocalDef[];
  required: RequiredRefs;
}

export interface InlineClause extends ClauseBase {
  mode: "inline";
  body: Inline[];
}

export interface BlockClause extends ClauseBase {
  mode: "block";
  body: Block[];
}

export interface ItemClause extends ClauseBase {
  mode: "item";
  body: ItemBodyNode[];
}

export interface SubitemClause extends ClauseBase {
  mode: "subitem";
  body: SubitemBodyNode[];
}

export type Clause = InlineClause | BlockClause | ItemClause | SubitemClause;

/** 모드에 따른 본문 타입. */
export type BodyOf<M extends ClauseMode> = M extends "inline" ? Inline[] : M extends "block" ? Block[] : M extends "item" ? ItemBodyNode[] : SubitemBodyNode[];

export type ClauseBody = Inline[] | Block[] | ItemBodyNode[] | SubitemBodyNode[];

/** 사용처의 옵션 선택 — 옵션 코드 → 선택지 코드. */
export type OptionSelection = Record<Code, Code>;

// ───────────────────────────── 생성 입력 (code 없음) ─────────────────────────────

export interface NewOptionValue {
  label: string;
  body?: Inline[];
}

export interface NewOption {
  label: string;
  values: NewOptionValue[];
}

export interface NewClause {
  label: string;
  mode: ClauseMode;
  body?: ClauseBody;
  options?: NewOption[];
  params?: ParamDef[];
  locals?: LocalDef[];
}

/** 목록 화면용 요약 — 코드 · 표시명 · 모드 · 사용처 수 · 최종수정(언제 · 누가). */
export interface ClauseSummary {
  code: Code;
  label: string;
  mode: ClauseMode;
  usageCount: number;
  updatedAt: Date;
  /** 마지막으로 저장한 사람의 id — 이름은 화면이 붙인다 (도메인은 사용자를 모른다). */
  updatedBy: Id;
}
