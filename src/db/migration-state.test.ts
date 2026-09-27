/**
 * 낡은 로컬 DB 감지 회귀 테스트.
 *
 * 2026-09-14 — `.data/pgdata` 가 0003 까지만 마이그레이션된 채 코드는 0006 을 전제해서
 * `/catalog/D0001` 이 파서 깊숙이(`parse(null)` → `null.trim`)에서 500 으로 터졌다.
 * 원인(DB 가 코드보다 낡음)을 첫 요청에서 이름 붙여 막는 것이 이 모듈의 몫이다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertMigrated,
  lastAppliedMigrationAt,
  pendingMigrations,
  readJournal,
  StaleDatabaseError,
} from "./migration-state";

const DRIZZLE = path.resolve(import.meta.dirname, "../../drizzle");
const journal = readJournal(DRIZZLE);
const statementsOf = (tag: string) =>
  readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

describe("pendingMigrations — 순수 비교", () => {
  const entries = [
    { tag: "0000_a", when: 100 },
    { tag: "0001_b", when: 200 },
    { tag: "0002_c", when: 300 },
  ];

  it("적용 이력이 없으면 전부 미적용", () => {
    expect(pendingMigrations(entries, undefined)).toEqual(["0000_a", "0001_b", "0002_c"]);
  });

  it("마지막 적용 시각보다 늦은 항목만 미적용 (drizzle migrator 와 같은 기준)", () => {
    expect(pendingMigrations(entries, 200)).toEqual(["0002_c"]);
  });

  it("마지막 항목까지 적용됐으면 비어 있다", () => {
    expect(pendingMigrations(entries, 300)).toEqual([]);
  });
});

describe("assertMigrated — 실제 PGlite", () => {
  let client: PGlite;
  beforeEach(() => {
    client = new PGlite();
  });
  afterEach(() => client.close());

  /** drizzle migrator 가 남기는 이력 테이블을 그대로 흉내 낸다 (마이그레이션 0000..upToIdx 적용). */
  async function applyUpTo(upToIdx: number) {
    await client.exec(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.exec(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    for (const e of journal.entries.filter((e) => e.idx <= upToIdx)) {
      for (const s of statementsOf(e.tag)) await client.exec(s);
      await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`, [
        e.tag,
        e.when,
      ]);
    }
  }

  it("빈 DB(이력 테이블 없음)는 전부 미적용으로 본다", async () => {
    expect(await lastAppliedMigrationAt(client)).toBeUndefined();
    await expect(assertMigrated(client, DRIZZLE)).rejects.toBeInstanceOf(StaleDatabaseError);
  });

  it("0003 까지만 적용된 DB — 사고 당시 모양 — 는 0004 이후를 이름 붙여 막는다", async () => {
    await applyUpTo(3);
    const err = await assertMigrated(client, DRIZZLE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleDatabaseError);
    const stale = err as StaleDatabaseError;
    expect(stale.pending).toEqual(journal.entries.filter((e) => e.idx > 3).map((e) => e.tag));
    expect(stale.pending[0]).toMatch(/^0004_/);
    expect(stale.message).toContain("npm run db:seed");
  });

  it("실제 migrator 로 끝까지 적용한 DB 는 통과한다", async () => {
    await migrate(drizzle(client), { migrationsFolder: DRIZZLE });
    await expect(assertMigrated(client, DRIZZLE)).resolves.toBeUndefined();
  });
});
