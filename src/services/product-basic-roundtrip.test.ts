import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findForm } from "@/domain/master";
import type { Actor } from "@/domain/types";

import { seedAlphaPlus } from "@/db/seed/alphaPlus";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { buildForm, initFormState, toSubmission } from "@/forms";
import { createServices, type Services } from "@/services/container";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 상품 기본정보 저장 왕복 — 화면(BasicTab)이 하는 일을 화면 없이 그대로 밟는다:
 * 서비스에서 읽기 → `buildForm` → `initFormState` → (상품명만 고침) → `toSubmission` → `saveBasic`.
 *
 * 점검 2026-09-27 H3 · D3 (c): 시드 알파Plus `type-1` 은 `waiver.reasons: []`(명시적 빈 목록)다.
 * 상품명만 고쳐 저장해도 이 행이 지워져 미입력이 되면 안 된다 — 사람이 손대지 않은 칸은 변경 없음.
 */
describe("상품 기본정보 저장 왕복 — 명시적 빈 목록 보존 (PGlite · 시드)", () => {
  let t: TestDb;
  let services: Services;
  let productId: string;

  beforeAll(async () => {
    t = await createTestDb();
    services = createServices(t.db);
    productId = (await seedAlphaPlus(services, admin)).productId;
  });
  afterAll(async () => {
    await t.close();
  });

  it("type-1 의 waiver.reasons: [] 는 상품명만 고쳐 저장해도 그대로 남는다", async () => {
    const enumsList = await services.catalog.listEnums();
    const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
    const options = await services.product.listPlanOptions(productId);
    const plans = await services.product.listPlans(productId);
    const type1 = options.find((o) => o.number === 1 && o.axis === "type")!;
    expect((await services.product.getPlanOptionValues(type1.id)).get("waiver.reasons")).toEqual({ entered: true, value: [] });

    // BasicTab 과 같은 모델 — 상품 레벨 폼 + 선택지마다 제 세목유형 폼 하나 (products/[id]/page.tsx)
    const productForm = buildForm("product", enumLookup, await services.product.getProductValues(productId));
    const optionSubmissions = await Promise.all(
      options.map(async (o) => {
        const form = findForm(o.planTypeCode);
        const model = buildForm("plan", enumLookup, await services.product.getPlanOptionValues(o.id), undefined, form ? [form] : []);
        return toSubmission(initFormState(model));
      }),
    );
    const product = toSubmission(initFormState(productForm));
    expect([...product.issues, ...optionSubmissions.flatMap((s) => s.issues)]).toEqual([]);

    const r = await services.product.saveBasic(admin, productId, {
      name: "알파Plus보장보험 개정",
      values: product.values,
      options: options.map((o, i) => ({ ...o, isNew: false, values: optionSubmissions[i].values })),
      combinations: plans.map((p) => p.options.map((o) => o.id)),
    });
    expect(r.ok).toBe(true);

    expect((await services.product.getProduct(productId))?.name).toBe("알파Plus보장보험 개정");
    expect(Object.fromEntries(await services.product.getPlanOptionValues(type1.id))).toEqual({
      "waiver.applies": { entered: true, value: false },
      "waiver.reasons": { entered: true, value: [] },
    });
  });
});
