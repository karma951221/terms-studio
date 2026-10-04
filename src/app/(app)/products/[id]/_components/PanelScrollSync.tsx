"use client";

/**
 * 목차에서 고른 조로 가운데(원문 `art-<id>`)와 오른쪽(조립 결과 `node-<id>`) 패널을 함께 옮긴다
 * (기능/상품 §4 「보통약관」 — 고른 조로 가운데 · 오른쪽이 함께 스크롤). 목차(`toc-<id>`)도 같이 옮긴다 —
 * 52조짜리 목차에서 고른 조가 화면 밖이면 「어디를 보고 있나」가 끊긴다.
 *
 * `scrollIntoView` 를 쓰지 않는다 — 그 조상 전부를 스크롤해 **페이지 자체가 튄다**.
 * 패널(`.ts-terms-panel`)의 `scrollTop` 만 그 조가 패널 머리 띠 바로 아래에 오도록 옮긴다(`panelScrollTop`) —
 * 머리 띠가 붙박이라 패널 맨 위에 맞추면 조 제목이 그 밑에 가린다.
 *
 * `articleId` 가 없으면 옮기지 않는다 — 처음 열 때(`art=` 없음)는 패널이 맨 위에서 시작한다(`initialScrollTarget`).
 */
import { useEffect } from "react";

import { panelScrollTop } from "./panelScroll";

export function PanelScrollSync({ articleId }: { articleId: string | undefined }) {
  useEffect(() => {
    if (!articleId) return;
    for (const domId of [`toc-${articleId}`, `art-${articleId}`, `node-${articleId}`]) {
      const el = document.getElementById(domId);
      const panel = el?.closest(".ts-terms-panel");
      if (!el || !(panel instanceof HTMLElement)) continue;
      const head = panel.querySelector(".ts-terms-panel-head");
      panel.scrollTop = panelScrollTop({
        scrollTop: panel.scrollTop,
        targetTop: el.getBoundingClientRect().top,
        panelTop: panel.getBoundingClientRect().top + panel.clientTop,
        headHeight: head instanceof HTMLElement ? head.offsetHeight : 0,
      });
    }
  }, [articleId]);
  return null;
}
