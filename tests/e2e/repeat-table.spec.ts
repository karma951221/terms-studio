import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 행 반복 표 — 담보 약관 문면 편집기 (ADR-0070 결정 6 · 설계 2026-09-22 §3.1 · §4).
 * 새 담보 → 담보 약관 템플릿 → 표 → 「행 반복」 세부보장마다 → 템플릿 셀에 「구조 표기」 → 미리보기에서 세부보장 수만큼 펼침 →
 * 담보에 세부보장을 하나 더하면 미리보기 행도 하나 는다.
 * 시드 담보 · 문서는 건드리지 않는다 (실물재현 E2E 가 같은 DB 를 대조한다).
 */

const COVERAGE = "반복표검증담보";
const SUB_1 = "첫째세부보장";
const SUB_2 = "둘째세부보장";

/** 같은 URL 로 돌아오는 서버 액션 제출 — POST 응답과 네트워크 정지를 기다린다. */
async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test(
  "행 반복 표: 표 → 행 반복 → 구조 표기 → 미리보기 펼침 · 세부보장 추가 후 행 증가",
  { annotation: { type: "좌표없음", description: "ADR-0070 반복 표 — 설계 2026-09-22 §4 E2E" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("반복표#1", "관리자로 로그인한다", () => login(page));

    const coverageUrl = await ev.action("반복표#2", "세부보장 1 · 급부 1 로 새 담보를 만든다", async () => {
      await page.goto("/coverages/new");
      await page.locator("#cov-name").fill(COVERAGE);
      await page.locator("#cov-sub").fill(SUB_1);
      await page.locator("#cov-benefit").fill("첫째급부");
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
      return page.url();
    });

    const docUrl = await ev.action("반복표#3", "담보 약관 템플릿을 만든다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByRole("button", { name: "템플릿 생성" }).click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      return page.url();
    });

    const add = async (kind: string, fields: Record<string, string>) => {
      const menu = page.locator("aside.ts-l3-side details.ts-insert-menu").first();
      if ((await menu.getAttribute("open")) === null) await menu.locator("summary").click();
      await menu.locator("select[name=kind]").selectOption(kind);
      for (const [name, value] of Object.entries(fields)) {
        const field = menu.locator(`[name=${name}]`);
        if ((await field.evaluate((el) => el.tagName)) === "SELECT") await field.selectOption(value);
        else await field.fill(value);
      }
      // 편집본에 적용 — 서버로 가지 않는다 (ADR-0074). 저장은 바의 「저장」 한 번.
      await menu.getByRole("button", { name: "고른 종류로 노드 추가" }).click();
    };
    const openNode = async (name: RegExp) => {
      await page.getByRole("button", { name }).first().click();
      await expect(page.getByRole("button", { name: "← 템플릿 전체로" })).toBeVisible();
    };

    await ev.action("반복표#4", "편집을 누르고 조를 넣고 그 조에 머리글 1행 · 빈 템플릿 1행 표를 넣는다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
      await add("article", { title: "감액 지급" });
      await openNode(/^제1조\(감액 지급\) 고치기/);
      await add("table", { title: "세부보장별 감액", headerRows: "1", rows: "세부보장|비고\n|" });
      await expect(page.locator("table.ts-doc-table")).toHaveCount(1);
    });

    await ev.action("반복표#5", "표 속성에서 행 반복을 「세부보장마다」로 적용한다 — 템플릿 행에 for 띠", async () => {
      await openNode(/^표 세부보장별 감액 고치기/);
      const repeat = page.getByLabel("행 반복");
      await expect(repeat.locator("option")).toHaveText(["없음", "세부보장마다", "세부보장 › 급부마다"]);
      await repeat.selectOption({ label: "세부보장마다" });
      await page.getByRole("button", { name: "표 적용" }).click();
      await expect(page.locator(".ts-l3-body .ts-doc-for-band")).toHaveText("세부보장마다");
      await expect(page.getByLabel("행 반복")).toHaveValue("1");
    });

    await ev.action("반복표#6", "템플릿 셀(2행 1열)에 구조 표기 「세부보장」을 넣는다 — 칩으로 선다", async () => {
      await page.getByRole("button", { name: "2행 1열 셀에 추가" }).click();
      await expect(page.locator("aside.ts-l3-side")).toContainText("2행 1열 셀");
      const kind = page.locator("aside.ts-l3-side details.ts-insert-menu").first().locator("select[name=kind]");
      await expect(kind.locator("option", { hasText: "구조 표기" })).toHaveCount(1);
      await add("structKey", { structLevel: "subCoverage" });
      await expect(page.locator(".ts-l3-body table.ts-doc-table")).toContainText("[세부보장명]");
    });

    await ev.action("반복표#7", "머리글 셀에는 구조 표기를 고를 수 없다", async () => {
      await page.getByRole("button", { name: "1행 1열 셀에 추가" }).click();
      await expect(page.locator("aside.ts-l3-side")).toContainText("1행 1열 셀");
      const kind = page.locator("aside.ts-l3-side details.ts-insert-menu").first().locator("select[name=kind]");
      await expect(kind.locator("option", { hasText: "구조 표기" })).toHaveCount(0);
    });

    await ev.action("반복표#7a", "저장 한 번으로 반영하고 읽기 모드로 돌아온다", async () => {
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.locator(".ts-l3-body table.ts-doc-table")).toContainText("[세부보장명]");
    });

    const previewRows = () => page.locator("aside.ts-l3-side table.ts-doc-table tbody tr");

    await ev.action("반복표#8", "미리보기 — 세부보장 1개라 템플릿 행이 1행으로 펼쳐진다", async () => {
      await page.goto(docUrl);
      await page.getByRole("button", { name: "미리보기" }).click();
      await page.waitForURL((url) => url.searchParams.get("view") === "eval");
      await expect(previewRows()).toHaveCount(2); // 머리글 + 세부보장 1
      await expect(previewRows().nth(1)).toContainText(SUB_1);
      await expect(page.locator("aside.ts-l3-side .ts-doc-for-band")).toHaveCount(0);
    });

    await ev.action("반복표#9", "담보에 세부보장을 하나 더한다", async () => {
      await page.goto(coverageUrl);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.locator("button.ts-tree-add", { hasText: "세부보장" }).click();
      await page.getByRole("textbox", { name: /^세부보장명/ }).last().fill(SUB_2);
      await page.getByRole("textbox", { name: /^급부명/ }).last().fill("둘째급부");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.getByText(SUB_2).first()).toBeVisible();
    });

    await ev.action("반복표#10", "미리보기 — 행이 2개로 는다 (세부보장 order 순)", async () => {
      await page.goto(`${docUrl}?view=eval`);
      await expect(previewRows()).toHaveCount(3);
      await expect(previewRows().nth(1)).toContainText(SUB_1);
      await expect(previewRows().nth(2)).toContainText(SUB_2);
    });
  },
);
