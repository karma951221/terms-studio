import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { planCombinationLabel, planTypeOptions } from "@/domain/product";
import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { discriminators } from "@/db/schema";
import { createServices, type Services } from "@/services/container";

import { ALPHA_PLUS_PRODUCT_NAME, seedAlphaPlus } from "./alphaPlus";
import { MERITZ_PRODUCT_NAME } from "./load";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 시드가 실물 재료 두 상품(카탈로그 · 담보 9 + 9 · 공용조항 133 · 상품 2 · 별표 21 · 보통약관 2 · 탑재 11 + 9)을 실제 서비스로 끝까지 만들고, 재실행에 안전한지.
 * 원문과의 대조는 `real.test.ts` 몫.
 */
describe("seedAlphaPlus — 실물 시드 두 상품(알파Plus · 메리츠) (PGlite)", () => {
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

  it("공용조항 133건 — 조 · 여러 항 34(두 곳 이상이 되풀이) · 박스 99(원문의 박스 전부 — 같은 박스는 하나) (알파플러스_모델명세 §4 · 메리츠_모델명세 §4)", async () => {
    const list = await services.clause.list();
    expect(list).toHaveLength(133);
    // 조 · 여러 항 — 보통약관이 쓰는 조째 19(C0001~) · 담보약관 조 13 · 준용규정 두 벌(보통약관 조를 가리켜 맨 뒤)
    expect(list.filter((c) => c.mode === "block").map((c) => [c.code, c.label])).toEqual([
      ["C0001", "목적"],
      ["C0002", "보험금 등의 청구"],
      ["C0003", "주소변경통지"],
      ["C0004", "보험수익자의 지정"],
      ["C0005", "대표자의 지정"],
      ["C0006", "계약 전 알릴 의무"],
      ["C0007", "사기에 의한 계약"],
      ["C0008", "제2회 이후 보험료의 납입"],
      ["C0009", "배당금의 지급"],
      ["C0010", "분쟁의 조정"],
      ["C0011", "관할법원"],
      ["C0012", "소멸시효"],
      ["C0013", "약관의 해석 ②③"],
      ["C0014", "설명서 교부 및 보험안내자료 등의 효력"],
      ["C0015", "법령 등의 개정에 따른 계약내용의 변경"],
      ["C0016", "회사의 손해배상책임"],
      ["C0017", "개인정보보호"],
      ["C0018", "준거법"],
      ["C0019", "예금보험에 의한 지급보장"],
      ["C0101", "보장의 범위(신화상치료비)"],
      ["C0102", "보험금의 지급사유(골절진단비)"],
      ["C0103", "보험금의 지급사유(골절수술비)"],
      ["C0104", "보험금 지급에 관한 세부규정(골절진단비)"],
      ["C0105", "보험금 지급에 관한 세부규정(골절수술비)"],
      ["C0106", "보험금 지급에 관한 세부규정(생활자금)"],
      ["C0107", "보험금 지급에 관한 세부규정(후유장해)"],
      ["C0108", "중증화상및부식진단의 정의 및 진단확정"],
      ["C0109", "특별약관의 소멸(사망)"],
      ["C0110", "특별약관의 소멸(지급사유 발생)"],
      ["C0111", "특별약관의 소멸(사망보험금)"],
      ["C0112", "특별약관의 소멸(생활자금)"],
      ["C0113", "특별약관의 소멸(중증화상및부식)"],
      ["C0132", "준용규정(알파Plus)"],
      ["C0133", "준용규정(메리츠)"],
    ]);
    // 박스 — 보통약관이 쓰는 박스는 보통약관보다 먼저(조째 19 바로 뒤, C0100 까지), 담보약관만 쓰는 박스는 담보약관 조 뒤
    const boxes = list.filter((c) => c.mode === "box");
    expect(boxes).toHaveLength(99);
    expect(boxes[0]?.code).toBe("C0020");
    expect(list.slice(0, 100).every((c) => c.mode !== "block" || Number(c.code.slice(1)) <= 19)).toBe(true);
    // 같은 박스는 하나 — 신의료기술평가위원회는 수술 담보 다섯 곳이 함께 쓴다
    expect(boxes.find((c) => c.label === "【신의료기술평가위원회】")?.code).toBe("C0116");
    // 낱말만 다른 박스는 옵션 — 계약 전 알릴 의무의 「청약서에서 · 서면으로」(알파Plus · 메리츠)
    const disclosure = await services.clause.get("C0031");
    expect(disclosure?.options.map((o) => o.values.map((v) => v.label))).toEqual([["청약서에서", "서면으로"]]);
    // 알파Plus 준용규정은 담보속성(갱신유형)을 읽는다 — 요구 참조는 저장 때 식에서 뽑는다 (ADR-0010)
    expect((await services.clause.get("C0132"))?.required).toEqual({ discriminators: [], attributes: ["A0001"] });
    // 쓰임 수 = 참조 자리 수 — 특별약관의 소멸(사망)은 소멸 급부 없는 특약 7벌(알파Plus 3 · 메리츠 4), 보통약관 조째 공용조항은 보통약관 두 벌,
    // 지급사유 발생 소멸은 세 담보(중대한특정상해수술비 · 메리츠 상해 · 질병 80%이상후유장해)
    const summaries = await services.clause.summaries();
    expect(summaries.find((c) => c.code === "C0109")?.usageCount).toBe(7);
    expect(summaries.find((c) => c.code === "C0019")?.usageCount).toBe(2);
    expect(summaries.find((c) => c.code === "C0110")?.usageCount).toBe(3);
  }, 30_000);

  it("메리츠 — 보통약관 · 기본계약(일반상해사망) · 특약 8(전부 갱신형) · 세목 종 3 × 형 2 · 담보 COV000010~18", async () => {
    const product = (await services.product.listProducts()).find((p) => p.name === MERITZ_PRODUCT_NAME)!;
    expect(product).toBeDefined();
    const preview = await services.assembly.preview(product.id);
    if (!preview.ok) throw new Error(JSON.stringify(preview.rejection));
    expect(preview.value.issues).toEqual([]);
    expect(preview.value.baseContracts.map((b) => b.name)).toEqual(["일반상해사망"]);
    expect(preview.value.specials.map((g) => [g.title, g.docs.length])).toEqual([
      ["상해 관련 특별약관", 5],
      ["질병 관련 특별약관", 3],
    ]);
    const options = await services.product.listPlanOptions(product.id);
    expect(options.filter((o) => o.axis === "type").map((o) => o.name)).toEqual(["보험료 납입면제 미적용형", "보험료 납입면제 1형", "보험료 납입면제 2형"]);
    expect(options.filter((o) => o.axis === "form").map((o) => o.name)).toEqual(["해약환급금 지급형", "해약환급금미지급형"]);
    expect(await services.product.listPlans(product.id)).toHaveLength(6);
    const mounts = await services.product.listProductCoverages(product.id);
    expect(mounts.filter((m) => m.attributes.some((a) => a.kindCode === "A0001" && a.valueCode === "2"))).toHaveLength(8);
    const summaries = await services.coverage.listSummaries();
    expect(summaries.find((c) => c.name === "일반상해사망")?.code).toBe("COV000010");
    expect(summaries.find((c) => c.name === "수술비(1-7종, 연간3회한)[질병](통합간편가입)보장")?.code).toBe("COV000018");
    // 별표 마스터는 두 상품이 이름으로 함께 쓴다 — 메리츠 원문 별표14(장해분류표)도 AX000002
    expect(preview.value.appendices[0]).toMatchObject({ code: "AX000002", number: 1, name: "장해분류표" });
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
