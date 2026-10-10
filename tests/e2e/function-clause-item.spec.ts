import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";
import { productWithSpecial } from "./_lib/product";

/**
 * 함수조항 유형 「호」 (최종 결정 4 · 기능/함수조항 §3.1) — 호 목록을 내는 함수조항을 만들고, 담보약관 템플릿 항의 호 목록 자리(호 뒤)에 툴바 「함수조항」으로 넣으면
 * 미리보기 탭(그 담보를 특약으로 탑재한 상품 문맥)에서 그 호들이 사용처 호 목록에 이어 선다. 단위 규칙(호 하나 · 한 곳 사용)은 경고만 — 만들 수 있다(최종 결정 7).
 * 시드 담보 · 문서는 건드리지 않는다 — 새 담보 · 새 템플릿 · 새 함수조항만 쓴다.
 */

const COVERAGE = "호함수조항검증담보";
const CLAUSE_NAME = "납입면제 호(검증)";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 같은 URL 로 돌아오는 서버 액션 제출 — POST 응답과 네트워크 정지를 기다린다. */
async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

test(
  "호 유형 함수조항 생성 → 템플릿 항의 호 목록에 넣기 → 미리보기에 호가 이어 선다",
  { annotation: { type: "좌표없음", description: "기능/함수조항 §3.1 유형 = 출력 모양 — 시나리오 파일에 호 유형 시나리오가 아직 없다 (기능/함수조항 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("호함수조항#1", "관리자로 로그인한다", () => login(page));

    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });

    await ev.action("호함수조항#2", "생성 화면(?type=item) — 유형 넷 중 「호」가 골라져 있고 빈 호 하나가 쓸 자리로 선다", async () => {
      await page.goto("/functions/new?type=item");
      await expect(page.getByRole("radio")).toHaveCount(4);
      await expect(page.getByRole("radio", { name: /^호/ })).toBeChecked();
      await expect(editor.getByRole("textbox", { name: "호", exact: true })).toHaveCount(1);
      await expect(editor.getByRole("textbox", { name: "항", exact: true })).toHaveCount(0);
    });

    const code = await ev.action("호함수조항#3", "이름과 호 둘을 쓰고(Enter 로 다음 호) 저장 — 상세로 가고 단위 규칙은 경고만 보인다", async () => {
      await page.getByLabel("함수조항명").fill(CLAUSE_NAME);
      const first = editor.getByRole("textbox", { name: "호", exact: true });
      await first.click();
      await first.fill("암으로 진단확정된 경우");
      await first.press("End");
      await first.press("Enter");
      const second = editor.getByRole("textbox", { name: "호", exact: true }).nth(1);
      await expect(second).toBeFocused();
      await second.fill("뇌졸중으로 진단확정된 경우");
      await second.press("Tab");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      // 기본정보는 접혀서 선다(코드 · 이름 한 줄) — 펼치면 반환 타입 「호 목록」 아래에 단위 규칙 경고. 펼침은 브라우저가 기억한다
      const metaHead = page.locator(".ts-clause-meta .ts-basics-head");
      await expect(metaHead).toContainText(CLAUSE_NAME);
      await expect(async () => {
        if ((await metaHead.getAttribute("aria-expanded")) !== "true") await metaHead.click();
        await expect(metaHead).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
      }).toPass();
      await expect(page.locator(".ts-clause-meta")).toContainText("반환 타입");
      await expect(page.locator(".ts-clause-meta")).toContainText("호 목록");
      await expect(page.getByRole("list", { name: "단위 규칙 경고" })).toContainText("「호」 함수조항 — 조 · 여러 항 단위가 아닙니다");
      await expect(editor.locator("ol.ts-doc-items > li.ts-doc-item")).toHaveCount(2);
      return decodeURIComponent(page.url().split("/").at(-1)!);
    });

    const docUrl = await ev.action("호함수조항#4", "새 담보와 그 담보약관 템플릿을 만든다", async () => {
      await page.goto("/coverages/new");
      await page.locator("#cov-name").fill(COVERAGE);
      await page.locator("#cov-sub").fill("납입면제");
      await page.locator("#cov-benefit").fill("납입면제");
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
      await page.goto("/documents/new?kind=coverage");
      await pickCombo(page.locator("#doc-coverage"), { label: COVERAGE });
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      return page.url();
    });

    const body = page.locator(".ts-l3-body");
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });

    await ev.action("호함수조항#5", "편집 — 조 · 항 · 호를 쓰고, 호에 커서를 둔 채 툴바 「함수조항」에서 그 함수조항을 고르면 호 뒤에 함수조항 상자가 선다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험료 납입면제");
      await title.press("Enter");
      await tool("항").click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true });
      await paragraph.fill("다음 중 어느 하나에 해당하면 차회 이후의 보험료 납입을 면제합니다.");
      await paragraph.press("End");
      await tool("호").click();
      const item = body.getByRole("textbox", { name: "호", exact: true });
      await item.fill("사망한 경우");
      await item.press("End");
      await tool("함수조항").click();
      await page.getByRole("menuitem", { name: `${CLAUSE_NAME}(${code})`, exact: true }).click();
      const placed = body.locator("ol.ts-doc-items [data-clause-ref]");
      await expect(placed).toHaveCount(1);
      await expect(placed.locator(".ts-doc-clause-name")).toHaveText(`[${code}] ${CLAUSE_NAME}`);
      await expect(placed).toContainText("뇌졸중으로 진단확정된 경우");
    });

    await ev.action("호함수조항#6", "저장 한 번 — 읽기 모드에도 함수조항 상자가 호 목록 안에 남는다", async () => {
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(body.locator("ol.ts-doc-items [data-clause-ref]")).toHaveCount(1);
    });

    await ev.action("호함수조항#7", "이 담보를 특약으로 탑재한 상품을 만들면 미리보기 — 사용처 호 목록에 함수조항의 호 둘이 이어 서서 호가 셋이 된다", async () => {
      await productWithSpecial(page, `호함수조항미리보기 ${COVERAGE}`, COVERAGE);
      await page.goto(docUrl);
      const items = page.locator("#ts-side-panel-preview ol.ts-doc-items > li.ts-doc-item");
      await expect(items).toHaveText(["사망한 경우", "암으로 진단확정된 경우", "뇌졸중으로 진단확정된 경우"]);
    });

    await ev.action("호함수조항#8", "함수조항 상세 — 이제 한 곳에서 쓰므로 「한 곳에서만 씁니다」 경고가 더해진다", async () => {
      await page.goto(`/functions/${code}`);
      // #3 에서 펼친 기본정보를 브라우저가 기억한다
      await expect(page.locator(".ts-clause-meta .ts-basics-head")).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("list", { name: "단위 규칙 경고" })).toContainText("한 곳에서만 씁니다");
    });
  },
);
