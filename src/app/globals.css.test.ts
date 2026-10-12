import fs from "node:fs";
import path from "node:path";

import postcss from "postcss";
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

/** 선택자 하나가 든 규칙의 선언을 모은다 — 같은 선택자가 여러 번 나오면 뒤가 이긴다. */
function declsOf(selector: string): Record<string, string> {
  const decls: Record<string, string> = {};
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
    rule.walkDecls((d) => {
      decls[d.prop] = d.value;
    });
  });
  return decls;
}

describe("촘촘한 줄의 콤보박스 입력은 옆 레거시 칸(24px) 높이에 맞춘다", () => {
  it("조건 줄 — .ts-cond-line 의 select · input 과 같은 24px · 12px · 왼쪽 4px", () => {
    const legacy = declsOf(".ts-cond-line select:where(:not([data-slot]))");
    expect(declsOf('.ts-cond-line .ts-combo [data-slot="input"]')).toMatchObject({
      height: legacy.height,
      "font-size": legacy["font-size"],
      "padding-left": "4px",
    });
    expect(legacy).toMatchObject({ height: "24px", "font-size": "12px" });
  });

  it("담보 추가 줄 — 옆 레거시 select(min-height 24px) 에 맞춘 24px", () => {
    expect(declsOf('.ts-mount-add-row .ts-combo [data-slot="input"]')).toMatchObject({ height: "24px" });
  });

  it("오른쪽 여백(pr-5 · 지우기 단추 자리)은 덮지 않는다", () => {
    for (const s of ['.ts-cond-line .ts-combo [data-slot="input"]', '.ts-mount-add-row .ts-combo [data-slot="input"]']) {
      const d = declsOf(s);
      expect(d.padding, s).toBeUndefined();
      expect(d["padding-inline"], s).toBeUndefined();
      expect(d["padding-right"], s).toBeUndefined();
    }
  });
});

describe("고른 것은 굵기와 색으로도 말한다 (디자인원칙 §1.3) — 굵기는 700 만", () => {
  it("라디오 — 켜진 네이티브 radio(data-slot 이어도)를 품은 줄이 굵고 진하다", () => {
    expect(declsOf(".ts-form-radio:has(> input:checked)")).toMatchObject({ "font-weight": "700", color: "var(--ts-ink)" });
  });

  it("토글 — 켜진 스위치의 라벨이 굵고 진하다", () => {
    expect(declsOf('.ts-toggle:has(> [data-slot="switch-native"]:checked) .ts-toggle-label')).toMatchObject({
      "font-weight": "700",
      color: "var(--ts-ink)",
    });
  });
});
