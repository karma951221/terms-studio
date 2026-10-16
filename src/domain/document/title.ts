/**
 * 조 제목 = 인라인 노드 목록 (ADR-0088 결정 1 ① · 5 · 6, ADR-0072 결정 2a · 기능/문면 §3.12). 순수.
 *
 * - 옛 글 제목은 읽을 때 [글 하나]로 이행한다(`normalizeTitle` · `withInlineTitles`) — 트리는 jsonb 한 덩어리라 마이그레이션이 없고
 *   다음 저장부터 새 모양이다. 이행한 글의 id 는 조 id 에서 짓는다(`<조id>.title`) — 같은 트리를 몇 번 읽어도 같은 id 다.
 * - 제목에 서는 인라인은 글 · 인라인 조건 · 인라인 반복 · 슬롯 · 조사(`TITLE_INLINE`). 제목 안 조건 가지 · 반복 본문 · 「비었을 때」 칸도 같은 집합이다.
 *   조 참조 · 별표 참조 · 문장 안 함수조항 · 구조 표기는 색인(`indexTree`)이 저장 오류로 막는다.
 * - 모델링 · 편집 화면은 전부 제목을 자리 말로 접어 한 줄로 편다(`foldTitle`) — 문면 편집기의 목차 · 대상 고르기 · 경로 · 참조 칩 · 관계정보,
 *   상품이 정해진 화면(상품 보통약관 탭의 목차 · 모델링 패널 · 조 사본 편집기)도 (2026-10-17 사용자 결정). 실제 글은 조립(그 상품 문맥으로 푼 글)과 미리보기에서 본다.
 */
import type { EnumDef } from "../catalog/types";
import type { MasterTree } from "../master";
import type { Code, Id } from "../types";
import { repeatLabel } from "./blockRepeat";
import { particlePreset } from "./particles";
import type { ArticleNode, BlockNode, DocumentNode, InlineNode, NodeKind } from "./nodes";

/** 조 제목 자리의 허용 인라인 (ADR-0088 결정 5). 제목 안 인라인 조건 가지 · 인라인 반복 본문 · 「비었을 때」 칸도 같은 집합이다(반복은 한 겹). */
export const TITLE_INLINE: readonly NodeKind[] = ["text", "slot", "inlineCond", "inlineFor", "particle"];

/** 제목 자리에 설 수 없는 인라인의 저장 오류 문구. */
export function titleKindMessage(kind: NodeKind): string {
  const what: Partial<Record<NodeKind, string>> = {
    articleRef: "조 참조",
    appendixRef: "별표 참조",
    clauseInlineRef: "문장 안 함수조항",
    structKey: "구조 표기",
  };
  return `조 제목에는 글 · 문장 안 조건 · 문장 안 반복 · 치환 슬롯 · 조사만 둘 수 있습니다 — ${what[kind] ?? kind} 은(는) 넣을 수 없습니다`;
}

/** 이행한 제목 글의 id — 조 id 에서 짓는다. */
export function titleTextId(articleId: Id): Id {
  return `${articleId}.title`;
}

/** 글 제목 → [글 하나]. 빈 글은 빈 목록. */
export function titleNodes(text: string, articleId: Id): InlineNode[] {
  return text === "" ? [] : [{ id: titleTextId(articleId), kind: "text", text }];
}

/** 저장 · 입력에서 읽은 제목 — 옛 글이면 [글 하나], 새 모양(배열)이면 그대로. 그 밖은 빈 제목. */
export function normalizeTitle(raw: unknown, articleId: Id): InlineNode[] {
  if (Array.isArray(raw)) return raw as InlineNode[];
  return typeof raw === "string" ? titleNodes(raw, articleId) : [];
}

/** 조 하나의 제목을 이행한다 — 이미 새 모양이면 같은 객체. */
export function normalizeArticle(article: ArticleNode): ArticleNode {
  const raw: unknown = article.title;
  return Array.isArray(raw) ? article : { ...article, title: normalizeTitle(raw, article.id) };
}

/**
 * 문서 트리의 조 제목을 모두 이행한다 — 조 자리(문서 · 관 · 조 자리 조건 블록 가지)만 본다(조 안에 조는 없다).
 * 바뀐 것이 없으면 같은 트리를 돌려준다. 문서 · 관 제목은 글 그대로다.
 */
export function withInlineTitles(doc: DocumentNode): DocumentNode {
  let changed = false;
  const visit = (list: readonly BlockNode[]): BlockNode[] =>
    list.map((n): BlockNode => {
      if (n.kind === "article") {
        const next = normalizeArticle(n);
        if (next !== n) changed = true;
        return next;
      }
      if (n.kind === "section") return { ...n, children: visit(n.children) as typeof n.children };
      if (n.kind === "condBlock") return { ...n, branches: n.branches.map((br) => ({ ...br, children: visit(br.children) })) };
      return n;
    });
  const children = visit(doc.children) as DocumentNode["children"];
  return changed ? { ...doc, children } : doc;
}

/** 글로만 된 제목(작업용 글자색 없음)이면 그 글 — 칩 · 색이 끼면 undefined. 옛 글 제목과 같은 뜻인지 가르는 데 쓴다. */
export function textOnlyTitle(title: readonly InlineNode[]): string | undefined {
  let out = "";
  for (const n of title) {
    if (n.kind !== "text" || n.mark !== undefined) return undefined;
    out += n.text;
  }
  return out;
}

/**
 * 제목 노드의 id 를 새 조 id 에서 전위 순(노드 · 가지)으로 다시 짓는다 — `<조id>.title`, `<조id>.title1`, … .
 * 조 복제 · 사본이 제목 노드에 문서 id 공급원을 쓰지 않게 한다(브라우저 · 서버가 같은 id 를 얻는다). 원본은 건드리지 않는다.
 */
export function relabelTitle(title: readonly InlineNode[], articleId: Id): InlineNode[] {
  let k = 0;
  const next = () => `${titleTextId(articleId)}${k++ === 0 ? "" : k - 1}`;
  const walk = (list: readonly InlineNode[]): InlineNode[] =>
    list.map((n): InlineNode => {
      const id = next();
      if (n.kind === "inlineCond") return { ...n, id, branches: n.branches.map((br) => ({ ...br, id: next(), children: walk(br.children) })) };
      if (n.kind === "inlineFor") {
        const children = walk(n.children);
        return { ...structuredClone(n), id, children, ...(n.fallback ? { fallback: walk(n.fallback) } : {}) };
      }
      return { ...structuredClone(n), id };
    });
  return walk(title);
}

/** 내장 슬롯 경로의 화면 이름 — 슬롯 고르기의 「현재 종」 묶음과 같은 말. */
const BUILTIN_SLOT_LABEL: Record<string, string> = {
  "builtin.plan.name": "종형명",
  "builtin.plan.number": "선택지 번호",
};

export interface FoldOptions {
  /** 슬롯 경로 → 이름(구분자 표시명 등). 모르면 undefined — 내장 이름 · 경로 그대로. */
  slotLabel?: (ref: string) => string | undefined;
  /** 인라인 반복 이름을 짓는 열거형(합집합 거름 필드 이름) · 마스터. 없으면 필드 키 · MVP 정본. */
  enumOf?: (code: Code) => EnumDef | undefined;
  master?: MasterTree;
}

/**
 * 모델링 · 편집 화면의 제목 한 줄 (ADR-0088 결정 6 — 상품이 정해진 화면도) — 글은 그대로, 슬롯은 「〔슬롯 이름〕」, 인라인 반복은 「〔반복 이름〕」(별칭 또는
 * 블록 반복 줄 머리와 같은 이름 짓기 — 「〔납입면제사유마다〕」), 인라인 조건은 첫 가지의 글(안도 같은 규칙),
 * 조사는 칩 표기(「을/를」). 제목에 서지 않는 칩(옛 · 손으로 짠 트리)은 「〔칩 이름〕」.
 */
export function foldTitle(title: readonly InlineNode[], opts: FoldOptions = {}): string {
  return title.map((n) => foldOne(n, opts)).join("");
}

function foldOne(n: InlineNode, opts: FoldOptions): string {
  switch (n.kind) {
    case "text":
      return n.text;
    case "slot":
      return `〔${opts.slotLabel?.(n.ref) ?? BUILTIN_SLOT_LABEL[n.ref] ?? n.ref}〕`;
    case "inlineCond":
      return foldTitle(n.branches[0]?.children ?? [], opts);
    case "particle":
      return particlePreset(n.preset)?.label ?? "";
    case "inlineFor":
      return `〔${n.alias ?? repeatLabel(n.source, { ...(opts.master ? { master: opts.master } : {}), ...(opts.enumOf ? { enumOf: opts.enumOf } : {}) })}〕`;
    case "articleRef":
      return "〔조 참조〕";
    case "appendixRef":
      return "〔별표 참조〕";
    case "clauseInlineRef":
      return "〔함수조항〕";
    case "structKey":
      return "〔구조 표기〕";
  }
}
