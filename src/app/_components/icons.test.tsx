import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { IconButton } from "./icons";

describe("IconButton — shadcn Button 위 아이콘 버튼 (디자인원칙 §1.6)", () => {
  it("이름은 tooltip · 접근성 이름 둘 다 — 32×32 ghost", () => {
    const html = renderToStaticMarkup(<IconButton label="담보 삭제" icon={<svg />} />);
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('title="담보 삭제"');
    expect(html).toContain('aria-label="담보 삭제"');
    expect(html).toContain('type="button"');
    expect(html).toMatch(/\bsize-8\b/);
    expect(html).toContain("ts-iconbtn");
  });

  it("danger 는 평소 뉴트럴, hover 에서만 error", () => {
    const html = renderToStaticMarkup(<IconButton label="삭제" icon={<svg />} danger />);
    expect(html).toContain("hover:text-destructive");
    expect(html).not.toMatch(/(^|\s)text-destructive(\s|")/);
  });

  it("편집 모드의 삭제처럼 disabled 면 disabled 로 그린다", () => {
    const html = renderToStaticMarkup(<IconButton label="삭제" icon={<svg />} disabled />);
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });

  it("size=sm 은 행 안 24×24", () => {
    expect(renderToStaticMarkup(<IconButton label="행 삭제" icon={<svg />} size="sm" />)).toMatch(/\bsize-6\b/);
  });
});

describe("globals.css — .ts-iconbtn 기본 모양 규칙이 남아 Tailwind 를 덮지 않는다", () => {
  it(".ts-iconbtn 단독 · :hover · .danger · [disabled] 규칙이 없다", () => {
    const selectors: string[] = [];
    postcss.parse(readFileSync("src/app/globals.css", "utf8")).walkRules((r) => {
      selectors.push(...r.selectors);
    });
    const base = selectors
      .map((s) => s.replace(/:where\(:not\(\[data-slot\]\)\)/g, "").trim())
      .filter((s) => /^\.ts-iconbtn(:hover|\.danger(:hover|:focus-visible)?|\[disabled\])?$/.test(s));
    expect(base).toEqual([]);
  });
});
