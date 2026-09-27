"use server";

/**
 * 담보 화면의 서버 액션 — **생성 화면 몫만** 남는다.
 *
 * 상세 화면의 이름 · 설명 · 값은 편집 흐름(`edit-actions.ts`)의 저장 하나로 묶였고,
 * 구조(세부보장 · 급부의 추가 · 삭제 · 순서) 정정은 상세 편집 흐름과 「구조 편집」 화면 몫이다 (기능/담보 §3.2).
 * 서버 액션은 그 자체로 호출 가능한 엔드포인트라, 화면에서 뺀 조작은 여기서도 지운다.
 */
import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { str } from "./lib";

const BASE = "/coverages";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
function detailPath(id: Id): string {
  return `${BASE}/${id}`;
}

export async function createCoverageAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().coverage.create(actor, {
    name: str(formData, "name"),
    description: str(formData, "description"),
    subCoverageName: str(formData, "subCoverageName") || undefined,
    benefitName: str(formData, "benefitName") || undefined,
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

export async function createSpecialDocumentAction(coverageId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const doc = await services.document.createSpecial(actor, coverageId, str(formData, "title"));
  if (!doc.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(doc.rejection)));
  const linked = await services.coverage.setDocument(actor, coverageId, doc.value.id);
  if (!linked.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(linked.rejection)));
  redirect(`/documents/${doc.value.id}`);
}
