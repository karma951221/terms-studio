"use server";

/**
 * 「구조 편집」 화면의 저장 액션 (ADR-0052 결정 2) — 탑재된 담보의 세부보장 · 급부 구조를 서비스 `applyStructurePlan` 한 번에.
 *
 * 상세 화면의 저장(`edit-actions.ts`)과 같은 서비스 경로다 — 추가 · 순서는 편집자도 저장하고(비파괴), 삭제가 섞이면
 * 서비스가 편집자를 역할로 거부하고 관리자에게는 1차 `needsConfirmation` 을 준다 (영향에 탑재 상품담보 · 스냅샷 소실 행).
 * 저장 뒤 상세 경로를 revalidate 한다 — 화면이 `/coverages/{id}` 로 돌아간다.
 */
import { revalidatePath } from "next/cache";

import type { EditOutcome } from "@/app/_lib/edit";
import { describeRejection } from "@/app/_lib/rejection";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { REMOVE_FORBIDDEN } from "./lib";
import type { CoverageStructureData } from "./structure-types";

export async function saveCoverageStructureAction(id: Id, input: CoverageStructureData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const result = await services.coverage.applyStructurePlan(actor, id, input.structure, { confirm });
  if (!result.ok) {
    const { rejection } = result;
    if (rejection.reason === "forbidden" && rejection.action === "coverage.deleteNode") return { ok: false, message: REMOVE_FORBIDDEN };
    // 삭제 수는 트랜잭션 안 계획의 것이어야 하는데 서비스는 영향만 돌려준다 — 바깥에서 다시 센 수는 어긋날 수 있어 붙이지 않는다.
    if (rejection.reason === "needsConfirmation") {
      return { ok: "confirm", impact: rejection.impact, token: "structure", title: "구조를 바꾸면 탑재된 상품의 값이 사라질 수 있다", actionLabel: "세부보장·급부 삭제하고 저장" };
    }
    return { ok: false, message: describeRejection(rejection).message };
  }
  revalidatePath(`/coverages/${id}`);
  return { ok: true };
}
