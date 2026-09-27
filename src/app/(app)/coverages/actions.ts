"use server";

/**
 * 담보 화면의 서버 액션 — 생성 화면과 상세의 담보약관 「만들기」(즉시 실행 명령) 몫만 남는다.
 *
 * 상세 화면의 이름 · 구조 · 값은 편집 흐름(`edit-actions.ts`)의 저장 하나로 묶였다 (기능/담보 §3.2 · §4).
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

/**
 * 담보약관 「만들기」 — 저장과 별개로 즉시 실행 (기능/담보 §3.5). 제목은 저장된 담보명으로 「{담보명} 특별약관」, 만든 뒤 조문 편집기로.
 * 제목을 화면에서 받지 않는다 — 읽기 모드에서도 누르는 버튼이라 입력칸이 없고, 제목은 문면에서 고친다.
 */
export async function createSpecialDocumentAction(coverageId: Id): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const tree = await services.coverage.get(coverageId);
  if (!tree) redirect(errorRedirectPath(detailPath(coverageId), "담보를 찾을 수 없습니다."));
  const doc = await services.document.createSpecial(actor, coverageId, `${tree.name} 특별약관`);
  if (!doc.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(doc.rejection)));
  const linked = await services.coverage.setDocument(actor, coverageId, doc.value.id);
  if (!linked.ok) redirect(errorRedirectPath(detailPath(coverageId), msg(linked.rejection)));
  redirect(`/documents/${doc.value.id}`);
}
