"use server";

/**
 * 담보 화면의 서버 액션 — 생성 화면 몫만 남는다. 담보약관 「만들기」는 상세에서 빠졌다 (2026-09-27, 기능/담보 §6.2).
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
  // 담보분류는 필수 (ADR-0090 · 기능/담보 §4 생성) — 서비스는 옛 호출(시드 밖 테스트)을 위해 비어도 받으므로 생성 화면이 막는다
  const category = str(formData, "category");
  if (!category) redirect(errorRedirectPath(`${BASE}/new`, "담보분류를 고르세요"));
  const r = await getServices().coverage.create(actor, {
    name: str(formData, "name"),
    description: str(formData, "description"),
    subCoverageName: str(formData, "subCoverageName") || undefined,
    benefitName: str(formData, "benefitName") || undefined,
    category,
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}
