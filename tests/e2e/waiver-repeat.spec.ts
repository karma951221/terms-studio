import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";

/**
 * 블록 반복 — 납입면제종마다 · 사유마다 · 현재 원소 (최종 결정 11 · ADR-0077 결정 2 · 3 · 4, 기능/문면 §3.7).
 *
 * 호 유형 함수조항(인자 사유 — 열거형 납입면제사유)을 만들고, 새 보통약관 템플릿의 조 자리에 「납입면제종마다」 반복 → 안에 항 →
 * 그 항의 호 목록에 「납입면제사유마다」 반복 → 안에 그 함수조항(사유 ← 현재 원소)을 넣는다. 종 둘(뇌졸중 · 뇌졸중+급성심근경색증)인 새 상품의
 * 조립 미리보기에서 종마다 항 하나, 그 안에 그 종의 사유마다 호가 선다 — 개수 조건 · 서수 없이.
 * 반복 블록을 가리키는 조 참조는 펼친 항 전부로, 함수조항 참조 줄 + 값 한정(해당 값들)은 그 값이 낸 호만으로 찍힌다 (결정 13).
 * 시드는 건드리지 않는다 — 새 함수조항 · 새 템플릿 · 새 상품만 쓴다.
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
  "납입면제종마다 항 › 사유마다 호(함수조항 사유 ← 현재 원소) → 상품 미리보기가 종마다 항 · 사유마다 호",
  { annotation: { type: "좌표없음", description: "기능/문면 §3.7 블록 반복 · ADR-0077 — 시나리오 파일에 블록 반복 시나리오가 아직 없다 (기능/문면 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const clauseName = `면제 사유 호(${stamp})`;
    const docTitle = `반복검증 보통약관 ${stamp}`;
    const productName = `반복검증 상품 ${stamp}`;
    await ev.action("반복#1", "관리자로 로그인한다", () => login(page));

    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });

    const code = await ev.action("반복#2", "새 함수조항(호) — 인자 「사유」(열거형 납입면제사유) · 호 「면제사유: 〔arg.사유〕」", async () => {
      await page.goto("/functions/new?type=item");
      await page.getByLabel("함수조항명").fill(clauseName);
      await page.getByRole("button", { name: "인자 추가" }).click();
      await page.getByLabel("인자 1 이름").fill("사유");
      await page.getByLabel("인자 1 타입").selectOption("enum:E0001");
      const item = editor.getByRole("textbox", { name: "호", exact: true });
      await item.click();
      await item.fill("면제사유: ");
      await item.press("End");
      await tool("슬롯").click();
      const dialog = page.getByRole("dialog", { name: "치환 슬롯 넣기", exact: true });
      await pickCombo(dialog.locator("#pop-slot"), { value: "arg.사유" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      return decodeURIComponent(page.url().split("/").at(-1)!);
    });

    const docUrl = await ev.action("반복#3", "새 보통약관 템플릿을 만든다", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(docTitle);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      return page.url();
    });

    const body = page.locator(".ts-l3-body");
    const repeats = body.locator(".ts-doc-repeat");

    await ev.action("반복#4", "편집 — 조를 쓰고 툴바 「반복」 → 원천 「납입면제종마다 — 적용여부 = 예인 선택지」 → 반복 상자 안 항을 쓴다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험료의 납입면제");
      await title.click();
      await tool("반복").click();
      const dialog = page.getByRole("dialog", { name: "반복 블록 넣기", exact: true });
      await dialog.getByLabel("반복 원천").selectOption({ label: "납입면제종마다 — 적용여부 = 예인 선택지" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(repeats).toHaveCount(1);
      await expect(repeats.first().locator(".ts-doc-cond-head")).toContainText("⟳ 납입면제종마다");
      const paragraph = repeats.first().getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill("다음의 사유로 차회 이후의 보험료 납입을 면제합니다.");
      await paragraph.press("End");
    });

    await ev.action("반복#5", "항에 커서를 두고 「반복」 ▾ → 「반복 블록(호) 추가…」 — 원천은 바깥 종의 목록뿐(「납입면제사유마다」)", async () => {
      await tool("반복").click();
      await page.getByRole("menuitem", { name: "반복 블록(호) 추가…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "반복 블록 넣기", exact: true });
      const source = dialog.getByLabel("반복 원천");
      await expect(source.locator("option")).toHaveText(["— 고른다 —", "납입면제사유마다 — 현재 종의 목록"]);
      await source.selectOption({ label: "납입면제사유마다 — 현재 종의 목록" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(repeats).toHaveCount(2);
      await expect(repeats.nth(1).locator(".ts-doc-cond-head")).toContainText("⟳ 납입면제사유마다");
    });

    await ev.action("반복#6", "안쪽 반복 머리 줄 오른쪽 클릭 → 「이 반복에 함수조항(호) 추가…」 — 인자 사유 ← 「현재 원소 — 납입면제사유마다」", async () => {
      await repeats.nth(1).locator(".ts-doc-cond-head").click({ button: "right" });
      await page.getByRole("menuitem", { name: "이 반복에 함수조항(호) 추가…", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "함수조항(호) 넣기", exact: true });
      await pickCombo(dialog.locator("#pop-clause"), { value: code });
      await dialog.getByLabel("인자 사유").selectOption({ label: "현재 원소 — 납입면제사유마다" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const placed = repeats.nth(1).locator("[data-clause-ref]");
      await expect(placed).toHaveCount(1);
      await expect(placed.locator(".ts-doc-clause-head")).toContainText("사유 ← 현재 ⟳ 납입면제사유마다");
    });

    await ev.action("반복#7", "저장 한 번 — 읽기 모드에도 반복 상자 둘이 남는다", async () => {
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(repeats).toHaveCount(2);
      expect(page.url()).toContain(docUrl.split("?")[0]);
    });

    await ev.action("반복#7b", "반복 안 항을 가리키는 조 참조 — 대상이 하나여도 연결어가 켜지고 고르지 않으면 넣어지지 않는다 (결정 14 확장)", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await body.getByRole("textbox", { name: "조 제목" }).first().click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" }).last();
      await title.fill("반복 참조");
      await title.press("Enter");
      await tool("항").click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true }).last();
      await paragraph.fill("면제 사유는 ");
      await paragraph.press("End");
      await tool("조 참조").click();
      const d = page.getByRole("dialog", { name: "조 참조 넣기" });
      await d.getByRole("button", { name: /펴기$/ }).first().click();
      await d.getByRole("treeitem", { level: 2 }).first().getByRole("checkbox").check();
      const and = d.getByRole("radio", { name: "및", exact: true });
      await expect(and).toBeEnabled();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d).toContainText("연결어(및 · 또는)를 고른다");
      await and.check();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d).toHaveCount(0);
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
    });

    await ev.action("반복#7c", "함수조항 참조 줄을 고르고 값 한정 「해당 값들 — 급성심근경색증」 → 칩에 ⟨값 = 급성심근경색증⟩, 연결어는 골라야 넣어진다 (결정 13)", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByRole("button", { name: "제2조(반복 참조)", exact: true }).click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true }).filter({ hasText: "면제 사유는" });
      await paragraph.click();
      await paragraph.press("End");
      await tool("항").click();
      const next = body.getByRole("textbox", { name: "항", exact: true }).nth(1);
      await next.fill("상해 사유 호는 ");
      await next.press("End");
      await tool("조 참조").click();
      const d = page.getByRole("dialog", { name: "조 참조 넣기" });
      const clauseRow = d.locator("[data-ref-row]").filter({ hasText: `함수조항 「${clauseName}」` });
      // 조 › 반복 블록 › 항 › 안쪽 반복 블록을 차례로 편다 — 편집기는 반복 본문 한 벌을 원형으로 싣는다
      for (let i = 0; i < 4 && (await clauseRow.count()) === 0; i++) await d.getByRole("button", { name: /펴기$/ }).first().click();
      await clauseRow.getByRole("checkbox").check();
      await d.getByLabel("값 한정").selectOption("values");
      await d.getByRole("checkbox", { name: "급성심근경색증", exact: true }).check();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d).toContainText("연결어(및 · 또는)를 고른다");
      await d.getByRole("radio", { name: "및", exact: true }).check();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d).toHaveCount(0);
      await expect(body.locator(".ts-doc-ref").filter({ hasText: "⟨값 = 급성심근경색증⟩" })).toHaveCount(1);
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
    });

    const productUrl = await ev.action("반복#8", "새 상품 — 종 둘(1종: 뇌졸중 · 2종: 뇌졸중 · 급성심근경색증, 적용여부 예) · 조합 둘 · 보통약관 = 새 템플릿", async () => {
      await page.goto("/products/new");
      await page.getByLabel("상품명", { exact: true }).fill(productName);
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/products\/[0-9a-f-]{36}(?:\?tab=basic)?$/);
      const url = page.url().split("?")[0];
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const rows = page.locator("#definitions-panel tbody tr");
      for (const [i, name, reasons] of [
        [0, "뇌졸중면제형", ["뇌졸중"]],
        [1, "뇌졸중심근경색면제형", ["뇌졸중", "급성심근경색증"]],
      ] as const) {
        await page.getByRole("button", { name: "보험종목 추가" }).click();
        const row = rows.nth(i);
        await row.getByRole("textbox", { name: "보험종목명" }).fill(name);
        await row.getByRole("combobox", { name: "세목유형" }).selectOption("waiver");
        await row.getByRole("radio", { name: "예", exact: true }).check();
        for (const r of reasons) await row.getByRole("checkbox", { name: r, exact: true }).check();
      }
      await page.getByRole("tab", { name: "종·형 조합" }).click();
      for (const label of [/제1종/, /제2종/]) await page.getByRole("checkbox", { name: label }).check();
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.getByRole("navigation", { name: "상품 하위 탭" }).getByRole("link", { name: "약관", exact: true }).click();
      await page.waitForLoadState("networkidle");
      await pickCombo(page.getByRole("combobox", { name: "보통약관 템플릿" }), { label: docTitle });
      await submit(page, page.getByRole("button", { name: "템플릿 저장" }));
      return url;
    });

    await ev.action("반복#9", "조립 미리보기 — 종마다 항 하나, 그 안에 그 종의 사유마다 호(열거형 순서) · 반복 참조는 펼친 것 전부 · 값 한정은 그 값의 호만", async () => {
      await page.goto(`${productUrl}/preview`);
      await page.getByRole("button", { name: "실행", exact: true }).click();
      await expect(page.getByRole("heading", { name: "조립 검사 결과" })).toBeVisible();
      const general = page.locator("article.ts-doc").first();
      const paragraphs = general.locator(".ts-doc-article").first().locator(".ts-doc-paragraph");
      await expect(paragraphs).toHaveCount(2);
      await expect(paragraphs.nth(0).locator("ol.ts-doc-items > li")).toHaveText([/면제사유: 뇌졸중$/]);
      await expect(paragraphs.nth(1).locator("ol.ts-doc-items > li")).toHaveText([/면제사유: 뇌졸중$/, /면제사유: 급성심근경색증$/]);
      // 반복 블록을 가리킨 참조 = 펼친 항 전부, 값 한정(급성심근경색증) = 2종 항의 그 호만 (결정 13)
      const refs = general.locator(".ts-doc-article").nth(1).locator(".ts-doc-paragraph");
      await expect(refs.nth(0)).toContainText("면제 사유는 제1조(보험료의 납입면제) 제1항 및 제2항");
      await expect(refs.nth(1)).toContainText("상해 사유 호는 제1조(보험료의 납입면제) 제2항 제2호");
    });
  },
);
