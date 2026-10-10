import type { Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 열거값 삭제 = 「없는 값」 오류 · 열거값 추가 = 재검사 목록 (기능/열거형 §3.2 · §3.3, ADR-0078 결정 4 · 5).
 * 시드를 건드리지 않게 이 테스트가 더한 값 · 구분자 · 상품만 지우고 되돌린다 (한 실행이 DB 하나를 나눠 쓴다).
 */

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 열거형 상세에서 새 값을 하나 더해 저장한다. */
async function addEnumValue(page: Page, code: string, label: string) {
  await page.goto(`/enums/${code}`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByRole("button", { name: "행 추가 · 값", exact: true }).click();
  // 값 행의 첫 칸이 값 이름 — 필드가 있는 열거형(E0001)은 필드 칸이 뒤따른다
  await page.locator("table.ts-table tbody tr").last().locator("input").first().fill(label);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
}

/** 열거형 상세에서 값 하나를 빼고 저장한다 — 관리자 확인 대화상자를 거친다. */
async function removeEnumValue(page: Page, code: string, label: string, confirmLine?: RegExp) {
  await page.goto(`/enums/${code}`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByRole("button", { name: `행 삭제 · ${label}`, exact: true }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const dialog = page.locator("dialog.ts-dialog");
  await expect(dialog).toContainText("값을 빼면 그 값을 고른 자리가 「없는 값」 오류가 된다");
  if (confirmLine) await expect(dialog).toContainText(confirmLine);
  await dialog.getByRole("button", { name: "값 1개 삭제하고 저장" }).click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
}

test(
  "열거값: 추가하면 재검사 목록, 지우면 세목 값에 「없는 값」 칩이 남고 빼기로 고친다",
  {
    annotation: {
      type: "좌표없음",
      description: "기능/열거형 §3.2 · §3.3 (ADR-0078 결정 4 · 5) — 구분자정의 시나리오 2 의 값 삭제 문장은 옛 「값 행 연쇄 삭제」라 좌표를 달지 않는다",
    },
  },
  async ({ page }) => {
    test.setTimeout(120000);
    await login(page);
    const stamp = Date.now();
    const reason = `임시사유${stamp}`;
    const noticeKind = `임시고지${stamp}`;
    let productUrl: string | undefined;
    let discriminatorUrl: string | undefined;
    try {
      // ── 추가 = 재검사: 상품 레벨 구분자가 고지유형(E0005) 값을 비교한다 → E0005 에 값을 더하면 그 식이 목록에 오른다
      //    (간편심사유형 E0003 은 2026-10-01 부터 목록값(복수)이라 `= 'V01'` 비교가 타입 오류다 — 기능/상품 §3.1)
      await page.goto("/catalog/new");
      await page.getByLabel("구분자명").fill(`재검사확인${stamp}`);
      await page.getByRole("radiogroup", { name: "레벨" }).getByRole("radio", { name: "상품", exact: true }).check();
      await page.getByLabel("식", { exact: true }).fill("feature.notice_kind = 'V01'");
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/catalog\/D\d{4}$/);
      discriminatorUrl = page.url();
      await addEnumValue(page, "E0005", noticeKind);
      const recheck = page.getByRole("status", { name: "재검사 목록" });
      await expect(recheck).toContainText("재검사 1건");
      await expect(recheck).toContainText(`재검사확인${stamp}`);

      // ── 삭제 = 없는 값: 납입면제사유(E0001)에 값을 더해 상품 세목이 고르게 한 뒤 그 값을 지운다
      await addEnumValue(page, "E0001", reason);
      await page.goto("/products/new");
      await page.getByLabel("상품명", { exact: true }).fill(`없는값 확인 ${stamp}`);
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/products\/[0-9a-f-]{36}(?:\?tab=basic)?$/);
      productUrl = page.url().split("?")[0];
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByRole("button", { name: "보험종목 추가" }).click();
      const row = page.locator("#definitions-panel tbody tr").nth(0);
      await row.getByRole("textbox", { name: "보험종목명" }).fill("납입면제형");
      await row.getByRole("combobox", { name: "세목유형" }).selectOption("waiver");
      await row.getByRole("radio", { name: "예", exact: true }).check();
      { await row.getByRole("button", { name: / 값 추가$/ }).click(); await row.getByRole("combobox", { name: / 값 추가$/ }).selectOption({ label: "뇌졸중" }); }
      { await row.getByRole("button", { name: / 값 추가$/ }).click(); await row.getByRole("combobox", { name: / 값 추가$/ }).selectOption({ label: reason }); }
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();

      await removeEnumValue(page, "E0001", reason, /그 값을 고른 저장 값 1건이 「없는 값」 오류로 남는다/);

      // 읽기: 남은 값은 이름으로, 지운 값은 코드와 함께 오류 칩으로 — 조용히 사라지지 않는다
      await page.goto(productUrl);
      const readRow = page.locator("#definitions-panel tbody tr").nth(0);
      await expect(readRow).toContainText("뇌졸중");
      const chip = readRow.locator(".ts-chip.is-error");
      await expect(chip).toHaveText(/^없는 값 V\d+$/);

      // 편집: 칩에 빼기 버튼 — 다른 체크를 만져도 칩은 남고, 빼기로만 지운다. 빼고 저장하면 칩이 없다
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const editRow = page.locator("#definitions-panel tbody tr").nth(0);
      { await editRow.getByRole("button", { name: / 값 추가$/ }).click(); await editRow.getByRole("combobox", { name: / 값 추가$/ }).selectOption({ label: "급성심근경색증" }); }
      await expect(editRow.locator(".ts-chip.is-error")).toHaveCount(1);
      await editRow.getByRole("button", { name: /^없는 값 V\d+ 빼기$/ }).click();
      await expect(editRow.locator(".ts-chip.is-error")).toHaveCount(0);
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator("#definitions-panel tbody tr").nth(0)).toContainText("뇌졸중, 급성심근경색증");
      await expect(page.locator(".ts-chip.is-error")).toHaveCount(0);
    } finally {
      if (productUrl) {
        await page.goto(`${productUrl}?confirm=product`);
        await page.locator('.ts-confirm button[type="submit"]').click();
        await page.waitForURL(/\/products$/);
      }
      if (discriminatorUrl) {
        await page.goto(discriminatorUrl);
        await page.getByRole("button", { name: /^구분자 재검사확인\d+\(D\d{4}\) 삭제/ }).click();
        await page.locator("dialog.ts-dialog").getByRole("button", { name: /삭제$/ }).click();
        await page.waitForURL((url) => !url.pathname.startsWith("/catalog/D"));
      }
      // E0005 에 더한 값은 아무도 고르지 않았다 — 되돌린다
      await removeEnumValue(page, "E0005", noticeKind).catch(() => undefined);
    }
  },
);
