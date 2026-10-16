/** 기본계약 1개 모드: 조연결된 기본계약 조의 해소·치환 결과로 보통약관 조 본문을 대치한다. */
import { refKey } from "../document/pcode";
import { keyBase } from "./resolve";
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
   * 반복 · 함수조항 펼치기가 만든 노드는 원형 열쇠(복제 접미사를 뗀 것)와 반복 블록 · 함수조항 참조의 묶음 열쇠(`groups`)에도 별칭이 선다 — 반복 안 대상 ·
   * 「펼친 것 전부」 참조가 대치 뒤에도 풀린다.
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
    // 반복이 낼 수 있던 열쇠(원소 0개라 안 난 본문 · 칸 쪽 코드)도 — 기본계약 문면의 참조가 「사라짐」 대신 「0개」로 갈린다 (ADR-0088 결정 4)
    for (const key of node.repeatKeys ?? []) {
      const from = refKey({ articleId: node.id, code: key });
      if (!aliases.has(from)) aliases.set(from, refKey({ articleId: node.linkedArticleId, code: baseKey(node.id, key) }));
    }
  }
  return {
    doc: mapArticles(general, (node) => {
      const replacement = replacements.get(node.id);
      if (!replacement) return node;
      // 원소 0개 판정(repeatKeys)도 기본계약 본문의 것 — 보통약관 조의 반복 코드는 대치로 사라졌다
      const out = { ...node, children: rekeyed(replacement) };
      delete out.repeatKeys;
      if (replacement.repeatKeys) out.repeatKeys = replacement.repeatKeys.map((k) => baseKey(replacement.id, k));
      return out;
    }),
    issues,
    aliases,
  };
}

/**
 * 조 안 항 · 호 · 목의 참조 열쇠 (`Keyed.key`) — 복제 접미사가 든 열쇠는 그 원형(`keyBase`)도, 반복 블록 · 함수조항 참조의 묶음 열쇠(`groups` 원형)도.
 * 렌더는 원형 열쇠 · 묶음 열쇠로 「그 열쇠로 생긴 노드 전부」를 찾는다(render.ts `lookup`).
 */
function articleKeys(a: RArticle<SInline>): string[] {
  const out = new Set<string>();
  const add = (n: { key?: string; groups?: string[] }) => {
    if (n.key !== undefined) {
      out.add(n.key);
      out.add(keyBase(n.key));
    }
    for (const g of n.groups ?? []) out.add(keyBase(g));
  };
  for (const p of a.children) {
    if (p.kind !== "paragraph") continue;
    add(p);
    for (const it of p.items ?? []) {
      if (it.kind !== "item") continue;
      add(it);
      for (const s of it.subitems ?? []) if (s.kind === "subitem") add(s);
    }
  }
  return [...out];
}

/** 대치된 조 안 기본계약 노드의 열쇠 — 기본계약 조 id 를 앞마디로 (보통약관 쪽 코드와 겹치지 않게). */
export function baseKey(baseArticleId: string, key: string): string {
  return `${baseArticleId}:${key}`;
}

/** 기본계약 조 본문 — 열쇠 · 묶음 열쇠에 기본계약 조 id 앞마디를 붙인 사본. */
function rekeyed(a: RArticle<SInline>): RArticle<SInline>["children"] {
  const k = <T extends { key?: string; groups?: string[] }>(n: T): T => ({
    ...n,
    ...(n.key !== undefined ? { key: baseKey(a.id, n.key) } : {}),
    ...(n.groups ? { groups: n.groups.map((g) => baseKey(a.id, g)) } : {}),
  });
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
