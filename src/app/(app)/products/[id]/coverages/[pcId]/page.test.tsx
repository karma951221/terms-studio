/**
 * 상품담보 값 화면 — 담보 상세와 같은 중첩 카드 그리드 (기능/상품 §4.7, d24df11).
 *
 * - 담보 ⊃ 세부보장(그리드) ⊃ 급부, 담보 상세와 같은 카드 클래스(`ts-cov-card` · `ts-cov-grid` · `ts-cov-benefits`).
 * - 필드가 없는 레벨(세부보장 — 기본 마스터에 subCoverage 레벨 필드가 없다)은
 *   「입력할 값 자리가 없습니다」 폼을 그리지 않는다.
 *
 * 서버 컴포넌트를 화면 없이 그대로 호출해 `renderToStaticMarkup` 으로 본다 — `@/lib/services` 를
 * 인메모리 PGlite 서비스로 대체한다(패턴: `coverages/edit-actions.test.ts`).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import type { Actor } from "@/domain/types";
import { createServices, type Services } from "@/services/container";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };

let t: TestDb;
let s: Services;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

vi.mock("@/lib/services", () => ({
  getServices: () => s,
  currentActor: async () => admin,
}));

const { default: ProductCoverageDetailPage } = await import("./page");

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection?: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify((r as { rejection?: unknown }).rejection)}`);
  return r.value;
}

describe("상품담보 값 화면 — 중첩 카드 그리드 · 자리 없는 레벨은 폼을 그리지 않는다", () => {
  let productId: string;
  let pcId: string;

  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);

    // 세부보장 2개 · 세부보장마다 급부 1개인 담보 — 기본 마스터에 subCoverage 레벨 필드가 없어
    // 「값 자리가 없습니다」 케이스를 그대로 재현한다 (도메인/master/catalog.ts).
    const coverage = unwrap(await s.coverage.create(admin, { name: "수술비(1-7종, 연간3회한)[상해]", subCoverageName: "1종 상해수술비(연간3회한)", benefitName: "수술급부" }));
    unwrap(await s.coverage.addSubCoverage(admin, coverage.id, { name: "2종 상해수술비(연간3회한)", benefitName: "수술급부" }));

    const product = unwrap(await s.product.createProduct(admin, { name: "값 화면 테스트 상품" }));
    productId = product.id;
    const pc = unwrap(await s.product.mount(admin, productId, coverage.id, [], "special"));
    pcId = pc.id;
  });
  afterAll(async () => {
    await t.close();
  });

  async function render(): Promise<string> {
    const element = await ProductCoverageDetailPage({ params: Promise.resolve({ id: productId, pcId }) });
    return renderToStaticMarkup(element as React.ReactElement);
  }

  it("담보 카드(ts-cov-card coverage) ⊃ 세부보장 그리드(ts-cov-grid) ⊃ 급부(ts-cov-benefits) 순서로 중첩된다", async () => {
    const html = await render();
    const coverageIndex = html.indexOf('data-level="coverage"');
    const gridIndex = html.indexOf("ts-cov-grid");
    const sub1Index = html.indexOf('data-level="subCoverage"');
    const benefitsIndex = html.indexOf("ts-cov-benefits", sub1Index);
    const benefitIndex = html.indexOf('data-level="benefit"', benefitsIndex);
    expect(coverageIndex).toBeGreaterThanOrEqual(0);
    expect(coverageIndex).toBeLessThan(gridIndex);
    expect(gridIndex).toBeLessThan(sub1Index);
    expect(sub1Index).toBeLessThan(benefitsIndex);
    expect(benefitsIndex).toBeLessThan(benefitIndex);
    // 세부보장 카드 2개 모두 그리드 안에 있다 (data-level 은 값 폼의 <form> 에도 붙으므로 카드 <section> 만 센다)
    expect((html.match(/<section class="ts-cov-card" data-level="subCoverage"/g) ?? []).length).toBe(2);
    expect((html.match(/<section class="ts-cov-card" data-level="benefit"/g) ?? []).length).toBe(2);
  });

  it("세부보장(필드 없는 레벨)에는 「입력할 값 자리가 없습니다」 폼이 없다", async () => {
    const html = await render();
    expect(html).not.toContain("입력할 값 자리가 없습니다");
  });

  it("담보 · 급부 카드 이름이 보인다", async () => {
    const html = await render();
    expect(html).toContain("1종 상해수술비(연간3회한)");
    expect(html).toContain("2종 상해수술비(연간3회한)");
    expect((html.match(/>수술급부</g) ?? []).length).toBe(2);
  });
});
