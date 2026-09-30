import { type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";

/**
 * 함수조항 내부 변수 (최종 결정 2 · 기능/함수조항 §3.7) — 인자(열거형 납입면제사유)를 가공한 내부 변수를 두고, 본문 슬롯 고르기의 「내부 변수」 묶음에서
 * 그 이름을 골라 저장하면 상세의 내부 변수 표에 남는다. 앞에 선언하지 않은 이름을 읽으면 저장이 거부된다.
 * 시드는 건드리지 않는다 — 새 함수조항만 쓴다.
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test(
  "인자를 가공한 내부 변수 → 슬롯 고르기의 「내부 변수」 묶음 → 저장 · 뒤 이름을 읽으면 거부",
  { annotation: { type: "좌표없음", description: "기능/함수조항 §3.7 내부 변수 — 시나리오 파일에 내부 변수 시나리오가 아직 없다 (기능/함수조항 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const clauseName = `사유 문구(${stamp})`;
    await ev.action("내부변수#1", "관리자로 로그인한다", () => login(page));

    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });

    await ev.action("내부변수#2", "새 함수조항(항) — 인자 「사유」(열거형 납입면제사유) · 내부 변수 「질병인가 = arg.사유 = 'V01'」 · 「대표 = arg.사유」", async () => {
      await page.goto("/functions/new?type=block");
      await page.getByLabel("함수조항명").fill(clauseName);
      await page.getByLabel("새 인자 이름", { exact: true }).fill("사유");
      await page.getByLabel("새 인자 타입", { exact: true }).selectOption("enum:E0001");
      await page.getByRole("button", { name: "인자 추가" }).click();
      await page.getByRole("button", { name: "내부 변수 추가" }).click();
      await page.getByLabel("내부 변수 1 이름").fill("질병인가");
      await page.getByLabel("내부 변수 1 식").fill("arg.사유 = 'V01'");
      await page.getByRole("button", { name: "내부 변수 추가" }).click();
      await page.getByLabel("내부 변수 2 이름").fill("대표");
      await page.getByLabel("내부 변수 2 식").fill("arg.사유");
    });

    await ev.action("내부변수#3", "본문 슬롯 — 고르기에 「내부 변수」 묶음이 서고 「대표」를 골라 넣는다 · 저장", async () => {
      const paragraph = editor.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill("납입면제사유: ");
      await paragraph.press("End");
      await toolbar.getByRole("button", { name: "슬롯", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "치환 슬롯 넣기", exact: true });
      await pickCombo(dialog.locator("#pop-slot"), { value: "var.대표" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      const locals = page.getByRole("region", { name: "내부 변수" });
      await expect(locals).toContainText("질병인가");
      await expect(locals).toContainText("arg.사유 = 'V01'");
      await expect(editor).toContainText("납입면제사유: var.대표");
    });

    await ev.action("내부변수#4", "편집 — 앞에 선언하지 않은 이름(var.뒤)을 읽는 내부 변수를 더하면 저장이 거부된다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByRole("button", { name: "내부 변수 추가" }).click();
      await page.getByLabel("내부 변수 3 이름").fill("앞");
      await page.getByLabel("내부 변수 3 식").fill("var.뒤");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.locator(".ts-error-banner").first()).toContainText("앞에 선언한 내부 변수만 읽는다");
    });
  },
);
