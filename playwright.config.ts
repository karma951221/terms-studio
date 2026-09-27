import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
// Next dev 서버의 기본 오리진과 맞춰야 cross-origin 경고가 뜨지 않는다 (127.0.0.1 아님).
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
/**
 * 프로필 — 기본(full)은 알파Plus 실물 시드 전량 DB 에서 `tests/e2e/*.spec.ts` 를,
 * `E2E_PROFILE=real`(`npm run test:e2e:real`)은 바탕(별표 + 보통약관)만 든 DB 에서 `tests/e2e/real/` 를 돈다 —
 * 실물 재현 데이터를 화면으로 처음부터 넣는 E2E (docs/QA/시나리오/실물재현_E2E_시나리오.md §4).
 */
const REAL = process.env.E2E_PROFILE === "real";
const RUN_DIR = path.join(process.cwd(), ".data", REAL ? "e2e-real-run" : "e2e-run");

/**
 * E2E: tests/e2e/**.
 *
 * 매 실행이 golden 스냅샷을 복사한 새 DB 에서 시작한다 (`scripts/e2e/prepare-db.ts`).
 * PGlite 인스턴스는 dev 서버 프로세스에 캐시되므로 DB 를 갈아끼우려면 서버를 새로 띄워야 하고,
 * 그래서 `reuseExistingServer` 를 끈다. 복사 → 기동 순서는 `&&` 로 못박는다
 * (globalSetup 과 webServer 의 순서는 보장되지 않는다).
 * 근거: docs/QA/E2E_관측복구_설계.md
 */
export default defineConfig({
  testDir: REAL ? "./tests/e2e/real" : "./tests/e2e",
  ...(REAL ? {} : { testIgnore: "real/**" }),
  // 한 DB 를 공유하므로 병렬로 돌리면 결정론이 깨진다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  ...(REAL ? { timeout: 180_000 } : {}),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["./tests/e2e/_lib/reporter.ts"]],
  use: {
    baseURL: BASE_URL,
    // 기존 "on-first-retry" 는 로컬 retries:0 이라 영원히 안 찍혔다.
    trace: "retain-on-failure",
    // 실물 재현(화면)은 조작이 수천 번이다 — 한 조작이 막히면 테스트 시간(10분)이 아니라 곧바로 실패로 드러나게
    // 새 dev 서버는 화면마다 처음 열 때 컴파일한다 — 이동은 넉넉히
    ...(REAL ? { actionTimeout: 15_000, navigationTimeout: 90_000 } : {}),
    screenshot: "only-on-failure",
    // 사전 설치된 브라우저를 그대로 쓰는 환경(원격 실행 등)을 위해 경로를 넘길 수 있게 한다.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // `E2E_EXTERNAL=1` + `E2E_BASE_URL` — 이미 떠 있는 서버에 붙는다(개발 중 한 단계씩 돌려 보기). DB 는 그 서버의 것이다.
  webServer: process.env.E2E_EXTERNAL === "1" ? undefined : {
    command: `npx tsx scripts/e2e/prepare-db.ts && npx tsx scripts/e2e/dev-with-log.ts --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PGLITE_DATA_DIR: RUN_DIR, ...(REAL ? { E2E_PROFILE: "real" } : {}) },
  },
});
