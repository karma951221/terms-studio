/**
 * 테스트용 DB — 인메모리 PGlite + drizzle + `pushSchema` (drizzle-kit/api).
 *
 * 사용법 (테스트 파일마다 새 DB — QA/테스트전략):
 *
 * ```ts
 * let db: TestDb;
 * beforeAll(async () => { db = await createTestDb(); });
 * afterAll(async () => { await db.close(); });
 * ```
 *
 * 마이그레이션 파일(drizzle/)에 의존하지 않는다 — 스키마 코드에서 바로 DDL 을 만든다.
 * 프로덕션 코드에서 import 하지 말 것.
 */
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";

import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDb {
  db: Database;
  client: PGlite;
  /**
   * 이 핸들(트랜잭션 포함)로 나간 SQL 문장 수 — drizzle `logger` 로 센다 (begin/commit 도 한 문장씩).
   * 적재 쿼리 수가 상품담보·세목 수와 무관한지(ADR-0034 결정 3) 재는 자다.
   */
  queryCount(): number;
  resetQueryCount(): void;
  /** PGlite 인스턴스를 닫는다. afterAll 에서 호출. */
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const t = wrap(client);
  // pushSchema 의 시그니처는 스키마 없는 PgDatabase<any> 로 선언돼 있어 캐스트가 필요하다.
  // 런타임은 같은 drizzle 인스턴스다.
  const { apply } = await pushSchema(schema, t.db as unknown as Parameters<typeof pushSchema>[1]);
  await apply();
  return t;
}

/**
 * 채운 DB 를 지금 모습으로 떠 두고, 같은 내용의 새 DB 를 여는 함수를 돌려준다 — 무거운 실물 시드를 테스트 파일마다 한 번만 적재하고
 * 변형마다 사본에서 시작할 때(`real.test.ts`). 뜬 뒤의 원본 변경은 사본에 없고, 사본끼리도 독립이다.
 */
export async function snapshotTestDb(source: TestDb): Promise<() => Promise<TestDb>> {
  const image = await source.client.dumpDataDir("none");
  return async () => {
    const client = new PGlite({ loadDataDir: image });
    await client.waitReady;
    return wrap(client);
  };
}

function wrap(client: PGlite): TestDb {
  let count = 0;
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery() {
        count += 1;
      },
    },
  });
  return {
    db,
    client,
    queryCount: () => count,
    resetQueryCount: () => {
      count = 0;
    },
    close: () => client.close(),
  };
}
