/**
 * 낡은 로컬 DB 감지 — 코드가 전제하는 마이그레이션(`drizzle/meta/_journal.json`)과
 * DB 에 실제 적용된 이력(`drizzle.__drizzle_migrations`)을 비교한다.
 *
 * 왜: 파일 DB(`.data/pgdata`)는 코드와 따로 늙는다. 스키마가 뒤처진 채 앱이 돌면
 * 새 코드가 옛 행을 읽다가 엉뚱한 곳(예: `parse(null)`)에서 터진다 — 2026-09-14 사고.
 * 여기서 첫 요청에 원인을 이름 붙여 막는다.
 *
 * 미적용 판정은 drizzle migrator 와 같다 — 마지막 적용 이력의 `created_at` 보다 늦은(`when`) 항목.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";

export interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

export function readJournal(migrationsFolder: string): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
}

/** 마지막 적용 시각(`created_at`) 이후의 저널 항목 태그. 적용 이력이 없으면 전부. */
export function pendingMigrations(
  entries: readonly Pick<JournalEntry, "tag" | "when">[],
  lastAppliedAt: number | undefined,
): string[] {
  return entries.filter((e) => lastAppliedAt === undefined || e.when > lastAppliedAt).map((e) => e.tag);
}

/** DB 의 마지막 적용 이력 시각. 이력 테이블(또는 스키마)이 아직 없으면 undefined. */
export async function lastAppliedMigrationAt(client: PGlite): Promise<number | undefined> {
  try {
    const r = await client.query<{ created_at: string | number | null }>(
      `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
    );
    const v = r.rows[0]?.created_at;
    return v === null || v === undefined ? undefined : Number(v);
  } catch (e) {
    // 42P01 undefined_table · 3F000 invalid_schema_name — 한 번도 마이그레이션한 적 없는 DB
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "3F000") return undefined;
    throw e;
  }
}

export class StaleDatabaseError extends Error {
  constructor(
    readonly pending: readonly string[],
    dataDir: string,
  ) {
    super(
      `로컬 DB(${dataDir})가 코드보다 낡았습니다 — 미적용 마이그레이션: ${pending.join(", ")}. ` +
        "`npm run db:seed` 로 적용하세요. 새 DB 를 전제한 마이그레이션이라 올라가지 않으면 " +
        "데이터 디렉토리를 지우고 다시 시드합니다.",
    );
    this.name = "StaleDatabaseError";
  }
}

/** 미적용 마이그레이션이 있으면 `StaleDatabaseError`. */
export async function assertMigrated(
  client: PGlite,
  migrationsFolder: string,
  dataDir = "(memory)",
): Promise<void> {
  const pending = pendingMigrations(readJournal(migrationsFolder).entries, await lastAppliedMigrationAt(client));
  if (pending.length > 0) throw new StaleDatabaseError(pending, dataDir);
}
