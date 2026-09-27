/**
 * 약관 섹션 좌측 목차 — 템플릿의 **관 › 조** (기능/상품 §4 「보통약관」 목차(좌)).
 *
 * - 관은 제목만, 조는 체크박스(= 노출여부) + 번호 + 제목. 번호는 **템플릿 번호**(끄기 전)다 —
 *   순연된 번호는 오른쪽 미리보기에서 본다.
 * - 끈 조는 취소선 · 흐리게(`.is-hidden-article`). 고른 조는 `aria-current` (주칠).
 * - 링크는 탭을 잃지 않는다 (`?tab=general&art=<조 id>`).
 */
import Link from "next/link";

import type { NodeNumber } from "@/domain/document";
import type { Id } from "@/domain/types";

import { generalArticlePath, type GeneralSection } from "../../lib";
import { ArticleVisibilityToggle } from "./ArticleVisibilityToggle";

export function GeneralToc({
  productId,
  sections,
  numbers,
  hidden,
  currentArticleId,
}: {
  productId: Id;
  sections: readonly GeneralSection[];
  numbers: ReadonlyMap<Id, NodeNumber>;
  hidden: ReadonlySet<Id>;
  currentArticleId: Id | undefined;
}) {
  if (sections.length === 0) return <p className="ts-muted">템플릿에 조가 하나도 없다.</p>;
  return (
    <nav className="ts-terms-toc" aria-label="보통약관 목차">
      {sections.map((s, i) => (
        <div key={s.id ?? `loose-${i}`}>
          {s.id && (
            <p className="ts-toc-section">
              {numbers.get(s.id)?.label ?? "관"} {s.title}
            </p>
          )}
          {s.articles.map((a) => {
            const isHidden = hidden.has(a.id);
            const label = `${numbers.get(a.id)?.label ?? "조"}(${a.title})`;
            return (
              <div key={a.id} id={`toc-${a.id}`} className={isHidden ? "ts-toc-row is-hidden-article" : "ts-toc-row"}>
                <ArticleVisibilityToggle productId={productId} articleId={a.id} hidden={isHidden} label={label} />
                <Link href={generalArticlePath(productId, a.id)} title={label} aria-current={a.id === currentArticleId ? "true" : undefined}>
                  {label}
                </Link>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
