"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";
import type { Code } from "@/domain/types";

import { str } from "../catalog/lib";

const enumPath = (code?: Code) => code ? `/types/enums/${code}` : "/types/enums";
const message = (rejection: Parameters<typeof describeRejection>[0]) => describeRejection(rejection).message;

export async function createTypeEnumAction(formData: FormData): Promise<void> {
  const values = formData.getAll("values").map((label) => String(label).trim()).filter(Boolean).map((label) => ({ label }));
  const result = await getServices().catalog.createEnum(await currentActor(), {
    label: str(formData, "label"),
    description: str(formData, "description"),
    values,
  });
  if (!result.ok) redirect(errorRedirectPath("/types/enums/new", message(result.rejection)));
  redirect(enumPath(result.value.code));
}

export async function renameTypeEnumAction(code: Code, formData: FormData): Promise<void> {
  const result = await getServices().catalog.renameEnum(await currentActor(), code, str(formData, "label"));
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function addTypeEnumValueAction(code: Code, formData: FormData): Promise<void> {
  const result = await getServices().catalog.addEnumValue(await currentActor(), code, { label: str(formData, "label") });
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function renameTypeEnumValueAction(code: Code, valueCode: Code, formData: FormData): Promise<void> {
  const result = await getServices().catalog.renameEnumValue(await currentActor(), code, valueCode, str(formData, "label"));
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function reorderTypeEnumValueAction(code: Code, valueCode: Code, direction: "up" | "down"): Promise<void> {
  const services = getServices();
  const item = await services.catalog.getEnum(code);
  if (!item) redirect(errorRedirectPath(enumPath(code), "열거형변수를 찾을 수 없습니다."));
  const order = [...item.values].sort((a, b) => a.order - b.order).map((value) => value.code);
  const index = order.indexOf(valueCode);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index >= 0 && target >= 0 && target < order.length) [order[index], order[target]] = [order[target]!, order[index]!];
  const result = await services.catalog.reorderEnumValues(await currentActor(), code, order);
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function removeTypeEnumValueAction(code: Code, valueCode: Code): Promise<void> {
  const result = await getServices().catalog.removeEnumValue(await currentActor(), code, valueCode, { confirm: true });
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath(code));
}

export async function removeTypeEnumAction(code: Code): Promise<void> {
  const result = await getServices().catalog.removeEnum(await currentActor(), code, { confirm: true });
  if (!result.ok) redirect(errorRedirectPath(enumPath(code), message(result.rejection)));
  redirect(enumPath());
}

export async function createInlineEnumAction(input: { label: string; values: string[] }): Promise<{ ok: true; item: { code: string; label: string; description?: string; values: { code: string; label: string; order: number }[] } } | { ok: false; message: string }> {
  const result = await getServices().catalog.createEnum(await currentActor(), {
    label: input.label.trim(),
    values: input.values.map((label) => ({ label: label.trim() })).filter((value) => value.label),
  });
  return result.ok ? { ok: true, item: result.value } : { ok: false, message: message(result.rejection) };
}
