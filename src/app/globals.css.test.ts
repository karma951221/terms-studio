import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 전역 스타일시트의 구문 — 중괄호 균형과 충돌 마커.
 *
 * 병합(24beece)이 양쪽이 끝에 덧붙인 블록을 합치며 닫는 괄호 하나를 잃었고(코덱스 리뷰 2026-09-14 Critical-1),
 * typecheck · lint · Vitest 어느 것도 CSS 를 파싱하지 않아 잡지 못했다. postcss 는 직접 의존성이 아니라
 * 주석 · 문자열을 걷어낸 뒤 `{` `}` 짝만 센다 — 이 부류(열린 블록이 뒤 규칙을 삼키는 것)를 잡는 데는 충분하다.
 */
const css = fs.readFileSync(path.join(__dirname, "globals.css"), "utf8");

function stripCommentsAndStrings(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

describe("globals.css 구문", () => {
  it("중괄호가 짝을 이루고 도중에 음수가 되지 않는다", () => {
    let depth = 0;
    let line = 1;
    for (const ch of stripCommentsAndStrings(css)) {
      if (ch === "\n") line++;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        expect(depth, `${line}행에서 닫는 괄호가 남는다`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(depth, "닫히지 않은 블록").toBe(0);
  });

  it("병합 충돌 마커가 없다", () => {
    expect(css).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  });
});
