import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planCombinationLabel, planTypeOptions } from "@/domain/product";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { discriminators } from "@/db/schema";
import { createServices, type Services } from "@/services/container";

import { ALPHA_PLUS_PRODUCT_NAME, seedAlphaPlus } from "./alphaPlus";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 시드가 실물 알파Plus 재료(카탈로그 · 담보 9 · 공용조항 11 · 상품 · 별표 21 · 탑재 11)를 실제 서비스로 끝까지 만들고, 재실행에 안전한지.
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

    // 세목 — 종 2(납입면제) · 형 2(무저해지 E0002) · 조합 4 = 종 × 형 전부 (실물 상품, 2026-09-27)
    const options = await services.product.listPlanOptions(r.productId);
    const byAxis = (axis: string) => options.filter((option) => option.axis === axis).map((option) => [option.number, option.name, option.planTypeCode]);
    expect(byAxis("type")).toEqual([
      [1, "보험료 납입면제 미적용형", "waiver"],
      [2, "보험료 납입면제형", "waiver"],
    ]);
    expect(byAxis("form")).toEqual([
      [1, "해약환급금 지급형", "no_surrender"],
      [2, "해약환급금미지급형(납입후50%)", "no_surrender"],
    ]);
    const plans = await services.product.listPlans(r.productId);
    expect(plans.map((plan) => planCombinationLabel(plan.options))).toEqual(["(제1종, 제1형)", "(제1종, 제2형)", "(제2종, 제1형)", "(제2종, 제2형)"]);
    const option = (axis: string, number: number) => options.find((o) => o.axis === axis && o.number === number)!;
    expect(Object.fromEntries(await services.product.getPlanOptionValues(option("type", 2).id))).toEqual({ "waiver.applies": { entered: true, value: true }, "waiver.reasons": { entered: true, value: ["V01", "V02"] } });
    expect(Object.fromEntries(await services.product.getPlanOptionValues(option("form", 1).id))).toEqual({ "no_surrender.type": { entered: true, value: "V01" } });
    expect(Object.fromEntries(await services.product.getPlanOptionValues(option("form", 2).id))).toEqual({ "no_surrender.type": { entered: true, value: "V03" } });

    // 담보코드 — JSON 순서대로 시스템 채번 (기능/담보 §3.1)
    expect((await services.coverage.listSummaries()).find((c) => c.name === "일반상해80%이상후유장해")?.code).toBe("COV000001");
    expect((await services.coverage.listSummaries()).find((c) => c.name === "신화상치료비보장")?.code).toBe("COV000009");

    // 담보속성 유효값 코드 — 유형 안 순번 1 · 2 (V01 아님), 코드 순이 곧 순서 (기능/담보속성 §3.1, 2026-09-28)
    expect((await services.product.listAttributeKinds()).map((k) => [k.code, k.values.map((v) => [v.code, v.label, v.fragment])])).toEqual([
      ["A0001", [["1", "비갱신형", ""], ["2", "갱신형", "갱신형"]]],
      ["A0002", [["1", "기본", ""], ["2", "추가", "추가"]]],
    ]);
    const mounts = await services.product.listProductCoverages(r.productId);
    expect(mounts.find((pc) => pc.name === "일반상해사망보장 추가")?.attributes).toEqual([{ kindCode: "A0002", valueCode: "2" }]);
    expect(mounts.find((pc) => pc.name === "갱신형 수술비(1-7종, 연간3회한)[상해]보장")?.attributes).toEqual([{ kindCode: "A0001", valueCode: "2" }]);
  });

  it("수술비(1-7종) — 세부보장 7 · 각 급부 1, 이름은 「N종 상해수술비(연간3회한)」", async () => {
    const surgery = (await services.coverage.list()).find((c) => c.name === "수술비(1-7종, 연간3회한)[상해]보장")!;
    const names = [1, 2, 3, 4, 5, 6, 7].map((n) => `${n}종 상해수술비(연간3회한)`);
    expect(surgery.subCoverages.map((s) => s.name)).toEqual(names);
    expect(surgery.subCoverages.map((s) => s.benefits.map((b) => b.name))).toEqual(names.map((n) => [n]));
  });

  it("신화상치료비 — 세부보장 3 · 각 급부 1, 급부명 = 세부보장명", async () => {
    const burn = (await services.coverage.list()).find((c) => c.name === "신화상치료비보장")!;
    const names = ["화상진단비", "화상수술비", "중증화상및부식진단비"];
    expect(burn.subCoverages.map((s) => s.name)).toEqual(names);
    expect(burn.subCoverages.map((s) => s.benefits.map((b) => b.name))).toEqual(names.map((n) => [n]));
  });

  it("시드 구분자는 원문 모델링이 쓰는 담보명(D0001) 하나뿐 — 감액 · 면책 · 최초1회 같은 특성 구분자는 두지 않는다 (알파플러스_모델명세 §2)", async () => {
    const defs = await services.catalog.list();
    expect(defs.map((d) => [d.code, d.label, d.level])).toEqual([["D0001", "담보명", "coverage"]]);
  });

  it("공용조항 11건 — 원문이 되풀이하는 문구 (알파플러스_모델명세 §3)", async () => {
    const list = await services.clause.list();
    expect(list.map((c) => [c.code, c.label, c.mode])).toEqual([
      ["C0001", "제3자 판정", "inline"],
      ["C0002", "준용규정", "block"],
      ["C0003", "사망 시 소멸", "inline"],
      ["C0004", "소멸 시 해약환급금 미지급", "inline"],
      ["C0005", "지급사유 발생 시 소멸", "inline"],
      ["C0006", "수술의 정의", "inline"],
      ["C0007", "수술의 장소", "inline"],
      ["C0008", "신의료기술 수술", "inline"],
      ["C0009", "장해지급률 확정 시기", "inline"],
      ["C0010", "분류표 외 후유장해", "inline"],
      ["C0011", "후유장해 합산", "block"],
    ]);
    // 준용규정은 담보속성(갱신유형)을 읽는다 — 요구 참조는 저장 때 식에서 뽑는다 (ADR-0010)
    expect((await services.clause.get("C0002"))?.required).toEqual({ discriminators: [], attributes: ["A0001"] });
    // 쓰임 수 = 참조하는 문서 수 — 사망 시 소멸은 특약 8벌(사망 · 생활자금 둘 · 골절진단 · 골절수술 · 중대한특정상해 · 수술비 · 신화상)
    expect((await services.clause.summaries()).find((c) => c.code === "C0003")?.usageCount).toBe(8);
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

  it("기존 DB 재실행은 카탈로그를 건드리지 않는다 — 사용자가 고친 구분자 · 새로 만든 구분자가 그대로다", async () => {
    const product = (await services.product.listProducts()).find((p) => p.name === ALPHA_PLUS_PRODUCT_NAME)!;
    await t.db.update(discriminators).set({ label: "사용자 담보명" }).where(eq(discriminators.code, "D0001"));
    const before = await services.catalog.list();
    const result = await seedAlphaPlus(services, admin);
    expect(result).toEqual({ created: false, productId: product.id });
    expect(await services.catalog.list()).toEqual(before);
    await t.db.update(discriminators).set({ label: "담보명" }).where(eq(discriminators.code, "D0001"));
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
