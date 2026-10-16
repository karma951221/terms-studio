import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";
import { pickCombo } from "./_lib/combo";

/**
 * 블록 반복의 「비었을 때」 칸 (ADR-0088 결정 4 · 수용 기준 4 일부, 기능/문면 §3.12).
 *
 * 새 보통약관 템플릿의 조 자리에 「납입면제종마다 — 적용여부 = 예인 선택지」 반복(본문 항 「면제 대상 종이 있습니다.」)을 넣고,
 * 반복 아래 입구 「+ 비었을 때 내용」으로 칸에 항 「면제 대상 종이 없습니다.」를 쓴다. 저장 한 번.
 * 적용 종 하나인 상품의 조립 미리보기는 반복 본문만, 적용 종 없는 상품(원소 0개)은 칸 항만 낸다. 시드는 건드리지 않는다 — 새 템플릿 · 새 상품만 쓴다.
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

/** 납입면제 종 하나인 새 상품 — 보통약관 = `docTitle`. 돌려주는 것은 상품 주소. */
async function product(page: Page, name: string, docTitle: string, plan: { applies: boolean; reasons: readonly string[] }): Promise<string> {
  await page.goto("/products/new");
  await page.getByLabel("상품명", { exact: true }).fill(name);
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}(?:\?tab=basic)?$/);
  const url = page.url().split("?")[0];
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByRole("button", { name: "보험종목 추가" }).click();
  const row = page.locator("#definitions-panel tbody tr").first();
  await row.getByRole("textbox", { name: "보험종목명" }).fill("면제형");
  await row.getByRole("combobox", { name: "세목유형" }).selectOption("waiver");
  await row.getByRole("radio", { name: plan.applies ? "예" : "아니오", exact: true }).check();
  for (const r of plan.reasons) {
    await row.getByRole("button", { name: / 값 추가$/ }).click();
    await row.getByRole("combobox", { name: / 값 추가$/ }).selectOption({ label: r });
  }
  await page.getByRole("tab", { name: "종·형 조합" }).click();
  await page.getByRole("checkbox", { name: /제1종/ }).check();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "상품 하위 탭" }).getByRole("link", { name: "보통약관", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await pickCombo(page.getByRole("combobox", { name: "보통약관 템플릿" }), { label: docTitle });
  await submit(page, page.getByRole("button", { name: "템플릿 지정" }));
  return url;
}

/** 조립 미리보기의 보통약관 첫 조. */
async function firstArticle(page: Page, productUrl: string): Promise<Locator> {
  await page.goto(`${productUrl}/preview`);
  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByRole("heading", { name: "조립 검사 결과" })).toBeVisible();
  return page.locator("article.ts-doc").first().locator(".ts-doc-article").first();
}

test(
  "블록 반복 「비었을 때」 칸 → 원소 있는 상품은 반복 본문만, 원소 0개 상품은 칸 항만",
  { annotation: { type: "좌표없음", description: "기능/문면 §3.12 반복의 「비었을 때」 칸 · ADR-0088 결정 4 — 시나리오 파일에 블록 반복 시나리오가 아직 없다 (기능/문면 §5)" } },
  async ({ page, ev }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const docTitle = `반복칸 보통약관 ${stamp}`;
    const bodyText = "면제 대상 종이 있습니다.";
    const emptyText = "면제 대상 종이 없습니다.";
    await ev.action("반복칸#1", "관리자로 로그인한다", () => login(page));

    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });
    const body = page.locator(".ts-l3-body");
    const repeat = body.locator(".ts-doc-repeat");

    await ev.action("반복칸#2", "새 보통약관 템플릿 — 조 「면제 안내」 · 툴바 「반복」 → 「납입면제종마다 — 적용여부 = 예인 선택지」 · 본문 항", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(docTitle);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("면제 안내");
      await title.click();
      await tool("반복").click();
      const dialog = page.getByRole("dialog", { name: "반복 블록 넣기", exact: true });
      await dialog.getByLabel("반복 원천").selectOption({ label: "납입면제종마다 — 적용여부 = 예인 선택지" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const paragraph = repeat.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill(bodyText);
      await paragraph.press("End");
    });

    await ev.action("반복칸#3", "반복 아래 입구 「+ 비었을 때 내용」 → 칸에 항 하나 · 칸 항을 쓰고 저장 한 번", async () => {
      await expect(repeat.locator("[data-fallback]")).toHaveCount(0);
      await repeat.getByRole("button", { name: "+ 비었을 때 내용", exact: true }).click();
      const fallback = repeat.locator("[data-fallback]");
      await expect(fallback).toHaveCount(1);
      const paragraph = fallback.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill(emptyText);
      await paragraph.press("End");
      await expect(repeat.locator(".ts-doc-cond-head").first()).toContainText("비었을 때 칸 있음");
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(repeat.locator("[data-fallback]")).toContainText(emptyText);
    });

    const some = await ev.action("반복칸#4", "상품 — 적용 종 하나(사유 뇌졸중)", () => product(page, `반복칸 있음 ${stamp}`, docTitle, { applies: true, reasons: ["뇌졸중"] }));
    await ev.action("반복칸#5", "조립 미리보기 — 반복 본문 항만, 칸 항은 없다", async () => {
      const article = await firstArticle(page, some);
      await expect(article).toContainText(bodyText);
      await expect(article).not.toContainText(emptyText);
    });

    const none = await ev.action("반복칸#6", "상품 — 적용여부 아니오인 종 하나(원소 0개)", () => product(page, `반복칸 없음 ${stamp}`, docTitle, { applies: false, reasons: [] }));
    await ev.action("반복칸#7", "조립 미리보기 — 「비었을 때」 칸 항만, 반복 본문은 없다", async () => {
      const article = await firstArticle(page, none);
      await expect(article).toContainText(emptyText);
      await expect(article).not.toContainText(bodyText);
    });
  },
);
