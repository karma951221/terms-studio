import { type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 함수조항 값별 분기(switch, 최종 결정 5 · 기능/함수조항 §3.7) — 목록값 인자(납입면제사유 E0001: 질병 · 상해)를 대상으로 값별 분기를 넣으면
 * 값마다 칸이 서고, 저장하면 상세(읽기)에 칸 머리가 남는다. 칸 하나를 지워 값이 칸 없이 남으면 저장이 거부되고,
 * 칸을 다시 더해 「문구 없음」으로 두면 저장된다. 시드는 건드리지 않는다 — 새 함수조항만 쓴다.
 */

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test(
  "값별 분기 넣기 → 칸마다 본문 → 저장 · 칸을 지우면 「칸이 없는 값」 거부 · 칸을 더해 「문구 없음」이면 저장",
  { annotation: { type: "좌표없음", description: "기능/함수조항 §3.7 값별 분기 — 시나리오 파일에 값별 분기 시나리오가 아직 없다 (기능/함수조항 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    const clauseName = `사유 정의(${Date.now()})`;
    await ev.action("값별분기#1", "관리자로 로그인한다", () => login(page));

    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const cases = editor.locator(".ts-doc-cond.is-switch");

    await ev.action("값별분기#2", "새 함수조항(항) — 인자 「사유」(열거형 납입면제사유) · 툴바 「값별 분기」 → 값마다 칸(질병 · 상해)", async () => {
      await page.goto("/functions/new?type=block");
      await page.getByLabel("함수조항명").fill(clauseName);
      await page.getByRole("button", { name: "인자 추가" }).click();
      await page.getByLabel("인자 1 이름").fill("사유");
      await page.getByLabel("인자 1 타입").selectOption("enum:E0001");
      await toolbar.getByRole("button", { name: "값별 분기", exact: true }).click();
      await expect(cases).toHaveCount(2);
      await expect(editor.getByLabel("값별 분기 대상")).toHaveValue("arg.사유");
      await expect(cases.nth(0).locator(".ts-switch-case")).toContainText("질병");
      await expect(cases.nth(1).locator(".ts-switch-case")).toContainText("상해");
    });

    await ev.action("값별분기#3", "칸마다 항을 쓰고 저장 — 상세(읽기)에 대상 줄 · 칸 머리가 남는다", async () => {
      await cases.nth(0).getByRole("textbox", { name: "항", exact: true }).fill("질병으로 진단확정된 경우");
      await cases.nth(1).getByRole("textbox", { name: "항", exact: true }).fill("상해로 장해상태가 된 경우");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      await expect(editor.locator(".ts-switch-on")).toContainText("값별 분기");
      await expect(cases.nth(0)).toContainText("칸 질병");
      await expect(cases.nth(1)).toContainText("상해로 장해상태가 된 경우");
    });

    await ev.action("값별분기#4", "편집 — 「상해」 칸을 지우면 대상 줄에 「칸 없는 값: 상해」 · 저장하면 거부된다", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await cases.nth(1).getByRole("button", { name: "이 칸 삭제" }).click();
      await expect(cases).toHaveCount(1);
      await expect(editor.locator(".ts-switch-missing")).toContainText("상해");
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.locator(".ts-error-banner").first()).toContainText("칸이 없는 값");
    });

    await ev.action("값별분기#5", "「+칸」 → 상해를 든 칸 · 빈 항을 지우고 「문구 없음」을 켜 저장 — 읽기에 「문구 없음」", async () => {
      await editor.getByRole("button", { name: "+칸" }).click();
      await expect(cases).toHaveCount(2);
      await expect(cases.nth(1).locator(".ts-switch-case")).toContainText("상해");
      const empty = cases.nth(1).getByRole("textbox", { name: "항", exact: true });
      await empty.click();
      await empty.press("Backspace");
      await expect(cases.nth(1).getByRole("textbox")).toHaveCount(0);
      await cases.nth(1).getByLabel("문구 없음").check();
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(cases.nth(1)).toContainText("상해 — 문구 없음");
    });
  },
);

test(
  "문장 안 값별 분기 — 문구 유형에 칩을 넣고 팝업에서 칸 문구 · 「문구 없음」 → 저장하면 읽기에 칸 조각",
  { annotation: { type: "좌표없음", description: "기능/함수조항 §3.7 값별 분기(문장 안) — 시나리오 파일에 값별 분기 시나리오가 아직 없다 (기능/함수조항 §7)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    const clauseName = `사유 말(${Date.now()})`;
    await ev.action("문장분기#1", "관리자로 로그인한다", () => login(page));
    const editor = page.locator(".ts-clause-editor");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });

    await ev.action("문장분기#2", "새 함수조항(문구) — 인자 「사유」 · 문장 끝에 툴바 「문장 안 값별 분기」 → 팝업(칸 질병 · 상해)", async () => {
      await page.goto("/functions/new?type=inline");
      await page.getByLabel("함수조항명").fill(clauseName);
      await page.getByRole("button", { name: "인자 추가" }).click();
      await page.getByLabel("인자 1 이름").fill("사유");
      await page.getByLabel("인자 1 타입").selectOption("enum:E0001");
      const line = editor.getByRole("textbox", { name: "문구", exact: true });
      await line.click();
      await line.fill("보험료 납입을 면제하는 사유: ");
      await line.press("End");
      await toolbar.getByRole("button", { name: "문장 안 값별 분기", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "문장 안 값별 분기" })).toBeVisible();
    });

    await ev.action("문장분기#3", "질병 칸에 문구 · 상해 칸은 「문구 없음」 → 닫고 저장 — 읽기에 질병 칸 문구", async () => {
      const dialog = page.getByRole("dialog", { name: "문장 안 값별 분기" });
      const branches = dialog.locator(".ts-pop-branch");
      await expect(branches).toHaveCount(2);
      await branches.nth(0).getByRole("textbox", { name: "이 칸의 문구" }).fill("질병 진단확정");
      await branches.nth(1).getByLabel("문구 없음").check();
      await dialog.getByRole("button", { name: "닫기", exact: true }).click();
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/functions\/C\d+$/);
      await expect(editor).toContainText("질병 진단확정");
      await expect(editor).toContainText("〔문구 없음〕");
    });
  },
);
