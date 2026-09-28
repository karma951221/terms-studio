"use client";

/**
 * 보통약관 세 패널 — 목차(좌) · 원문 모델(가운데) · 조립 결과(오른쪽) (기능/상품 §4 「보통약관 작성」).
 *
 * 단위는 **관**이다. 서버(`GeneralTab`)가 관마다 가운데 · 오른쪽을 미리 그려 `panes` 로 넘기고, 여기서는 고른 조가 속한
 * 관 하나만 붙인다. 목차를 눌러도 서버를 다시 부르지 않는다 — 고른 조는 이 컴포넌트의 상태고 주소는 `replaceState` 로만
 * 맞춘다(`selectArticleOnClick`). 서버가 다른 조로 다시 그려 보내면(옵션 저장 뒤 `?art=` 로 돌아옴) 그 조를 따른다.
 */
import { Fragment, useState, type ReactNode } from "react";

import type { Id } from "@/domain/types";

import { GeneralToc, type TocSection } from "./GeneralToc";
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

export function GeneralPanels({ productId, toc, panes, initialArticleId }: { productId: Id; toc: readonly TocSection[]; panes: readonly GeneralPane[]; initialArticleId: Id | undefined }) {
  const [current, setCurrent] = useState(initialArticleId);
  // 서버가 다른 조로 다시 그렸으면(`?art=` 로 돌아온 저장 등) 그 조를 따른다 — 렌더 중 상태 맞추기(React 권장 패턴)
  const [served, setServed] = useState(initialArticleId);
  if (served !== initialArticleId) {
    setServed(initialArticleId);
    setCurrent(initialArticleId);
  }
  const pane = paneOf(panes, current);
  const label = pane?.label ?? "전체";
  return (
    <div className="ts-terms-panels">
      <div className="ts-terms-panel">
        <h3 className="ts-terms-panel-title">목차</h3>
        <GeneralToc productId={productId} sections={toc} currentArticleId={current} onSelect={setCurrent} />
      </div>
      <div className="ts-terms-panel">
        <h3 className="ts-terms-panel-title">약관 — {label} (원문)</h3>
        {pane ? <Fragment key={pane.key}>{pane.center}</Fragment> : <p className="ts-muted">이 관에는 조가 없다.</p>}
      </div>
      <div className="ts-terms-panel">
        <h3 className="ts-terms-panel-title">미리보기 — {label} (평가)</h3>
        {pane && <Fragment key={pane.key}>{pane.right}</Fragment>}
      </div>
      <PanelScrollSync articleId={current} />
    </div>
  );
}
