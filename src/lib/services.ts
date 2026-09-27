/**
 * 서버 액션 · 서버 컴포넌트가 서비스 계층에 닿는 유일한 통로.
 *
 * - `getServices()` : `getDb()` 위에 `createServices()` 를 globalThis 캐시로 한 번만 만든다.
 * - `currentActor()` : 쿠키의 세션 토큰으로 `auth.currentActor(token)`. 없으면 `/login` 으로 redirect.
 * - `currentActorOrNull()` : redirect 없이 조회 (로그인 화면 자체 · 레이아웃의 조건 분기용).
 *
 * 두 actor 함수는 모든 화면의 관문이라, 여기서 프로세스당 한 번 `ensureDbReady()` 로
 * 파일 DB 가 코드보다 낡지 않았는지 확인한다 (`@/db/migration-state`).
 */
import path from "node:path";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb, getPgliteClient, PGLITE_DATA_DIR, resolveDriver } from "@/db/client";
import { assertMigrated } from "@/db/migration-state";
import { createServices, type Services } from "@/services/container";

export const SESSION_COOKIE = "ts_session";

const globalCache = globalThis as typeof globalThis & {
  __termsStudioServices?: Services;
  __termsStudioServicesFactory?: typeof createServices;
  __termsStudioDbReady?: Promise<void>;
};

/** 파일 DB(PGlite)가 미적용 마이그레이션 없이 코드와 맞는지 — 프로세스당 한 번. 실패하면 다음 요청에 다시 본다. */
export function ensureDbReady(): Promise<void> {
  if (resolveDriver() !== "pglite") return Promise.resolve();
  if (!globalCache.__termsStudioDbReady) {
    globalCache.__termsStudioDbReady = assertMigrated(
      getPgliteClient(),
      path.join(process.cwd(), "drizzle"),
      PGLITE_DATA_DIR,
    ).catch((e: unknown) => {
      globalCache.__termsStudioDbReady = undefined;
      throw e;
    });
  }
  return globalCache.__termsStudioDbReady;
}

/** 프로세스당 서비스 묶음 하나. */
export function getServices(): Services {
  // HMR로 서비스 구현이 바뀌면 기존 인스턴스의 오래된 메서드도 교체한다.
  if (!globalCache.__termsStudioServices || globalCache.__termsStudioServicesFactory !== createServices) {
    globalCache.__termsStudioServices = createServices(getDb());
    globalCache.__termsStudioServicesFactory = createServices;
  }
  return globalCache.__termsStudioServices;
}

/** 로그인 세션이 없거나 만료됐으면 `/login` 으로 redirect. 서버 컴포넌트·서버 액션 양쪽에서 쓴다. */
export async function currentActor() {
  await ensureDbReady();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const actor = await getServices().auth.currentActor(token);
  if (!actor) redirect("/login");
  return actor;
}

/** redirect 없이 조회 — `/login` 자체나 레이아웃의 「이미 로그인」 분기에. */
export async function currentActorOrNull() {
  await ensureDbReady();
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  return getServices().auth.currentActor(token);
}
