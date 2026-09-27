"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Id } from "@/domain/types";

import { PRODUCT_TABS, PRODUCT_TAB_LABEL, productDetailPath, type ProductTab } from "../../lib";
import { useProductEdit } from "./ProductEdit";

/**
 * 상세의 하위 탭 — 작업 순서대로 기본정보 · 보통약관 · 특별약관 (기능/상품 §3.8 · §4.3).
 *
 * 현재 탭은 경로가 아니라 `?tab=` 에서 오므로 `NavLink`(pathname 판정) 대신 계산한 `aria-current` 를 단다.
 * 탭 전환은 곧 새 서버 렌더라 기본정보의 편집 초안이 사라진다 — 그래서 편집 중 고친 것이 있으면
 * 탭 링크도 경로 링크처럼 「고친 내용을 버립니까?」를 거친다 (디자인원칙 §1.7 · 점검 M21).
 */
export function ProductTabs({ productId, current }: { productId: Id; current: ProductTab }) {
  const { leave } = useProductEdit();
  const router = useRouter();
  return (
    <nav className="ts-subtabs" aria-label="상품 하위 탭">
      {PRODUCT_TABS.map((tab) => {
        const href = productDetailPath(productId, tab);
        return (
          <Link
            key={tab}
            href={href}
            aria-current={tab === current ? "page" : undefined}
            onNavigate={
              tab === current
                ? undefined
                : (event) => {
                    event.preventDefault();
                    leave(() => router.push(href));
                  }
            }
          >
            {PRODUCT_TAB_LABEL[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
