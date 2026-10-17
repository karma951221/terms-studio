import { expect, test } from "./_lib/fixtures";

/**
 * 절 형태 ① 뼈대 (ADR-0021 결정 1 · ADR-0082 결정 7 · 8 · ADR-0090 결정 8 · 기능/조립산출 §3.8) — 합성 표본 상품의 조립 미리보기.
 * 시드 표본(samples.json): 「표본 — 독립특약 블록 2개」(그룹 제목 표시 켬) · 「표본 — 기본계약 2개(주계약)」(끔).
 * 본문 = 책자 제목 → 「제1절 일반조항」(연결 조는 위임 문구 — ①잠정, ② 판정에서 바뀐다) → 「제2절 보장조항」(그룹 머리 · 블록 머리 · 블록마다 제1조부터).
 */
async function openPreview(page: import("@playwright/test").Page, productName: string): Promise<void> {
  await page.goto("/products");
  await page.getByRole("link", { name: productName, exact: true }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}/);
  const productUrl = page.url().split("?")[0]!;
  await page.goto(`${productUrl}/preview`);
  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByRole("button", { name: "다시 실행", exact: true })).toBeVisible();
}

test(
  "절 형태: 표본 상품 미리보기 — 제1절(위임 문구) · 제2절 블록 머리(그룹 제목 표시 켬 「Ⅰ-1.」 · 끔 「1.」)",
  {
    annotation: {
      type: "좌표없음",
      description: "기능/조립산출 §3.8 절 형태 산출 골격(ADR-0082, 2026-10-17 ① 구현) — 시나리오 좌표가 아직 없다",
    },
  },
  async ({ page }) => {
    test.setTimeout(180000);
    await page.goto("/login");
    await page.getByRole("button", { name: /admin/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    // ── 독립특약 블록 2개 — 제목 = 상품명 · 그룹 제목 표시 켬
    await openPreview(page, "표본 — 독립특약 블록 2개");
    await expect(page.getByText("「완성본 아님」")).toHaveCount(0);
    await expect(page.locator(".ts-count").first()).toContainText("제1절");
    await expect(page.locator(".ts-count").first()).toContainText("블록 2");
    const first = page.locator("article.ts-doc").first();
    await expect(first.locator(".ts-doc-title")).toHaveText("제1절 일반조항");
    await expect(first).toContainText("는 제2절 보장조항에서 정합니다.");
    const second = page.getByRole("region", { name: "제2절 보장조항" });
    await expect(second.locator(":scope > .ts-doc-title")).toHaveText("제2절 보장조항");
    await expect(second.locator(".ts-doc-group-title")).toHaveText(["Ⅰ. 상해 관련 특별약관"]);
    await expect(second.locator("article.ts-doc > .ts-doc-title")).toHaveText(["Ⅰ-1. 일반상해80%이상후유장해 특별약관", "Ⅰ-2. 일반상해80%이상후유장해 추가 특별약관"]);
    // 블록마다 제1조부터
    for (const block of await second.locator("article.ts-doc").all()) await expect(block.locator(".ts-doc-article").first()).toContainText("제1조");
    // 독립특약은 특약 그룹이 없다
    await expect(page.getByRole("heading", { name: /^특약 그룹/ })).toHaveCount(0);

    // ── 주계약 기본계약 2개 — 그룹 제목 표시 끔 「1.」 「2.」 · 특약 그룹은 그대로
    await openPreview(page, "표본 — 기본계약 2개(주계약)");
    const blocks = page.getByRole("region", { name: "제2절 보장조항" });
    await expect(blocks.locator(".ts-doc-group-title")).toHaveCount(0);
    await expect(blocks.locator("article.ts-doc > .ts-doc-title")).toHaveText(["1. 일반상해80%이상후유장해", "2. 일반상해사망보장"]);
    await expect(page.getByRole("heading", { name: /^특약 그룹/ })).toBeVisible();
  },
);
