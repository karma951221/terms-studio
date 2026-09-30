import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 조 참조는 (조, P코드)로 저장된다 (ADR-0072 결정 1 · 3 · 5 · 최종 결정 12, 기능/문면 §3.5).
 *
 * 편집기에서 항을 참조로 고르면 그 항의 조 · P코드가 저장된다. 앞에 항을 끼워 번호가 밀려도 참조는 같은 항(코드)을 따라가
 * 계산 번호가 바뀐다 — 번호를 글로 박지 않는다. 새 항은 기본 위치값 n×100 에서 겹치지 않는 코드를 받는다(끼운 항 = P0300).
 * 시드 문서는 건드리지 않는다 — 새로 만든 보통약관만 쓴다.
 *
 * 좌표 문면작성#4 — 흐름 1(같은 문서의 조 · 항 참조) · 4(저장)와 기대 결과 「번호 텍스트가 박히지 않고 계산된 번호로」 ·
 * 경계 「밀리는 순간 오참조」를 친다. 보통약관 조 참조(흐름 2) · 별표 참조(흐름 3)는 이 테스트 밖이다.
 */

const DOC_TITLE = "P코드검증 보통약관";

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
  "조 참조는 항의 P코드를 저장한다 — 앞에 항을 끼워도 같은 항을 따라가 번호가 「제2항」 → 「제3항」",
  { annotation: { type: "시나리오", description: "문면작성#4" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("문면작성#4.0", "관리자로 로그인하고 보통약관 템플릿을 새로 만든다", async () => {
      await login(page);
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(DOC_TITLE);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
    });

    const body = page.locator(".ts-l3-body");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });
    const paragraphs = body.getByRole("textbox", { name: "항", exact: true });

    await ev.action("문면작성#4.0", "편집 — 조 하나에 항 둘을 쓴다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험금의 지급사유");
      await title.press("Enter");
      await tool("항").click();
      await paragraphs.first().fill("회사는 보험금을 지급합니다.");
      await paragraphs.first().press("End");
      await paragraphs.first().press("Enter");
      await expect(paragraphs.nth(1)).toBeFocused();
      await paragraphs.nth(1).fill("지급 기일은 서류를 접수한 날부터 3영업일입니다.");
    });

    await ev.action("문면작성#4.1", "첫 항 끝에 조 참조 — 둘째 항을 고르면 「제2항」 칩이 선다", async () => {
      await paragraphs.first().click();
      await paragraphs.first().press("End");
      await tool("조 참조").click();
      const d = page.getByRole("dialog", { name: "조 참조 넣기" });
      await expect(d).toBeVisible();
      await d.getByRole("button", { name: /펴기$/ }).first().click();
      await d.getByRole("treeitem", { level: 2 }).nth(1).getByRole("checkbox").check();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d).toHaveCount(0);
      await expect(body.locator("[data-chip]")).toContainText(["제2항"]);
    });

    await ev.action("문면작성#4.4", "저장 · 새로 읽어도 「제2항」", async () => {
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.reload();
      await expect(body).toContainText("회사는 보험금을 지급합니다.제1조(보험금의 지급사유) 제2항");
    });

    await ev.action("문면작성#4.4", "첫 항 뒤에 항을 끼워 넣고 저장 — 참조는 같은 항(코드)을 따라가 「제3항」", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await paragraphs.first().click();
      await paragraphs.first().press("End");
      await tool("항").click();
      await expect(paragraphs).toHaveCount(3);
      await expect(paragraphs.nth(1)).toBeFocused();
      await paragraphs.nth(1).fill("끼워 넣은 항입니다.");
      await expect(body.locator("[data-chip]")).toContainText(["제3항"]);
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.reload();
      await expect(body).toContainText("회사는 보험금을 지급합니다.제1조(보험금의 지급사유) 제3항");
      await expect(body).toContainText("끼워 넣은 항입니다.");
    });
  },
);
