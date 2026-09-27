"use server";

/**
 * 별표 상세의 저장 · 삭제 — 화면 하나에 저장은 하나다 (디자인원칙 §2 L2).
 *
 * 서비스에는 renameAppendix · setAppendixDescription 으로 나뉜 API 만 있다.
 * 그 사이는 여기서 메운다 — 저장된 것과 화면이 들고 온 값을 견줘 달라진 것만 부른다.
 * 전체가 한 트랜잭션이다 (`saveOnce`, 점검 2026-09-27 H1) — 뒤 단계가 거부되면 이름도 남지 않는다.
 */
import type { EditOutcome } from "@/app/_lib/edit";
import { describeRejection } from "@/app/_lib/rejection";
import { saveOnce } from "@/app/_lib/saveOnce";
import type { Code, Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { AppendixEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveAppendixEditAction(code: Code, input: AppendixEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const before = await services.document.getAppendix(code);
  if (!before) return { ok: false, message: `찾을 수 없습니다 — 별표 ${code}` };

  return saveOnce(services, async () => {
    if (input.name !== before.name) {
      const error = failed(await services.document.renameAppendix(actor, code, input.name), "name");
      if (error) return error;
    }
    if (input.description !== before.description) {
      const error = failed(await services.document.setAppendixDescription(actor, code, input.description), "description");
      if (error) return error;
    }
    return { ok: true };
  });
}

export async function removeAppendixEditAction(code: Code, confirm = false): Promise<EditOutcome> {
  const result = await getServices().document.removeAppendix(await currentActor(), code, { confirm });
  return failed(result, "delete") ?? { ok: true };
}
