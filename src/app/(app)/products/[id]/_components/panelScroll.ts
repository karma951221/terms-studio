/**
 * 보통약관 세 패널의 스크롤 맞추기 — 순수 계산만 (`PanelScrollSync` 가 DOM 에 적용한다).
 *
 * 2026-10-04 사용자 QA: `?tab=general` 을 열기만 해도 목차가 68px 내려가 「제1관」 제목이 잘렸다 — 서버는 `art=` 가
 * 없어도 첫 조를 현재 조로 넘기는데, 그 조로도 옮겼기 때문이다. 옮긴 조 제목은 붙박이 머리 띠(`.ts-terms-panel-head`) 밑에 가렸다.
 */
import type { Id } from "@/domain/types";

/** 처음 열 때 옮길 조 — `art=` 로 고른 조가 그대로 현재 조일 때만. 서버가 고른 기본값(첫 조)으로는 옮기지 않는다. */
export function initialScrollTarget(requested: Id | undefined, current: Id | undefined): Id | undefined {
  return requested !== undefined && requested === current ? current : undefined;
}

/** 조 맨 위가 패널 머리 띠 바로 아래에 오도록 하는 패널 `scrollTop`. */
export function panelScrollTop({ scrollTop, targetTop, panelTop, headHeight }: { scrollTop: number; targetTop: number; panelTop: number; headHeight: number }): number {
  return Math.max(0, scrollTop + targetTop - panelTop - headHeight);
}
