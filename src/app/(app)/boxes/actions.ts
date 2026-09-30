"use server";

import { redirect } from "next/navigation";

import { str } from "@/app/_lib/formData";
import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import { boxLinesFromText } from "@/domain/document/box";
import { currentActor, getServices } from "@/lib/services";

const BASE = "/boxes";

/**
 * 박스 등록 — 코드는 받지 않는다 (시스템 채번 BX000001…, 기능/박스 §3.1). 줄 칸은 한 줄 = 박스의 한 줄.
 * 등록 뒤 상세로 보낸다 — 받은 코드를 보여 준다.
 */
export async function createBoxAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().document.createBox(actor, {
    name: str(formData, "name"),
    title: str(formData, "title"),
    lines: boxLinesFromText(str(formData, "lines")),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, describeRejection(r.rejection).message));
  redirect(`${BASE}/${encodeURIComponent(r.value.code)}`);
}
