"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionOutcome } from "@/app/_components/ValueForm";
import { str } from "@/app/_lib/formData";
import { describeRejection, errorRedirectPath } from "@/app/_lib/rejection";
import type { GeneralSettingsInput, ProductBasicInput, SnapshotOwner } from "@/services/product";
import type { ArticleNode } from "@/domain/document";
import type { Id, Issue, Result } from "@/domain/types";
import type { Submission } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { parseSelections, productDetailPath, type ProductTab } from "./lib";

const basicValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
const basicSlots = z.array(z.object({ path: z.string(), value: basicValue.optional() }).transform((entry) => ({ path: entry.path, value: entry.value })));
const basicSchema = z.object({
  name: z.string(), values: basicSlots,
  options: z.array(z.object({ id: z.string().uuid(), isNew: z.boolean(), axis: z.enum(["type", "form"]), number: z.number().int().positive(), name: z.string(), planTypeCode: z.string(), values: basicSlots })),
  combinations: z.array(z.array(z.string().uuid())),
});

export async function saveProductBasicAction(id: Id, input: ProductBasicInput, confirm = false): Promise<import("@/app/_lib/edit").EditOutcome> {
  const actor = await currentActor();
  const parsed = basicSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "입력 내용을 확인해 주세요. 종·형 번호는 1 이상의 정수여야 합니다." };
  const result = await getServices().product.saveBasic(actor, id, parsed.data, { confirm });
  if (!result.ok) {
    if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token: "basic" };
    return { ok: false, message: msg(result.rejection) };
  }
  revalidatePath(BASE);
  revalidatePath(detailPath(id));
  return { ok: true };
}

const BASE = "/products";

function msg(r: Parameters<typeof describeRejection>[0]): string {
  return describeRejection(r).message;
}
/** 되돌아갈 자리 — 섹션이 사는 탭까지 (기능/상품 §3.8). 탭을 안 주면 기본정보다. 상품담보 · 기본계약 조작은 상품담보 탭. */
function detailPath(id: Id, tab?: ProductTab): string {
  return productDetailPath(id, tab);
}

// ───────────────────────────── 상품 ─────────────────────────────

export async function createProductAction(formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.createProduct(actor, { name: str(formData, "name") });
  if (!r.ok) redirect(errorRedirectPath(`${BASE}/new`, msg(r.rejection)));
  redirect(detailPath(r.value.id));
}

export async function renameProductAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameProduct(actor, id, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(id, "basic"), msg(r.rejection)));
  redirect(detailPath(id, "basic"));
}

/**
 * 보통약관 템플릿 선택·교체·해제. 교체로 조 노출·오버라이드를 잃으면 서비스가
 * `needsConfirmation` 으로 거부한다 — 그때는 **확인 카드가 뜰 자리**로 보낸다
 * (`?tab=general&confirm=template:<새 템플릿 id>`, 해제는 빈 id). 카드의 실행 버튼이
 * 같은 액션을 `confirm=1` 로 다시 부른다 (코덱스 리뷰 2026-09-15 Important-6).
 */
export async function setProductGeneralDocumentAction(id: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const generalDocumentId = str(formData, "generalDocumentId") || undefined;
  const r = await getServices().product.setGeneralDocument(actor, id, generalDocumentId, { confirm: formData.get("confirm") === "1" });
  if (!r.ok && r.rejection.reason === "needsConfirmation") redirect(`${productDetailPath(id, "general")}&confirm=template:${encodeURIComponent(generalDocumentId ?? "")}`);
  if (!r.ok) redirect(errorRedirectPath(productDetailPath(id, "general"), msg(r.rejection)));
  redirect(productDetailPath(id, "general"));
}

/** 확인 카드의 실행 버튼 — 같은 교체를 `confirm` 으로 다시 부른다 (폼에는 필드가 없어 여기서 짠다). */
export async function confirmProductGeneralDocumentAction(id: Id, generalDocumentId: Id | undefined): Promise<void> {
  const fd = new FormData();
  if (generalDocumentId) fd.set("generalDocumentId", generalDocumentId);
  fd.set("confirm", "1");
  await setProductGeneralDocumentAction(id, fd);
}

export async function deleteProductAction(id: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.deleteProduct(actor, id, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(id), msg(r.rejection)));
  redirect(BASE);
}

export async function writeProductValuesAction(productId: Id, submission: Submission): Promise<ActionOutcome> {
  const actor = await currentActor();
  const services = getServices();
  return outcome(await services.product.setProductValues(actor, productId, submission.values));
}

/** 보통약관 탭 저장 결과 — 거부면 이슈 좌표(조 · 함수조항 자리)째 돌려 화면이 그 항목 옆에 붙인다. */
export type GeneralSaveOutcome = { ok: true } | { ok: false; message: string; issues: Issue[] };

const generalSchema = z.object({
  generalDocumentId: z.string().min(1),
  hiddenArticles: z.array(z.string()),
  overrides: z.array(z.object({ nodeId: z.string(), clauseCode: z.string(), options: z.record(z.string(), z.string()) })),
  // 조 사본 (ADR-0079) — 조 노드의 모양은 서비스가 문면 저장 검증으로 본다. 여기서는 조 노드인지 · 자리 id 만
  copies: z
    .array(
      z.object({
        articleId: z.string().min(1),
        article: z.custom<ArticleNode>((v) => typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "article" && typeof (v as { id?: unknown }).id === "string"),
        templateHash: z.string().min(1),
      }),
    )
    .optional(),
  templateVersion: z.number().int().positive().optional(),
});

/**
 * 보통약관 탭 저장 한 번 (기능/상품 §3.8) — 조 노출 · 옵션 오버라이드 · 조 사본(ADR-0079)의 최종 상태를 한 트랜잭션으로.
 * redirect 하지 않는다 — 탭 첫 줄의 `저장`(ProductEditProvider)이 `startTransition` 으로 부르고, 성공하면 읽기로 돌아가 refresh 한다.
 */
export async function saveProductGeneralAction(productId: Id, input: GeneralSettingsInput): Promise<GeneralSaveOutcome> {
  const actor = await currentActor();
  const parsed = generalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "저장할 내용을 읽을 수 없습니다. 새로고침한 뒤 다시 편집해 주세요.", issues: [] };
  const r = await getServices().product.saveGeneralSettings(actor, productId, parsed.data);
  if (!r.ok) {
    const issues = r.rejection.reason === "invalid" ? r.rejection.issues : [];
    return { ok: false, message: issues.length > 0 ? "저장하지 못한 항목이 있습니다. 표시된 자리를 고쳐 주세요." : msg(r.rejection), issues };
  }
  revalidatePath(detailPath(productId));
  return { ok: true };
}

// ───────────────────────────── 조립 미리보기 ─────────────────────────────

/**
 * 미리보기 「실행」 · 「다시 실행」 (기능/조립산출 §3.6) — 지금 입력으로 조립해 산출본을 저장한다(상품당 1행 덮어쓰기).
 * 편집자 가능 · 비파괴. 자동 재실행은 없다 — 이 버튼만이 산출본을 바꾼다.
 * 거부(없는 상품 등)면 `?error=` 로 같은 화면에 돌아온다.
 */
export async function runPreviewAction(id: Id): Promise<void> {
  const actor = await currentActor();
  const path = previewPath(id);
  const r = await getServices().assembly.run(actor, id);
  if (!r.ok) redirect(errorRedirectPath(path, msg(r.rejection)));
  revalidatePath(path);
  redirect(path);
}

function previewPath(id: Id): string {
  return `${BASE}/${id}/preview`;
}

/** 서비스 Result → 폼 결과. 제출은 한 트랜잭션이라 거부되면 아무 값도 안 바뀌어 있다. */
function outcome(r: Result<void>): ActionOutcome {
  if (r.ok) return { ok: true };
  return { ok: false, issues: r.rejection.reason === "invalid" ? r.rejection.issues : [{ kind: "typeMismatch", message: msg(r.rejection), at: {} }] };
}

// ───────────────────────────── 세목 ─────────────────────────────

export async function addPlanOptionAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.addPlanOption(actor, productId, {
    axis: str(formData, "axis") as "type" | "form",
    number: Number(str(formData, "number")),
    name: str(formData, "name"),
    planTypeCode: str(formData, "planTypeCode"),
  });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "basic"), msg(r.rejection)));
  redirect(detailPath(productId, "basic"));
}

/**
 * 세목 선택지 값 저장 — 선택지의 세목유형 폼 하나가 대상. 서비스가 폼 소속(같은 레벨 · 다른 폼 거부)과 타입을 본다.
 * 선택지가 이 상품 것이 아니면 저장하지 않는다 — URL 의 좌표를 믿지 않는다.
 */
export async function writePlanOptionValuesAction(productId: Id, optionId: Id, submission: Submission): Promise<ActionOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const options = await services.product.listPlanOptions(productId);
  if (!options.some((o) => o.id === optionId)) {
    return { ok: false, issues: [{ kind: "brokenRef", message: "이 상품의 세목 선택지가 아닙니다", at: { ownerId: optionId } }] };
  }
  return outcome(await services.product.setPlanOptionValues(actor, optionId, submission.values));
}

export async function removePlanOptionAction(productId: Id, optionId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removePlanOption(actor, optionId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "basic"), msg(r.rejection)));
  redirect(detailPath(productId, "basic"));
}

export async function registerPlanAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const optionIds = formData.getAll("optionIds").map(String);
  const r = await getServices().product.registerPlan(actor, productId, optionIds);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "basic"), msg(r.rejection)));
  redirect(detailPath(productId, "basic"));
}

export async function removePlanAction(productId: Id, planId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.removePlan(actor, planId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "basic"), msg(r.rejection)));
  redirect(detailPath(productId, "basic"));
}

// ───────────────────────────── 상품담보 = 탑재 ─────────────────────────────

export async function mountAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const kinds = await services.product.listAttributeKinds();
  const coverageId = str(formData, "coverageId");
  const section = str(formData, "section") === "base" ? "base" : "special";
  const r = await services.product.mount(actor, productId, coverageId, parseSelections(formData, kinds), section);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "coverages"), msg(r.rejection)));
  redirect(`${detailPath(productId)}/coverages/${r.value.id}`);
}

export async function renameProductCoverageAction(productId: Id, tab: ProductTab, pcId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.renameProductCoverage(actor, pcId, str(formData, "name"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, tab), msg(r.rejection)));
  redirect(detailPath(productId, tab));
}

export async function regenerateNameAction(productId: Id, tab: ProductTab, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.regenerateName(actor, pcId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, tab), msg(r.rejection)));
  redirect(detailPath(productId, tab));
}

export async function setAttributesAction(productId: Id, pcId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const services = getServices();
  const kinds = await services.product.listAttributeKinds();
  const r = await services.product.setAttributes(actor, pcId, parseSelections(formData, kinds), { regenerateName: formData.get("regenerateName") === "on" });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId), msg(r.rejection)));
  redirect(detailPath(productId));
}

export async function unmountAction(productId: Id, tab: ProductTab, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.unmount(actor, pcId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, tab), msg(r.rejection)));
  redirect(detailPath(productId, tab));
}

export async function attachPlanAction(productId: Id, tab: ProductTab, pcId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.attachPlan(actor, pcId, str(formData, "planId"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, tab), msg(r.rejection)));
  redirect(detailPath(productId, tab));
}

export async function detachPlanAction(productId: Id, tab: ProductTab, pcId: Id, planId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.detachPlan(actor, pcId, planId, { confirm: true });
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, tab), msg(r.rejection)));
  redirect(detailPath(productId, tab));
}

export async function writeSnapshotValuesAction(pcId: Id, owner: SnapshotOwner, submission: Submission): Promise<ActionOutcome> {
  const actor = await currentActor();
  const services = getServices();
  return outcome(await services.product.setSnapshotValues(actor, pcId, owner, submission.values));
}

// ───────────────────────────── 기본계약 ─────────────────────────────

export async function designateBaseContractAction(productId: Id, formData: FormData): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.designateBaseContract(actor, productId, str(formData, "productCoverageId"));
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "coverages"), msg(r.rejection)));
  redirect(detailPath(productId, "coverages"));
}

export async function releaseBaseContractAction(productId: Id, pcId: Id): Promise<void> {
  const actor = await currentActor();
  const r = await getServices().product.releaseBaseContract(actor, productId, pcId);
  if (!r.ok) redirect(errorRedirectPath(detailPath(productId, "coverages"), msg(r.rejection)));
  redirect(detailPath(productId, "coverages"));
}
