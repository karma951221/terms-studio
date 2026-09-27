import { eq, notInArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discriminatorResultType } from "@/domain/catalog";
import { planTypeOptions } from "@/domain/product";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { discriminators } from "@/db/schema";
import { createServices, type Services } from "@/services/container";

import { ALPHA_PLUS_PRODUCT_NAME, seedAlphaPlus } from "./alphaPlus";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 시드가 실물 알파Plus 재료(카탈로그 · 담보 9 · 상품 · 별표 21 · 탑재 11)를 실제 서비스로 끝까지 만들고, 재실행에 안전한지.
 * 원문과의 대조는 `real.test.ts` 몫.
 */
describe("seedAlphaPlus — 알파Plus 실물 시드 (PGlite)", () => {
  let t: TestDb;
  let services: Services;

  beforeAll(async () => {
    t = await createTestDb();
    services = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("첫 호출 — 생성하고, 조립 미리보기가 complete=true · 특약 10벌 · 별표 14건(참조된 것만)", async () => {
    const r = await seedAlphaPlus(services, admin);
    expect(r.created).toBe(true);

    const preview = await services.assembly.preview(r.productId);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.issues).toEqual([]);
    expect(preview.value.complete).toBe(true);
    // 순서 = 담보명 순 → 담보속성 순 (groups.ts). 수술비 두 벌은 담보 하나의 탑재분이라 붙어 나온다 (비갱신형 → 갱신형).
    expect(preview.value.specials[0].docs.map((d) => d.title)).toEqual([
      "골절(치아파절 제외)진단비Ⅱ보장 특별약관",
      "골절수술비Ⅱ보장 특별약관",
      "수술비(1-7종, 연간3회한)[상해]보장 특별약관",
      "갱신형 수술비(1-7종, 연간3회한)[상해]보장 특별약관",
      "신화상치료비보장 특별약관",
      "일반상해50%이상후유장해 생활자금보장 특별약관",
      "일반상해80%이상후유장해 생활자금보장 특별약관",
      "일반상해사망보장 특별약관",
      "일반상해사망보장 추가 특별약관",
      "중대한특정상해수술비보장 특별약관",
    ]);
    // 별표 마스터는 21건이지만 책자에 실리는 것은 문면이 참조한 것뿐 — 번호는 등장 순 (ADR-0063)
    expect(preview.value.appendices.map((a) => a.code)).toEqual([
      // 장해 · 적립이율 · 암 · 뇌졸중 · 급성심근경색 · 말기폐질환 · 말기간경화 · 양성뇌종양 · 만성당뇨합병증
      "AX000002", "AX000001", "AX000004", "AX000007", "AX000008", "AX000010", "AX000011", "AX000020", "AX000012",
      // 골절(치아파절 제외)Ⅱ · 골절Ⅱ · 1-7종 수술 · 화상 · 중대한 특정상해
      "AX000014", "AX000021", "AX000003", "AX000013", "AX000015",
    ]);
    expect(preview.value.appendices[0]).toMatchObject({ code: "AX000002", number: 1, name: "장해분류표" });
    expect(preview.value.baseContracts.map((b) => b.name)).toEqual(["일반상해80%이상후유장해"]);

    const defs = await services.catalog.list();
    expect(defs.find((d) => d.code === "D0001")).toMatchObject({ label: "담보명", level: "coverage", expression: "coverage_basic.claim_name" });
    // 세목유형 4종은 이제 세목 레벨 마스터 폼이다 (ADR-0037 · 기능/마스터 §3.3)
    expect(planTypeOptions().map((t) => t.label)).toEqual(["납입면제", "무저해지", "계약전환", "영위업종적용"]);
    expect((await services.catalog.getEnum("E0001"))?.values.map((v) => v.label)).toEqual(["질병", "상해"]);
    expect((await services.catalog.getEnum("E0002"))?.values.map((v) => v.label)).toEqual(["해약환급금지급형", "해약환급금미지급형", "해약환급금미지급형(납입후50%)"]);

    const options = await services.product.listPlanOptions(r.productId);
    expect(options.map((option) => [option.axis, option.number, option.name, option.planTypeCode])).toEqual([
      ["type", 1, "보험료 납입면제 미적용형", "waiver"],
      ["type", 2, "보험료 납입면제형", "waiver"],
    ]);
    expect(await services.product.listPlans(r.productId)).toHaveLength(2);
    expect(Object.fromEntries(await services.product.getPlanOptionValues(options[1].id))).toEqual({ "waiver.applies": { entered: true, value: true }, "waiver.reasons": { entered: true, value: ["V01", "V02"] } });
  });

  it("급부 특성 시드 구분자 — 감액여부(3레벨) · 면책 넷 (ADR-0065 §5)", async () => {
    const defs = await services.catalog.list();
    const byLabel = (label: string, level: string) => defs.find((d) => d.label === label && d.level === level);
    expect(byLabel("감액여부", "benefit")?.expression).toBe("exist(reduction.periods)");
    expect(byLabel("감액여부", "subCoverage")?.expression).toMatch(/^any\(D\d{4}\)$/);
    expect(byLabel("감액여부", "coverage")?.expression).toMatch(/^any\(D\d{4}\)$/);
    expect(byLabel("면책기간", "benefit")?.expression).toBe("exemption.months");
    expect(byLabel("면책15세이상", "benefit")?.expression).toBe("exemption.age15_only");
    const catalog = new Map(defs.map((d) => [d.code, d]));
    expect(discriminatorResultType(byLabel("감액여부", "coverage")!, undefined, catalog)).toEqual({ kind: "boolean" });
  });

  it("두 번째 호출 — no-op (상품명으로 이미 있음을 판단), 상품 id 동일 · 여전히 complete=true", async () => {
    const first = await seedAlphaPlus(services, admin);
    const second = await seedAlphaPlus(services, admin);
    expect(second.created).toBe(false);
    expect(second.productId).toBe(first.productId);

    const preview = await services.assembly.preview(second.productId);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.complete).toBe(true);

    const products = await services.product.listProducts();
    expect(products.filter((p) => p.name === ALPHA_PLUS_PRODUCT_NAME)).toHaveLength(1);
  });

  it("기존 DB에 빠진 특성만 보충하고 사용자 코드·상품을 보존하며 재실행해도 중복되지 않는다", async () => {
    const product = (await services.product.listProducts()).find((p) => p.name === ALPHA_PLUS_PRODUCT_NAME)!;
    // 이전 버전: D0001만 시드였고 D0002는 사용자가 이미 사용 중이다.
    await t.db.delete(discriminators).where(notInArray(discriminators.code, ["D0001", "D0002"]));
    await t.db.update(discriminators).set({ label: "사용자 지급률", expression: "pay.rate" }).where(eq(discriminators.code, "D0002"));
    const before = await services.catalog.get("D0002");
    const result = await seedAlphaPlus(services, admin);
    expect(result).toEqual({ created: false, productId: product.id });
    expect(await services.catalog.get("D0002")).toEqual(before);
    const defs = await services.catalog.list();
    expect(defs).toHaveLength(11);
    const reduction = defs.find((d) => d.level === "benefit" && d.expression === "exist(reduction.periods)")!;
    expect(reduction.code).not.toBe("D0002");
    for (const level of ["coverage", "subCoverage"]) {
      expect(defs.find((d) => d.level === level && d.label === "감액여부")?.expression).toBe(`any(${reduction.code})`);
    }
    const renamed = await services.catalog.rename(admin, reduction.code, "사용자 감액 이름");
    expect(renamed.ok).toBe(true);
    await seedAlphaPlus(services, admin);
    expect(await services.catalog.list()).toHaveLength(11);
    expect((await services.catalog.get(reduction.code))?.label).toBe("사용자 감액 이름");
  });

  it("두 번째 기본계약 지정은 거부되고(기능/상품 §3 「기본계약」 · MVP 정확히 1개), 기존 상품은 시드 재실행으로 바뀌지 않는다", async () => {
    const product = (await services.product.listProducts()).find((p) => p.name === ALPHA_PLUS_PRODUCT_NAME)!;
    const baseIds = await services.product.listBaseContractIds(product.id);
    expect(baseIds).toHaveLength(1);
    const extra = (await services.product.listProductCoverages(product.id)).find((pc) => !baseIds.includes(pc.id))!;
    const second = await services.product.designateBaseContract(admin, product.id, extra.id);
    expect(second.ok).toBe(false);
    if (!second.ok && second.rejection.reason === "invalid") expect(second.rejection.issues[0].kind).toBe("unsupported");
    const before = await services.product.listBaseContractIds(product.id);
    expect(before).toEqual(baseIds);
    const preview = await services.assembly.preview(product.id);
    expect(preview.ok && preview.value.complete).toBe(true);
    const defs = await services.catalog.list();

    await expect(seedAlphaPlus(services, admin)).resolves.toEqual({ created: false, productId: product.id });
    expect(await services.product.listBaseContractIds(product.id)).toEqual(before);
    expect(await services.catalog.list()).toEqual(defs);
  });
});
