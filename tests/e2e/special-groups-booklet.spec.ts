import { type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";
import { productWithSpecial } from "./_lib/product";

/**
 * 특약 그룹의 책자 반영 — 독립특약(절 형태)의 블록 순서 = 그룹 순서 · 「그룹 제목 표시」 (ADR-0090 결정 5 · 7 · 8 · 기능/상품 §3.7 · §4.4).
 *
 * 새 독립특약 상품에 상해 담보 둘을 탑재하고 사용자 그룹 둘(수술 관련 → 사망 관련)에 하나씩 넣어 기본 그룹(상해, 담보 없음)을 맨 뒤로 보낸다.
 * 「그룹 제목 표시」를 켜면 미리보기에 「Ⅰ. 수술 관련 특별약관」 아래 「Ⅰ-1. …」, 「Ⅱ. 사망 관련 특별약관」 아래 「Ⅱ-1. …」,
 * 끄면 그룹 제목 없이 「1.」 「2.」. 제2절 골격(절 형태)은 아직 없어 블록은 특약 자리에 찍힌다(잠정, 기능/조립산출 §3.8).
 * 시드 상품은 건드리지 않는다 — 끝에 만든 상품을 지운다.
 */

const DEATH = "일반상해사망보장";
const SURGERY = "수술비(1-7종, 연간3회한)[상해]보장";
const SURGERY_GROUP = "수술 관련 특별약관";
const DEATH_GROUP = "사망 관련 특별약관";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 기본정보 탭 — 편집 → 계약형태 · 그룹 제목 표시 → 저장 한 번. */
async function setBasic(page: Page, url: string, opts: { standalone?: boolean; groupTitles: boolean }): Promise<void> {
  await page.goto(`${url}?tab=basic`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const info = page.getByRole("region", { name: "상품정보" });
  if (opts.standalone) await info.locator('tr[data-path="feature.contract_kind"] select').selectOption({ label: "독립특약" });
  await info.locator('tr[data-path="booklet.group_titles"]').getByRole("radio", { name: opts.groupTitles ? "예" : "아니오", exact: true }).check();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(info.locator('tr[data-path="booklet.group_titles"] td')).toHaveText(opts.groupTitles ? "예" : "아니오");
}

/** 미리보기 — 실행(또는 다시 실행) 뒤 그룹 제목 줄 · 특약(블록) 제목 줄. */
async function previewHeadings(page: Page, url: string): Promise<{ groups: string[]; docs: string[] }> {
  await page.goto(`${url}/preview`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^(다시 )?실행$/ }).first().click();
  await expect(page.getByRole("heading", { name: "조립 검사 결과" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/오래된 결과/)).toHaveCount(0);
  const groups = page.locator("section.ts-doc-group");
  return {
    groups: await groups.locator("h2.ts-doc-group-title").allInnerTexts(),
    docs: await groups.locator("h2.ts-doc-title").allInnerTexts(),
  };
}

test(
  "특약 그룹 책자 — 독립특약 블록은 그룹 순서로 서고 「그룹 제목 표시」를 켜면 「Ⅰ.」 「Ⅰ-1.」, 끄면 「1.」",
  { annotation: { type: "좌표없음", description: "기능/상품 §3.7 「그룹 제목 표시」 · 기능/조립산출 §3.8 블록 번호 머리 (ADR-0090 결정 8, 2026-10-17) — 시나리오 좌표가 아직 없다" } },
  async ({ page, ev }) => {
    test.setTimeout(180_000);
    await ev.action("특약그룹책자#1", "관리자로 로그인한다", () => login(page));

    let url = "";
    try {
      await ev.action("특약그룹책자#2", `새 상품에 「${DEATH}」를 특약으로 탑재하고 계약형태를 독립특약으로 · 그룹 제목 표시를 켠다`, async () => {
        url = await productWithSpecial(page, `특약 그룹 책자 E2E ${Date.now()}`, DEATH);
        await setBasic(page, url, { standalone: true, groupTitles: true });
      });

      await ev.action("특약그룹책자#3", `상품담보 탭 편집 — 「${SURGERY}」를 더하고 사용자 그룹 「${SURGERY_GROUP}」 · 「${DEATH_GROUP}」에 하나씩 넣어 기본 그룹을 맨 뒤로 둔 뒤 저장한다`, async () => {
        await page.goto(`${url}?tab=coverages`);
        await page.waitForLoadState("networkidle");
        await page.getByRole("button", { name: "편집", exact: true }).click();
        const specials = page.getByRole("region", { name: "특별약관", exact: true });
        await specials.getByRole("button", { name: "특별약관에 담보 추가" }).click();
        await pickCombo(specials.getByRole("combobox", { name: "담보 · 특별약관에 추가", exact: true }), { label: SURGERY });
        await specials.getByRole("button", { name: "추가", exact: true }).click();

        const groups = page.getByRole("region", { name: "특약 그룹", exact: true });
        const rows = groups.locator("tbody tr[data-group]");
        await expect(rows.locator("td:nth-child(2)")).toHaveText(["상해 관련 특별약관"]);
        // 기본 그룹(상해) 한 줄 뒤에 사용자 그룹 둘 — 「+ 그룹」은 목록 끝에 붙는다
        for (const [i, [name, coverage]] of ([[SURGERY_GROUP, SURGERY], [DEATH_GROUP, DEATH]] as const).entries()) {
          await groups.getByRole("button", { name: "특약 그룹 추가" }).click();
          await groups.getByRole("textbox", { name: `그룹 이름 · ${i + 2}` }).fill(name);
          await groups.getByRole("combobox", { name: `담보 넣기 · ${name}` }).selectOption({ label: coverage });
        }
        // 기본 그룹을 맨 뒤로 — 두 번 ▼ (수술 관련 → 사망 관련 → 상해 관련)
        await groups.getByRole("button", { name: "아래로 · 상해 관련 특별약관" }).click();
        await groups.getByRole("button", { name: "아래로 · 상해 관련 특별약관" }).click();
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(rows.locator("td:nth-child(2)")).toHaveText([SURGERY_GROUP, DEATH_GROUP, "상해 관련 특별약관"]);
        await expect(rows.nth(2)).toContainText("담보 없음 — 책자에 찍지 않는다");
      });

      await ev.action("특약그룹책자#4", "미리보기를 실행하면 그룹 순서대로 「Ⅰ. 수술 관련 특별약관」 · 「Ⅰ-1. …」 · 「Ⅱ. 사망 관련 특별약관」 · 「Ⅱ-1. …」 — 빈 기본 그룹은 찍지 않는다", async () => {
        const shown = await previewHeadings(page, url);
        expect(shown.groups).toEqual([`Ⅰ. ${SURGERY_GROUP}`, `Ⅱ. ${DEATH_GROUP}`]);
        // 특약(블록) 제목 = 머리 + 상품담보명 + 「 특별약관」 — 상품담보명은 작명 규칙이 짓는다
        expect(shown.docs).toHaveLength(2);
        expect(shown.docs[0]).toMatch(/^Ⅰ-1\. .*수술비.* 특별약관$/);
        expect(shown.docs[1]).toMatch(/^Ⅱ-1\. .*일반상해사망보장.* 특별약관$/);
      });

      await ev.action("특약그룹책자#5", "그룹 제목 표시를 끄고 다시 실행하면 그룹 제목 없이 같은 순서로 「1.」 「2.」", async () => {
        await setBasic(page, url, { groupTitles: false });
        const shown = await previewHeadings(page, url);
        expect(shown.groups).toEqual([]);
        expect(shown.docs).toHaveLength(2);
        expect(shown.docs[0]).toMatch(/^1\. .*수술비.* 특별약관$/);
        expect(shown.docs[1]).toMatch(/^2\. .*일반상해사망보장.* 특별약관$/);
      });
    } finally {
      if (url) {
        await page.goto(`${url}?confirm=product`);
        await page.locator('.ts-confirm button[type="submit"]').click();
        await page.waitForURL(/\/products$/);
      }
    }
  },
);
