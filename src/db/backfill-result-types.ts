/**
 * 구분자 결과 타입 미지정 기존분 이행 (기능/구분자 §3.1, 2026-10-17 — 결과 타입 필수).
 *
 * 마이그레이션 0029 가 `discriminators.result_type` 에 NOT NULL 을 건다. 추론은 식 언어(TS)라 SQL 로 못 하므로,
 * 시드 스크립트(`npm run db:seed` — 마이그레이션을 적용하는 자리)가 `migrate` **전에** 이것을 불러 미지정 행을
 * 식의 추론 타입으로 채운다. 새 DB(테이블 없음)나 이미 이행한 DB 에서는 아무것도 하지 않는다 — 몇 번을 돌려도 안전하다.
 *
 * 열 이름만 쓰는 날 SQL 이다 — 스키마 코드(지금 모양)는 이행 전 DB 와 다를 수 있다.
 * 추론이 안 서는 행(문법 · 순환 …)은 비운 채 `unresolved` 로 돌려준다 — 그대로면 0029 가 실패하니 부른 쪽이 멈춘다.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { inferMissingResultTypes } from "@/domain/catalog/expression";
import type { DiscriminatorResultType } from "@/domain/catalog/types";
import type { AttachLevel, Code } from "@/domain/types";

interface Row {
  code: Code;
  level: AttachLevel;
  expression: string;
  result_type: DiscriminatorResultType | null;
}

export async function backfillDiscriminatorResultTypes<TSchema extends Record<string, unknown>>(
  db: PgDatabase<PgQueryResultHKT, TSchema>,
): Promise<{ filled: Code[]; unresolved: Code[] }> {
  const exists = (await db.execute(sql`SELECT to_regclass('public.discriminators') IS NOT NULL AS "exists"`)) as unknown as { rows: { exists: boolean }[] };
  if (!exists.rows[0]?.exists) return { filled: [], unresolved: [] };

  const rows = ((await db.execute(sql`SELECT "code", "level", "expression", "result_type" FROM "discriminators" ORDER BY "code"`)) as unknown as { rows: Row[] }).rows;
  const missing = inferMissingResultTypes(
    rows.map((r) => ({ code: r.code, level: r.level, expression: r.expression, ...(r.result_type ? { resultType: r.result_type } : {}) })),
  );
  const filled: Code[] = [];
  const unresolved: Code[] = [];
  for (const [code, type] of missing) {
    if (!type) {
      unresolved.push(code);
      continue;
    }
    await db.execute(sql`UPDATE "discriminators" SET "result_type" = ${JSON.stringify(type)}::jsonb WHERE "code" = ${code}`);
    filled.push(code);
  }
  return { filled, unresolved };
}
