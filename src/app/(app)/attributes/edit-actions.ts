"use server";

import type { EditOutcome } from "@/app/_lib/edit";
import { describeRejection } from "@/app/_lib/rejection";
import { saveOnce } from "@/app/_lib/saveOnce";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { AttributeEditData, NamingTemplateEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

const isNew = (code: string) => code.startsWith("new:");

/**
 * 담보속성 상세의 저장 — 종류명 · 유효값 행(추가 · 이름 · 조각 · 순서 · **삭제**)이 저장 한 번이다 (디자인원칙 §2 L2).
 *
 * 값 표는 최종 목록 한 벌로 서비스 `reviseAttributeKind` 에 넘긴다 — 한 단계씩 고치면 이름 맞바꾸기가 중간 상태에서 거부되고,
 * 앞 단계는 이미 커밋돼 있었다 (점검 2026-09-27 H1). 표에서 ✕ 로 뺀 저장된 값은 여기서 빠지고, 확인은 **저장 시점**에 한 번 —
 * 빠진 값 전부의 사용처를 합친 대화상자다 (D2). 전체가 한 트랜잭션이라 거부 · 확인 대기 중엔 아무것도 남지 않는다.
 */
export async function saveAttributeEditAction(code: string, input: AttributeEditData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  return saveOnce(services, async () => {
    const current = await services.product.getAttributeKind(code);
    if (!current) return { ok: false, message: `담보속성을 찾을 수 없습니다 — ${code}` };
    const values = input.values.map(({ code: valueCode, label, fragment }) => (isNew(valueCode) ? { label, fragment } : { code: valueCode, label, fragment }));
    const result = await services.product.reviseAttributeKind(actor, code, { label: input.label, values }, { confirm });
    if (result.ok) return { ok: true };
    if (result.rejection.reason === "needsConfirmation") {
      const kept = new Set(input.values.map((value) => value.code));
      const removed = current.values.filter((value) => !kept.has(value.code)).length;
      return { ok: "confirm", impact: result.rejection.impact, token: "values", title: "값을 빼면 그 값을 쓰는 곳이 깨질 수 있다", actionLabel: `값 ${removed}개 삭제하고 저장` };
    }
    return failed(result, "values")!;
  });
}

export async function removeAttributeEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().product.removeAttributeKind(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}

export async function saveNamingTemplateEditAction(input: NamingTemplateEditData): Promise<EditOutcome> {
  const result = await getServices().product.setNamingTemplate(await currentActor(), input.template);
  return failed(result, "template") ?? { ok: true };
}
