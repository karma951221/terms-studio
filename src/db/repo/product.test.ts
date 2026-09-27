import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import { productCoveragePlans, productCoverages, productPlans } from "../schema";
import { createTestDb, type TestDb } from "../test-utils";
import * as repo from "./product";

describe("product repo (PGlite) — 스키마 · 채번 · 매핑", () => {
  let t: TestDb;
  const who = "00000000-0000-4000-8000-000000000001";
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("담보속성 코드 순번은 카탈로그와 같은 시퀀스 테이블을 kind attribute / attributeValue 로 공유한다", async () => {
    expect(await repo.nextAttributeSeq(t.db, "attribute", "")).toBe(1);
    expect(await repo.nextAttributeSeq(t.db, "attribute", "")).toBe(2);
    expect(await repo.nextAttributeSeq(t.db, "attributeValue", "A0001")).toBe(1);
    expect(await repo.nextAttributeSeq(t.db, "attributeValue", "A0002")).toBe(1);
  });

  it("담보속성 종류 + 유효값(작명 규칙) 저장 → 도메인 객체로 읽힌다 (order 순)", async () => {
    await repo.insertAttributeKind(t.db, { code: "A0001", label: "갱신유형", order: 0, values: [] }, who);
    await repo.saveAttributeKind(
      t.db,
      {
        code: "A0001",
        label: "갱신유형",
        order: 0,
        values: [
          { code: "V02", label: "갱신형", order: 0, fragment: "갱신형" },
          { code: "V01", label: "비갱신형", order: 1, fragment: "" },
        ],
      },
      who,
    );
    const kinds = await repo.listAttributeKinds(t.db);
    expect(kinds).toEqual([
      {
        code: "A0001",
        label: "갱신유형",
        order: 0,
        values: [
          { code: "V02", label: "갱신형", order: 0, fragment: "갱신형" },
          { code: "V01", label: "비갱신형", order: 1, fragment: "" },
        ],
      },
    ]);
    // 값 삭제 반영
    await repo.saveAttributeKind(t.db, { ...kinds[0], values: [kinds[0].values[0]] }, who);
    expect((await repo.loadAttributeKind(t.db, "A0001"))?.values.map((v) => v.code)).toEqual(["V02"]);
  });

  it("전역 명명 템플릿은 행이 없으면 [담보명]이고 수정값을 왕복한다", async () => {
    expect(await repo.loadNamingTemplate(t.db)).toBe("[담보명]");
    await repo.saveNamingTemplate(t.db, "[A0001] [담보명]", who);
    expect(await repo.loadNamingTemplate(t.db)).toBe("[A0001] [담보명]");
  });

  it("상품 · 상품담보(조합 · 스냅샷 노드) 저장과 조회", async () => {
    const product = await repo.insertProduct(t.db, { name: "알파Plus(축약)" }, who);
    expect(product.id).toMatch(/[0-9a-f-]{36}/);
    const cov = "11111111-1111-4111-8111-111111111111";
    const pc = await repo.insertProductCoverage(
      t.db,
      { productId: product.id, coverageId: cov, coverageName: "일반상해사망", name: "일반상해사망 추가", attributes: [{ kindCode: "A0001", valueCode: "V02" }], combinationKey: `${cov}|A0001=V02` },
      who,
    );
    const sub = await repo.insertNode(t.db, { productCoverageId: pc.id, kind: "sub", masterNodeId: "22222222-2222-4222-8222-222222222222", name: "세부보장", order: 0 }, who);
    await repo.insertNode(t.db, { productCoverageId: pc.id, kind: "benefit", masterNodeId: "33333333-3333-4333-8333-333333333333", parentId: sub.id, name: "급부", order: 0 }, who);
    const loaded = await repo.loadProductCoverage(t.db, pc.id);
    expect(loaded).toEqual({ id: pc.id, productId: product.id, coverageId: cov, name: "일반상해사망 추가", attributes: [{ kindCode: "A0001", valueCode: "V02" }] });
    const nodes = await repo.listNodes(t.db, pc.id);
    expect(nodes.map((n) => [n.kind, n.name, n.parentId === sub.id])).toEqual([
      ["sub", "세부보장", false],
      ["benefit", "급부", true],
    ]);
  });

  it("세목 목록은 createdAt 이 같아도 조합 키 순으로 안정 정렬된다", async () => {
    const product = await repo.insertProduct(t.db, { name: "정렬 안정성 — 세목" }, who);
    const keys = ["K8", "K3", "K6", "K1", "K9", "K4", "K7", "K2"];
    const idOf = new Map<string, string>();
    for (const [i, key] of keys.entries()) {
      // 세목 하나는 축마다 선택지 하나 — 조합이 비면 insertPlan 이 빈 values() 로 실패한다.
      const option = await repo.insertPlanOption(t.db, product.id, { axis: "type", number: i + 1, name: `제${i + 1}종`, planTypeCode: "D0002" }, who);
      idOf.set(key, (await repo.insertPlan(t.db, product.id, key, [option.id], who)).id);
    }
    // createdAt 을 강제로 동률로 만든다 — PGlite 에서 실제로 82% 확률로 일어나는 상황이다.
    await t.db.update(productPlans).set({ createdAt: new Date("2026-09-08T00:00:00.000Z") }).where(eq(productPlans.productId, product.id));
    expect((await repo.listPlans(t.db, product.id)).map((p) => p.id)).toEqual([...keys].sort().map((k) => idOf.get(k)));
  });

  it("탑재 목록은 createdAt 이 같아도 조합 키 순으로 안정 정렬된다", async () => {
    const product = await repo.insertProduct(t.db, { name: "정렬 안정성 — 탑재" }, who);
    const order = [8, 3, 6, 1, 9, 4, 7, 2];
    for (const n of order) {
      await repo.insertProductCoverage(
        t.db,
        { productId: product.id, coverageId: "44444444-4444-4444-8444-444444444444", coverageName: `담보${n}`, name: `담보${n}`, combinationKey: `K${n}`, attributes: [] },
        who,
      );
    }
    await t.db.update(productCoverages).set({ createdAt: new Date("2026-09-08T00:00:00.000Z") }).where(eq(productCoverages.productId, product.id));
    expect((await repo.listProductCoverages(t.db, product.id)).map((c) => c.name)).toEqual([...order].sort().map((n) => `담보${n}`));
  });

  describe("상품 단위 일괄 조회 — 조립 적재는 상품담보 수와 무관한 쿼리 수로 읽는다 (ADR-0034 결정 3)", () => {
    let productId: string;
    let pcA: string;
    let pcB: string;
    let pcEmpty: string;
    let plan1: string;
    let plan2: string;

    beforeAll(async () => {
      const product = await repo.insertProduct(t.db, { name: "일괄 조회" }, who);
      productId = product.id;
      const cov = "55555555-5555-4555-8555-555555555555";
      const mk = (n: string) => repo.insertProductCoverage(t.db, { productId, coverageId: cov, coverageName: `담보명 ${n}`, name: `상품담보 ${n}`, combinationKey: `K${n}`, attributes: [] }, who);
      pcA = (await mk("A")).id;
      pcB = (await mk("B")).id;
      pcEmpty = (await mk("E")).id;
      // A: 세부보장 2(순서 역순 삽입) · 급부는 첫 세부보장 아래 2 · 고아 급부 1 — listNodes 의 정렬 규칙(세부보장 order → 소속 급부 order → 고아 급부)이 그대로여야 한다
      const subA2 = await repo.insertNode(t.db, { productCoverageId: pcA, kind: "sub", masterNodeId: "a2000000-0000-4000-8000-000000000000", name: "A-세부2", order: 1 }, who);
      const subA1 = await repo.insertNode(t.db, { productCoverageId: pcA, kind: "sub", masterNodeId: "a1000000-0000-4000-8000-000000000000", name: "A-세부1", order: 0 }, who);
      await repo.insertNode(t.db, { productCoverageId: pcA, kind: "benefit", masterNodeId: "a1200000-0000-4000-8000-000000000000", parentId: subA1.id, name: "A-급부1-2", order: 1 }, who);
      await repo.insertNode(t.db, { productCoverageId: pcA, kind: "benefit", masterNodeId: "a1100000-0000-4000-8000-000000000000", parentId: subA1.id, name: "A-급부1-1", order: 0 }, who);
      await repo.insertNode(t.db, { productCoverageId: pcA, kind: "benefit", masterNodeId: "a2100000-0000-4000-8000-000000000000", parentId: subA2.id, name: "A-급부2-1", order: 0 }, who);
      await repo.insertNode(t.db, { productCoverageId: pcA, kind: "benefit", masterNodeId: "a0900000-0000-4000-8000-000000000000", name: "A-고아급부", order: 0 }, who);
      const subB = await repo.insertNode(t.db, { productCoverageId: pcB, kind: "sub", masterNodeId: "b1000000-0000-4000-8000-000000000000", name: "B-세부1", order: 0 }, who);
      await repo.insertNode(t.db, { productCoverageId: pcB, kind: "benefit", masterNodeId: "b1100000-0000-4000-8000-000000000000", parentId: subB.id, name: "B-급부1-1", order: 0 }, who);
      // 세목 2 (조합 키 순 K1 < K2) — A 에는 둘 다(2 를 먼저 부착) · B 에는 1 · E 는 없음
      const o1 = await repo.insertPlanOption(t.db, productId, { axis: "type", number: 1, name: "1종", planTypeCode: "waiver" }, who);
      const o2 = await repo.insertPlanOption(t.db, productId, { axis: "type", number: 2, name: "2종", planTypeCode: "waiver" }, who);
      plan1 = (await repo.insertPlan(t.db, productId, "K1", [o1.id], who)).id;
      plan2 = (await repo.insertPlan(t.db, productId, "K2", [o2.id], who)).id;
      await repo.attachPlan(t.db, pcA, plan2, who);
      await repo.attachPlan(t.db, pcA, plan1, who);
      await repo.attachPlan(t.db, pcB, plan1, who);
      // 부착 시각을 명시해 「2 를 먼저 부착」을 고정한다 — PGlite 에서는 createdAt 동률이 흔하고, 동률이면 조합 키 순(K1 < K2)이다.
      await t.db.update(productCoveragePlans).set({ createdAt: new Date("2026-09-08T00:00:00.000Z") }).where(and(eq(productCoveragePlans.productCoverageId, pcA), eq(productCoveragePlans.planId, plan2)));
      await t.db.update(productCoveragePlans).set({ createdAt: new Date("2026-09-08T00:00:01.000Z") }).where(and(eq(productCoveragePlans.productCoverageId, pcA), eq(productCoveragePlans.planId, plan1)));
    });

    it("listNodesForProduct — 상품담보별 노드 목록이 listNodes 와 같은 순서 · 쿼리 1회 · 노드 없는 상품담보는 키 없음", async () => {
      t.resetQueryCount();
      const byPc = await repo.listNodesForProduct(t.db, productId);
      expect(t.queryCount()).toBe(1);
      expect(byPc.get(pcA)).toEqual(await repo.listNodes(t.db, pcA));
      expect(byPc.get(pcB)).toEqual(await repo.listNodes(t.db, pcB));
      expect(byPc.get(pcA)!.map((n) => n.name)).toEqual(["A-세부1", "A-급부1-1", "A-급부1-2", "A-세부2", "A-급부2-1", "A-고아급부"]);
      expect(byPc.has(pcEmpty)).toBe(false);
      expect(await repo.listNodesForProduct(t.db, "00000000-0000-4000-8000-0000000000ff")).toEqual(new Map());
    });

    it("coverageNamesOf — 탑재 시점 담보명을 id 묶음으로 · 빈 목록은 쿼리 없음 · 없는 id 는 키 없음", async () => {
      t.resetQueryCount();
      expect(await repo.coverageNamesOf(t.db, [])).toEqual(new Map());
      expect(t.queryCount()).toBe(0);
      const names = await repo.coverageNamesOf(t.db, [pcA, pcB, "00000000-0000-4000-8000-0000000000ff"]);
      expect(t.queryCount()).toBe(1);
      expect(names).toEqual(new Map([[pcA, "담보명 A"], [pcB, "담보명 B"]]));
    });

    it("listAttachedPlansForProduct — 상품담보별 부착 세목(부착 순) · 쿼리 수가 상품담보 수와 무관", async () => {
      t.resetQueryCount();
      const byPc = await repo.listAttachedPlansForProduct(t.db, productId);
      const n = t.queryCount();
      expect(n).toBeLessThanOrEqual(2);
      expect(byPc.get(pcA)!.map((p) => p.id)).toEqual([plan2, plan1]);
      expect(byPc.get(pcB)!.map((p) => p.id)).toEqual([plan1]);
      expect(byPc.has(pcEmpty)).toBe(false);
      // 단건 경로(listAttachedPlanIds + loadPlan)와 같은 내용
      const single = [];
      for (const id of await repo.listAttachedPlanIds(t.db, pcA)) single.push((await repo.loadPlan(t.db, id))!);
      expect(byPc.get(pcA)).toEqual(single);
      // 상품담보를 하나 더 부착해도 쿼리 수 그대로
      const pcC = (await repo.insertProductCoverage(t.db, { productId, coverageId: "55555555-5555-4555-8555-555555555555", coverageName: "담보명 C", name: "상품담보 C", combinationKey: "KC", attributes: [] }, who)).id;
      await repo.attachPlan(t.db, pcC, plan2, who);
      t.resetQueryCount();
      expect((await repo.listAttachedPlansForProduct(t.db, productId)).get(pcC)!.map((p) => p.id)).toEqual([plan2]);
      expect(t.queryCount()).toBe(n);
    });
  });
});
