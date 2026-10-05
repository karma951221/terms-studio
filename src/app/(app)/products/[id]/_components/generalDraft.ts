/**
 * 보통약관 탭의 편집 초안 — 조 노출 · 함수조항 옵션 오버라이드 · 조 사본 (기능/상품 §3.8 · §3.10 · §4.6, ADR-0079).
 *
 * 편집 중 고른 것은 이 초안에만 쌓이고 탭 첫 줄의 `저장` 한 번이 `saveGeneralSettings` 로 최종 상태를 보낸다.
 * 초안의 오버라이드는 서비스가 저장하는 모양(마스터와 **다른 키만**)으로 늘 정규화해 둔다 — 그래야 「마스터로 되돌리면
 * 변경이 아니다」 · 「키가 다 빠지면 자리 없음」을 저장 없이 판정한다. 조 사본도 같다 — 템플릿과 같은 내용으로 돌아오면 사본이 아니다.
 * 순수 함수만 둔다(React 없음).
 */
import type { ArticleNode } from "@/domain/document";
import { articleHash, sameArticle, type ArticleCopy, type ClauseOptionOverride } from "@/domain/product";
import type { Code, Id, Issue } from "@/domain/types";
import type { GeneralSettingsInput } from "@/services/product";

export interface OverrideDraft {
  clauseCode: Code;
  /** 마스터 기본과 다른 선택만. */
  options: Readonly<Record<Code, Code>>;
}

/** 조 사본 하나 — 내용 · 만들 때(또는 「사본 유지」 때)의 템플릿 조 지문. */
export interface CopyDraft {
  article: ArticleNode;
  templateHash: string;
}

export interface GeneralDraft {
  /** 숨긴 조 id — 숨긴 순. */
  hidden: readonly Id[];
  /** 함수조항 자리(노드 id) → 이 상품의 선택. 없으면 마스터 기본. */
  overrides: Readonly<Record<Id, OverrideDraft>>;
  /** 템플릿 조 id → 이 상품의 사본. 없으면 템플릿을 따른다. */
  copies: Readonly<Record<Id, CopyDraft>>;
}

export type GeneralDraftAction =
  | { type: "toggleArticle"; articleId: Id; shown: boolean }
  /** `value` 가 빈 값이거나 `base`(그 자리의 마스터 기본)와 같으면 그 옵션을 오버라이드에서 뺀다. */
  | { type: "setOption"; nodeId: Id; clauseCode: Code; optionCode: Code; value: Code; base: Readonly<Record<Code, Code>> }
  /** ↺ — 그 자리를 마스터 기본으로. */
  | { type: "resetNode"; nodeId: Id }
  /**
   * 조 편집 — `article` 이 그 조의 새 내용, `template` 은 지금 템플릿의 같은 조. 같은 내용이면 사본을 뺀다.
   * 지문은 처음 사본을 만들 때의 템플릿 조 지문을 지킨다 — 고쳤다고 「템플릿이 바뀜」을 조용히 지우지 않는다.
   */
  | { type: "editArticle"; article: ArticleNode; template: ArticleNode }
  /** 「템플릿대로 되돌리기」 — 사본을 버린다. */
  | { type: "revertArticle"; articleId: Id }
  /** 「사본 유지」 — 사본은 그대로, 지문만 지금 템플릿 조 지문으로(노랑이 사라진다). */
  | { type: "keepCopy"; articleId: Id; templateHash: string }
  | { type: "reset"; draft: GeneralDraft };

export function initGeneralDraft(hidden: readonly Id[], overrides: readonly ClauseOptionOverride[], copies: readonly ArticleCopy[] = []): GeneralDraft {
  return {
    hidden: [...hidden],
    overrides: Object.fromEntries(overrides.map((o) => [o.nodeId, { clauseCode: o.clauseCode, options: { ...o.options } }])),
    copies: Object.fromEntries(copies.map((c) => [c.articleId, { article: c.article, templateHash: c.templateHash }])),
  };
}

function without<T>(record: Readonly<Record<Id, T>>, id: Id): Readonly<Record<Id, T>> {
  const { [id]: _gone, ...rest } = record;
  void _gone;
  return rest;
}

export function generalDraftReducer(state: GeneralDraft, action: GeneralDraftAction): GeneralDraft {
  switch (action.type) {
    case "toggleArticle": {
      const rest = state.hidden.filter((id) => id !== action.articleId);
      return { ...state, hidden: action.shown ? rest : [...rest, action.articleId] };
    }
    case "setOption": {
      const current = state.overrides[action.nodeId]?.options ?? {};
      const { [action.optionCode]: _old, ...rest } = current;
      void _old;
      const options = action.value === "" || action.base[action.optionCode] === action.value ? rest : { ...rest, [action.optionCode]: action.value };
      if (Object.keys(options).length === 0) return { ...state, overrides: without(state.overrides, action.nodeId) };
      return { ...state, overrides: { ...state.overrides, [action.nodeId]: { clauseCode: action.clauseCode, options } } };
    }
    case "resetNode":
      return { ...state, overrides: without(state.overrides, action.nodeId) };
    case "editArticle": {
      const id = action.template.id;
      if (sameArticle(action.article, action.template)) return state.copies[id] ? { ...state, copies: without(state.copies, id) } : state;
      const templateHash = state.copies[id]?.templateHash ?? articleHash(action.template);
      return { ...state, copies: { ...state.copies, [id]: { article: { ...action.article, id }, templateHash } } };
    }
    case "revertArticle":
      return state.copies[action.articleId] ? { ...state, copies: without(state.copies, action.articleId) } : state;
    case "keepCopy": {
      const copy = state.copies[action.articleId];
      return copy ? { ...state, copies: { ...state.copies, [action.articleId]: { ...copy, templateHash: action.templateHash } } } : state;
    }
    case "reset":
      return action.draft;
  }
}

function sameOptions(a: OverrideDraft | undefined, b: OverrideDraft | undefined): boolean {
  if (!a || !b) return a === b;
  const ka = Object.keys(a.options);
  return a.clauseCode === b.clauseCode && ka.length === Object.keys(b.options).length && ka.every((k) => a.options[k] === b.options[k]);
}

function sameCopy(a: CopyDraft | undefined, b: CopyDraft | undefined): boolean {
  if (!a || !b) return a === b;
  return a.templateHash === b.templateHash && sameArticle(a.article, b.article);
}

/** 저장된 것과 달라진 조(노출 · 사본) · 함수조항 자리 — 화면의 「변경」 표시와 「버립니까?」 판정의 재료. */
export function generalDraftChanges(saved: GeneralDraft, draft: GeneralDraft): { articles: Set<Id>; nodes: Set<Id> } {
  const was = new Set(saved.hidden);
  const now = new Set(draft.hidden);
  const articles = new Set([...was, ...now].filter((id) => was.has(id) !== now.has(id)));
  for (const id of new Set([...Object.keys(saved.copies), ...Object.keys(draft.copies)])) if (!sameCopy(saved.copies[id], draft.copies[id])) articles.add(id);
  const nodes = new Set([...Object.keys(saved.overrides), ...Object.keys(draft.overrides)].filter((id) => !sameOptions(saved.overrides[id], draft.overrides[id])));
  return { articles, nodes };
}

export function generalDraftDirty(saved: GeneralDraft, draft: GeneralDraft): boolean {
  const { articles, nodes } = generalDraftChanges(saved, draft);
  return articles.size + nodes.size > 0;
}

/** 초안의 사본 목록 — 조립 · 저장이 받는 모양. */
export function draftCopies(draft: GeneralDraft): ArticleCopy[] {
  return Object.entries(draft.copies).map(([articleId, c]) => ({ articleId, article: c.article, templateHash: c.templateHash }));
}

/** `저장` 이 보내는 최종 상태. `templateVersion` = 편집을 시작할 때 본 템플릿 판 (「템플릿이 바뀌었습니다」의 기준). */
export function toGeneralSettings(generalDocumentId: Id, draft: GeneralDraft, templateVersion?: number): GeneralSettingsInput {
  return {
    generalDocumentId,
    hiddenArticles: [...draft.hidden],
    overrides: Object.entries(draft.overrides).map(([nodeId, o]) => ({ nodeId, clauseCode: o.clauseCode, options: { ...o.options } })),
    copies: draftCopies(draft),
    ...(templateVersion !== undefined ? { templateVersion } : {}),
  };
}

/**
 * 저장 거부의 이슈를 고칠 자리로 나눈다 — 조는 목차 그 줄, 함수조항 자리는 그 상자 (CLAUDE.md 「실제 오류는 해당 항목과 수정 위치로」).
 * 조 사본 검사 오류(조 + 그 안 자리)는 목차 그 줄과 `copies`(조 편집 패널이 그 자리로 안내한다) 둘에.
 */
export function issuesByPlace(issues: readonly Issue[]): { articles: Map<Id, string[]>; nodes: Map<Id, string[]>; copies: Issue[]; other: string[] } {
  const articles = new Map<Id, string[]>();
  const nodes = new Map<Id, string[]>();
  const copies: Issue[] = [];
  const other: string[] = [];
  const push = (m: Map<Id, string[]>, id: Id, message: string) => m.set(id, [...(m.get(id) ?? []), message]);
  for (const i of issues) {
    const node = i.at.nodePath?.at(-1);
    if (i.at.articleId) {
      push(articles, i.at.articleId, i.message);
      if (node) copies.push(i);
    } else if (node) push(nodes, node, i.message);
    else other.push(i.message);
  }
  return { articles, nodes, copies, other };
}

/**
 * 깨진 참조가 남은 초안의 저장 거부 문구 (ADR-0081 결정 2) — 하나라도 남으면 서버에 보내지 않는다(서버도 같은 검사로 거부한다).
 * 없으면 undefined.
 */
export function refBreakRefusal(breaks: readonly Issue[]): string | undefined {
  return breaks.length > 0 ? `참조가 깨진 곳 ${breaks.length} — 조 편집 위 「깨지는 참조」 목록에서 고친 뒤 저장한다.` : undefined;
}
