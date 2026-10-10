/**
 * 문면 저작 화면 미리보기 — 고른 상품의 조립 문맥으로 **조 하나** (기능/문면 §3.9, 2026-10-10).
 *
 * 조립과 같은 결과여야 하므로 조립 함수를 그대로 부르고 그 조만 꺼낸다 — 규칙을 따로 두지 않는다.
 * - 담보약관: 넘긴 트리(편집본)를 그 담보의 문서 자리에 끼워 `assembleSpecial` (그 상품담보 문맥 · 그 특약 한 벌 번호).
 *   기본계약 상품담보는 특약으로 찍히지 않으므로(보통약관 조를 대치한다) 미리보기 대상이 아니다.
 * - 보통약관: 넘긴 트리를 그 상품의 보통약관 자리에 끼워 `assembleGeneral` (기본계약 문맥 · 조 사본 · 노출 끔 · 대치 그대로).
 * - 조립이 그 조를 내지 않으면 까닭 하나 — 생략 판정(보통약관 조와 같음) · 노출 끔 · 그 밖(조건으로 빠짐 · 빈 조).
 */
import type { DocumentNode } from "../document/nodes";
import type { Id, Issue } from "../types";
import { assembleGeneral, assembleSpecial } from "./booklet";
import type { MasterBundle, ProductInput, RenderedArticle, RenderedDoc } from "./types";

export type ArticlePreviewTarget =
  /** 담보약관 — 미리보기할 상품담보(특약 탑재분)와 조립할 트리(편집 중이면 편집본). */
  | { document: "special"; productCoverageId: Id; tree: DocumentNode }
  /** 보통약관 — 상품의 보통약관 자리에 끼울 트리. */
  | { document: "general"; tree: DocumentNode };

export type ArticlePreview =
  | {
      kind: "shown";
      article: RenderedArticle;
      /** 그 조 자리의 조립 오류 · 경고 (본문 표식이 없는 것까지). */
      issues: Issue[];
      /** 보통약관 조가 기본계약 조로 대치됐으면 그 기본계약 상품담보 이름. */
      replacedByBase?: string;
      /** 상품이 이 조의 사본을 쓴다 (ADR-0079). */
      articleCopy?: true;
    }
  | { kind: "dropped"; reason: "omitted"; linkedArticleTitle: string }
  | { kind: "dropped"; reason: "hidden" | "notEmitted" }
  | { kind: "unavailable"; message: string };

function articleIn(doc: RenderedDoc | undefined, id: Id): RenderedArticle | undefined {
  for (const c of doc?.children ?? []) {
    if (c.kind === "article" && c.id === id) return c;
    if (c.kind === "section") for (const a of c.children) if (a.kind === "article" && a.id === id) return a;
  }
  return undefined;
}

const issuesOf = (issues: readonly Issue[], articleId: Id) => issues.filter((i) => i.at.articleId === articleId);

/** 넘긴 트리로 조 하나를 조립한다 — 결정적 · 순수. 같은 재료면 책자의 같은 조와 같다. */
export function previewArticle(master: MasterBundle, product: ProductInput, target: ArticlePreviewTarget, articleId: Id): ArticlePreview {
  if (target.document === "special") {
    const pc = product.coverages.find((c) => c.snapshot.id === target.productCoverageId);
    if (!pc) return { kind: "unavailable", message: "그 상품담보를 찾을 수 없다" };
    if (product.product.baseContractIds.includes(pc.snapshot.id)) return { kind: "unavailable", message: "기본계약 상품담보는 특약으로 찍히지 않는다 — 보통약관 조를 대치한다" };
    const specialDocuments = new Map(master.specialDocuments);
    specialDocuments.set(pc.snapshot.coverageId, target.tree);
    const r = assembleSpecial({ ...master, specialDocuments }, product, pc.snapshot.id);
    if (!r.ok) return { kind: "unavailable", message: "조립하지 못했다" };
    const article = articleIn(r.value.doc, articleId);
    if (article) return { kind: "shown", article, issues: issuesOf(r.value.issues, articleId) };
    const omitted = r.value.omitted.find((o) => o.articleId === articleId && o.disposition === "omitted");
    if (omitted) {
      const linked = articleIn(r.value.general, omitted.linkedArticleId);
      return { kind: "dropped", reason: "omitted", linkedArticleTitle: linked ? `${linked.label}(${linked.title})` : omitted.articleTitle };
    }
    return { kind: "dropped", reason: "notEmitted" };
  }

  const generalId = product.product.generalDocumentId;
  if (generalId === undefined) return { kind: "unavailable", message: "이 상품은 보통약관 템플릿을 고르지 않았다" };
  const generalDocuments = new Map(master.generalDocuments);
  generalDocuments.set(generalId, target.tree);
  const r = assembleGeneral({ ...master, generalDocuments }, product);
  if (!r) return { kind: "unavailable", message: "조립하지 못했다" };
  if (product.product.hiddenArticleIds.has(articleId)) return { kind: "dropped", reason: "hidden" };
  const article = articleIn(r.doc, articleId);
  if (!article) return { kind: "dropped", reason: "notEmitted" };
  const base = r.replaced.get(articleId);
  return {
    kind: "shown",
    article,
    issues: issuesOf(r.issues, articleId),
    ...(base !== undefined ? { replacedByBase: base } : {}),
    ...(base === undefined && product.product.articleCopies?.has(articleId) ? { articleCopy: true as const } : {}),
  };
}
