"use server";

/**
 * 동적표 생성 · 저장 · 삭제 — 화면 하나에 저장은 하나다 (기능/동적표 §4.2 · 디자인원칙 §2 L2).
 *
 * 서비스 `create` · `save` 가 정의 전체를 받아 저장 검사(§3.6)를 돌리므로 여기서는 결과만 화면 모양으로 옮긴다 —
 * 거부면 사유와 고칠 자리(`issues[].at.refPath` = `arg.X` · `headers.first` · `cell`)를 그대로 돌려 화면이 그 칸 아래에 보인다.
 * 삭제는 2단 — 편집자는 거부, 관리자는 깨질 사용처 확인(`confirm`) 뒤 삭제 (서비스 `remove`).
 */
import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import { currentActor, getServices } from "@/lib/services";

import type { DynTableEditData, DynTableSaveOutcome } from "./edit-types";

function failed(rejection: Parameters<typeof describeRejection>[0]): DynTableSaveOutcome {
  const view = describeRejection(rejection);
  return { ok: false, message: view.message, ...(view.issues ? { issues: [...view.issues] } : {}) };
}

export async function createDynTableAction(input: DynTableEditData): Promise<DynTableSaveOutcome> {
  const r = await getServices().dynTable.create(await currentActor(), input);
  if (!r.ok) return failed(r.rejection);
  return { ok: true, code: r.value.code };
}

export async function saveDynTableAction(code: string, input: DynTableEditData): Promise<DynTableSaveOutcome> {
  const r = await getServices().dynTable.save(await currentActor(), code, input);
  if (!r.ok) return failed(r.rejection);
  return { ok: true, code: r.value.table.code, ...(r.value.recheck.length > 0 ? { recheck: r.value.recheck.length } : {}) };
}

export async function removeDynTableAction(code: string, confirm = false): Promise<EditOutcome> {
  const result = await getServices().dynTable.remove(await currentActor(), code, { confirm });
  if (result.ok) return { ok: true };
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token: "delete" };
  return { ok: false, message: describeRejection(result.rejection).message };
}
