/**
 * 결과 타입 미지정 기존분 이행 (기능/구분자 §3.1, 2026-10-17) — 마이그레이션 0029(NOT NULL) 전에 시드 스크립트가 부른다.
 * 테스트 DB 는 지금 스키마(NOT NULL)로 만들어지므로 옛 모양을 흉내 내려고 제약을 잠시 푼다.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backfillDiscriminatorResultTypes } from "./backfill-result-types";
import { createTestDb, type TestDb } from "./test-utils";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  await t.db.execute(sql`ALTER TABLE "discriminators" ALTER COLUMN "result_type" DROP NOT NULL`);
});
afterEach(async () => {
  await t.close();
});

async function insert(code: string, level: string, expression: string, resultType: unknown = null) {
  await t.db.execute(
    sql`INSERT INTO "discriminators" ("code", "label", "level", "expression", "result_type") VALUES (${code}, ${code}, ${level}, ${expression}, ${resultType === null ? null : JSON.stringify(resultType)}::jsonb)`,
  );
}

async function types(): Promise<Record<string, unknown>> {
  const r = await t.db.execute<{ code: string; result_type: unknown }>(sql`SELECT "code", "result_type" FROM "discriminators" ORDER BY "code"`);
  return Object.fromEntries(r.rows.map((row) => [row.code, row.result_type]));
}

describe("backfillDiscriminatorResultTypes", () => {
  it("미지정 행만 추론 타입으로 채우고, 있는 타입은 그대로 둔다", async () => {
    await insert("D0001", "coverage", "coverage_basic.claim_name");
    await insert("D0002", "coverage", "D0001 ≠ ''");
    await insert("D0003", "plan", "waiver.applies", { kind: "boolean" });
    const r = await backfillDiscriminatorResultTypes(t.db);
    expect(r).toEqual({ filled: ["D0001", "D0002"], unresolved: [] });
    expect(await types()).toEqual({ D0001: { kind: "string" }, D0002: { kind: "boolean" }, D0003: { kind: "boolean" } });
    // 다시 돌려도 안전하다
    expect(await backfillDiscriminatorResultTypes(t.db)).toEqual({ filled: [], unresolved: [] });
  });

  it("추론이 안 서는 행은 비운 채 unresolved 로 돌려준다 — 시드 스크립트가 이름을 대고 멈춘다", async () => {
    await insert("D0001", "coverage", "any(");
    expect(await backfillDiscriminatorResultTypes(t.db)).toEqual({ filled: [], unresolved: ["D0001"] });
    expect(await types()).toEqual({ D0001: null });
  });

  it("테이블이 아직 없는 새 DB 면 아무것도 하지 않는다", async () => {
    const client = new PGlite();
    try {
      expect(await backfillDiscriminatorResultTypes(drizzle(client))).toEqual({ filled: [], unresolved: [] });
    } finally {
      await client.close();
    }
  });
});
