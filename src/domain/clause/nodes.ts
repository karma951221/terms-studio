/**
 * 함수조항 본문 노드 — 문면 노드 트리(ADR-0012 · 기능/문면 §3.2)의 **부분집합**.
 *
 * 함수조항 본문은 문면과 같은 노드 모델을 쓰되, 함수조항 안에서 쓸 수 있는 종류만 여기 둔다.
 * B3(document)·C2(assembly) 통합 시 노드 타입을 하나로 합칠 수 있도록 **타입은 이 파일 한 곳**에만 둔다.
 *
 * - 유형 = 출력 모양 (최종 결정 4): inline 본문 = `Inline[]` (문장 안 문구) · block 본문 = `Block[]` (항 목록) ·
 *   item 본문 = `ItemBodyNode[]` (호 목록 — 조건 블록 가지 안도 호 목록) · subitem 본문 = `SubitemBodyNode[]` (목 목록). 빈 목록도 된다.
 * - 인라인 종류: `text · slot · inlineCond · articleRef · appendixRef · optionSlot`.
 *   **함수조항 참조(clauseInlineRef · clauseBlockRef)는 없다** — 중첩 금지(MVP, 기능/함수조항 §3.1).
 *   반복(forBlock · inlineFor)도 MVP 이후라 없다.
 * - 블록 종류: `paragraph(항) · condBlock(조건 블록) · bulletList(글머리 목록) · boxRef(정적 마스터 박스 참조)`. 조(article)는 항상 사용처 소유라 없다.
 *   박스 참조는 잎이라 중첩 금지에 걸리지 않는다 — 항 자리와 항의 호 목록 자리(호 뒤)에 선다 (최종 결정 6 · 9).
 *   글머리 목록은 항 자리와 항의 호 목록 자리(호 뒤)에 선다 — 항목(bullet)은 한 줄 문장, 목록 안 조건 블록은 없다(문면보다 좁다).
 * - 호(item)·목(subitem)은 항의 하위 목록으로 매달린다.
 * - 인라인 조건의 중첩은 금지, 블록 조건의 중첩은 허용 (기능/문면 §3.2).
 * - **값별 분기(switch, 최종 결정 5)** — 대상(인자 · 내부 변수 하나, 목록값) 값마다 칸. 칸은 값 여러 개 또는 「문구 없음」(`empty`).
 *   모든 값이 정확히 한 칸 · default 칸 없음 · 칸 순서 = 열거형 순서(저장 때 맞춘다). 블록(`switchBlock` — 서 있는 자리의 목록: 항 · 호 · 목)과
 *   문장 안(`inlineSwitch` — 문장 안 조건과 같은 제약: 문장 안 조건 · 분기 안에 또 두지 못한다) 둘 다. 칸은 가지처럼 투명하다.
 *   지금은 함수조항 안에서만 연다 — 모양은 문면 노드에도 그대로 옮길 수 있게 가지(조건)와 같은 틀이다.
 * - 식(`slot.ref` · `when`)은 코드 기반 소스 문자열 — 파싱·추출은 expression 모듈.
 * - 항 · 호 · 목은 P코드(`code`)를 가진다 — 본문 안에서 공존하는 노드끼리 유일, 조건 가지 · switch 칸의 같은 자리는 코드를 공유한다
 *   (ADR-0072 결정 4 · 최종 결정 12, clause/pcode.ts).
 * - 노드 id 는 함수조항 하나 안(본문 + 모든 옵션 선택지 본문)에서 유일해야 한다 —
 *   인라인화(`expandClause`)가 `${참조노드id}/${원노드id}` 로 유일화하기 때문.
 *
 * DB·React import 금지 (순수층).
 */

import type { Code, Id, ReferenceConnector, RefRestrict } from "../types";

// ───────────────────────────── 인라인 ─────────────────────────────

/** 텍스트런. */
export interface TextNode {
  id: Id;
  kind: "text";
  text: string;
}

/** 값 치환 슬롯 — `ref` 는 식 참조 경로 문자열. 문면·함수조항은 구분자 코드만 찍는다 (ADR-0037). */
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
 * 조 참조 슬롯의 대상 — 모양은 `scope` 가 정한다 (기능/함수조항 §3.5 · ADR-0072 결정 3):
 * - 없음 : 보통약관 마스터의 조 `{ articleId }` · 그 조의 항 · 호 · 목 `{ articleId, code }`. 문맥과 무관하게 고정된다.
 * - `"clause"` : **이 함수조항 본문 안의** 항 · 호 · 목 `{ code }` — 「제1항에 따라」처럼 조째 함수조항이 제 항을 가리킨다.
 *   조건 가지 · 값별 분기 칸의 같은 자리는 코드를 공유해 어느 칸이 서든 산다. 펼치면 사용처 조의 (참조 노드 코드, 이 코드)로 바뀌어 사용처 번호로 찍힌다.
 * - `"host"` : **사용처 문서의** 위치 `{ host: "2.1" }` (`"1"` · `"2.1"` · `"2.1.3"` — 사용처의 n번째 조 · 그 조의 m번째 항 · k번째 호).
 *   「제1조(보험금의 지급사유)에서 정한」처럼 조째 함수조항이 사용처의 지급사유 조를 가리킨다. 조립이 사용처 트리에서 대상으로 푼다.
 */
export interface ClauseRefTarget {
  articleId?: Id;
  code?: Code;
  host?: string;
  /** 보통약관의 펼친 함수조항 안 노드 — `code` 가 그 함수조항 블록 참조 (문면 `RefTarget.innerCode` 와 같다, ADR-0077 결정 6). */
  innerCode?: Code;
  /** 값 한정 — 해당 값들만(함수조항 본문에는 반복이 없어 「현재 값」은 저장 검사가 거부한다, ADR-0077 결정 7). */
  restrict?: RefRestrict;
}

/** 조 참조 슬롯 — 대상을 저장하고 렌더 시 계산된 번호를 찍는다. */
export interface ArticleRefNode {
  id: Id;
  kind: "articleRef";
  targets: ClauseRefTarget[];
  /** 기본값 없음 — 대상이 둘 이상이면 필수 (결정 14 · 문서의 `ArticleRefNode.connector` 와 같은 규칙). */
  connector?: ReferenceConnector;
  scope?: ClauseRefScope;
}

/** 함수조항 조 참조의 범위 — 없으면 보통약관 마스터. */
export type ClauseRefScope = "clause" | "host";

/** 사용처 위치 경로 — `조[.항[.호[.목]]]` 순번(1부터). */
export const HOST_PATH = /^[1-9]\d*(\.[1-9]\d*){0,3}$/;

/** 별표 참조 슬롯 — 별표 불변 코드. 번호는 책자별 계산값. */
export interface AppendixRefNode {
  id: Id;
  kind: "appendixRef";
  appendixCode: Code;
}

/** 옵션 자리 — 사용처가 고른 선택지(OptionValue)의 본문이 이 자리에 들어간다 (기능/함수조항 §3.2). */
export interface OptionSlotNode {
  id: Id;
  kind: "optionSlot";
  optionCode: Code;
}

/**
 * 값별 분기의 칸 — 값 코드 여러 개(열거형 순서), 또는 「문구 없음」(`empty` — 본문 없음을 명시). 본문은 서 있는 자리의 목록이다(투명).
 * 지운 열거값 코드는 칸에 남아 「없는 값」 오류가 된다(조용히 지우지 않는다 — ADR-0078 결정 5).
 */
export interface SwitchCase<C> {
  id: Id;
  values: Code[];
  empty?: true;
  children: C[];
}

/** 문장 안 값별 분기 — 칸 본문은 문장 조각. 문장 안 조건 · 분기 안에 둘 수 없고, 칸 안에도 그것들을 둘 수 없다. */
export interface InlineSwitchNode {
  id: Id;
  kind: "inlineSwitch";
  /** 대상 식 — 인자 · 내부 변수 하나(`arg.사유` · `var.X`), 목록값(enum) 타입. */
  on: string;
  cases: SwitchCase<Inline>[];
}

export type Inline =
  | TextNode
  | SlotNode
  | InlineCondNode
  | InlineSwitchNode
  | ArticleRefNode
  | AppendixRefNode
  | OptionSlotNode;

export type InlineKind = Inline["kind"];

// ───────────────────────────── 블록 ─────────────────────────────

/** 목. */
export interface SubitemNode {
  id: Id;
  kind: "subitem";
  /** P코드 — 함수조항 본문 안에서 공존하는 노드끼리 유일 (ADR-0072 · clause/pcode.ts). 없으면 저장 때 채운다. */
  code?: Code;
  children: Inline[];
}

/** 호. */
export interface ItemNode {
  id: Id;
  kind: "item";
  /** P코드 (ADR-0072). */
  code?: Code;
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
  /** P코드 (ADR-0072). */
  code?: Code;
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

/** 값별 분기 (블록) — 항 자리에 선다. 칸 본문은 항 목록(투명). 조건 블록 · 분기와 서로 중첩할 수 있다. */
export interface SwitchBlockNode {
  id: Id;
  kind: "switchBlock";
  on: string;
  cases: SwitchCase<Block>[];
}

export type Block = ParagraphNode | CondBlockNode | SwitchBlockNode | BulletListNode | BoxRefNode;

export type BlockKind = Block["kind"];

// ───────────────────────────── 호 · 목 유형 본문 (최종 결정 4) ─────────────────────────────

/** 항의 호 목록 한 자리 — 호 · 글머리 목록 · 박스 참조 (항 `items` 와 같다). */
export type ItemListNode = ItemNode | BulletListNode | BoxRefNode;

/** 호 목록 자리의 조건 블록 — 가지 안도 호 목록이다(서 있는 자리를 따른다). 중첩 허용. */
export interface ItemCondBlockNode {
  id: Id;
  kind: "condBlock";
  branches: ItemBranch[];
}

export interface ItemBranch {
  id: Id;
  when?: string;
  children: ItemBodyNode[];
}

/** 호 목록 자리의 값별 분기 — 칸 본문도 호 목록이다. */
export interface ItemSwitchBlockNode {
  id: Id;
  kind: "switchBlock";
  on: string;
  cases: SwitchCase<ItemBodyNode>[];
}

/** 「호」 유형 본문의 한 자리 — 호 목록(list<호>). 사용처 항의 호 목록 자리에 펼쳐지고 번호는 사용처에서 이어 매긴다. */
export type ItemBodyNode = ItemListNode | ItemCondBlockNode | ItemSwitchBlockNode;

/** 목 목록 자리의 조건 블록 — 가지 안도 목 목록이다. 중첩 허용. */
export interface SubitemCondBlockNode {
  id: Id;
  kind: "condBlock";
  branches: SubitemBranch[];
}

export interface SubitemBranch {
  id: Id;
  when?: string;
  children: SubitemBodyNode[];
}

/** 목 목록 자리의 값별 분기 — 칸 본문도 목 목록이다. */
export interface SubitemSwitchBlockNode {
  id: Id;
  kind: "switchBlock";
  on: string;
  cases: SwitchCase<SubitemBodyNode>[];
}

/** 「목」 유형 본문의 한 자리 — 목 목록(list<목>). 사용처 호의 목 목록 자리에 펼쳐진다. */
export type SubitemBodyNode = SubitemNode | SubitemCondBlockNode | SubitemSwitchBlockNode;

/** 함수조항 안에 나타날 수 있는 모든 노드. */
export type ClauseNode = Inline | Block | ItemNode | SubitemNode | BulletNode | ItemCondBlockNode | SubitemCondBlockNode | ItemSwitchBlockNode | SubitemSwitchBlockNode;

/** 값별 분기 노드(블록 · 문장 안) — 모양이 같아 걷는 쪽이 한 벌로 다룬다. */
export type AnySwitchNode = InlineSwitchNode | SwitchBlockNode | ItemSwitchBlockNode | SubitemSwitchBlockNode;

export type ClauseNodeKind = ClauseNode["kind"];

export const INLINE_KINDS: readonly InlineKind[] = [
  "text",
  "slot",
  "inlineCond",
  "inlineSwitch",
  "articleRef",
  "appendixRef",
  "optionSlot",
];

export const BLOCK_KINDS: readonly BlockKind[] = ["paragraph", "condBlock", "switchBlock", "bulletList", "boxRef"];
