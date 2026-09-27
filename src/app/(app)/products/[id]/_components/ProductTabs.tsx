import Link from "next/link";

import type { Id } from "@/domain/types";

import { PRODUCT_TABS, PRODUCT_TAB_LABEL, productDetailPath, type ProductTab } from "../../lib";

/**
 * 상세의 하위 탭 — 작업 순서대로 기본정보 · 보통약관 · 특별약관 (기능/상품 §3.8 · §4.3).
 *
 * 현재 탭은 경로가 아니라 `?tab=` 에서 오므로 `NavLink`(pathname 판정) 대신 계산한 `aria-current` 를 단다.
 * 서버 렌더라 탭 전환이 곧 새 요청이다 — 그래서 탭마다 제 데이터만 그리면 된다.
 */
export function ProductTabs({ productId, current }: { productId: Id; current: ProductTab }) {
  return (
    <nav className="ts-subtabs" aria-label="상품 하위 탭">
      {PRODUCT_TABS.map((tab) => (
        <Link key={tab} href={productDetailPath(productId, tab)} aria-current={tab === current ? "page" : undefined}>
          {PRODUCT_TAB_LABEL[tab]}
        </Link>
      ))}
    </nav>
  );
}
