/**
 * 공용조항 본문 노드 — 문면 노드 트리(ADR-0012 · 기능/문면 §3.2)의 **부분집합**.
 *
 * 공용조항 본문은 문면과 같은 노드 모델을 쓰되, 공용조항 안에서 쓸 수 있는 종류만 여기 둔다.
 * B3(document)·C2(assembly) 통합 시 노드 타입을 하나로 합칠 수 있도록 **타입은 이 파일 한 곳**에만 둔다.
 *
 * - inline 본문 = `Inline[]` (문장 안 문구).  block 본문 = `Block[]` (항 또는 항 목록).
 * - 인라인 종류: `text · slot · inlineCond · articleRef · appendixRef · optionSlot`.
 *   **공용조항 참조(clauseInlineRef · clauseBlockRef)는 없다** — 중첩 금지(MVP, 기능/공용조항 §3.1).
 *   반복(forBlock · inlineFor)도 MVP 이후라 없다.
 * - 블록 종류: `paragraph(항) · condBlock(조건 블록) · bulletList(글머리 목록) · boxRef(정적 마스터 박스 참조)`. 조(article)는 항상 사용처 소유라 없다.
 *   박스 참조는 잎이라 중첩 금지에 걸리지 않는다 — 항 자리와 항의 호 목록 자리(호 뒤)에 선다 (최종 결정 6 · 9).
 *   글머리 목록은 항 자리와 항의 호 목록 자리(호 뒤)에 선다 — 항목(bullet)은 한 줄 문장, 목록 안 조건 블록은 없다(문면보다 좁다).
 * - 호(item)·목(subitem)은 항의 하위 목록으로 매달린다.
 * - 인라인 조건의 중첩은 금지, 블록 조건의 중첩은 허용 (기능/문면 §3.2).
 * - 식(`slot.ref` · `when`)은 코드 기반 소스 문자열 — 파싱·추출은 expression 모듈.
 * - 노드 id 는 공용조항 하나 안(본문 + 모든 옵션 선택지 본문)에서 유일해야 한다 —
 *   인라인화(`expandClause`)가 `${참조노드id}/${원노드id}` 로 유일화하기 때문.
 *
 * DB·React import 금지 (순수층).
 */

import type { Code, Id, ReferenceConnector } from "../types";

// ───────────────────────────── 인라인 ─────────────────────────────

/** 텍스트런. */
export interface TextNode {
  id: Id;
  kind: "text";
  text: string;
}

/** 값 치환 슬롯 — `ref` 는 식 참조 경로 문자열. 문면·공용조항은 구분자 코드만 찍는다 (ADR-0037). */
export interface SlotNode {
  id: Id;
  kind: "slot";
  ref: string;
}

/** 인라인 조건의 가지. `when` 이 없으면 else 가지 (마지막 가지에만 허용). */
export interface InlineBranch {
  id: Id;
  when?: string;
  /** 인라인 조건 안에는 다시 inlineCond 를 둘 수 없다 (검증으로 강제). */
  children: Inline[];
}

/** 인라인 조건 (if / elif / else). */
export interface InlineCondNode {
  id: Id;
  kind: "inlineCond";
  branches: InlineBranch[];
}

/**
 * 조 참조 슬롯 — 대상을 저장하고 렌더 시 계산된 번호를 찍는다. 대상이 어디 있는지는 `scope` 가 정한다 (기능/공용조항 §3.5):
 * - 없음 : 보통약관 마스터의 조 · 항 · 호 · 목 (`nodeId` = 그 노드 id). 문맥과 무관하게 고정된다.
 * - `"clause"` : **이 공용조항 본문 안의** 항 · 호 · 목 (`nodeId` = 본문 노드 id) — 「제1항에 따라」처럼 조째 공용조항이 제 항을 가리킨다.
 *   펼칠 때(`expandClause`) 펼친 노드 id 로 바뀌어 사용처 번호로 찍힌다.
 * - `"host"` : **사용처 문서의** 위치 (`nodeId` = 위치 경로 `"1"` · `"2.1"` · `"2.1.3"` — 사용처의 n번째 조 · 그 조의 m번째 항 · k번째 호).
 *   「제1조(보험금의 지급사유)에서 정한」처럼 조째 공용조항이 사용처의 지급사유 조를 가리킨다. 조립이 사용처 트리에서 노드 id 로 푼다.
 */
export interface ArticleRefNode {
  id: Id;
  kind: "articleRef";
  targets: { nodeId: Id }[];
  /** 기본값 없음 — 대상이 둘 이상이면 필수 (결정 14 · 문서의 `ArticleRefNode.connector` 와 같은 규칙). */
  connector?: ReferenceConnector;
  scope?: ClauseRefScope;
}

/** 공용조항 조 참조의 범위 — 없으면 보통약관 마스터. */
export type ClauseRefScope = "clause" | "host";

/** 사용처 위치 경로 — `조[.항[.호[.목]]]` 순번(1부터). */
export const HOST_PATH = /^[1-9]\d*(\.[1-9]\d*){0,3}$/;

/** 별표 참조 슬롯 — 별표 불변 코드. 번호는 책자별 계산값. */
export interface AppendixRefNode {
  id: Id;
  kind: "appendixRef";
  appendixCode: Code;
}

/** 옵션 자리 — 사용처가 고른 선택지(OptionValue)의 본문이 이 자리에 들어간다 (기능/공용조항 §3.2). */
export interface OptionSlotNode {
  id: Id;
  kind: "optionSlot";
  optionCode: Code;
}

export type Inline =
  | TextNode
  | SlotNode
  | InlineCondNode
  | ArticleRefNode
  | AppendixRefNode
  | OptionSlotNode;

export type InlineKind = Inline["kind"];

// ───────────────────────────── 블록 ─────────────────────────────

/** 목. */
export interface SubitemNode {
  id: Id;
  kind: "subitem";
  children: Inline[];
}

/** 호. */
export interface ItemNode {
  id: Id;
  kind: "item";
  children: Inline[];
  subitems?: SubitemNode[];
}

/** 글머리 목록의 항목 — 번호 없는 한 줄 문장. */
export interface BulletNode {
  id: Id;
  kind: "bullet";
  children: Inline[];
}

/** 글머리 목록 — 번호 없는 「-」 나열 (문면 §3.2 와 같은 노드). 항 · 호 번호에 들지 않는다. */
export interface BulletListNode {
  id: Id;
  kind: "bulletList";
  children: BulletNode[];
}

/** 정적 마스터 박스 참조 — 박스 코드만. 조립이 박스 마스터에서 내용을 읽어 편다 (문면 `BoxRefNode` 와 같은 모양). */
export interface BoxRefNode {
  id: Id;
  kind: "boxRef";
  boxCode: Code;
}

/** 항. 호 목록 자리에 글머리 목록 · 박스 참조도 선다(호 뒤). */
export interface ParagraphNode {
  id: Id;
  kind: "paragraph";
  children: Inline[];
  items?: (ItemNode | BulletListNode | BoxRefNode)[];
}

/** 블록 조건의 가지. `when` 이 없으면 else 가지 (마지막 가지에만 허용). */
export interface BlockBranch {
  id: Id;
  when?: string;
  /** 블록 조건은 중첩 허용 — 가지 안에 다시 condBlock 이 올 수 있다. */
  children: Block[];
}

/** 블록 조건 (if / elif / else) — 항 자리에 선다. */
export interface CondBlockNode {
  id: Id;
  kind: "condBlock";
  branches: BlockBranch[];
}

export type Block = ParagraphNode | CondBlockNode | BulletListNode | BoxRefNode;

export type BlockKind = Block["kind"];

/** 공용조항 안에 나타날 수 있는 모든 노드. */
export type ClauseNode = Inline | Block | ItemNode | SubitemNode | BulletNode;

export type ClauseNodeKind = ClauseNode["kind"];

export const INLINE_KINDS: readonly InlineKind[] = [
  "text",
  "slot",
  "inlineCond",
  "articleRef",
  "appendixRef",
  "optionSlot",
];

export const BLOCK_KINDS: readonly BlockKind[] = ["paragraph", "condBlock", "bulletList", "boxRef"];
