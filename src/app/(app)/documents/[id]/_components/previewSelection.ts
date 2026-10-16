"use client";

import { useEffect, useState } from "react";

import type { Id } from "@/domain/types";
import type { PreviewProduct } from "@/services/assembly";

import { loadPreviewMaterialAction, type PreviewMaterialOutcome } from "../../preview-actions";

export const previewKeyOf = (p: PreviewProduct) => p.productCoverageId ?? p.productId;

/** 미리보기 · 「구분자」 탭이 함께 쓰는 고른 상품 · 상품 재료 — 상품마다 한 번 받아 기억한다 (기능/문면 §3.9). */
export function usePreviewSelection(products: readonly PreviewProduct[]) {
  const [picked, setPicked] = useState<Id | undefined>(products[0] ? previewKeyOf(products[0]) : undefined);
  const [materials, setMaterials] = useState<Record<Id, PreviewMaterialOutcome>>({});
  const selected = products.find((p) => previewKeyOf(p) === picked) ?? products[0];
  const productId = selected?.productId;

  // 고른 상품의 재료가 없으면 한 번 받는다 — 상품마다 기억한다
  useEffect(() => {
    if (!productId || materials[productId]) return;
    let live = true;
    loadPreviewMaterialAction(productId).then(
      (r) => live && setMaterials((m) => ({ ...m, [productId]: r })),
      (e: unknown) => live && setMaterials((m) => ({ ...m, [productId]: { ok: false, message: e instanceof Error ? e.message : String(e) } })),
    );
    return () => {
      live = false;
    };
  }, [productId, materials]);

  return { products, selected, pick: setPicked, outcome: productId ? materials[productId] : undefined };
}
export type PreviewSelection = ReturnType<typeof usePreviewSelection>;
