/** 기본계약 1개 모드: 조연결된 기본계약 조의 해소·치환 결과로 보통약관 조 본문을 대치한다. */
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
  /** 대치된 기본계약 조 id → 보통약관 조 id. 기본계약 문면 안의 자기 조 참조를 렌더가 이걸로 푼다. */
  aliases: Map<Id, Id>;
}

/**
 * @param hidden 상품이 노출을 끈 보통약관 조 id → 조 명 (기능/상품 §3.6). 대치 대상이 이 중에 있으면 조용히 빠지지 않게 오류를 낸다.
 */
export function replaceGeneralWithBase(general: SubstitutedDoc, base: SubstitutedDoc, owner: BaseOwner, hidden?: ReadonlyMap<Id, string>): BaseReplacementOutcome {
  const replacements = new Map<Id, RArticle<SInline>>();
  const aliases = new Map<Id, Id>();
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
  }
  return {
    doc: mapArticles(general, (node) => {
      const replacement = replacements.get(node.id);
      return replacement ? { ...node, children: replacement.children } : node;
    }),
    issues,
    aliases,
  };
}
