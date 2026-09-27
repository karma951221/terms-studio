import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { products } from "@/db/schema";
import { ASSEMBLY_STAMP_SOURCES, assemblyInputStamp, loadPreview, savePreview } from "./preview";

describe("preview repo (PGlite) — 입력 스탬프 · 산출본 upsert", () => {
  let t: TestDb;
  let productId: string;
  beforeAll(async () => {
    t = await createTestDb();
    [{ id: productId }] = await t.db.insert(products).values({ name: "P" }).returning({ id: products.id });
  });
  afterAll(async () => {
    await t.close();
  });

  it("스탬프는 재료 테이블마다 한 조각 — 테이블 이름 순 · `|` 로 잇고 · 같은 DB 면 같은 문자열", async () => {
    const a = await assemblyInputStamp(t.db, productId);
    const b = await assemblyInputStamp(t.db, productId);
    expect(a).toBe(b);
    const pieces = a.split("|");
    expect(pieces).toHaveLength(ASSEMBLY_STAMP_SOURCES.length);
    const names = ASSEMBLY_STAMP_SOURCES.map((s) => s.name);
    expect(names).toEqual([...names].sort());
    // 각 조각은 `이름=시각(또는 다이제스트):count`
    for (const piece of pieces) expect(piece).toMatch(/^[a-z_()]+=.*:\d+$/);
    // 빈 DB — 상품 행 하나만 count 1
    expect(pieces.find((p) => p.startsWith("products="))).toMatch(/:1$/);
    expect(pieces.find((p) => p.startsWith("clauses="))).toMatch(/^clauses=-:0$/);
  });

  it("savePreview 는 상품당 1행 upsert · loadPreview 는 없으면 undefined", async () => {
    expect(await loadPreview(t.db, productId)).toBeUndefined();
    const booklet = { general: undefined, specials: [], appendices: [], issues: [], complete: true, omitted: [], undocumented: [], baseContracts: [], trace: [] };
    const first = new Date("2026-09-17T00:00:00Z");
    await savePreview(t.db, { productId, generatedAt: first, generatedBy: null, inputStamp: "s1", grade: "ok", booklet });
    await savePreview(t.db, { productId, generatedAt: new Date("2026-09-17T01:00:00Z"), generatedBy: "00000000-0000-4000-8000-000000000002", inputStamp: "s2", grade: "withErrors", booklet });
    const row = await loadPreview(t.db, productId);
    expect(row).toMatchObject({ productId, inputStamp: "s2", grade: "withErrors", generatedBy: "00000000-0000-4000-8000-000000000002" });
    expect(row!.generatedAt.toISOString()).toBe("2026-09-17T01:00:00.000Z");
    expect(row!.booklet).toEqual(booklet);
  });
});
