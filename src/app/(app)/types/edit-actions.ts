"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import { saveOnce } from "@/app/_lib/saveOnce";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { EnumEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

const isNew = (code: string) => code.startsWith("new:");

/**
 * 열거형변수 상세의 저장 — 이름 · 주석 · 값 행(추가 · 이름 · 순서 · **삭제**)이 저장 한 번이다 (디자인원칙 §2 L2 표).
 *
 * 값 표는 최종 목록 한 벌로 서비스 `reviseEnum` 에 넘긴다 — 한 단계씩 고치면 값 이름 A↔B 맞바꾸기가 중간 상태에서
 * 「중복」으로 거부됐다 (점검 2026-09-27 H2 ①). 표에서 ✕ 로 뺀 저장된 값은 여기서 빠지고, 확인은 **저장 시점**에 한 번 —
 * 빠진 값 전부의 영향(값 행 · 사용처)을 합친 대화상자다 (D2). 전체가 한 트랜잭션이라 거부 · 확인 대기 중엔 아무것도 남지 않는다 (H1).
 */
export async function saveEnumEditAction(code: string, input: EnumEditData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  return saveOnce(services, async () => {
    const current = await services.catalog.getEnum(code);
    if (!current) return { ok: false, message: "열거형변수를 찾을 수 없습니다." };
    const values = input.values.map((value) => (isNew(value.code) ? { label: value.label } : { code: value.code, label: value.label }));
    const result = await services.catalog.reviseEnum(actor, code, { label: input.label, description: input.description, values }, { confirm });
    if (result.ok) return { ok: true };
    if (result.rejection.reason === "needsConfirmation") {
      const kept = new Set(input.values.map((value) => value.code));
      const removed = current.values.filter((value) => !kept.has(value.code)).length;
      return { ok: "confirm", impact: result.rejection.impact, token: "values", title: "값을 빼면 저장된 값이 사라질 수 있다", actionLabel: `값 ${removed}개 삭제하고 저장` };
    }
    return failed(result, "values")!;
  });
}

export async function removeEnumEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeEnum(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}
