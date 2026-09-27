import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/**
 * E2E 프로필 — `full`(기본: 알파Plus 실물 시드 전량) · `real`(바탕만: 별표 + 보통약관, 나머지는 화면으로 넣는다).
 * 프로필마다 golden · 실행 DB · 서버 로그를 따로 둔다 — 서로의 fast 재사용을 흐리지 않게.
 * 근거: docs/QA/시나리오/실물재현_E2E_시나리오.md §4
 */
export const E2E_PROFILE: "full" | "real" = process.env.E2E_PROFILE === "real" ? "real" : "full";
const TAG = E2E_PROFILE === "real" ? "e2e-real" : "e2e";

export const RUN_DIR = path.join(ROOT, ".data", `${TAG}-run`);
export const SERVER_LOG = path.join(ROOT, ".data", `${TAG}-server.log`);
export const GOLDEN_KEY_FILE = path.join(ROOT, ".data", `${TAG}-golden-key`);
export const FAST_MARKER = path.join(ROOT, ".data", `${TAG}-fast`);
export const FAILURES_DIR = path.join(ROOT, "test-results", "failures");

/**
 * 시나리오 문서가 사는 폴더들 — 기능별 `docs/기능/<f>/시나리오` · `docs/공통/화면/시나리오` · `docs/QA/시나리오`.
 * 기능 폴더는 그때그때 훑는다 (기능이 늘어도 여기를 고치지 않게). 없는 폴더는 뺀다.
 */
export function scenarioDirs(root: string = ROOT): string[] {
  const features = path.join(root, "docs", "기능");
  const perFeature = existsSync(features)
    ? readdirSync(features, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(features, entry.name, "시나리오"))
    : [];
  return [...perFeature, path.join(root, "docs", "공통", "화면", "시나리오"), path.join(root, "docs", "QA", "시나리오")].filter(
    (dir) => existsSync(dir),
  );
}
