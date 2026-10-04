"use client";

/**
 * 보통약관 세 패널 — 목차(좌) · 원문 모델(가운데) · 조립 결과(오른쪽) (기능/상품 §4.6 보통약관 탭).
 *
 * 단위는 **관**이다. 서버(`GeneralTab`)가 관마다 가운데 · 오른쪽을 미리 그려 `panes` 로 넘기고, 여기서는 고른 조가 속한
 * 관 하나만 붙인다. 목차를 눌러도 서버를 다시 부르지 않는다 — 고른 조는 이 컴포넌트의 상태고 주소는 `replaceState` 로만
 * 맞춘다(`selectArticleOnClick`). 서버가 다른 조로 다시 그려 보내면(`?art=` 로 새로 받음) 그 조를 따른다.
 *
 * 패널마다 머리 띠(`.ts-terms-panel-head` — 특별약관 탭과 같은 규칙, 스크롤해도 위에 붙는다): 「목차」 · 「모델링 — 관」 · 「미리보기 — 관」.
 *
 * 편집 중이면 패널이 둘이다 (ADR-0079 · 기능/상품 §4.6) — 목차(노출 체크 · 사본 점)와 **조 편집**(고른 조 하나를 문면 편집기로,
 * `ArticleCopyEditor`). 미리보기는 숨긴다 — 저장 전에는 저장된 조립이라 고친 것과 어긋난다. 모델링도 조 편집이 대신한다.
 */
import { Fragment, useState, type ReactNode } from "react";

import type { Id } from "@/domain/types";

import { ArticleCopyEditor, type CopyEditorData } from "./ArticleCopyEditor";
import { useGeneralEdit } from "./GeneralEdit";
import { CopyDots, copyStateOf, GeneralToc, type TocSection } from "./GeneralToc";
import { initialScrollTarget } from "./panelScroll";
import { PanelScrollSync } from "./PanelScrollSync";

export interface GeneralPane {
  key: string;
  /** 패널 제목의 묶음 이름 — 「제1관 …」 · 「전체」 · 「관 밖 조 제1조 ~ 제3조」. */
  label: string;
  articleIds: readonly Id[];
  center: ReactNode;
  right: ReactNode;
}

/** 고른 조가 속한 관 — 없으면 조가 있는 첫 관 (URL 의 좌표를 믿지 않는다). */
export function paneOf(panes: readonly GeneralPane[], articleId: Id | undefined): GeneralPane | undefined {
  return (articleId ? panes.find((p) => p.articleIds.includes(articleId)) : undefined) ?? panes.find((p) => p.articleIds.length > 0) ?? panes[0];
}

export function GeneralPanels({
  productId,
  toc,
  panes,
  initialArticleId,
  requestedArticleId,
  copyEditor,
}: {
  productId: Id;
  toc: readonly TocSection[];
  panes: readonly GeneralPane[];
  initialArticleId: Id | undefined;
  /** 주소의 `?art=` 그대로 — 이게 현재 조일 때만 처음 열면서 그 조로 옮긴다(`initialScrollTarget`). */
  requestedArticleId?: Id | undefined;
  /** 편집 중 조 편집 패널의 재료 — 없으면 편집 중에도 세 패널(템플릿이 없는 화면 · 단독 렌더). */
  copyEditor?: CopyEditorData;
}) {
  const [current, setCurrent] = useState(initialArticleId);
  // 서버가 다른 조로 다시 그렸으면(`?art=` 로 돌아온 저장 등) 그 조를 따른다 — 렌더 중 상태 맞추기(React 권장 패턴)
  const [served, setServed] = useState(initialArticleId);
  // 패널을 옮길 조 — 목차를 눌렀거나 `art=` 로 열었을 때만. 서버가 고른 기본값(첫 조)으로는 옮기지 않는다 (2026-10-04 사용자 QA)
  const [scrollTo, setScrollTo] = useState(() => initialScrollTarget(requestedArticleId, initialArticleId));
  if (served !== initialArticleId) {
    setServed(initialArticleId);
    setCurrent(initialArticleId);
    setScrollTo(initialScrollTarget(requestedArticleId, initialArticleId));
  }
  const select = (articleId: Id) => {
    setCurrent(articleId);
    setScrollTo(articleId);
  };
  const edit = useGeneralEdit();
  const editing = edit?.editing ?? false;
  const pane = paneOf(panes, current);
  const label = pane?.label ?? "전체";

  if (editing && copyEditor) {
    const articleId = current && pane?.articleIds.includes(current) ? current : pane?.articleIds[0];
    const entry = toc.flatMap((s) => s.articles).find((a) => a.id === articleId);
    const copy = articleId ? edit?.current.copies[articleId] : undefined;
    const articleLabel = entry ? (copy ? `${entry.number}(${copy.article.title})` : `${entry.number}(${entry.templateTitle})`) : "조";
    return (
      <div className="ts-terms-panels is-editing">
        <section className="ts-terms-panel" aria-label="목차">
          <div className="ts-terms-panel-head">
            <h3 className="ts-terms-panel-title">목차</h3>
          </div>
          <GeneralToc productId={productId} sections={toc} currentArticleId={articleId} onSelect={select} />
        </section>
        <section className="ts-terms-panel ts-terms-panel-edit" aria-label="조 편집">
          <div className="ts-terms-panel-head">
            <h3 className="ts-terms-panel-title">조 편집 — {articleLabel}</h3>
            {entry && <CopyDots state={copyStateOf(copy, entry.templateHash)} label={articleLabel} />}
            <span className="ts-terms-panel-hint">저장하면 이 상품의 보통약관에 반영됩니다</span>
          </div>
          {articleId ? <ArticleCopyEditor key={articleId} data={copyEditor} articleId={articleId} label={articleLabel} /> : <p className="ts-muted">조가 없다.</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="ts-terms-panels">
      <section className="ts-terms-panel" aria-label="목차">
        <div className="ts-terms-panel-head">
          <h3 className="ts-terms-panel-title">목차</h3>
        </div>
        <GeneralToc productId={productId} sections={toc} currentArticleId={current} onSelect={select} />
      </section>
      <section className="ts-terms-panel" aria-label="모델링">
        <div className="ts-terms-panel-head">
          <h3 className="ts-terms-panel-title">모델링 — {label}</h3>
        </div>
        {pane ? <Fragment key={pane.key}>{pane.center}</Fragment> : <p className="ts-muted">이 관에는 조가 없다.</p>}
      </section>
      <section className="ts-terms-panel" aria-label="미리보기">
        <div className="ts-terms-panel-head">
          <h3 className="ts-terms-panel-title">미리보기 — {label}</h3>
          {editing && <span className="ts-terms-panel-hint">저장하면 미리보기에 반영됩니다</span>}
        </div>
        {pane && <Fragment key={pane.key}>{pane.right}</Fragment>}
      </section>
      <PanelScrollSync articleId={scrollTo} />
    </div>
  );
}
