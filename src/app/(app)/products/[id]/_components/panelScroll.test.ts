/**
 * 보통약관 세 패널의 스크롤 맞추기 (2026-10-04 사용자 QA — `?tab=general` 을 열기만 해도 목차가 68px 내려가
 * 「제1관」 제목이 잘리고, 옮긴 조 제목은 붙박이 머리 띠 밑에 가렸다).
 */
import { describe, expect, it } from "vitest";

import { initialScrollTarget, panelScrollTop } from "./panelScroll";

describe("initialScrollTarget — 처음 열 때 옮길 조", () => {
  it("`art=` 가 없으면 옮기지 않는다 — 첫 조는 서버가 고른 기본값일 뿐, 패널은 맨 위에서 시작한다", () => {
    expect(initialScrollTarget(undefined, "A1")).toBeUndefined();
  });

  it("`art=` 로 고른 조가 현재 조면 그 조로 한 번 옮긴다", () => {
    expect(initialScrollTarget("A3", "A3")).toBe("A3");
  });

  it("`art=` 가 없는 조라 서버가 첫 조로 바꿨으면 옮기지 않는다", () => {
    expect(initialScrollTarget("없는조", "A1")).toBeUndefined();
  });
});

describe("panelScrollTop — 조 맨 위를 머리 띠 바로 아래에", () => {
  it("붙박이 머리 띠 높이만큼 덜 내린다 — 조 제목이 머리 띠에 가리지 않는다", () => {
    // 패널 꼭대기 100, 조는 패널 안 400 지점(현재 scrollTop 50), 머리 띠 36
    expect(panelScrollTop({ scrollTop: 50, targetTop: 500, panelTop: 100, headHeight: 36 })).toBe(50 + 400 - 36);
  });

  it("음수로 내려가지 않는다", () => {
    expect(panelScrollTop({ scrollTop: 0, targetTop: 110, panelTop: 100, headHeight: 36 })).toBe(0);
  });
});
