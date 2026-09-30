import type { Page } from "@playwright/test";

/**
 * 테스트 전용 열거형을 생성 화면에서 만든다 — 값별 분기 · 인자 E2E 가 시드 열거형(E0001 납입면제사유 — 실물 값 14개)에 기대지 않게.
 * 이름은 유일해야 한다(호출자가 스탬프를 붙인다). 돌려주는 값 = 채번된 코드(E…).
 */
export async function createEnum(page: Page, label: string, values: readonly string[]): Promise<string> {
  await page.goto("/enums/new");
  await page.getByLabel("열거형변수 이름").fill(label);
  // 생성 화면은 빈 값 두 줄로 시작한다
  for (let i = 2; i < values.length; i++) await page.getByRole("button", { name: "행 추가 · 값", exact: true }).click();
  for (const [i, value] of values.entries()) await page.getByRole("textbox", { name: `${i + 1}번 값 이름`, exact: true }).fill(value);
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await page.waitForURL(/\/enums\/E\d{4}$/);
  return decodeURIComponent(page.url().split("/").at(-1)!);
}
