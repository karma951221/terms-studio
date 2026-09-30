import { type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 담보속성 조회 · 상세 (기능/담보속성 §4, 2026-09-28) — 시드 알파Plus 를 읽기만 한다. 편집은 취소로 끝낸다(저장하지 않는다).
 *
 * - 조회: 한 행 = 유효값 하나(갱신유형 → 비갱신형 · 갱신형 두 행), 「수」 컬럼 없음, 값 코드는 1 · 2 (V01 아님).
 * - 상세: 코드 · 값 이름 · 「상품담보명 표기」ⓘ — 순서 · 사용 수 컬럼 없음, 「명명 조각」이란 말 없음.
 * - 편집: 마지막 행 아래 ⊕ 「행 추가 · 값」 → 새 행의 값 이름 칸에 커서 · 행 앞 ⊖ 「행 삭제 · {값 이름}」 → 편집 취소 · 버리기 (값 행 표, 2026-10-01).
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test(
  "담보속성 — 값별 한 행 조회 · 상세 값 표 · 편집의 「행 추가」(취소)",
  { annotation: { type: "좌표없음", description: "기능/담보속성 §4 (2026-09-28)" } },
  async ({ page, ev }) => {
    await ev.action("담보속성#1", "관리자로 로그인한다", () => login(page));

    await ev.action("담보속성#2", "조회 — 컬럼에 「수」가 없고, 갱신유형 · 부가유형의 값이 각각 한 행(코드 1 · 2)", async () => {
      await page.goto("/attributes");
      await expect(page.locator("table.ts-table thead th")).toHaveText(["담보속성 코드", "담보속성명", "값 코드", "값 이름", "상품담보명 표기", "최종수정", "수정자"]);
      const rows = page.locator("table.ts-table tbody tr");
      await expect(rows).toHaveCount(4);
      const cells = await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 4).map((td) => td.textContent?.trim())));
      expect(cells).toEqual([
        ["A0001", "갱신유형", "1", "비갱신형"],
        ["A0001", "갱신유형", "2", "갱신형"],
        ["A0002", "부가유형", "1", "기본"],
        ["A0002", "부가유형", "2", "추가"],
      ]);
      await expect(page.getByText("명명")).toHaveCount(0);
    });

    await ev.action("담보속성#3", "행의 담보속성명을 누르면 유형 상세 — 값 표는 코드 · 값 이름 · 상품담보명 표기(ⓘ)뿐", async () => {
      await page.getByRole("link", { name: "갱신유형" }).first().click();
      await page.waitForURL(/\/attributes\/A0001$/);
      // 값 표 머리만 본다. 머리 칸 끝의 ⓘ 는 공백을 남기므로 정규식으로.
      const head = page.locator("table.ts-attr-values thead th");
      await expect(head).toHaveText([/^코드$/, /^값 이름$/, /^상품담보명 표기\s*$/]);
      await expect(page.getByLabel("상품담보명에 이 값 대신 들어갈 말 — 비우면 붙지 않는다")).toBeVisible();
      await expect(page.getByText(/사용처|사용 수|명명 조각/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /행 추가|행 삭제/ })).toHaveCount(0);
    });

    await ev.action("담보속성#4", "편집 — 마지막 행 아래 ⊕ 「행 추가 · 값」을 누르면 새 행이 생기고 그 값 이름 칸에 커서가 간다 · 행 앞 ⊖", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const add = page.locator("table.ts-attr-values tfoot").getByRole("button", { name: "행 추가 · 값", exact: true });
      await expect(add).toBeVisible();
      await expect(page.getByRole("button", { name: "행 삭제 · 비갱신형", exact: true })).toBeVisible();
      await add.click();
      await expect(page.locator("table.ts-attr-values tbody tr")).toHaveCount(3);
      await expect(page.locator("table.ts-attr-values tbody tr").last().getByRole("textbox", { name: "값 이름" })).toBeFocused();
      await page.keyboard.type("혼합형");
    });

    await ev.action("담보속성#5", "편집 취소 → 버리기 — 새 행은 사라지고 읽기로 돌아간다(저장 없음)", async () => {
      await page.getByRole("button", { name: "편집 취소", exact: true }).click();
      await page.getByRole("button", { name: "저장하지 않고 나가기", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.locator("table.ts-attr-values tbody tr")).toHaveCount(2);
      await expect(page.getByText("혼합형")).toHaveCount(0);
    });
  },
);
