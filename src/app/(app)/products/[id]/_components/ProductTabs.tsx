"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { Id } from "@/domain/types";

import { PRODUCT_TABS, PRODUCT_TAB_LABEL, TERMS_SUBS, TERMS_SUB_LABEL, productDetailPath, termsPath, type ProductTab, type TermsSub } from "../../lib";
import { useProductEdit } from "./ProductEdit";

/**
 * 상세의 탭 — 기본정보 · 상품담보 · 약관 (기능/상품 §3.8 · §4.3, 2026-09-28 「안 2」).
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

/** 약관 탭 둘째 줄 — 보통약관 작성 · 담보별 미리보기 (`?sub=`). 약관 탭에는 편집 초안이 없어 확인 없이 옮긴다. */
export function TermsSubTabs({ productId, current }: { productId: Id; current: TermsSub }) {
  return (
    <nav className="ts-subtabs ts-subtabs-second" aria-label="약관 하위 탭">
      {TERMS_SUBS.map((sub) => (
        <Link key={sub} href={termsPath(productId, sub)} aria-current={sub === current ? "page" : undefined}>
          {TERMS_SUB_LABEL[sub]}
        </Link>
      ))}
    </nav>
  );
}
