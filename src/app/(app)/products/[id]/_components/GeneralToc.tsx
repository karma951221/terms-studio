"use client";

/**
 * 약관 섹션 좌측 목차 — 템플릿의 **관 › 조** (기능/상품 §4 「보통약관」 목차(좌)).
 *
 * - 관은 제목만, 조는 체크박스(= 노출여부) + 번호 + 제목. 번호는 **템플릿 번호**(끄기 전)다 —
 *   순연된 번호는 오른쪽 미리보기에서 본다.
 * - 끈 조는 취소선 · 흐리게(`.is-hidden-article`). 고른 조는 `aria-current` (주칠).
 * - 조 제목은 진짜 주소(`…&art=<조 id>`)를 가진 링크지만 누르면 **서버로 가지 않는다** — 고른 조만 바꾸고 주소는
 *   `replaceState` 로 맞춘다 (`selectArticleOnClick` · 2026-09-28 사용자 QA「목차를 누르면 새로고침된다」).
 */
import type { Id } from "@/domain/types";

import { generalArticlePath } from "../../lib";
import { ArticleVisibilityToggle } from "./ArticleVisibilityToggle";
import { selectArticleOnClick } from "./tocNav";

/** 목차 한 묶음(관) — 번호 · 제목 표기는 서버가 템플릿 번호로 만들어 준다. */
export interface TocSection {
  key: string;
  /** 「제1관 목적 및 용어의 정의」 — 관 밖 조 묶음이면 없다. */
  label?: string;
  articles: { id: Id; label: string; hidden: boolean }[];
}

export function GeneralToc({
  productId,
  sections,
  currentArticleId,
  onSelect,
}: {
  productId: Id;
  sections: readonly TocSection[];
  currentArticleId: Id | undefined;
  onSelect: (articleId: Id) => void;
}) {
  if (sections.length === 0) return <p className="ts-muted">템플릿에 조가 하나도 없다.</p>;
  return (
    <nav className="ts-terms-toc" aria-label="보통약관 목차">
      {sections.map((s) => (
        <div key={s.key}>
          {s.label && <p className="ts-toc-section">{s.label}</p>}
          {s.articles.map((a) => {
            const href = generalArticlePath(productId, a.id);
            return (
              <div key={a.id} id={`toc-${a.id}`} className={a.hidden ? "ts-toc-row is-hidden-article" : "ts-toc-row"}>
                <ArticleVisibilityToggle productId={productId} articleId={a.id} hidden={a.hidden} label={a.label} />
                <a href={href} title={a.label} aria-current={a.id === currentArticleId ? "true" : undefined} onClick={(e) => selectArticleOnClick(e, href, () => onSelect(a.id))}>
                  {a.label}
                </a>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
