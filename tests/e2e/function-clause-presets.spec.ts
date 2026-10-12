import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";
import { productWithSpecial } from "./_lib/product";

/**
 * 함수조항 프리셋 (ADR-0084 · 기능/함수조항/시나리오/프리셋_시나리오) — 프리셋을 만들고 넣기 목록의 프리셋 줄로 넣는다 · 빈 값 거부 ·
 * 삭제 = 사용처를 직접 연결로 풀기. 시드는 건드리지 않는다 — 새 담보 · 새 템플릿 · 새 함수조항 · 새 상품만 쓴다.
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

const stamp = Date.now();
const clauseName = `부활 기산(${stamp})`;
const coverageName = `프리셋검증담보${stamp}`;
let code = "";
let docUrl = "";

test.describe.serial("함수조항 프리셋", () => {
  test("프리셋을 만들고 그 조합으로 넣기", { annotation: { type: "시나리오", description: "프리셋#1" } }, async ({ page, ev }) => {
    test.setTimeout(150_000);
    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    await ev.action("프리셋#1.1", "관리자로 로그인한다", () => login(page));

    code = await ev.action("프리셋#1.2", "새 함수조항(항) — 옵션 「기산」(계약일 · 최초계약일)과 그 옵션 자리를 쓰고 저장", async () => {
      await page.goto("/functions/new?type=block");
      await page.getByLabel("함수조항명").fill(clauseName);
      await page.getByRole("button", { name: "옵션 추가" }).click();
      await page.getByLabel("옵션명").last().fill("기산");
      await page.getByRole("textbox", { name: "기산 — 선택지 1", exact: true }).fill("계약일");
      await page.getByRole("textbox", { name: "기산 — 선택지 2", exact: true }).fill("최초계약일");
      const paragraph = editor.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill("이 특별약관은 ");
      await paragraph.press("End");
      await toolbar.getByRole("button", { name: "옵션 자리", exact: true }).click();
      // 옵션이 하나면 메뉴 없이 곧바로 넣는다 (실물 드라이버와 같다)
      if ((await page.getByRole("menuitem", { name: /^옵션 자리 — / }).count()) > 0) await page.getByRole("menuitem", { name: "옵션 자리 — 기산", exact: true }).click();
      await expect(editor).toContainText("〔기산〕");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      return decodeURIComponent(page.url().split("/").at(-1)!);
    });

    await ev.action("프리셋#1.3", "편집 — 「프리셋」 구획에 「갱신」(기산 = 최초계약일)을 더하고 저장, 카드가 「기산: 최초계약일」로 읽힌다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByLabel("새 프리셋 이름", { exact: true }).fill("갱신");
      await page.getByRole("button", { name: "프리셋 추가" }).click();
      await page.getByLabel("갱신 — 옵션 기산", { exact: true }).selectOption({ label: "최초계약일" });
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "프리셋" })).toContainText("기산: 최초계약일");
    });

    docUrl = await ev.action("프리셋#1.4", "새 담보와 그 담보약관 템플릿을 만든다", async () => {
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
    await ev.action("프리셋#1.5", "편집 — 조를 쓰고 툴바 「함수조항」 목록의 「· 갱신」으로 넣으면 머리 띠 「프리셋 ‘갱신’」, 옵션을 안 골라도 저장된다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await toolbar.getByRole("button", { name: "조", exact: true }).click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("부활");
      await title.press("Enter");
      await toolbar.getByRole("button", { name: "함수조항", exact: true }).click();
      await page.getByRole("menuitem", { name: `${clauseName}(${code}) · 프리셋 갱신`, exact: true }).click();
      await expect(body.locator("[data-clause-ref] .ts-doc-clause-head")).toContainText("프리셋 ‘갱신’");
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.locator(".ts-l3-bar .ts-count")).toContainText("검증 오류 0");
    });

    await ev.action("프리셋#1.6", "이 담보를 특약으로 탑재한 상품을 만들면 미리보기 — 프리셋 값(최초계약일)으로 찍힌다", async () => {
      await productWithSpecial(page, `프리셋미리보기 ${coverageName}`, coverageName);
      await page.goto(docUrl);
      await expect(page.locator("#ts-side-panel-preview")).toContainText("이 특별약관은 최초계약일");
    });
  });

  test("빈 프리셋 값은 저장 거부", { annotation: { type: "시나리오", description: "프리셋#2" } }, async ({ page, ev }) => {
    await ev.action("프리셋#2.1", "관리자로 로그인한다", () => login(page));
    await ev.action("프리셋#2.2", "편집 — 프리셋 「계약일」을 옵션 없이 더하고 저장하면 거부 「프리셋 ‘계약일’ 에 옵션 O01 선택이 비었습니다」", async () => {
      await page.goto(`/functions/${code}`);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByLabel("새 프리셋 이름", { exact: true }).fill("계약일");
      await page.getByRole("button", { name: "프리셋 추가" }).click();
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByText(/프리셋 ‘계약일’ 에 옵션 O01 선택이 비었습니다/).first()).toBeVisible();
    });
    await ev.action("프리셋#2.3", "값을 고르면 저장된다", async () => {
      await page.getByLabel("계약일 — 옵션 기산", { exact: true }).selectOption({ label: "계약일" });
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "프리셋" })).toContainText("기산: 계약일");
    });
  });

  test("프리셋 삭제 = 사용처를 직접 연결로 풀기", { annotation: { type: "시나리오", description: "프리셋#3" } }, async ({ page, ev }) => {
    await ev.action("프리셋#3.1", "관리자로 로그인한다", () => login(page));
    await ev.action("프리셋#3.2", "편집 — 「갱신」 ⊖ → 「사용처 1곳이 직접 연결로 바뀝니다」 확인 「빼기」 → 저장", async () => {
      await page.goto(`/functions/${code}`);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.getByRole("button", { name: "프리셋 삭제 · 갱신" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "사용처 1곳이 직접 연결로 바뀝니다" })).toBeVisible();
      await page.getByRole("button", { name: "빼기", exact: true }).click();
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "프리셋" })).not.toContainText("갱신");
    });
    await ev.action("프리셋#3.3", "그 템플릿 — 머리 띠가 옵션 선택 「기산: 최초계약일」로, 미리보기 문장은 그대로", async () => {
      await page.goto(docUrl);
      await expect(page.locator(".ts-l3-body [data-clause-ref] .ts-doc-clause-head")).toContainText("기산: 최초계약일");
      await expect(page.locator("#ts-side-panel-preview")).toContainText("이 특별약관은 최초계약일");
    });
  });
});
