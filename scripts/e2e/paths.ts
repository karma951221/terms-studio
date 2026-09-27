import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

export const RUN_DIR = path.join(ROOT, ".data", "e2e-run");
export const SERVER_LOG = path.join(ROOT, ".data", "e2e-server.log");
export const GOLDEN_KEY_FILE = path.join(ROOT, ".data", "e2e-golden-key");
export const FAST_MARKER = path.join(ROOT, ".data", "e2e-fast");
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
