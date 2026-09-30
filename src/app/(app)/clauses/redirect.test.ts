import { describe, expect, it } from "vitest";

import LegacyClausePage from "./[code]/page";
import LegacyNewClausePage from "./new/page";
import LegacyClausesPage from "./page";

/** redirect() 는 NEXT_REDIRECT 오류를 던진다 — digest 에 넘겨 갈 주소가 실린다. */
async function target(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("redirect 되지 않았다");
}

describe("옛 주소 /clauses — 함수조항 /functions 로 넘긴다 (최종 결정 1 · 계획 §7-4)", () => {
  it("조회는 검색어를 들고 /functions 로", async () => {
    expect(await target(() => LegacyClausesPage({ searchParams: Promise.resolve({ q: "소멸" }) }))).toBe("/functions?q=%EC%86%8C%EB%A9%B8");
  });

  it("생성은 유형 쿼리를 들고 /functions/new 로", async () => {
    expect(await target(() => LegacyNewClausePage({ searchParams: Promise.resolve({ type: "block" }) }))).toBe("/functions/new?type=block");
  });

  it("상세는 코드 · 노드 쿼리를 들고 /functions/<code> 로", async () => {
    const run = () => LegacyClausePage({ params: Promise.resolve({ code: "C0002" }), searchParams: Promise.resolve({ node: "p1" }) });
    expect(await target(run)).toBe("/functions/C0002?node=p1");
  });
});
