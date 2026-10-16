import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";

/**
 * 문장 안 반복 — 원천 · 연결어 · 「비었을 때」 칸 (ADR-0088 결정 1 · 2 · 3 · 수용 기준 3, 기능/문면 §3.12).
 *
 * 새 보통약관 템플릿의 항 문장에 툴바 「문장 안 반복」으로 「납입면제사유 합집합(적용여부 = 예인 선택지)마다」 반복을 넣는다 — 연결어 「및」,
 * 본문은 「현재 값」의 약관표시명(열거형의 첫 문자 필드 — 값 이름은 찍지 않는다, ADR-0088 결정 1 · 2026-10-17), 「비었을 때」 칸은 「해당 사유 없음」. 편집기 본문에는 자리 말 「〔…마다〕」 칩 하나만 선다.
 * 사유 셋인 상품의 조립 미리보기는 「A, B 및 C」, 적용 종이 없는 상품은 칸 글이다. 시드는 건드리지 않는다 — 새 템플릿 · 새 상품만 쓴다.
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

/** 조립 미리보기의 보통약관 첫 조 첫 항 글. */
async function firstParagraph(page: Page, productUrl: string): Promise<Locator> {
  await page.goto(`${productUrl}/preview`);
  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.getByRole("heading", { name: "조립 검사 결과" })).toBeVisible();
  return page.locator("article.ts-doc").first().locator(".ts-doc-article").first().locator(".ts-doc-paragraph").first();
}

test(
  "문장 안 반복(사유 합집합마다 · 및 · 비었을 때 칸) → 사유 셋 상품은 「A, B 및 C」, 적용 종 없는 상품은 칸 글",
  { annotation: { type: "좌표없음", description: "기능/문면 §3.12 인라인 반복 · ADR-0088 수용 기준 3 — 시나리오 파일에 문장 안 반복 시나리오가 아직 없다 (기능/문면 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const docTitle = `문장반복 보통약관 ${stamp}`;
    await ev.action("문장반복#1", "관리자로 로그인한다", () => login(page));

    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });
    const body = page.locator(".ts-l3-body");

    await ev.action("문장반복#2", "새 보통약관 템플릿 — 조 「적용 사유」 · 항 「대상 사유는 」", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(docTitle);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("적용 사유");
      await title.press("Enter");
      await tool("항").click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true });
      await paragraph.fill("대상 사유는 ");
      await paragraph.press("End");
    });

    await ev.action("문장반복#3", "툴바 「문장 안 반복」 → 원천 「납입면제사유 합집합마다 — 적용여부 = 예인 선택지」 · 연결어는 골라야 넣어진다", async () => {
      await tool("문장 안 반복").click();
      const dialog = page.getByRole("dialog", { name: "문장 안 반복 넣기", exact: true });
      await dialog.getByLabel("반복 원천").selectOption({ label: "납입면제사유 합집합마다 — 적용여부 = 예인 선택지" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toContainText("연결어(및 · 또는 · 쉼표만)를 고른다");
      await dialog.getByRole("radio", { name: "및", exact: true }).check();
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    });

    await ev.action("문장반복#4", "이어 열린 반복 창 — 본문은 「현재 값」의 약관표시명 슬롯(값 이름 아님), 「비었을 때」 칸에 「해당 사유 없음」을 쓰고 닫는다", async () => {
      const dialog = page.getByRole("dialog", { name: "문장 안 반복", exact: true });
      await expect(dialog).toBeVisible();
      const each = dialog.getByRole("textbox", { name: "원소마다", exact: true });
      await expect(each).toContainText("builtin.value.F01");
      await expect(each).not.toContainText("builtin.value.name");
      const fallback = dialog.getByRole("textbox", { name: "비었을 때", exact: true });
      await fallback.click();
      await fallback.fill("해당 사유 없음");
      await fallback.press("Enter");
      await dialog.getByRole("button", { name: "닫기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      // 편집기 본문은 자리 말 칩 하나 — 원소는 상품 문맥 없이 모른다 (ADR-0088 결정 6)
      await expect(body.locator(".ts-doc-inline-chip.is-repeat")).toHaveText("〔납입면제사유 합집합마다〕");
      const paragraph = body.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.press("End");
      await paragraph.pressSequentially("입니다.");
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(body.locator(".ts-doc-inline-chip.is-repeat")).toHaveCount(1);
    });

    const three = await ev.action("문장반복#5", "상품 — 적용 종 하나(사유 뇌졸중 · 급성심근경색증 · 말기폐질환)", () =>
      product(page, `문장반복 셋 ${stamp}`, docTitle, { applies: true, reasons: ["뇌졸중", "급성심근경색증", "말기폐질환"] }),
    );
    await ev.action("문장반복#6", "조립 미리보기 — 「대상 사유는 뇌졸중, 급성심근경색증 및 말기폐질환입니다.」(열거형 순서)", async () => {
      await expect(await firstParagraph(page, three)).toContainText("대상 사유는 뇌졸중, 급성심근경색증 및 말기폐질환입니다.");
    });

    const none = await ev.action("문장반복#7", "상품 — 적용여부 아니오인 종 하나(원소 0개)", () => product(page, `문장반복 없음 ${stamp}`, docTitle, { applies: false, reasons: [] }));
    await ev.action("문장반복#8", "조립 미리보기 — 「비었을 때」 칸 글 「대상 사유는 해당 사유 없음입니다.」", async () => {
      await expect(await firstParagraph(page, none)).toContainText("대상 사유는 해당 사유 없음입니다.");
    });
  },
);
