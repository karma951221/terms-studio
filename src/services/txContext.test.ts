import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Db } from "@/db/repo/types";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { contextualDb, rollbackUnless } from "./txContext";

/** 프록시로 센다 — tx 안이면 tx, 밖이면 root 로 간다. */
async function count(db: Db): Promise<number> {
  const r = (await db.execute(sql`select count(*)::int as n from probe`)) as unknown as { rows: { n: number }[] };
  return r.rows[0].n;
}

describe("contextualDb — 트랜잭션 안에서 주입 소스가 같은 tx 를 타게 한다 (PGlite 단일 연결 교착 회피)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.db.execute(sql`create table probe (n int)`);
  });
  afterAll(async () => {
    await t.close();
  });

  it("바깥 핸들 대신 프록시로 쿼리하면 tx 안에서 교착 없이 같은 트랜잭션의 미커밋 데이터가 보인다", async () => {
    const db = contextualDb(t.db);
    const seenInside = await db.transaction(async (tx) => {
      await tx.execute(sql`insert into probe values (1)`);
      // 주입 소스가 하듯 tx 를 모르는 채 프록시로 읽는다
      return await count(db);
    });
    expect(seenInside).toBe(1);
  });

  it("tx 밖에서는 root 로 간다 · 롤백된 tx 의 쓰기는 남지 않는다", async () => {
    const db = contextualDb(t.db);
    await expect(
      db.transaction(async () => {
        await db.execute(sql`insert into probe values (2)`); // 프록시 → 현재 tx
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await count(db)).toBe(1);
  });

  it("tx 안에서 다시 transaction 을 열면 세이브포인트(중첩)로 같은 연결을 쓴다", async () => {
    const db = contextualDb(t.db);
    const n = await db.transaction(async () => {
      await db.transaction(async (inner) => {
        await inner.execute(sql`insert into probe values (3)`);
      });
      return await count(db);
    });
    expect(n).toBe(2);
  });

  it("rollbackUnless — 결과가 keep 을 통과하면 커밋, 아니면 앞 단계 쓰기까지 롤백하고 결과는 그대로 돌려준다 (저장 한 번 = 한 트랜잭션)", async () => {
    const db = contextualDb(t.db);
    const before = await count(db);
    // 서비스 호출처럼 안쪽에서 다시 transaction 을 연다 (세이브포인트) — 첫 단계는 성공, 둘째 단계가 거부
    const rejected = await rollbackUnless(
      db,
      async () => {
        await db.transaction(async (tx) => {
          await tx.execute(sql`insert into probe values (10)`);
        });
        return { ok: false as const, message: "둘째 단계 거부" };
      },
      (r) => r.ok,
    );
    expect(rejected).toEqual({ ok: false, message: "둘째 단계 거부" });
    expect(await count(db)).toBe(before);

    const kept = await rollbackUnless(
      db,
      async () => {
        await db.transaction(async (tx) => {
          await tx.execute(sql`insert into probe values (11)`);
        });
        return { ok: true as const };
      },
      (r) => r.ok,
    );
    expect(kept).toEqual({ ok: true });
    expect(await count(db)).toBe(before + 1);
  });

  it("rollbackUnless — 안에서 던진 예외는 롤백 뒤 그대로 올라간다", async () => {
    const db = contextualDb(t.db);
    const before = await count(db);
    await expect(
      rollbackUnless(
        db,
        async () => {
          await db.execute(sql`insert into probe values (12)`);
          throw new Error("boom");
        },
        () => true,
      ),
    ).rejects.toThrow("boom");
    expect(await count(db)).toBe(before);
  });
});
