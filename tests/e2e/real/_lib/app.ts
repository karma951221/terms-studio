/** 실물 재현 화면 E2E 공용 — 로그인 · 같은 URL 제출 · 상품 탭. */
import { expect, type Locator, type Page } from "@playwright/test";

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 같은 URL 로 돌아오는 서버 액션 제출 — POST 응답과 네트워크 정지를 기다린다. */
export async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

/** L2 상세의 「편집 → 저장」 한 번 — 읽기 모드로 돌아올 때까지. */
export async function saveEdit(page: Page): Promise<void> {
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible({ timeout: 30_000 });
}

/** 이 스펙들이 공유하는 좌표 없음 사유 — 실물재현_E2E_시나리오는 절차 문서라 좌표 체계 밖이다. */
export const NO_COORD = { annotation: { type: "좌표없음", description: "실물재현_E2E_시나리오 §4 ④ — 절차 문서라 좌표 체계 밖" } } as const;

/**
 * 화면을 열고 하이드레이션까지 기다린다 — 새 dev 서버가 처음 그리는 화면은 JS 가 늦게 붙어,
 * 그 전에 친 입력칸 값이 React 상태로 덮여 사라진다(빈 칸 제출).
 */
export async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
}

/** 제출 뒤 새 화면에 닿고 하이드레이션까지 — 그 전에 누른 버튼은 아무 일도 하지 않는다. */
export async function arrive(page: Page, url: RegExp): Promise<void> {
  await page.waitForURL(url);
  await page.waitForLoadState("networkidle");
}
