/**
 * 저작 화면 미리보기(기능/문면 §3.9)의 문맥 상품 — 미리보기는 고른 상품의 조립 문맥이라 템플릿을 쓰는 상품이 있어야 선다.
 * 시드 상품은 건드리지 않고 새 상품을 만든다 (실물재현 E2E 가 같은 DB 를 대조한다).
 */
import { expect, type Page } from "@playwright/test";

import { pickCombo } from "./combo";

async function createProduct(page: Page, name: string): Promise<string> {
  await page.goto("/products/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("상품명", { exact: true }).fill(name);
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}(?:\?tab=basic)?$/);
  return page.url().split("?")[0];
}

/** 새 상품에 그 담보를 **특약으로** 탑재한다 — 상품담보 탭 편집 · 저장 한 번. 상품 주소를 돌려준다. */
export async function productWithSpecial(page: Page, name: string, coverageName: string): Promise<string> {
  const url = await createProduct(page, name);
  await page.goto(`${url}?tab=coverages`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const region = page.getByRole("region", { name: "특별약관", exact: true });
  await region.getByRole("button", { name: "특별약관에 담보 추가" }).click();
  await pickCombo(region.getByRole("combobox", { name: "담보 · 특별약관에 추가", exact: true }), { label: coverageName });
  await region.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(region.locator("tbody tr")).toHaveCount(1);
  return url;
}

/** 새 상품의 보통약관 템플릿으로 그 템플릿을 고른다. 상품 주소를 돌려준다. */
export async function productWithGeneral(page: Page, name: string, generalTitle: string): Promise<string> {
  const url = await createProduct(page, name);
  await page.goto(`${url}?tab=general`);
  await page.waitForLoadState("networkidle");
  await pickCombo(page.getByRole("combobox", { name: "보통약관 템플릿" }), { label: generalTitle });
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.getByRole("button", { name: "템플릿 지정" }).click()]);
  await page.waitForLoadState("networkidle");
  return url;
}
