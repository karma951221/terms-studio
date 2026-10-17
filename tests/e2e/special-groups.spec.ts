import { expect, test } from "./_lib/fixtures";
import { pickCombo } from "./_lib/combo";

/**
 * 특약 그룹 (ADR-0090 · 기능/상품 §3.7 · §4.5) — 상품담보 탭 「특약 그룹」 섹션: 기본 그룹(담보분류)과 사용자 그룹이 한 목록,
 * 담보 단위로 넣기 · ▲▼ 전체 순서 · 빈 이름 거부, 탭의 편집 하나 = 저장 하나 → 미리보기 책자의 그룹 순서 · 제목이 따라온다.
 * 시드 담보(일반상해사망보장 = 상해 · 질병사망(통합간편가입)보장 = 질병)를 새 상품에 탑재해 다른 시드 상품을 건드리지 않는다.
 */
test(
  "특약 그룹: 사용자 그룹 만들기 · 담보 넣기 · ▲ 순서 → 저장 → 미리보기 책자 순서",
  {
    annotation: {
      type: "좌표없음",
      description: "기능/상품 §4.5 「특약 그룹」 섹션(ADR-0090, 2026-10-17 구현) — 시나리오 좌표가 아직 없다",
    },
  },
  async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/login");
    await page.getByRole("button", { name: /admin/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    const name = `특약 그룹 E2E ${Date.now()}`;
    let productUrl: string | undefined;
    try {
      await page.goto("/products/new");
      await page.getByLabel("상품명", { exact: true }).fill(name);
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/products\/[0-9a-f-]{36}(?:\?tab=basic)?$/);
      productUrl = page.url().split("?")[0]!;

      // ── 특약 둘을 탑재 — 저장 전에도 「특약 그룹」 섹션이 초안의 기본 그룹(담보분류 순)을 보인다
      await page.goto(`${productUrl}?tab=coverages`);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const specials = page.getByRole("region", { name: "특별약관", exact: true });
      for (const coverage of ["일반상해사망보장", "질병사망(통합간편가입)보장"]) {
        await specials.getByRole("button", { name: "특별약관에 담보 추가" }).click();
        await pickCombo(specials.getByRole("combobox", { name: "담보 · 특별약관에 추가", exact: true }), { label: coverage });
        await specials.getByRole("button", { name: "추가", exact: true }).click();
      }
      const groups = page.getByRole("region", { name: "특약 그룹", exact: true });
      const groupRows = groups.locator("tbody tr[data-group]");
      await expect(groupRows.locator("td:nth-child(2)")).toHaveText(["상해 관련 특별약관", "질병 관련 특별약관"]);
      await expect(groupRows.locator("td:nth-child(3)")).toHaveText(["기본 — 담보분류 상해", "기본 — 담보분류 질병"]);

      // ── 사용자 그룹 — 「+ 그룹」은 목록 끝, 이름 · 담보 넣기, ▲ 두 번으로 맨 앞
      await groups.getByRole("button", { name: "특약 그룹 추가" }).click();
      await groups.getByRole("textbox", { name: "그룹 이름 · 3" }).fill("질병 사망 특별약관");
      await groups.getByRole("combobox", { name: "담보 넣기 · 질병 사망 특별약관" }).selectOption({ label: "질병사망(통합간편가입)보장" });
      await groups.getByRole("button", { name: "위로 · 질병 사망 특별약관" }).click();
      await groups.getByRole("button", { name: "위로 · 질병 사망 특별약관" }).click();
      // 표의 「그룹」 열은 읽기 전용으로 초안을 따른다
      await expect(specials.locator("tbody tr", { hasText: "질병사망(통합간편가입)보장" }).locator("td").nth(4)).toHaveText("질병 사망 특별약관");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();

      // ── 읽기 — 저장된 순서 · 질병 기본 그룹은 담보가 없어 「책자에 찍지 않는다」
      await expect(groupRows.locator("td:nth-child(2)")).toHaveText(["질병 사망 특별약관", "상해 관련 특별약관", "질병 관련 특별약관"]);
      await expect(groupRows.nth(0)).toContainText("질병사망(통합간편가입)보장");
      await expect(groupRows.nth(2)).toContainText("담보 없음 — 책자에 찍지 않는다");

      // ── 빈 이름 · 기본 그룹 제목과 같은 이름은 그 그룹 줄에서 거부 — 저장하지 않는다
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await groups.getByRole("button", { name: "특약 그룹 추가" }).click();
      await groups.getByRole("button", { name: "특약 그룹 추가" }).click();
      await groups.getByRole("textbox", { name: "그룹 이름 · 5" }).fill("상해 관련 특별약관");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(groups.getByRole("alert").filter({ hasText: "그룹 이름은 비울 수 없습니다" })).toBeVisible();
      await expect(groups.getByRole("alert").filter({ hasText: "이 상품의 다른 그룹 제목과 같습니다 — 「상해 관련 특별약관」" })).toBeVisible();
      await page.getByRole("button", { name: "취소", exact: true }).click();
      await page.getByRole("button", { name: "저장하지 않고 나가기" }).click();
      await expect(groupRows).toHaveCount(3);

      // ── 미리보기 — 책자의 특약 그룹 순서 = 상품 그룹 목록, 제목 = 사용자 그룹 이름 · 담보분류의 「그룹 제목」, 빈 그룹은 없다
      await page.goto(`${productUrl}/preview`);
      await page.getByRole("button", { name: "실행", exact: true }).click();
      await expect(page.locator(".ts-doc-group-title")).toHaveText(["질병 사망 특별약관", "상해 관련 특별약관"]);
    } finally {
      if (productUrl) {
        await page.goto(`${productUrl}?confirm=product`);
        await page.locator('.ts-confirm button[type="submit"]').click();
        await page.waitForURL(/\/products$/);
      }
    }
  },
);
