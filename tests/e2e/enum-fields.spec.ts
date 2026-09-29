import type { Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 열거형 유저 정의 필드 (기능/열거형 §3.1 · §4.3, ADR-0078 결정 2) — 필드 정의 · 값 × 필드 입력 · 저장 한 번 · 필드 삭제 관리자 확인.
 * 시드를 건드리지 않게 이 테스트가 더한 필드만 지우고 되돌린다 (한 실행이 DB 하나를 나눠 쓴다).
 */

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test(
  "열거형 필드: 참거짓 필드를 더하고 값 하나에 예를 넣어 저장하면 다시 열어도 남고, 필드를 빼면 관리자 확인 뒤 사라진다",
  {
    annotation: {
      type: "좌표없음",
      description: "기능/열거형 §3.1 · §4.3 (ADR-0078 결정 2) — 열거형 전용 시나리오 파일이 없다 (기능/열거형 §7)",
    },
  },
  async ({ page }) => {
    test.setTimeout(90000);
    await login(page);
    const field = `면책여부${Date.now()}`;
    let added = false;
    try {
      await page.goto("/enums/E0001");
      const firstValue = (await page.locator("table.ts-table").last().locator("tbody tr").first().locator("td").nth(1).innerText()).trim();
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByRole("button", { name: "필드 추가", exact: true }).click();
      await page.getByRole("textbox", { name: /^필드 이름/ }).last().fill(field);
      await page.getByRole("combobox", { name: `${field} 타입` }).selectOption({ label: "참거짓" });
      // 값 × 필드 칸 — 새 필드 열이 값 표에 바로 선다
      await page.getByRole("combobox", { name: `${firstValue} ${field}` }).selectOption({ label: "예" });
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      added = true;

      // 다시 열어도 남는다 — 필드 표에 이름 · 타입, 값 표에 그 열과 「예」
      await page.reload();
      const fields = page.getByRole("region", { name: "필드" });
      await expect(fields).toContainText(field);
      await expect(fields).toContainText("참거짓");
      const values = page.locator("table.ts-table").last();
      await expect(values.locator("thead")).toContainText(field);
      await expect(values.locator("tbody tr").first()).toContainText("예");
    } finally {
      if (added) {
        // 필드 삭제 = 관리자 확인 (ADR-0019) — 「값 1개의 입력이 지워진다」
        await page.goto("/enums/E0001");
        await page.getByRole("button", { name: "편집", exact: true }).click();
        await page.getByRole("button", { name: new RegExp(`^${field}\\(F\\d+\\) 빼기`) }).click();
        await page.getByRole("button", { name: "저장", exact: true }).click();
        const dialog = page.locator("dialog.ts-dialog");
        await expect(dialog).toContainText("필드를 빼거나 타입을 바꾸면 값마다 넣은 입력이 지워진다");
        await expect(dialog).toContainText(`필드 「${field}」 — 값 1개의 입력이 지워진다`);
        await dialog.getByRole("button", { name: "필드 1개 바꾸고 저장" }).click();
        await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: "필드" })).not.toContainText(field);
      }
    }
  },
);
