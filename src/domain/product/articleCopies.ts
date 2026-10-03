/**
 * 조 사본 (ADR-0079 · 기능/상품 §3.10) — 상품 보통약관 탭에서 고친 템플릿 조는 **이 상품만의 사본**이 된다. 순수.
 *
 * - 사본 = 템플릿 조 하나(그 조 노드의 하위 트리 전부)를 통째로 갈아 끼울 내용. 자리는 템플릿 조 id 다 — 구조 · 순서 · 번호는 템플릿을 따른다.
 *   고치지 않은 조는 템플릿을 그대로 따라간다(템플릿을 고치면 바로 보인다). 상품 전용 새 조 · 순서 바꾸기는 없다.
 * - 사본은 만들 때의 템플릿 조 지문(`templateHash`)을 함께 든다. 지금 템플릿 조 지문과 다르면 「템플릿이 바뀜」(stale, 노랑)이다 —
 *   자동으로 합치지 않는다. 화면이 나란히 보여 주고 「템플릿대로 되돌리기」 · 「사본 유지」(지문만 새로)를 고른다.
 * - 지문은 키 순서와 무관한 직렬화(`stableStringify`)의 53비트 해시 — jsonb 왕복이 키 순서를 바꿔도 같은 내용이면 같다.
 *   변경 감지용이지 보안용이 아니다.
 */
import { indexTree, type ArticleNode, type BlockNode, type DocumentNode, type SectionNode } from "../document/nodes";
import type { Id } from "../types";

/** 상품의 조 사본 한 건 — 자리(템플릿 조 id) · 내용 · 만들 때(또는 「사본 유지」 때)의 템플릿 조 지문. */
export interface ArticleCopy {
  articleId: Id;
  article: ArticleNode;
  templateHash: string;
}

/** 사본 표시 — `copied` 빨강(템플릿과 다른 본문) · `stale` 노랑(사본을 만든 뒤 템플릿의 같은 조가 바뀜). */
export type ArticleCopyState = "copied" | "stale";

/** 키를 정렬한 JSON — `undefined` 값의 키는 뺀다(JSON · jsonb 와 같은 뜻). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** cyrb53 — 53비트 비암호 해시, 14자리 16진수. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** 조 하나의 내용 지문 — 제목 · 본문 · 하위 노드 id 까지. */
export function articleHash(article: ArticleNode): string {
  return cyrb53(stableStringify(article));
}

/** 내용이 같은 조인가 (키 순서 무관). */
export function sameArticle(a: ArticleNode, b: ArticleNode): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** 트리의 조 — 관 · 조건 블록 가지 안까지, 문서 순. */
export function articlesById(tree: DocumentNode): Map<Id, ArticleNode> {
  const out = new Map<Id, ArticleNode>();
  for (const e of indexTree(tree).nodes.values()) if (e.node.kind === "article") out.set(e.node.id, e.node);
  return out;
}

/** 조 자리(문서 · 관 · 조 자리의 조건 블록 가지)에서 사본이 있는 조를 갈아 끼운다. 조 안으로는 내려가지 않는다(조 안에 조는 없다). */
function replaceArticles(nodes: readonly BlockNode[], copies: ReadonlyMap<Id, ArticleNode>): BlockNode[] {
  return nodes.map((n): BlockNode => {
    if (n.kind === "article") {
      const copy = copies.get(n.id);
      return copy ? { ...copy, id: n.id } : n;
    }
    if (n.kind === "section") return { ...n, children: replaceArticles(n.children, copies) as SectionNode["children"] };
    if (n.kind === "condBlock") return { ...n, branches: n.branches.map((br) => ({ ...br, children: replaceArticles(br.children, copies) })) };
    return n;
  });
}

/**
 * 템플릿 트리 + 조 사본 → 이 상품의 보통약관 트리. 템플릿에 없는 조의 사본은 쓰이지 않는다(조가 템플릿에서 지워졌다).
 * 사본이 없으면 템플릿 트리를 그대로 돌려준다.
 */
export function applyArticleCopies(tree: DocumentNode, copies: Iterable<Pick<ArticleCopy, "articleId" | "article">> | ReadonlyMap<Id, ArticleNode>): DocumentNode {
  const byId = copies instanceof Map ? (copies as ReadonlyMap<Id, ArticleNode>) : new Map([...(copies as Iterable<Pick<ArticleCopy, "articleId" | "article">>)].map((c) => [c.articleId, c.article] as const));
  if (byId.size === 0) return tree;
  return { ...tree, children: replaceArticles(tree.children, byId) as DocumentNode["children"] };
}

/** 템플릿에 자리가 남은 사본만 — 템플릿에서 조가 지워졌으면 그 사본은 쓰이지 않으므로 버린다(다음 저장에서 지워진다). */
export function liveArticleCopies<C extends Pick<ArticleCopy, "articleId">>(tree: DocumentNode, copies: readonly C[]): C[] {
  const ids = articlesById(tree);
  return copies.filter((c) => ids.has(c.articleId));
}

/** 사본마다 표시 — 템플릿에 자리가 없는 사본은 싣지 않는다. 순서는 사본 목록 순. */
export function articleCopyStates(tree: DocumentNode, copies: readonly Pick<ArticleCopy, "articleId" | "templateHash">[]): Map<Id, ArticleCopyState> {
  const articles = articlesById(tree);
  const out = new Map<Id, ArticleCopyState>();
  for (const c of copies) {
    const a = articles.get(c.articleId);
    if (a) out.set(c.articleId, articleHash(a) === c.templateHash ? "copied" : "stale");
  }
  return out;
}

/**
 * 편집 명령이 그 조 안만 바꿨는가 — 조 사본 편집의 안전망. 조를 더하거나 · 지우거나 · 옮기거나 · 감싸거나 · 다른 조를 고치면 false.
 * 판정: 바뀐 트리의 그 조를 원래 트리에 갈아 끼운 것이 바뀐 트리와 같아야 한다.
 */
export function articleOnlyChange(before: DocumentNode, after: DocumentNode, articleId: Id): boolean {
  const changed = articlesById(after).get(articleId);
  if (!changed || !articlesById(before).has(articleId)) return false;
  return stableStringify(applyArticleCopies(before, [{ articleId, article: changed }])) === stableStringify(after);
}
