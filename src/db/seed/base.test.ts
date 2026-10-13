import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "@/services/container";

import { boxesUsedByGenerals, clausesUsedByGenerals, loadRealBase } from "./load";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

/**
 * 실물 화면 E2E 의 바탕(`SEED_PROFILE=base`) — 별표 · 보통약관 세 벌(알파Plus 2604 · 2607 · 메리츠)과 보통약관이 쓰는 박스(BX000001~BX000122) · 함수조항(C0001~C0053 —
 * 조째 21 + 납입면제 함수조항 32(사유별 호 · 정의 · 역할, ADR-0086)), 그리고 그것들이 읽는 열거형(E0001 납입면제사유 — 필드 포함) · 구분자(앞 코드).
 * 화면 E2E 는 그 뒤 코드(BX000123~ · C0054~)부터 친다 (docs/QA/시나리오/실물재현_E2E_시나리오.md §4).
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

  it("별표 21 · 열거형 2(E0001 · 필드 셋, E0002 — D0003 이 읽는 무저해지 유형) · 구분자 6(D0001 ~ D0006 — 부활 문구가 기본 연결로 읽는 D0006 갱신형 상품까지 앞 코드) · 보통약관이 쓰는 박스 122 · 함수조항 53(앞 코드 — 2607 보통약관도 2604 것을 함께 쓴다) · 보통약관 3 — 담보 · 상품은 없다", async () => {
    expect(await loadRealBase(services, admin)).toEqual({ created: true });
    expect(await services.document.listAppendices()).toHaveLength(21);
    const clauses = (await services.clause.list()).map((c) => c.code);
    expect(clauses).toEqual([...clausesUsedByGenerals()].sort());
    expect(clauses).toEqual(Array.from({ length: 53 }, (_, i) => `C${String(i + 1).padStart(4, "0")}`));
    // 역할 함수조항은 보통약관 조를 가리킨다(가리키기 순환) — 두 번에 만들어 자리표시가 남지 않는다
    for (const code of ["C0044", "C0045", "C0051", "C0052"]) expect(JSON.stringify((await services.clause.get(code))?.body), code).not.toContain("〔보통약관 참조〕");
    expect((await services.catalog.listEnums()).map((e) => [e.code, e.fields?.length ?? 0])).toEqual([["E0001", 3], ["E0002", 0]]);
    expect((await services.catalog.list()).map((d) => d.code)).toEqual(["D0001", "D0002", "D0003", "D0004", "D0005", "D0006"]);
    const boxes = (await services.document.listBoxes()).map((b) => b.code);
    expect(boxes).toEqual([...boxesUsedByGenerals()].sort());
    expect(boxes).toEqual(Array.from({ length: 122 }, (_, i) => `BX${String(i + 1).padStart(6, "0")}`));
    expect((await services.document.list("general")).map((d) => d.title).sort()).toEqual([
      "무배당 메리츠 통합간편건강보험(연만기형)2607(통합간편심사형) 보통약관",
      "무배당 알파Plus보장보험2604 보통약관",
      "무배당 알파Plus보장보험2607 보통약관",
    ]);
    expect(await services.coverage.listSummaries()).toEqual([]);
    expect(await services.product.listProducts()).toEqual([]);
  });

  it("다시 부르면 아무것도 하지 않는다", async () => {
    expect(await loadRealBase(services, admin)).toEqual({ created: false });
    expect(await services.clause.list()).toHaveLength(53);
    expect(await services.document.listBoxes()).toHaveLength(122);
  });
});
