import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { codeSequences, users } from "./schema";
import { createTestDb, snapshotTestDb, type TestDb } from "./test-utils";

describe("createTestDb — 인메모리 PGlite + pushSchema", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("스키마가 적용된 빈 DB 를 돌려준다 — users 에 넣고 읽을 수 있다", async () => {
    await t.db.insert(users).values({ name: "admin", role: "admin" });
    const rows = await t.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("admin");
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("복합 PK 테이블(code_sequences)도 만들어진다", async () => {
    await t.db.insert(codeSequences).values({ kind: "discriminator", scope: "" });
    const rows = await t.db.select().from(codeSequences);
    expect(rows[0].next).toBe(1);
  });

  it("호출할 때마다 서로 독립인 DB 다", async () => {
    const other = await createTestDb();
    try {
      expect(await other.db.select().from(users)).toHaveLength(0);
    } finally {
      await other.close();
    }
  });
});

describe("snapshotTestDb — 채운 DB 를 떠 두고 같은 내용의 새 DB 를 여러 벌 연다(무거운 시드를 한 번만 적재)", () => {
  it("뜬 뒤의 변경은 사본에 없고, 사본끼리도 독립이다", async () => {
    const source = await createTestDb();
    await source.db.insert(users).values({ name: "admin", role: "admin" });
    const open = await snapshotTestDb(source);
    await source.db.insert(users).values({ name: "later", role: "admin" });
    await source.close();
    const a = await open();
    const b = await open();
    try {
      expect((await a.db.select().from(users)).map((u) => u.name)).toEqual(["admin"]);
      await a.db.insert(users).values({ name: "only-a", role: "admin" });
      expect(await b.db.select().from(users)).toHaveLength(1);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
