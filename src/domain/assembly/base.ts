/** 기본계약 1개 모드: 조연결된 기본계약 조의 해소·치환 결과로 보통약관 조 본문을 대치한다. */
import { refKey } from "../document/pcode";
import type { Id, Issue } from "../types";
import type { RArticle, SInline, SubstitutedDoc } from "./types";
import { articlesOf, mapArticles } from "./walk";

export interface BaseOwner {
  productCoverageId: Id;
  productCoverageName: string;
}

export interface BaseReplacementOutcome {
  doc: SubstitutedDoc;
  issues: Issue[];
  /**
   * 참조 열쇠 별칭 — 대치된 기본계약 조 id → 보통약관 조 id, 그 조의 항 · 호 · 목 `기본계약조#코드` → `보통약관조#기본계약조:코드`.
   * 대치된 조는 보통약관 조 id 에 기본계약 본문을 담고, 본문의 열쇠에는 기본계약 조 id 를 앞마디로 붙인다 — 보통약관 쪽 같은 코드(다른 항)와
   * 섞이지 않게(ADR-0072, 보통약관 항 → 기본계약 항은 자리 별칭 `positionAliases` 만). 기본계약 문면 안의 자기 조 참조를 렌더가 이걸로 푼다.
   */
  aliases: Map<string, string>;
}

/**
 * @param hidden 상품이 노출을 끈 보통약관 조 id → 조 명 (기능/상품 §3.6). 대치 대상이 이 중에 있으면 조용히 빠지지 않게 오류를 낸다.
 */
export function replaceGeneralWithBase(general: SubstitutedDoc, base: SubstitutedDoc, owner: BaseOwner, hidden?: ReadonlyMap<Id, string>): BaseReplacementOutcome {
  const replacements = new Map<Id, RArticle<SInline>>();
  const aliases = new Map<string, string>();
  const issues: Issue[] = [];
  const generalArticleIds = new Set(articlesOf(general).map((node) => node.id));
  for (const node of articlesOf(base)) {
    if (node.linkedArticleId === undefined) {
      issues.push({
        kind: "unlinkedBaseArticle",
        severity: "warning",
        message: `기본계약 조 「${node.title}」에 대응 보통약관 조가 연결되지 않아 출력하지 않습니다`,
        at: { document: "special", ownerId: owner.productCoverageId, ownerName: owner.productCoverageName, articleId: node.id, articleTitle: node.title },
      });
      continue;
    }
    const hiddenTitle = hidden?.get(node.linkedArticleId);
    if (hiddenTitle !== undefined && !generalArticleIds.has(node.linkedArticleId)) {
      // 대치할 자리가 상품에서 노출 끔 — 기본계약 문면이 통째로 사라지므로 오류로 드러낸다 (기능/상품 §3.6).
      issues.push({
        kind: "articleHidden",
        severity: "error",
        message: `기본계약 조 「${node.title}」 이(가) 연결된 보통약관 조 「${hiddenTitle}」 은(는) 상품에서 노출을 껐습니다`,
        at: { document: "special", ownerId: owner.productCoverageId, ownerName: owner.productCoverageName, articleId: node.id, articleTitle: node.title },
      });
      continue;
    }
    replacements.set(node.linkedArticleId, node);
    aliases.set(node.id, node.linkedArticleId);
    for (const key of articleKeys(node)) aliases.set(refKey({ articleId: node.id, code: key }), refKey({ articleId: node.linkedArticleId, code: baseKey(node.id, key) }));
  }
  return {
    doc: mapArticles(general, (node) => {
      const replacement = replacements.get(node.id);
      return replacement ? { ...node, children: rekeyed(replacement) } : node;
    }),
    issues,
    aliases,
  };
}

/** 조 안 항 · 호 · 목의 참조 열쇠 (`Keyed.key`). */
function articleKeys(a: RArticle<SInline>): string[] {
  const out: string[] = [];
  for (const p of a.children) {
    if (p.kind !== "paragraph") continue;
    if (p.key !== undefined) out.push(p.key);
    for (const it of p.items ?? []) {
      if (it.kind !== "item") continue;
      if (it.key !== undefined) out.push(it.key);
      for (const s of it.subitems ?? []) if (s.kind === "subitem" && s.key !== undefined) out.push(s.key);
    }
  }
  return out;
}

/** 대치된 조 안 기본계약 노드의 열쇠 — 기본계약 조 id 를 앞마디로 (보통약관 쪽 코드와 겹치지 않게). */
export function baseKey(baseArticleId: string, key: string): string {
  return `${baseArticleId}:${key}`;
}

/** 기본계약 조 본문 — 열쇠에 기본계약 조 id 앞마디를 붙인 사본. */
function rekeyed(a: RArticle<SInline>): RArticle<SInline>["children"] {
  const k = <T extends { key?: string }>(n: T): T => (n.key !== undefined ? { ...n, key: baseKey(a.id, n.key) } : n);
  return a.children.map((p) => {
    if (p.kind !== "paragraph") return p;
    return {
      ...k(p),
      ...(p.items
        ? { items: p.items.map((it) => (it.kind !== "item" ? it : { ...k(it), ...(it.subitems ? { subitems: it.subitems.map((sub) => (sub.kind === "subitem" ? k(sub) : sub)) } : {}) })) }
        : {}),
    };
  });
}
