"use server";

/**
 * 저작 화면 미리보기의 재료 받기 (기능/문면 §3.9) — 상품을 고를 때 한 번. 조립은 브라우저가 편집본으로 `previewArticle` 를 돌린다.
 * 공유 마스터 · 상품 고유분의 Map · Set 은 서버 함수 반환값으로 그대로 넘어간다(React 직렬화).
 */
import type { PreviewMaterial } from "@/services/assembly";
import type { Id } from "@/domain/types";
import { describeRejection } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

export type PreviewMaterialOutcome = { ok: true; material: PreviewMaterial } | { ok: false; message: string };

export async function loadPreviewMaterialAction(productId: Id): Promise<PreviewMaterialOutcome> {
  await currentActor();
  const r = await getServices().assembly.previewMaterial(productId);
  return r.ok ? { ok: true, material: r.value } : { ok: false, message: describeRejection(r.rejection).message };
}
