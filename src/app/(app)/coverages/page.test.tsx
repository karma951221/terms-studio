/**
 * 담보 조회(L1) — 담보코드 1열 · 코드로도 검색 (기능/담보 §4 · 2026-09-27).
 * 서버 컴포넌트를 서비스 흉내로 그려 문자열로 본다 — 클릭 흐름은 E2E(coverage-code.spec) 몫.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/coverages",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/services", () => ({
  getServices: () => ({
    coverage: {
      listSummaries: async () => [
        { id: "c2", code: "COV000002", name: "골절진단비", updatedAt: new Date("2026-09-27T00:00:00Z") },
        { id: "c1", code: "COV000001", name: "일반상해사망보장", updatedAt: new Date("2026-09-27T00:00:00Z") },
      ],
    },
  }),
}));

import CoveragesPage from "./page";

async function render(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await CoveragesPage({ searchParams: Promise.resolve(sp) }));
}

describe("담보 조회 — 담보코드", () => {
  it("1열이 코드 — 헤더 「코드」 · 행마다 COV 코드 · 검색창은 코드 · 담보명", async () => {
    const html = await render();
    expect(html.indexOf("<th class=\"col-code\">코드</th>")).toBeGreaterThan(-1);
    expect(html.indexOf("<th class=\"col-code\">")).toBeLessThan(html.indexOf("<th class=\"col-flex\">"));
    expect(html).toContain("<code>COV000001</code>");
    expect(html).toContain("<code>COV000002</code>");
    expect(html).toContain('placeholder="코드 · 담보명"');
  });

  it("코드로 검색하면 그 담보만", async () => {
    const html = await render({ q: "cov000002" });
    expect(html).toContain("골절진단비");
    expect(html).not.toContain("일반상해사망보장");
  });

  it("이름 검색은 그대로", async () => {
    const html = await render({ q: "사망" });
    expect(html).toContain("COV000001");
    expect(html).not.toContain("COV000002");
  });
});
