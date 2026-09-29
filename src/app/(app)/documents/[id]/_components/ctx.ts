/**
 * L3 저작 화면이 렌더에 쓰는 문맥 — 편집기(`DocumentEditor`)가 한 번 만들어 목차 · 본문 · 우측 패널 · 팝업이 나눠 쓴다.
 * 규칙 없음. 표시명 해소(공용조항 · 별표 · 조 참조)와 조작 콜백만 든다.
 *
 * ADR-0074: 조작은 전부 편집본에 명령을 적용할 뿐 서버로 가지 않는다. 가운데 본문이 그 자리 편집기다 —
 * 문장 · 제목 · 조건 머리 줄은 그 자리에서 고치고(초점이 떠나면 편집본에), 칩은 누르면 바로 아래에 팝업, 넣기 · 조작은 본문 위 툴바(오른쪽 클릭 메뉴는 지름길).
 */
import type { MouseEvent } from "react";

import type { ReactNode } from "react";

import type { Clause } from "@/domain/clause";
import type { BranchEvaluation, EditOp, InlineAt, InlineNode, NodeNumber, ReferenceTarget, SlotEvaluation, TableEvaluation } from "@/domain/document";
import { format, parse, type DisplayName } from "@/domain/expression";
import type { Box } from "@/domain/document/box";
import type { Code, Id } from "@/domain/types";

import type { ConditionContext } from "./condition/types";
import type { Token } from "./inlineRuns";
import type { MenuItem, PopupSpec } from "./menus";

export type DocMode = "read" | "edit";

/** 팝업 · 메뉴가 뜨는 자리 — 화면 좌표. `y` 는 그 아래 가장자리(팝업은 바로 아래에 뜬다), `top` 은 위 가장자리(아래가 모자라면 위로). */
export interface Anchor {
  x: number;
  y: number;
  top?: number;
}

export function anchorOf(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom, top: r.top };
}

/** 표 셀 좌표. */
export interface CellAt {
  tableId: Id;
  row: number;
  col: number;
}

export interface DocCtx {
  documentId: Id;
  docKind: "special" | "general";
  mode: DocMode;
  numbers: ReadonlyMap<Id, NodeNumber>;
  /** 사전평가 결과 — 있으면 안 탄 가지를 톤다운한다. */
  branchEval?: ReadonlyMap<Id, BranchEvaluation>;
  slotEval?: ReadonlyMap<Id, SlotEvaluation>;
  /**
   * 반복 표 펼침 결과 (ADR-0070 결정 6) — 미리보기(사전평가)의 결과 조문에서만 준다. 있으면 반복 표는 펼친 행으로,
   * 행 0 이면 「표 생략됨」 자리로 그린다. 없으면 템플릿(for 띠) 그대로.
   */
  tables?: ReadonlyMap<Id, TableEvaluation>;
  /** 별표 코드 → 이름. */
  appendixName: ReadonlyMap<Code, string>;
  /** 공용조항 코드 → 표시명. */
  clauseLabel: ReadonlyMap<Code, string>;
  /** 공용조항 옵션 선택 → 「소멸 사유: 사망」. */
  optionText: (clauseCode: Code, options: Record<Code, Code>) => string;
  references: { self: ReadonlyMap<Id, ReferenceTarget>; general: ReadonlyMap<Id, ReferenceTarget> };
  /** 조건식 칩이 구분자 코드 대신 표시명(`+@노드 이름`)을 찍게 하는 훅 — `condition/display.ts` 의 것과 같다. */
  refLabel?: DisplayName;
  /** 「고칠 자리로」 · 좌표 링크로 잠깐 강조할 노드. */
  flashId?: Id;
  /** 편집 모드에서만 있다. */
  edit?: EditHandlers;
  /**
   * 칩 모양을 화면이 바꿔 그리는 훅 — 공용조항 화면이 옵션 자리 운반체(`clauseInlineRef` · `option:O01`)를 「〔옵션명〕」으로 그린다.
   * undefined 를 돌려주면 기본 모양. `what` 은 편집 모드 tooltip 의 칩 이름.
   */
  chipOverride?: (node: InlineNode) => { className: string; title: string; body: ReactNode; what: string } | undefined;
  /**
   * 조 참조 팝업의 범위를 화면이 정한다 — 공용조항 에디터: 보통약관 · 이 공용조항 · 사용처(기능/공용조항 §3.5).
   * 있으면 이 목록이 범위 고르기가 되고, 고른 범위의 후보만 트리에 선다. 없으면 문면 규칙(담보약관: 이 템플릿 · 대응 보통약관).
   */
  articleRefChoices?: readonly ArticleRefChoice[];
  /** 조건 머리 줄의 변수 목록 문맥 — 노드(가지 · 조건 블록) 자리대로(반복 표 안이면 「현재 행」). 편집 모드에서만 쓴다. */
  conditionFor?: (nodeId: Id) => ConditionContext;
  /** 공용조항 블록이 본문을 그리는 재료 — 코드로 찾는다. 없으면 이름만. */
  clauses?: readonly Clause[];
  /** 정적 마스터 박스 조회 — 박스 참조를 내용째 그린다(공용조항 블록 안도). 없으면 코드만. */
  boxOf?: (code: Code) => Box | undefined;
  /**
   * 공용조항 블록 안을 무엇으로 그리나 — 기본은 **모델**(슬롯 · 옵션 자리 · 조건 · 참조, `ClauseModel`),
   * `"text"` 는 고른 선택지 문구를 끼운 문장(미리보기 · 사전평가 결과). 가운데 = 모델, 오른쪽 = 결과 (2026-09-28).
   */
  clauseView?: "model" | "text";
}

/** 가운데 편집기의 조작 — 편집 모드에서만 준다. */
export interface EditHandlers {
  /** 편집본에 명령을 적용한다 — 거부되면 사유 배너, 편집본은 그대로. 적용되면 true. */
  apply: (ops: readonly EditOp[]) => boolean;
  /** 문장 칸을 마쳤다 — DOM 조각을 지금 목록과 맞춰 `setInlines`. 바뀐 것이 없으면 아무 일 없음. */
  commitInline: (at: InlineAt, tokens: readonly Token[]) => void;
  /** 문장 칸에서 Enter — 아래에 같은 종류(항 · 호 · 목)를 새로 넣고 커서를 옮긴다. */
  enter: (ownerId: Id) => void;
  /** 빈 문장 칸에서 Backspace — 그 항 · 호 · 목을 지운다(하위가 없을 때만). 지웠으면 true. */
  removeEmpty: (ownerId: Id) => boolean;
  /** 표 셀에 여러 칸짜리 글(엑셀)을 붙여넣었다 — 채웠으면 true. */
  pasteGrid: (cell: CellAt, text: string) => boolean;
  /** 조 · 관 · 문서 제목. */
  setTitle: (nodeId: Id, title: string) => void;
  setBox: (nodeId: Id, title: string, lines: string[]) => void;
  /** 그 자리에 팝업을 연다. */
  popup: (spec: PopupSpec, anchor: Anchor) => void;
  /** 문장 칸에 초점이 왔다 — 표 셀이면 셀 조작 줄을 그 셀에 띄운다. */
  focusInline: (at: InlineAt) => void;
  /** 셀 조작 줄이 떠 있는 셀. 행 · 열을 넣고 빼면 조작 줄이 옮겨 가거나(`setActiveCell`) 닫힌다. */
  activeCell?: CellAt;
  setActiveCell: (cell: CellAt | undefined) => void;
  /** 적용 직후 커서를 둘 노드(새 항 등) — 그 칸이 그려지면 초점을 가져가고 `focusDone` 을 부른다. */
  focusRequest?: Id;
  focusDone: () => void;
  /** 팝업 안의 문장 칸(문장 안 조건의 가지)도 같은 오른쪽 클릭 메뉴를 쓴다. */
  contextMenu: (event: MouseEvent<HTMLElement>) => void;
  /** 조건 머리 줄 끝의 작은 버튼(가지 추가 · ELSE · 풀기 · 가지 삭제 · 블록 삭제)이 쓰는 목록 — 툴바의 그 자리 목록과 같다. */
  headItems: (branchId: Id) => MenuItem[];
  /** 목록 항목 하나를 돌린다 — 툴바 · 오른쪽 클릭 메뉴와 같은 길. 공용조항 블록의 🗑 도 이 길(삭제 확인). */
  run: (item: MenuItem, anchor: Anchor) => void;
  /** 고른 잇닿은 형제 블록(끌어 옮기기 · 위로/아래로가 한꺼번에 옮긴다). 없으면 블록 손잡이도 없다 (`useBlockDrag`). */
  blockSel?: readonly Id[];
  /** 블록 손잡이를 눌렀다 — Shift 면 잇닿은 형제까지 늘린다. */
  selectBlock?: (id: Id, extend: boolean) => void;
}

/** 조건식 칩 글자 — 읽기 모드는 길면 자르고 전체는 tooltip 으로 준다 (디자인원칙 §2 L3). */
export function chipText(when: string | undefined, mode: DocMode, refLabel?: DisplayName): { text: string; full: string } {
  const full = when === undefined ? "그 밖의 경우 (else)" : when.trim() === "" ? "(조건 없음)" : displayOf(when, refLabel);
  if (mode === "edit" || full.length <= 56) return { text: full, full };
  return { text: `${full.slice(0, 56)}…`, full };
}

function displayOf(when: string, refLabel: DisplayName | undefined): string {
  if (!refLabel) return when;
  const parsed = parse(when);
  return parsed.ok ? format(parsed.value, refLabel) : when;
}

/** 문장 자리 → DOM `data-inline` 값 (오른쪽 클릭이 자리를 되읽는다). */
export function encodeAt(at: InlineAt): string {
  return "tableId" in at ? `cell:${at.tableId}:${at.row}:${at.col}` : `node:${at.parentId}`;
}

export function decodeAt(raw: string): InlineAt | undefined {
  const [kind, id, row, col] = raw.split(":");
  if (kind === "node" && id) return { parentId: id };
  if (kind === "cell" && id && row !== undefined && col !== undefined) return { tableId: id, row: Number(row), col: Number(col) };
  return undefined;
}

/** 조 참조 범위 하나 — 폼 값(`scope`)이 `host` 면 노드 범위는 `general`(대상 id 가 `host:` 로 시작한다 — clauseTree 의 운반 규칙). */
export interface ArticleRefChoice {
  value: "general" | "self" | "host";
  label: string;
  index: ReadonlyMap<Id, ReferenceTarget>;
  /** 조 줄 없이 항부터 (이 공용조항). */
  rootless?: boolean;
}
