import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "@/services/container";

import { clausesUsedByGenerals, loadRealBase } from "./load";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 실물 화면 E2E 의 바탕(`SEED_PROFILE=base`) — 별표 · 보통약관 두 벌과 보통약관이 쓰는 공용조항(C0001~C0100 — 조째 19 · 박스 81)만.
 * 화면 E2E 는 그 뒤 코드(C0101~)부터 친다 (docs/QA/시나리오/실물재현_E2E_시나리오.md §4).
 */
describe("loadRealBase — 화면 E2E 바탕", () => {
  let t: TestDb;
  let services: Services;

  beforeAll(async () => {
    t = await createTestDb();
    services = createServices(t.db);
  });
  afterAll(async () => {
    await t.close();
  });

  it("별표 21 · 보통약관이 쓰는 공용조항 100(앞 코드 — 조째 19 · 박스 81) · 보통약관 2 — 담보 · 상품은 없다", async () => {
    expect(await loadRealBase(services, admin)).toEqual({ created: true });
    expect(await services.document.listAppendices()).toHaveLength(21);
    const clauses = (await services.clause.list()).map((c) => c.code);
    expect(clauses).toEqual([...clausesUsedByGenerals()].sort());
    expect(clauses).toEqual(Array.from({ length: 100 }, (_, i) => `C${String(i + 1).padStart(4, "0")}`));
    expect((await services.document.list("general")).map((d) => d.title).sort()).toEqual([
      "무배당 메리츠 통합간편건강보험(연만기형)2607(통합간편심사형) 보통약관",
      "무배당 알파Plus보장보험2604 보통약관",
    ]);
    expect(await services.coverage.listSummaries()).toEqual([]);
    expect(await services.product.listProducts()).toEqual([]);
  });

  it("다시 부르면 아무것도 하지 않는다", async () => {
    expect(await loadRealBase(services, admin)).toEqual({ created: false });
    expect(await services.clause.list()).toHaveLength(100);
  });
});
