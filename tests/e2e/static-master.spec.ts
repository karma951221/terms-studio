import type { Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 정적 마스터 › 박스 (기능/박스 §4, 최종 결정 9) — 박스를 만들고, 보통약관 템플릿의 항 뒤에 툴바 「박스」로 놓고, 미리보기에 박스 내용이 선다.
 * 시드 문서는 건드리지 않는다 — 새로 만든 템플릿 · 박스만 쓴다(이름에 시각을 붙여 다시 돌려도 겹치지 않게).
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test(
  "박스 생성 → 템플릿 항 뒤에 넣기 → 미리보기에 박스",
  { annotation: { type: "좌표없음", description: "기능/박스 §4.1 ~ §4.4 — 박스 전용 시나리오 파일이 없다 (기능/박스 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    const stamp = Date.now();
    const boxName = `【용어풀이】 보험연도 ${stamp}`;
    const docTitle = `박스검증 보통약관 ${stamp}`;
    await ev.action("박스#1", "관리자로 로그인한다", () => login(page));

    await ev.action("박스#2", "내비 「정적 마스터」 아래에 별표 · 박스가 선다", async () => {
      await page.goto("/boxes");
      const nav = page.getByRole("navigation");
      await expect(nav.getByText("정적 마스터", { exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "별표", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "박스", exact: true })).toBeVisible();
    });

    let code = "";
    await ev.action("박스#3", "새 박스 — 이름 · 제목 · 줄을 쓰고 만들면 상세로 가고 코드 BX 가 붙는다", async () => {
      await page.goto("/boxes/new");
      await page.getByLabel("박스 이름").fill(boxName);
      await page.getByLabel("제목").fill("보험연도");
      await page.getByLabel("줄").fill("보험연도란 계약일부터 1년 단위로 끊은 기간을 말합니다.\n예: 2026년 3월 1일 계약이면 첫 보험연도는 2027년 2월 28일까지");
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/boxes\/BX\d+$/);
      code = decodeURIComponent(page.url().split("/").at(-1)!);
      await expect(page.locator(".ts-field-static")).toHaveText(code);
      await expect(page.locator("aside.ts-doc-box")).toContainText("【보험연도】");
      await expect(page.locator("aside.ts-doc-box")).toContainText("보험연도란 계약일부터 1년 단위로");
    });

    await ev.action("박스#4", "같은 이름으로 또 만들면 같은 화면에서 거부한다", async () => {
      await page.goto("/boxes/new");
      await page.getByLabel("박스 이름").fill(boxName);
      await page.getByLabel("줄").fill("x");
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await expect(page.getByText(/이미 있는 박스 이름/)).toBeVisible();
    });

    await ev.action("박스#5", "보통약관 템플릿을 새로 만든다", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(docTitle);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
    });

    const body = page.locator(".ts-l3-body");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });

    await ev.action("박스#6", "편집 — 조 · 항을 쓰고, 항에 커서를 둔 채 툴바 「박스」에서 그 박스를 고르면 항 뒤에 박스가 선다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("용어의 정의");
      await title.press("Enter");
      await tool("항").click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true });
      await paragraph.fill("이 약관에서 쓰는 용어의 뜻은 다음과 같습니다.");
      await paragraph.press("End");
      await expect(tool("박스")).toBeEnabled();
      await tool("박스").click();
      await page.getByRole("menuitem", { name: `${boxName}(${code})` }).click();
      const placed = body.locator(`aside[data-box="${code}"]`);
      await expect(placed).toBeVisible();
      await expect(placed).toContainText("보험연도란 계약일부터 1년 단위로");
    });

    await ev.action("박스#7", "저장 — 읽기 모드에도 박스가 남는다", async () => {
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(body.locator(`aside[data-box="${code}"]`)).toContainText("【보험연도】");
    });

    await ev.action("박스#8", "더보기 › 미리보기 — 약관 전체에 박스 제목 · 줄이 그 자리에 들어가 있다", async () => {
      await page.getByRole("button", { name: "더보기", exact: true }).click();
      await page.getByRole("menuitem", { name: "미리보기", exact: true }).click();
      const preview = page.getByRole("dialog", { name: "미리보기 — 약관 전체" });
      await expect(preview).toContainText("이 약관에서 쓰는 용어의 뜻은 다음과 같습니다.");
      await expect(preview.locator(`aside[data-box="${code}"]`)).toContainText("예: 2026년 3월 1일 계약이면");
      await preview.getByRole("button", { name: "미리보기 닫기" }).click();
    });
  },
);
