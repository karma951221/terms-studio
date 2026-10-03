/**
 * 보통약관 탭의 편집 초안 — 조 노출 · 함수조항 옵션 오버라이드 (기능/상품 §3.8 · §4.6).
 *
 * 편집 중 고른 것은 이 초안에만 쌓이고 탭 첫 줄의 `저장` 한 번이 `saveGeneralSettings` 로 최종 상태를 보낸다.
 * 초안의 오버라이드는 서비스가 저장하는 모양(마스터와 **다른 키만**)으로 늘 정규화해 둔다 — 그래야 「마스터로 되돌리면
 * 변경이 아니다」 · 「키가 다 빠지면 자리 없음」을 저장 없이 판정한다. 순수 함수만 둔다(React 없음).
 */
import type { ClauseOptionOverride } from "@/domain/product";
import type { Code, Id, Issue } from "@/domain/types";
import type { GeneralSettingsInput } from "@/services/product";

export interface OverrideDraft {
  clauseCode: Code;
  /** 마스터 기본과 다른 선택만. */
  options: Readonly<Record<Code, Code>>;
}

export interface GeneralDraft {
  /** 숨긴 조 id — 숨긴 순. */
  hidden: readonly Id[];
  /** 함수조항 자리(노드 id) → 이 상품의 선택. 없으면 마스터 기본. */
  overrides: Readonly<Record<Id, OverrideDraft>>;
}

export type GeneralDraftAction =
  | { type: "toggleArticle"; articleId: Id; shown: boolean }
  /** `value` 가 빈 값이거나 `base`(그 자리의 마스터 기본)와 같으면 그 옵션을 오버라이드에서 뺀다. */
  | { type: "setOption"; nodeId: Id; clauseCode: Code; optionCode: Code; value: Code; base: Readonly<Record<Code, Code>> }
  /** ↺ — 그 자리를 마스터 기본으로. */
  | { type: "resetNode"; nodeId: Id }
  | { type: "reset"; draft: GeneralDraft };

export function initGeneralDraft(hidden: readonly Id[], overrides: readonly ClauseOptionOverride[]): GeneralDraft {
  return { hidden: [...hidden], overrides: Object.fromEntries(overrides.map((o) => [o.nodeId, { clauseCode: o.clauseCode, options: { ...o.options } }])) };
}

function withoutNode(overrides: GeneralDraft["overrides"], nodeId: Id): GeneralDraft["overrides"] {
  const { [nodeId]: _gone, ...rest } = overrides;
  void _gone;
  return rest;
}

export function generalDraftReducer(state: GeneralDraft, action: GeneralDraftAction): GeneralDraft {
  switch (action.type) {
    case "toggleArticle": {
      const without = state.hidden.filter((id) => id !== action.articleId);
      return { ...state, hidden: action.shown ? without : [...without, action.articleId] };
    }
    case "setOption": {
      const current = state.overrides[action.nodeId]?.options ?? {};
      const { [action.optionCode]: _old, ...rest } = current;
      void _old;
      const options = action.value === "" || action.base[action.optionCode] === action.value ? rest : { ...rest, [action.optionCode]: action.value };
      if (Object.keys(options).length === 0) return { ...state, overrides: withoutNode(state.overrides, action.nodeId) };
      return { ...state, overrides: { ...state.overrides, [action.nodeId]: { clauseCode: action.clauseCode, options } } };
    }
    case "resetNode":
      return { ...state, overrides: withoutNode(state.overrides, action.nodeId) };
    case "reset":
      return action.draft;
  }
}

function sameOptions(a: OverrideDraft | undefined, b: OverrideDraft | undefined): boolean {
  if (!a || !b) return a === b;
  const ka = Object.keys(a.options);
  return a.clauseCode === b.clauseCode && ka.length === Object.keys(b.options).length && ka.every((k) => a.options[k] === b.options[k]);
}

/** 저장된 것과 달라진 조 · 함수조항 자리 — 화면의 「변경」 표시와 「버립니까?」 판정의 재료. */
export function generalDraftChanges(saved: GeneralDraft, draft: GeneralDraft): { articles: Set<Id>; nodes: Set<Id> } {
  const was = new Set(saved.hidden);
  const now = new Set(draft.hidden);
  const articles = new Set([...was, ...now].filter((id) => was.has(id) !== now.has(id)));
  const nodes = new Set([...Object.keys(saved.overrides), ...Object.keys(draft.overrides)].filter((id) => !sameOptions(saved.overrides[id], draft.overrides[id])));
  return { articles, nodes };
}

export function generalDraftDirty(saved: GeneralDraft, draft: GeneralDraft): boolean {
  const { articles, nodes } = generalDraftChanges(saved, draft);
  return articles.size + nodes.size > 0;
}

/** `저장` 이 보내는 최종 상태. */
export function toGeneralSettings(generalDocumentId: Id, draft: GeneralDraft): GeneralSettingsInput {
  return {
    generalDocumentId,
    hiddenArticles: [...draft.hidden],
    overrides: Object.entries(draft.overrides).map(([nodeId, o]) => ({ nodeId, clauseCode: o.clauseCode, options: { ...o.options } })),
  };
}

/** 저장 거부의 이슈를 고칠 자리로 나눈다 — 조는 목차 그 줄, 함수조항 자리는 그 상자 (CLAUDE.md 「실제 오류는 해당 항목과 수정 위치로」). */
export function issuesByPlace(issues: readonly Issue[]): { articles: Map<Id, string[]>; nodes: Map<Id, string[]>; other: string[] } {
  const articles = new Map<Id, string[]>();
  const nodes = new Map<Id, string[]>();
  const other: string[] = [];
  const push = (m: Map<Id, string[]>, id: Id, message: string) => m.set(id, [...(m.get(id) ?? []), message]);
  for (const i of issues) {
    const node = i.at.nodePath?.at(-1);
    if (node) push(nodes, node, i.message);
    else if (i.at.articleId) push(articles, i.at.articleId, i.message);
    else other.push(i.message);
  }
  return { articles, nodes, other };
}
