/**
 * L3 저작 화면이 렌더에 쓰는 문맥 — 편집기(`DocumentEditor`)가 한 번 만들어 목차 · 본문 · 우측 패널이 나눠 쓴다.
 * 규칙 없음. 표시명 해소(공용조항 · 별표 · 조 참조)와 조작 콜백만 든다.
 *
 * ADR-0074: 선택 · 조작은 쿼리가 아니라 브라우저 상태다. 조작(`apply`)은 편집본에 명령을 적용할 뿐 서버로 가지 않는다.
 */
import type { BranchEvaluation, EditOp, NodeNumber, ReferenceTarget, SlotEvaluation, TableEvaluation } from "@/domain/document";
import { format, parse, type DisplayName } from "@/domain/expression";
import type { Code, Id } from "@/domain/types";

export type DocMode = "read" | "edit";

/** 고른 자리 — 노드(또는 가지) id, 표면 셀 좌표까지. */
export interface Selection {
  node?: Id;
  cell?: { row: number; col: number };
}

export interface DocCtx {
  documentId: Id;
  docKind: "special" | "general";
  mode: DocMode;
  /** 우측 패널에 실린 노드 또는 가지 id (편집 모드). */
  selectedId?: Id;
  numbers: ReadonlyMap<Id, NodeNumber>;
  /** 사전평가 결과 — 있으면 안 탄 가지를 톤다운한다. */
  branchEval?: ReadonlyMap<Id, BranchEvaluation>;
  slotEval?: ReadonlyMap<Id, SlotEvaluation>;
  /**
   * 반복 표 펼침 결과 (ADR-0070 결정 6) — 미리보기(사전평가)의 결과 조문에서만 준다. 있으면 반복 표는 펼친 행으로,
   * 행 0 이면 「표 생략됨」 자리로 그린다. 없으면 템플릿(for 띠) 그대로.
   */
  tables?: ReadonlyMap<Id, TableEvaluation>;
  /** 편집 모드에서 고른 표 셀. */
  selectedCell?: { tableId: Id; row: number; col: number };
  /** 별표 코드 → 이름. */
  appendixName: ReadonlyMap<Code, string>;
  /** 공용조항 코드 → 표시명. */
  clauseLabel: ReadonlyMap<Code, string>;
  /** 공용조항 옵션 선택 → 「소멸 사유: 사망」. */
  optionText: (clauseCode: Code, options: Record<Code, Code>) => string;
  references: { self: ReadonlyMap<Id, ReferenceTarget>; general: ReadonlyMap<Id, ReferenceTarget> };
  /** 자리를 고른다 — 우측 패널에 그 자리의 폼이 실린다. `undefined` 면 「템플릿 전체」. */
  select: (selection: Selection) => void;
  /** 편집본에 명령을 적용한다 — 거부되면 사유 배너, 편집본은 그대로. 적용되면 true. */
  apply: (ops: readonly EditOp[]) => boolean;
  /** 명령을 만들지 못했을 때 — 사유 배너. */
  fail: (message: string) => void;
  /** 같은 부모 안에서 한 칸 위/아래 (끝이면 아무 일 없음). */
  move: (nodeId: Id, dir: -1 | 1) => void;
  /** 삭제 확인 카드를 연다 (저장하면 사라진다). */
  askRemove: (nodeId: Id) => void;
  /** 조건식 칩이 구분자 코드 대신 표시명(`+@노드 이름`)을 찍게 하는 훅 — `condition/display.ts` 의 것과 같다. */
  refLabel?: DisplayName;
}

/** 조건식 칩 글자 — 읽기 모드는 길면 자르고 전체는 tooltip 으로 준다 (디자인원칙 §2 L3). */
export function chipText(when: string | undefined, mode: DocMode, refLabel?: DisplayName): { text: string; full: string } {
  const full = when === undefined ? "그 밖의 경우 (else)" : displayOf(when, refLabel);
  if (mode === "edit" || full.length <= 56) return { text: full, full };
  return { text: `${full.slice(0, 56)}…`, full };
}

function displayOf(when: string, refLabel: DisplayName | undefined): string {
  if (!refLabel) return when;
  const parsed = parse(when);
  return parsed.ok ? format(parsed.value, refLabel) : when;
}
