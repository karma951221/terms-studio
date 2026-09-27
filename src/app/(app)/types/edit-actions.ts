"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";
import { saveEnum } from "@/db/repo/catalog";

import type { EnumEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveEnumEditAction(code: string, input: EnumEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const current = await services.catalog.getEnum(code);
  if (!current) return { ok: false, message: "열거형변수를 찾을 수 없습니다." };
  let error = failed(await services.catalog.renameEnum(actor, code, input.label), "label");
  if (error) return error;
  const existing = new Set(current.values.map((value) => value.code));
  for (const value of input.values.filter((item) => existing.has(item.code))) {
    const result = await services.catalog.renameEnumValue(actor, code, value.code, value.label);
    error = failed(result, value.code);
    if (error) return error;
  }
  // 새 값은 발급받은 코드로 바꿔 **제출 순서 그대로** 정렬한다 — 기존 코드 뒤에 새 코드를 붙이면 새 값을 앞 · 중간으로
  // 옮긴 순서가 사라졌다 (코덱스 리뷰 2026-09-14 Important-4).
  const issued = new Map<string, string>();
  for (const value of input.values.filter((item) => !existing.has(item.code))) {
    const result = await services.catalog.addEnumValue(actor, code, { label: value.label });
    error = failed(result, value.code);
    if (error) return error;
    if (result.ok) issued.set(value.code, result.value.values.at(-1)!.code);
  }
  const codes = input.values.map((item) => issued.get(item.code) ?? item.code);
  error = failed(await services.catalog.reorderEnumValues(actor, code, codes), "order");
  if (error) return error;
  if (input.description !== (current.description ?? "")) {
    const updated = await services.catalog.getEnum(code);
    if (!updated) return { ok: false, message: "열거형변수를 찾을 수 없습니다." };
    await saveEnum(services.db, { ...updated, description: input.description }, actor.userId);
  }
  return { ok: true };
}

export async function removeEnumEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeEnum(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}

export async function removeEnumValueEditAction(code: string, valueCode: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeEnumValue(await currentActor(), code, valueCode, { confirm }), valueCode) ?? { ok: true };
}
