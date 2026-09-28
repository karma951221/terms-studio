/**
 * 상품 상세의 편집 상태 — 편집 중 떠나는 조작(✕ 취소 · 탭 링크 · 경로 링크)의 가드 (점검 M21 · 디자인원칙 §1.7).
 * 클릭은 DOM 없이 재현할 수 없어 판정 함수와 서버 렌더 문자열로 본다 — 클릭 흐름은 E2E(T8) 몫.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import { leaveNeedsConfirm, ProductEditProvider, ProductHeadActions } from "./ProductEdit";
import { ProductTabs, TermsSubTabs } from "./ProductTabs";

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
      <ProductTabs productId="p1" current="terms" />
    </ProductEditProvider>,
  );

  it("탭은 URL — 기본정보 · 상품담보 · 약관 세 링크와 현재 탭 표시 (2026-09-28 「안 2」)", () => {
    const labels = [...html.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(["기본정보", "상품담보", "약관"]);
    expect(html).toContain('href="/products/p1?tab=basic"');
    expect(html).toContain('href="/products/p1?tab=coverages"');
    const current = html.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(current).toContain('href="/products/p1?tab=terms"');
  });

  it("약관 둘째 줄 — 보통약관 작성 · 담보별 미리보기 (`?sub=`)", () => {
    const sub = renderToStaticMarkup(<TermsSubTabs productId="p1" current="special" />);
    const labels = [...sub.matchAll(/<a[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(["보통약관 작성", "담보별 미리보기"]);
    expect(sub).toContain('href="/products/p1?tab=terms&amp;sub=general"');
    expect(sub.match(/<a[^>]*aria-current="page"[^>]*>/)?.[0]).toContain("sub=special");
  });
});

describe("ProductHeadActions — 편집할 것이 없는 탭", () => {
  it("상품담보 · 약관 탭에는 편집이 없고 더보기만 선다", () => {
    const html = renderToStaticMarkup(
      <ProductEditProvider canEdit={false}>
        <ProductHeadActions menu={[]} />
      </ProductEditProvider>,
    );
    expect(html).not.toContain(">편집<");
  });

  it("기본정보 탭은 편집으로 시작한다", () => {
    const html = renderToStaticMarkup(
      <ProductEditProvider canEdit>
        <ProductHeadActions menu={[]} />
      </ProductEditProvider>,
    );
    expect(html).toContain(">편집<");
  });
});
