import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";
import { productWithSpecial } from "./_lib/product";

/**
 * 동적표(감액 지급금액 표) — 인수 케이스 1 (docs/QA/인수기준.md 「동적표(감액 지급금액 표) 인수 케이스」, 기능/동적표 §4).
 * 시드 동적표 A(DT000001 「감액 지급금액 표」)를 담보약관에 넣고(인자 갱신형 = 아니오 상수), 세부보장 1 · 급부 1(100% · 1년 50%) 담보를 특약으로
 * 탑재한 상품의 미리보기가 [구 분 │ 계약일부터 1년경과시점 전일 이전 │ 계약일부터 1년경과시점 이후] [질병80%이상후유장해 │ 보험가입금액의 50% │ 보험가입금액의 100%] 로 선다.
 * 세부보장이 하나라 「해당보장의」 는 없다. 보통약관에는 동적표 넣기가 잠긴다 (기능/동적표 §3.5).
 * 시드는 건드리지 않는다 — 새 담보 · 새 담보약관 · 새 상품만 쓴다.
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

test(
  "동적표 — 시드 감액 표를 담보약관에 넣고(갱신형 = 아니오) 미리보기가 1년 경계 두 열 · 50% · 100% 로 선다 (인수 케이스 1)",
  { annotation: { type: "좌표없음", description: "QA/인수기준 「동적표(감액 지급금액 표) 인수 케이스」 1 — 시나리오 파일이 아직 없다" } },
  async ({ page, ev }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const coverageName = `동적표검증담보${stamp}`;
    await ev.action("동적표#1", "관리자로 로그인한다", () => login(page));

    await ev.action("동적표#2", "약관 조문 › 동적표 조회에 시드 「감액 지급금액 표」(DT000001)가 있다", async () => {
      await page.goto("/dyntables");
      const row = page.getByRole("row").filter({ hasText: "DT000001" });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("link", { name: "감액 지급금액 표", exact: true })).toBeVisible();
      await expect(row).toContainText("감액 구간");
    });

    await ev.action("동적표#3", "새 담보 — 세부보장 1 · 급부 「질병80%이상후유장해」 · 지급률 100 · 감액 1Y 50%", async () => {
      await page.goto("/coverages/new");
      await page.locator("#cov-name").fill(coverageName);
      await page.locator("#cov-sub").fill("질병80%이상후유장해");
      await page.locator("#cov-benefit").fill("질병80%이상후유장해");
      await page.locator("#cov-category").selectOption({ label: "질병" }); // 담보분류는 필수 (ADR-0090)
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);

      await page.getByRole("button", { name: "편집", exact: true }).click();
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
      const benefit = page.locator("section.ts-cov-card[data-level='benefit']").first();
      // 선택 필드 지급률 — 「⊕ 지급률」 로 칸을 만들고 100
      await benefit.getByRole("button", { name: "지급률", exact: true }).click();
      await benefit.locator('input[name="pay.rate"]').fill("100");
      // 선택 폼 감액 — 「⊕ 감액」 으로 열고 구간 표에 행 하나 (1Y · 50)
      await benefit.getByRole("button", { name: "감액", exact: true }).click();
      const reduction = benefit.getByRole("group", { name: "감액" });
      await expect(reduction).toBeVisible();
      await reduction.getByRole("button", { name: "+ 행", exact: true }).click();
      await reduction.getByRole("textbox", { name: "1행 기간", exact: true }).fill("1Y");
      await reduction.getByRole("textbox", { name: "1행 지급률", exact: true }).fill("50");
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(benefit).toContainText("1년");
    });

    const docUrl = await ev.action("동적표#4", "그 담보의 담보약관 템플릿을 만든다", async () => {
      await page.goto("/documents/new?kind=coverage");
      await pickCombo(page.locator("#doc-coverage"), { label: coverageName });
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      return page.url();
    });

    const body = page.locator(".ts-l3-body");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });

    await ev.action("동적표#5", "편집 — 조를 쓰고 툴바 「동적표」로 DT000001 을 고르고 갱신형 = 아니오(상수)로 연결해 넣으면 띠 「[DT000001] 동적표 감액 지급금액 표 · 인자: 갱신형 ← 아니오」", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await toolbar.getByRole("button", { name: "조", exact: true }).click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험금의 지급사유");
      await title.press("Enter");
      await toolbar.getByRole("button", { name: "동적표", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "동적표 넣기", exact: true });
      await pickCombo(dialog.locator("#pop-dyntable"), { value: "DT000001" });
      await dialog.getByLabel("인자 갱신형", { exact: true }).selectOption("c:false");
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const band = body.locator(".ts-doc-clause.is-dyntable");
      await expect(band).toHaveCount(1);
      await expect(band.locator(".ts-doc-clause-head")).toContainText("[DT000001] 동적표 감액 지급금액 표");
      await expect(band.locator(".ts-doc-clause-head")).toContainText("갱신형 ← 아니오");
    });

    await ev.action("동적표#6", "저장 — 담보약관은 동적표를 받는다", async () => {
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(body.locator(".ts-doc-clause.is-dyntable")).toHaveCount(1);
    });

    await ev.action("동적표#7", "이 담보를 특약으로 탑재한 상품의 미리보기 — 머리글 「계약일부터 1년경과시점 전일 이전 · 이후」 · 셀 「보험가입금액의 50% · 100%」 · 「해당보장의」 없음", async () => {
      await productWithSpecial(page, `동적표미리보기 ${coverageName}`, coverageName);
      await page.goto(docUrl);
      const preview = page.locator("#ts-side-panel-preview");
      const table = preview.locator("table").first();
      await expect(table).toBeVisible();
      const headerCells = table.locator("tr").first().locator("th, td");
      await expect(headerCells).toHaveText(["구 분", "계약일부터 1년경과시점 전일 이전", "계약일부터 1년경과시점 이후"]);
      const rowCells = table.locator("tr").nth(1).locator("th, td");
      await expect(rowCells).toHaveText(["질병80%이상후유장해", "보험가입금액의 50%", "보험가입금액의 100%"]);
      await expect(preview).not.toContainText("해당보장의");
      await expect(preview).not.toContainText("최초계약일");
    });

    await ev.action("동적표#8", "보통약관에는 동적표 넣기가 잠긴다 — 툴바 「동적표」가 꺼져 있다", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(`동적표검증 보통약관 ${stamp}`);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await toolbar.getByRole("button", { name: "조", exact: true }).click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험금의 지급사유");
      await title.press("Enter");
      await expect(toolbar.getByRole("button", { name: "함수조항", exact: true })).toBeEnabled();
      await expect(toolbar.getByRole("button", { name: "동적표", exact: true })).toBeDisabled();
    });
  },
);
