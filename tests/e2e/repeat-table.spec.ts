import { type Locator, type Page } from "@playwright/test";

import { comboOptionCount, pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";

/**
 * 행 반복 표 — 담보 약관 문면 편집기 (ADR-0070 결정 6 · 설계 2026-09-22 §3.1 · §4).
 * 새 담보 → 담보약관 템플릿 목록의 `+` 로 그 담보의 템플릿 생성(2026-09-27 입구) → (오른쪽 클릭) 조 · 항 · 표 → 셀 조작 줄 「이 행 반복…」 세부보장마다 → 템플릿 셀 오른쪽 클릭 「구조 표기」 →
 * 미리보기에서 세부보장 수만큼 펼침 →
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

    const docUrl = await ev.action("반복표#3", "담보약관 템플릿 목록의 + → 템플릿 없는 담보에서 새 담보를 골라 만든다 → 조문 편집기로", async () => {
      await page.goto("/documents?kind=coverage");
      await page.getByRole("link", { name: "새 담보약관 템플릿", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/documents/new" && url.searchParams.get("kind") === "coverage");
      // 담보는 검색 입력 — 이름으로 쳐서 그 줄을 누른다 (새 담보의 코드는 실행마다 같지만 여기서는 이름으로 찾는다)
      await pickCombo(page.locator("#doc-coverage"), { label: COVERAGE });
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      await expect(page.getByText(`${COVERAGE} 특별약관`).first()).toBeVisible();
      return page.url();
    });

    await ev.action("반복표#3a", "만든 담보는 다시 고를 수 없다 — 담보 하나가 템플릿 한 벌", async () => {
      const back = page.url();
      await page.goto("/documents/new?kind=coverage");
      // 시드 담보는 모두 템플릿이 있다 — 방금 만든 담보까지 쓰였으면 고를 칸 대신 「없는 담보가 없다」 안내, 칸이 있으면 그 담보는 목록에 없다
      const input = page.locator("#doc-coverage");
      if ((await input.count()) === 0) await expect(page.getByText("담보약관 템플릿이 없는 담보가 없다")).toBeVisible();
      else expect(await comboOptionCount(input, COVERAGE)).toBe(0);
      await page.goto(back);
    });

    // 가운데 그 자리 편집 (기능/문면 §4.3) — 넣기 · 조작은 툴바(오른쪽 클릭 메뉴는 같은 목록의 지름길), 셀은 누르면 조작 줄. 전부 편집본에만 들어가고 저장은 바의 「저장」 한 번.
    const menu = async (target: Locator, item: string) => {
      await target.click({ button: "right" });
      await page.getByRole("menuitem", { name: item, exact: true }).click();
    };
    const body = page.locator(".ts-l3-body");
    const cell = (name: string) => body.getByRole("textbox", { name, exact: true });

    await ev.action("반복표#4", "편집을 누르고 툴바 「조」로 조를 넣고, 항 아래에 머리글 1행 · 템플릿 1행 표를 넣는다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
      // 넣기 · 조작의 입구는 본문 위 툴바 (기능/문면 §4.3, 2026-09-27) — 오른쪽 클릭 메뉴는 지름길
      const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
      await expect(toolbar).toBeVisible();
      await toolbar.getByRole("button", { name: "조", exact: true }).click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("감액 지급");
      await title.press("Enter");
      await expect(page.getByRole("heading", { name: "제1조(감액 지급)" })).toBeVisible();
      await menu(page.getByRole("heading", { name: "제1조(감액 지급)" }), "항 추가");
      await menu(body.locator(".ts-doc-paragraph").first(), "아래에 표 추가…");
      const pop = page.getByRole("dialog", { name: "표 넣기" });
      await pop.getByLabel("행 수").fill("2");
      await pop.getByLabel("열 수").fill("2");
      await pop.getByLabel("표 제목").fill("세부보장별 감액");
      await pop.getByRole("button", { name: "표 만들기" }).click();
      await expect(body.locator("table.ts-doc-table")).toHaveCount(1);
      await cell("1행 1열").fill("세부보장");
      await cell("1행 2열").fill("비고");
      await cell("1행 2열").press("Tab");
      await expect(cell("1행 1열")).toHaveText("세부보장");
      await expect(cell("1행 2열")).toHaveText("비고");
    });

    await ev.action("반복표#5", "템플릿 셀을 누르면 뜨는 조작 줄의 「이 행 반복…」 — 세부보장마다 · 템플릿 행에 for 띠", async () => {
      await cell("2행 1열").click();
      const bar = page.getByRole("toolbar", { name: "2행 1열 셀 조작" });
      await expect(bar).toBeVisible();
      await bar.getByRole("button", { name: "이 행 반복…" }).click();
      const pop = page.getByRole("dialog", { name: "행 반복" });
      await expect(pop.getByLabel("행 반복").locator("option")).toHaveText(["없음", "세부보장마다", "세부보장 › 급부마다"]);
      await pop.getByLabel("행 반복").selectOption({ label: "세부보장마다" });
      await pop.getByRole("button", { name: "확인" }).click();
      await expect(body.locator(".ts-doc-for-band")).toHaveText("세부보장마다");
    });

    await ev.action("반복표#6", "템플릿 셀(2행 1열)을 오른쪽 클릭 › 구조 표기 「세부보장」 — 칩으로 선다", async () => {
      await menu(cell("2행 1열"), "구조 표기…");
      const pop = page.getByRole("dialog", { name: "구조 표기 넣기" });
      await pop.getByLabel("구조 표기").selectOption("subCoverage");
      await pop.getByRole("button", { name: "넣기" }).click();
      await expect(body.locator("table.ts-doc-table")).toContainText("[세부보장명]");
    });

    await ev.action("반복표#7", "머리글 셀의 오른쪽 클릭 메뉴에는 구조 표기가 없다 · 셀 조작 줄로 행을 넣고 뺀다", async () => {
      await cell("1행 1열").click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "치환 슬롯…" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "구조 표기…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await cell("2행 2열").click();
      await page.getByRole("toolbar", { name: "2행 2열 셀 조작" }).getByRole("button", { name: "아래에 행" }).click();
      await expect(body.locator("table.ts-doc-table tbody tr")).toHaveCount(3);
      await cell("3행 1열").click();
      await page.getByRole("toolbar", { name: "3행 1열 셀 조작" }).getByRole("button", { name: "행 삭제" }).click();
      await expect(body.locator("table.ts-doc-table tbody tr")).toHaveCount(2);
    });

    await ev.action("반복표#7a", "저장 한 번으로 반영하고 읽기 모드로 돌아온다", async () => {
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.locator(".ts-l3-body table.ts-doc-table")).toContainText("[세부보장명]");
      await page.reload();
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
      await page.getByRole("button", { name: "세부보장 추가", exact: true }).click();
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
