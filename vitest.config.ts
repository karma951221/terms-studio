import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 단위 테스트: src 안에 `*.test.ts` 로 colocate.
 * E2E(tests/e2e)는 Playwright 가 담당하므로 vitest 대상에서 제외한다.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**"],
    environment: "node",
    // PGlite 를 띄우는 테스트는 혼자 1~3초다 — E2E(dev 서버)와 함께 돌면 기본 5초를 넘겨 떨어졌다(2026-09-30).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
