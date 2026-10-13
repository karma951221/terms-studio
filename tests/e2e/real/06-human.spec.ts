import { articleTitles, diffArticlesUnordered, referenceNumberIssues, type UnorderedDiff } from "../../../src/domain/assembly/compare";
import { pickCombo } from "../_lib/combo";
import { expect, test } from "../_lib/fixtures";
import { NO_COORD, arrive, login, open } from "./_lib/app";
import { renderedLines, sourceLines } from "./_lib/compare";
import { HUMAN, REAL_FIXTURES, SEED } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ⑥ 사람처럼 — ③b 에서 넣은 「말기신부전증진단비보장」을 알파Plus2607 상품에 탑재하고(메뉴 → 상품 → 상품담보 탭 → 편집 → 저장),
 * 조립 미리보기에서 그 특약을 원문과 대조한다. 책자는 이제 2607 특약 15 전부다. 근거: docs/QA/시나리오/실물재현_E2E_시나리오.md §9
 */

const product = SEED.products.find((p) => p.code === HUMAN.product)!;
const fixtures = REAL_FIXTURES[HUMAN.product];
const NAME = "말기신부전증진단비보장";
const clean: UnorderedDiff = { missing: [], extra: [] };

test.describe.serial("실물 재현(화면) ⑥ 사람처럼 — 알파Plus2607 에 말기신부전증 탑재 → 원문 대조", () => {
  test(`「${product.name}」 상품담보 — 특별약관에 「${NAME}」 더하고 저장`, NO_COORD, async ({ page, ev }) => {
    await ev.action("실물사람#4.1", "메뉴 「상품」 → 상품을 연다 → 상품담보 탭", async () => {
      await login(page);
      await open(page, "/");
      await page.locator("nav").getByRole("link", { name: "상품", exact: true }).first().click();
      await page.waitForLoadState("networkidle");
      await page.getByRole("link", { name: product.name, exact: true }).click();
      await arrive(page, /\/products\/[0-9a-f-]+/);
      await page.getByRole("navigation", { name: "상품 하위 탭" }).getByRole("link", { name: "상품담보", exact: true }).click();
      await arrive(page, /tab=coverages/);
    });
    await ev.action("실물사람#4.2", `편집 → 특별약관 표 아래 「+ 담보 추가」 → 「${NAME}」 → 추가 → 저장`, async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const region = page.getByRole("region", { name: "특별약관", exact: true });
      await region.getByRole("button", { name: "특별약관에 담보 추가" }).click();
      await pickCombo(region.getByRole("combobox", { name: "담보 · 특별약관에 추가", exact: true }), { label: NAME });
      await region.getByRole("button", { name: "추가", exact: true }).click();
      await expect(region.getByRole("textbox", { name: `상품담보명 · ${NAME}`, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(region.locator("tbody tr")).toHaveCount(fixtures.specials.length + 1);
      const row = region.locator("tbody tr").filter({ has: page.locator("td.col-flex").getByText(NAME, { exact: true }) });
      await expect(row.locator("td").nth(4)).toHaveText("질병 관련 특별약관");
    });
  });

  test(`조립 미리보기 → 「${HUMAN.special[0]}」 원문 대조 · 특약 ${fixtures.specials.length + 1}`, NO_COORD, async ({ page, ev }) => {
    await ev.action("실물사람#4.3", "상품 더보기 › 미리보기 → 실행 — 오류 0", async () => {
      await login(page);
      await open(page, "/products");
      await page.getByRole("link", { name: product.name, exact: true }).click();
      await arrive(page, /\/products\/[0-9a-f-]+/);
      await page.getByRole("button", { name: "더보기", exact: true }).click();
      await page.getByRole("menuitem", { name: "미리보기", exact: true }).click();
      await expect(page).toHaveURL(/\/products\/.+\/preview/);
      await page.getByRole("button", { name: /^(다시 )?실행$/ }).click();
      await expect(page.getByText(/^조립 검사: 오류 0 · /)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/완성본 아님/)).toHaveCount(0);
    });
    await ev.action("실물사람#4.4", `「${HUMAN.special[0]}」을 원문과 대조한다`, async () => {
      const general = await renderedLines(page.locator("article.ts-doc").first());
      const doc = page.locator("article.ts-doc", { has: page.getByRole("heading", { name: HUMAN.special[0], exact: true }) });
      await expect(doc).toHaveCount(1);
      const lines = await renderedLines(doc);
      const diff = diffArticlesUnordered(sourceLines(HUMAN.special[1], fixtures.dir), lines);
      expect(diff, JSON.stringify(diff, null, 1)).toEqual(clean);
      expect(referenceNumberIssues(lines, articleTitles(general))).toEqual([]);
    });
  });
});
