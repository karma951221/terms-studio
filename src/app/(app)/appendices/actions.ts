"use server";

import { redirect } from "next/navigation";

import { str } from "@/app/_lib/formData";
import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

const BASE = "/appendices";

const detailPath = (code: string) => `${BASE}/${encodeURIComponent(code)}`;

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}

/**
 * 별표 등록 — 코드는 받지 않는다 (시스템 채번 AX000001…, 기능/별표 §3.1).
 * 등록 뒤 상세로 보낸다 — 사람이 코드를 정하지 않았으니 받은 코드를 보여 줘야 한다.
 */
export async function createAppendixAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.createAppendix(actor, {
    name: str(formData, "name"),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}
