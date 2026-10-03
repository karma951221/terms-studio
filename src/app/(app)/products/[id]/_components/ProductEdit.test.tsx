/**
 * 상품 상세의 편집 상태 — 편집 중 떠나는 조작(✕ 취소 · 탭 링크 · 경로 링크)의 가드 (점검 M21 · 디자인원칙 §1.7).
 * 클릭은 DOM 없이 재현할 수 없어 판정 함수와 서버 렌더 문자열로 본다 — 클릭 흐름은 E2E(T8) 몫.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import { leaveNeedsConfirm, ProductEditButtons, ProductEditProvider, ProductHeadActions } from "./ProductEdit";
import { ProductTabs } from "./ProductTabs";

describe("ProductEdit — 떠나는 조작의 판정 (M21)", () => {
  it("편집 중이고 고친 것이 있을 때만 「고친 내용을 버립니까?」", () => {
    expect(leaveNeedsConfirm({ editing: true, dirty: true })).toBe(true);
  });

  it("편집 중이어도 고친 것이 없으면 확인 없이 바로 (취소 · 탭 · 경로 모두)", () => {
    expect(leaveNeedsConfirm({ editing: true, dirty: false })).toBe(false);
  });

  it("읽기 중이면 묻지 않는다", () => {
    expect(leaveNeedsConfirm({ editing: false, dirty: true })).toBe(false);
  });
});

describe("ProductTabs — 편집 상태 안에서 그려진다", () => {
  const html = renderToStaticMarkup(
    <ProductEditProvider canEdit={false}>
      <ProductTabs productId="p1" current="special" />
    </ProductEditProvider>,
  );

  it("탭은 URL — 기본정보 · 상품담보 · 보통약관 · 특별약관 네 링크(한 줄)와 현재 탭 표시 (2026-10-03)", () => {
    const labels = [...html.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(["기본정보", "상품담보", "보통약관", "특별약관"]);
    expect(html).toContain('href="/products/p1?tab=basic"');
    expect(html).toContain('href="/products/p1?tab=coverages"');
    expect(html).toContain('href="/products/p1?tab=general"');
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(current).toContain('href="/products/p1?tab=special"');
  });

  it("둘째 줄 하위 탭은 없다 — nav 하나, sub= 없음", () => {
    expect(html.match(/<nav/g)).toHaveLength(1);
    expect(html).not.toContain("sub=");
    expect(html).not.toContain("ts-subtabs-second");
  });
});

describe("ProductHeadActions — 헤더에는 더보기만 (2026-10-03 사용자 QA: 머리의 편집은 모든 탭에 걸리는 것처럼 보였다)", () => {
  it("편집이 있는 탭이어도 헤더에는 편집이 없다", () => {
    for (const canEdit of [true, false]) {
      const html = renderToStaticMarkup(
        <ProductEditProvider canEdit={canEdit}>
          <ProductHeadActions menu={[]} />
        </ProductEditProvider>,
      );
      expect(html).not.toContain(">편집<");
      expect(html).toContain("더보기");
    }
  });
});

describe("ProductEditButtons — 탭 첫 줄 오른쪽의 편집 조작", () => {
  const render = (canEdit: boolean, initialEditing = false) =>
    renderToStaticMarkup(
      <ProductEditProvider canEdit={canEdit} initialEditing={initialEditing}>
        <ProductEditButtons />
      </ProductEditProvider>,
    );

  it("편집할 것이 없는 탭에는 아무것도 없다", () => {
    expect(render(false)).toBe("");
  });

  it("읽기는 [편집], 편집은 같은 자리에 [취소] [저장]", () => {
    expect(render(true)).toContain(">편집<");
    const editing = render(true, true);
    expect(editing).not.toContain(">편집<");
    expect(editing).toContain(">취소<");
    expect(editing).toMatch(/class="primary"[^>]*>저장</);
  });
});
