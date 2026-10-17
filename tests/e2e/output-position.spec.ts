import { type Locator, type Page } from "@playwright/test";

import { comboOptionCount, pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";
import { productWithSpecial } from "./_lib/product";

/**
 * 작성위치 · 범위 낱말 (ADR-0089 결정 3 · 4 · 기능/문면 §3.3 · §3.4) — 담보약관 템플릿에서 슬롯 고르기 「범위 낱말」(칩 〔이 약관의〕)을 넣고,
 * 조건 머리 줄 변수 목록 끝의 「작성위치」(= 특약)로 특약 전용 문장을 가른다. 특약으로 탑재한 상품의 미리보기는 「이 특별약관의」와 그 문장을 찍는다.
 * 보통약관 템플릿의 조건 변수 목록에는 「작성위치」가 없다. 시드는 건드리지 않는다 — 새 담보 · 새 템플릿만 쓴다.
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
  "담보약관 — 범위 낱말 슬롯 〔이 약관의〕 · 작성위치 = 특약 조건 → 특약 미리보기는 「이 특별약관의」 · 보통약관에는 작성위치 없음",
  { annotation: { type: "좌표없음", description: "기능/문면 §3.3 작성위치 조건 · §3.4 범위 낱말 슬롯 — 시나리오 파일에 작성위치 시나리오가 아직 없다 (기능/문면 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const coverageName = `작성위치검증담보${stamp}`;
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });
    const body = page.locator(".ts-l3-body");
    await ev.action("작성위치#1", "관리자로 로그인한다", () => login(page));

    const docUrl = await ev.action("작성위치#2", "새 담보와 그 담보약관 템플릿을 만든다", async () => {
      await page.goto("/coverages/new");
      await page.locator("#cov-name").fill(coverageName);
      await page.locator("#cov-sub").fill("사망");
      await page.locator("#cov-benefit").fill("사망보험금");
      await page.locator("#cov-category").selectOption({ label: "상해" });
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
      await page.goto("/documents/new?kind=coverage");
      await pickCombo(page.locator("#doc-coverage"), { label: coverageName });
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      return page.url();
    });

    await ev.action("작성위치#3", "편집 — 항 「회사는 」 뒤에 툴바 「슬롯」 → 맨 앞 「범위 낱말」 묶음의 〔이 약관의〕를 넣는다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험금의 지급사유");
      await title.press("Enter");
      await tool("항").click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true });
      await paragraph.fill("회사는 ");
      await paragraph.press("End");
      await tool("슬롯").click();
      const dialog = page.getByRole("dialog", { name: "치환 슬롯 넣기", exact: true });
      await pickCombo(dialog.locator("#pop-slot"), { value: "builtin.output.scope" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(body.locator(".ts-doc-slot")).toHaveText("〔이 약관의〕");
      await paragraph.click();
      await paragraph.press("End");
      await paragraph.pressSequentially(" 보험기간 중 보험금을 지급합니다.");
    });

    await ev.action("작성위치#4", "툴바 「조건식」 — 변수 목록 끝 「작성위치」 · 연산자 = · 값 「특약」, 빈 항에 특약 전용 문장을 쓰고 저장", async () => {
      await tool("조건식").click();
      const head = body.locator("[data-cond-head]");
      await pickCombo(head.getByRole("combobox", { name: "IF 1번 줄 변수" }), { value: "builtin.output" });
      await expect(head.getByRole("combobox", { name: "IF 1번 줄 연산자" })).toHaveValue("=");
      await head.getByRole("combobox", { name: "IF 1번 줄 값" }).selectOption({ label: "특약" });
      const inner = body.locator(".ts-doc-cond").getByRole("textbox", { name: "항", exact: true });
      await inner.click();
      await inner.fill("특약에만 있는 문장입니다.");
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
    });

    await ev.action("작성위치#5", "이 담보를 특약으로 탑재한 상품의 미리보기 — 「이 특별약관의」와 특약 전용 문장이 찍힌다", async () => {
      await productWithSpecial(page, `작성위치미리보기 ${coverageName}`, coverageName);
      await page.goto(docUrl);
      const preview = page.locator("#ts-side-panel-preview");
      await expect(preview).toContainText("회사는 이 특별약관의 보험기간 중 보험금을 지급합니다.");
      await expect(preview).toContainText("특약에만 있는 문장입니다.");
    });

    await ev.action("작성위치#6", "보통약관 템플릿 — 조건 변수 목록에 「작성위치」가 없다", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(`작성위치 보통약관 ${stamp}`);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("x");
      await title.press("Enter");
      await tool("항").click();
      await body.getByRole("textbox", { name: "항", exact: true }).fill("x");
      await tool("조건식").click();
      const head = body.locator("[data-cond-head]");
      expect(await comboOptionCount(head.getByRole("combobox", { name: "IF 1번 줄 변수" }), "작성위치")).toBe(0);
    });
  },
);
