"use server";

import type { EditOutcome } from "@/app/_lib/edit";
import { describeRejection } from "@/app/_lib/rejection";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { AttributeEditData, NamingTemplateEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

export async function saveAttributeEditAction(code: string, input: AttributeEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const current = await services.product.getAttributeKind(code);
  if (!current) return { ok: false, message: `담보속성을 찾을 수 없습니다 — ${code}` };

  let error: EditOutcome | undefined;
  if (input.label !== current.label) {
    error = failed(await services.product.renameAttributeKind(actor, code, input.label), "label");
    if (error) return error;
  }

  const existing = new Set(current.values.map((value) => value.code));
  const order: string[] = [];
  for (const value of input.values) {
    if (existing.has(value.code)) {
      const before = current.values.find((item) => item.code === value.code)!;
      if (value.label !== before.label) {
        error = failed(await services.product.renameAttributeValue(actor, code, value.code, value.label), value.code);
        if (error) return error;
      }
      if (value.fragment !== before.fragment) {
        error = failed(await services.product.setNamingFragment(actor, code, value.code, value.fragment), value.code);
        if (error) return error;
      }
      order.push(value.code);
    } else {
      const added = await services.product.addAttributeValue(actor, code, { label: value.label, fragment: value.fragment });
      error = failed(added, value.code);
      if (error) return error;
      if (added.ok) order.push(added.value.values.at(-1)!.code);
    }
  }
  error = failed(await services.product.reorderAttributeValues(actor, code, order), "order");
  return error ?? { ok: true };
}

export async function removeAttributeEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().product.removeAttributeKind(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}

export async function removeAttributeValueEditAction(code: string, valueCode: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().product.removeAttributeValue(await currentActor(), code, valueCode, { confirm }), valueCode) ?? { ok: true };
}

export async function saveNamingTemplateEditAction(input: NamingTemplateEditData): Promise<EditOutcome> {
  const result = await getServices().product.setNamingTemplate(await currentActor(), input.template);
  return failed(result, "template") ?? { ok: true };
}
