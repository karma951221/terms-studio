"use server";

import { redirect } from "next/navigation";

import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { AttachLevel, Code } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { bool, resultTypeFromForm, str } from "./lib";

const BASE = "/catalog";

function detailPath(code: Code): string {
  return `${BASE}/${code}`;
}
function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}

// ───────────────────────────── 생성 ─────────────────────────────

/**
 * 새 구분자 — 구분자명 · 레벨 · 식 · 주석 (ADR-0037: 종류·타입·노출·상수값이 없다)
 * + 선택인 결과 타입 (기능/구분자 §3.1: 미지정이면 키를 싣지 않는다 — 추론 타입만 쓴다).
 */
export async function createDiscriminatorAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const resultType = resultTypeFromForm(str(formData, "resultTypeKind"), bool(formData, "resultTypeMulti"), str(formData, "resultTypeEnum"));
  const r = await getServices().catalog.create(actor, {
    label: str(formData, "label"),
    level: str(formData, "level") as AttachLevel,
    expression: str(formData, "expression"),
    description: str(formData, "description"),
    ...(resultType ? { resultType } : {}),
  });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.code));
}

export async function createEnumAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const values = str(formData, "values")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
  const r = await getServices().catalog.createEnum(actor, { label: str(formData, "label"), values });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

// ───────────────────────────── 상세 · 비파괴 편집 ─────────────────────────────

/**
 * 「기본 정보」 한 폼 = 저장 하나 (디자인원칙 §2 L2 · 리뷰 #53).
 * 기존 단일 액션들을 순서대로 부르고, 첫 거부에서 멈춰 그 문장을 돌려준다 —
 * 새 규칙을 여기서 만들지 않는다 (규칙은 서비스에 있다).
 */
export async function saveBasicInfoAction(code: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const fail = (r: { ok: false; rejection: Parameters<typeof describeRejection>[0] }): never =>
    redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));

  const renamed = await services.catalog.rename(actor, code, str(formData, "label"));
  if (!renamed.ok) fail(renamed);
  const described = await services.catalog.setDescription(actor, code, str(formData, "description"));
  if (!described.ok) fail(described);
  const expression = await services.catalog.setExpression(actor, code, str(formData, "expression"));
  if (!expression.ok) fail(expression);
  redirect(detailPath(code));
}

// ───────────────────────────── 파괴적 (2단 — 확인 폼이 confirm:true 로 호출) ─────────────────────────────

export async function removeAction(code: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.remove(actor, code, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(code), msg(r.rejection)));
  redirect(BASE);
}

export async function removeEnumValueAction(enumCode: Code, valueCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.removeEnumValue(actor, enumCode, valueCode, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function removeEnumAction(enumCode: Code): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.removeEnum(actor, enumCode, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function addEnumValueAction(enumCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.addEnumValue(actor, enumCode, { label: str(formData, "label") });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function renameEnumValueAction(enumCode: Code, valueCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.renameEnumValue(actor, enumCode, valueCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}

export async function renameEnumAction(enumCode: Code, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().catalog.renameEnum(actor, enumCode, str(formData, "label"));
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/enums`, msg(r.rejection)));
  redirect(`${BASE}/enums`);
}
