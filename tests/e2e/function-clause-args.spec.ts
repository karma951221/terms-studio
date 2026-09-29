import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";

/**
 * 함수조항 인자 · 인자 연결 · 기본 연결 (최종 결정 2 · 기능/함수조항 §3.7) — 인자(문자, 기본 연결 D0001 담보명)를 두고 본문 슬롯이 그 인자를 읽는
 * 함수조항을 만든 뒤, 담보약관 템플릿에 넣고 그 사용처에서만 다른 구분자로 연결하면 미리보기가 연결한 구분자 값으로 찍힌다.
 * 시드는 건드리지 않는다 — 새 구분자 · 새 담보 · 새 템플릿 · 새 함수조항만 쓴다.
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
  "인자(기본 연결 D0001)를 읽는 함수조항 → 템플릿 사용처에서 다른 구분자로 연결 → 미리보기가 그 값으로",
  { annotation: { type: "좌표없음", description: "기능/함수조항 §3.7 인자 · 인자 연결 — 시나리오 파일에 인자 시나리오가 아직 없다 (기능/함수조항 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(150_000);
    const stamp = Date.now();
    const clauseName = `보험금명 문구(${stamp})`;
    const coverageName = `인자검증담보${stamp}`;
    await ev.action("인자#1", "관리자로 로그인한다", () => login(page));

    const bound = await ev.action("인자#2", "사용처가 댈 구분자 — 담보 레벨 문자 리터럴 「골절진단비」", async () => {
      await page.goto("/catalog/new");
      await page.getByLabel("구분자명").fill(`인자연결검증${stamp}`);
      await page.getByRole("radiogroup", { name: "레벨" }).getByRole("radio", { name: "담보", exact: true }).check();
      await page.getByLabel("식", { exact: true }).fill("'골절진단비'");
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/catalog\/D\d{4}$/);
      return decodeURIComponent(page.url().split("/").at(-1)!);
    });

    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });

    const code = await ev.action("인자#3", "새 함수조항(항) — 인자 「보험금명」(문자 · 기본 연결 담보명 D0001)을 더하고 본문 슬롯이 그 인자를 읽게 한 뒤 저장", async () => {
      await page.goto("/functions/new?type=block");
      await page.getByLabel("함수조항명").fill(clauseName);
      await page.getByRole("button", { name: "인자 추가" }).click();
      await page.getByLabel("인자 1 이름").fill("보험금명");
      await page.getByLabel("인자 1 타입").selectOption("string");
      await page.getByLabel("인자 1 기본 연결").selectOption("d:D0001");
      const paragraph = editor.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill("이 특별약관의 보험금은 ");
      await paragraph.press("End");
      await toolbar.getByRole("button", { name: "슬롯", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "치환 슬롯 넣기", exact: true });
      await pickCombo(dialog.locator("#pop-slot"), { value: "arg.보험금명" });
      await dialog.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      const params = page.getByRole("region", { name: "인자" });
      await expect(params).toContainText("보험금명");
      await expect(params).toContainText("담보명 (D0001)");
      await expect(editor).toContainText("보험금은 arg.보험금명");
      return decodeURIComponent(page.url().split("/").at(-1)!);
    });

    const docUrl = await ev.action("인자#4", "새 담보와 그 담보약관 템플릿을 만든다", async () => {
      await page.goto("/coverages/new");
      await page.locator("#cov-name").fill(coverageName);
      await page.locator("#cov-sub").fill("골절");
      await page.locator("#cov-benefit").fill("골절진단비");
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
      await page.goto("/documents/new?kind=coverage");
      await pickCombo(page.locator("#doc-coverage"), { label: coverageName });
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      return page.url();
    });

    const body = page.locator(".ts-l3-body");
    await ev.action("인자#5", "편집 — 조를 쓰고 툴바 「함수조항」으로 넣으면 머리에 「인자: 보험금명 ← 담보명 (D0001)(기본)」", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await toolbar.getByRole("button", { name: "조", exact: true }).click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험금의 지급사유");
      await title.press("Enter");
      await toolbar.getByRole("button", { name: "함수조항", exact: true }).click();
      await page.getByRole("menuitem", { name: `${clauseName}(${code})`, exact: true }).click();
      const placed = body.locator("[data-clause-ref]");
      await expect(placed).toHaveCount(1);
      await expect(placed.locator(".ts-doc-clause-head")).toContainText("인자: 보험금명 ← 담보명 (D0001)(기본)");
    });

    await ev.action("인자#6", "그 사용처에서만 인자 연결을 새 구분자로 바꾸고 저장", async () => {
      await body.locator("[data-clause-ref] .ts-doc-clause-opt").click();
      const dialog = page.getByRole("dialog", { name: "함수조항 옵션 · 인자", exact: true });
      await dialog.getByLabel("인자 보험금명").selectOption(`d:${bound}`);
      await dialog.getByRole("button", { name: "확인", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(body.locator("[data-clause-ref] .ts-doc-clause-head")).toContainText(`인자: 보험금명 ← 인자연결검증${stamp} (${bound})`);
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
    });

    await ev.action("인자#7", "미리보기 — 슬롯이 연결한 구분자 값 「골절진단비」로 찍힌다", async () => {
      await page.goto(`${docUrl}?view=eval`);
      await expect(page.locator("aside.ts-l3-side")).toContainText("이 특별약관의 보험금은 골절진단비");
    });
  },
);
