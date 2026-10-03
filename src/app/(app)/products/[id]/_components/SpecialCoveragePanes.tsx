"use client";

/**
 * 담보별 미리보기 오른쪽 패널 — 위는 고른 담보의 **상품담보 선택기**, 아래는 고른 한 건의 조립 결과 (기능/상품 §4.7).
 *
 * 서버(`SpecialPreviewTab`)가 그 담보의 상품담보마다 결과를 미리 그려 `panes` 로 넘기고, 여기서는 고른 한 건만 붙인다.
 * 선택기를 눌러도 서버를 다시 부르지 않는다 — 가운데(담보 모델)는 그대로 있고, 주소는 `replaceState` 로 `&pc=` 만 맞춘다
 * (`selectArticleOnClick` — 보통약관 목차와 같은 방식). 서버가 다른 상품담보로 다시 그려 보내면 그것을 따른다.
 */
import { Fragment, useState, type ReactNode } from "react";

import type { Id } from "@/domain/types";

import { specialPreviewPath } from "../../lib";
import { selectArticleOnClick } from "./tocNav";

export interface SpecialCoveragePane {
  /** 상품담보 id. */
  id: Id;
  /** 상품담보명 — 선택기 · 패널 제목. */
  name: string;
  body: ReactNode;
}

export function SpecialCoveragePanes({ productId, panes, initialId }: { productId: Id; panes: readonly SpecialCoveragePane[]; initialId: Id }) {
  const [current, setCurrent] = useState(initialId);
  // 서버가 다른 상품담보로 다시 그렸으면 그것을 따른다 — 렌더 중 상태 맞추기(GeneralPanels 와 같은 패턴)
  const [served, setServed] = useState(initialId);
  if (served !== initialId) {
    setServed(initialId);
    setCurrent(initialId);
  }
  const pane = panes.find((p) => p.id === current) ?? panes[0];
  return (
    <section className="ts-terms-panel" aria-label="담보별 미리보기">
      <nav className="ts-special-pcs" aria-label="상품담보">
        {panes.map((p) => {
          const href = specialPreviewPath(productId, p.id);
          return (
            <a key={p.id} href={href} aria-current={p.id === pane?.id ? "page" : undefined} onClick={(e) => selectArticleOnClick(e, href, () => setCurrent(p.id))}>
              {p.name}
            </a>
          );
        })}
      </nav>
      <h3 className="ts-terms-panel-title">미리보기 — {pane?.name ?? ""} (평가)</h3>
      {pane && <Fragment key={pane.id}>{pane.body}</Fragment>}
    </section>
  );
}
