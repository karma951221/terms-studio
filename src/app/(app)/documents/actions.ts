"use server";

/**
 * 문면 — 편집본 밖의 서버 액션 (문서 생성 · 복제 · 삭제). 폼 제출 → 서비스 → redirect.
 *
 * 저작 화면의 트리 명령 · 템플릿 이름 · 대응 보통약관은 여기 없다 — 브라우저 편집본에 적용했다가
 * `저장` 한 번(`edit-actions.ts` 의 `saveDocumentEditAction`)으로 간다 (ADR-0074).
 * 복제 · 삭제는 읽기 모드 더보기 메뉴에서만 연다 — 편집 중에는 쓸 수 없다 (결정 6).
 */
import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { docListHref, str } from "./lib";

const BASE = "/documents";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(id: Id): string {
  return `${BASE}/${id}`;
}

export async function createGeneralAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.createGeneral(actor, str(formData, "title"));
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

/** 보통약관 템플릿 복제 — 새 이름으로 (기능/문면 §3.1). 실패하면 복제 카드로 돌아간다. */
export async function duplicateGeneralAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.duplicate(actor, id, { title: str(formData, "title") });
  if (!r.ok) redirect(errorRedirectPath(`${detailPath(id)}?dup=1`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

/** 담보약관 템플릿 복제 — 템플릿이 없는 담보로. 담보 쪽 문서 연결까지 (템플릿 생성과 같은 두 걸음). */
export async function duplicateSpecialAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const coverageId = str(formData, "coverageId");
  const back = `${detailPath(id)}?dup=1`;
  if (!coverageId) redirect(errorRedirectPath(back, "복제할 담보를 고르세요."));
  const r = await services.document.duplicate(actor, id, { coverageId, title: str(formData, "title") });
  if (!r.ok) redirect(errorRedirectPath(back, msg(r.rejection)));
  const linked = await services.coverage.setDocument(actor, coverageId, r.value.id);
  if (!linked.ok) redirect(errorRedirectPath(detailPath(r.value.id), msg(linked.rejection)));
  redirect(detailPath(r.value.id));
}

export async function removeDocumentAction(id: Id): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const kind = (await services.document.get(id))?.kind ?? "general";
  const r = await services.document.remove(actor, id, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(docListHref(kind));
}
