import { type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 담보코드 · 상품모델링 탑재 표 · 세목 형 (2026-09-27) — 시드 알파Plus 를 읽기만 한다 (실물재현 E2E 가 같은 DB 를 대조한다).
 *
 * - 담보 조회: 1열 담보코드(COV000001…, 시스템 채번 · 시드 JSON 순서) · 코드로 검색 · 상세 머리 줄에 코드 (기능/담보 §4)
 * - 상품 상세: 「보통약관 기본계약」 · 「특별약관」 표 — 한 행 = 상품담보 하나, 담보코드 · 담보속성 조합 · 상품담보명 · 「담보 검색」 (기능/상품 §4.6)
 * - 기본정보: 세목 종 2 · 형 2 · 조합 4 (기능/상품 §4.4)
 */

const PRODUCT = "알파Plus보장보험";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 검색창에 쳐서 URL 쿼리가 바뀔 때까지 — 입력은 300ms 뒤 `router.replace` 로 간다. */
async function search(page: Page, key: string, value: string): Promise<void> {
  await page.getByRole("searchbox").fill(value);
  await page.waitForURL((url) => url.searchParams.get(key) === value);
  await page.waitForLoadState("networkidle");
}

async function openProduct(page: Page): Promise<string> {
  await page.goto("/products");
  await page.getByRole("link", { name: new RegExp(`^${PRODUCT}$`) }).click();
  await page.waitForURL(/\/products\/[0-9a-f-]+/);
  return new URL(page.url()).pathname;
}

test(
  "담보코드 — 조회 1열 · 코드 검색 · 상세 머리 줄",
  { annotation: { type: "좌표없음", description: "기능/담보 §4 담보코드 (2026-09-27)" } },
  async ({ page, ev }) => {
    await ev.action("담보코드#1", "관리자로 로그인한다", () => login(page));

    await ev.action("담보코드#2", "담보 조회 — 1열 헤더가 「코드」이고 시드 담보 9건이 COV000001~COV000009 를 갖는다", async () => {
      await page.goto("/coverages");
      await expect(page.locator("table.ts-table thead th").first()).toHaveText("코드");
      const codes = await page.locator("table.ts-table tbody td.col-code code").allInnerTexts();
      expect([...codes].sort()).toEqual(Array.from({ length: 9 }, (_, i) => `COV00000${i + 1}`));
      const row = page.locator("tbody tr", { has: page.getByRole("link", { name: "일반상해사망보장", exact: true }) });
      await expect(row.locator("td.col-code")).toHaveText("COV000002");
    });

    await ev.action("담보코드#3", "코드로 검색하면 그 담보 한 건만 남는다", async () => {
      await search(page, "q", "COV000008");
      await expect(page.locator("table.ts-table tbody tr")).toHaveCount(1);
      await expect(page.getByRole("link", { name: "수술비(1-7종, 연간3회한)[상해]보장" })).toBeVisible();
      await expect(page.getByText(/총\s*1\s*건/)).toBeVisible();
    });

    await ev.action("담보코드#4", "상세 머리 줄에 담보코드가 보인다", async () => {
      await page.getByRole("link", { name: "수술비(1-7종, 연간3회한)[상해]보장" }).click();
      await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
      await expect(page.locator(".ts-edit-head, .ts-count").getByText("COV000008", { exact: true }).first()).toBeVisible();
    });
  },
);

test(
  "상품모델링 — 기본계약 · 특별약관 표(담보코드 · 담보속성 조합 · 상품담보명) · 담보 검색",
  { annotation: { type: "좌표없음", description: "기능/상품 §4.6 탑재 표 (2026-09-27)" } },
  async ({ page, ev }) => {
    await ev.action("탑재표#1", "관리자로 로그인한다", () => login(page));
    const productPath = await ev.action("탑재표#2", "시드 상품을 연다", () => openProduct(page));

    await ev.action("탑재표#3", "보통약관 탭 「보통약관 기본계약」 — 한 행 COV000001 · 속성 — · 상품담보명", async () => {
      await page.goto(`${productPath}?tab=general`);
      const section = page.getByRole("region", { name: "보통약관 기본계약", exact: true });
      await expect(section.getByRole("heading", { name: "보통약관 기본계약" })).toBeVisible();
      await expect(section.locator("thead th")).toHaveText(["담보코드", "담보속성 조합", "상품담보명", "세목 부착", "조작"]);
      const rows = section.locator("tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first().locator("td").nth(0)).toHaveText("COV000001");
      await expect(rows.first().locator("td").nth(1)).toHaveText("—");
      await expect(rows.first().getByRole("textbox", { name: /^상품담보명/ })).toHaveValue("일반상해80%이상후유장해");
    });

    const section = page.getByRole("region", { name: "특별약관", exact: true });
    const rowOf = (name: string) => section.locator("tbody tr", { has: page.getByRole("textbox", { name: `상품담보명 · ${name}`, exact: true }) });

    await ev.action("탑재표#4", "특별약관 탭 — 상품담보 10행, 같은 담보의 두 벌은 담보속성 조합으로 갈린다", async () => {
      await page.goto(`${productPath}?tab=special`);
      await expect(section.locator("tbody tr")).toHaveCount(10);
      await expect(section.getByText(/총\s*10\s*건/)).toBeVisible();
      await expect(rowOf("일반상해사망보장").locator("td").nth(0)).toHaveText("COV000002");
      await expect(rowOf("일반상해사망보장").locator("td").nth(1)).toHaveText("부가유형=기본");
      await expect(rowOf("일반상해사망보장 추가").locator("td").nth(0)).toHaveText("COV000002");
      await expect(rowOf("일반상해사망보장 추가").locator("td").nth(1)).toHaveText("부가유형=추가");
      await expect(rowOf("갱신형 수술비(1-7종, 연간3회한)[상해]보장").locator("td").nth(1)).toHaveText("갱신유형=갱신형");
    });

    await ev.action("탑재표#5", "담보 검색 — 코드 COV000002 면 사망보장 두 벌만", async () => {
      await search(page, "mq", "COV000002");
      await expect(section.locator("tbody tr")).toHaveCount(2);
      await expect(rowOf("일반상해사망보장")).toBeVisible();
      await expect(rowOf("일반상해사망보장 추가")).toBeVisible();
    });

    await ev.action("탑재표#6", "담보 검색 — 속성 조합 「갱신유형=갱신형」이면 갱신형 수술비만 (비갱신형 한 벌은 빠진다)", async () => {
      await search(page, "mq", "갱신유형=갱신형");
      await expect(section.locator("tbody tr")).toHaveCount(1);
      await expect(rowOf("갱신형 수술비(1-7종, 연간3회한)[상해]보장")).toBeVisible();
    });

    await ev.action("탑재표#7", "담보 검색 — 상품담보명 「추가」 · 없는 말이면 안내 한 줄", async () => {
      await search(page, "mq", "추가");
      await expect(section.locator("tbody tr")).toHaveCount(1);
      await expect(rowOf("일반상해사망보장 추가")).toBeVisible();
      await search(page, "mq", "없는담보");
      await expect(section.getByText("「없는담보」에 맞는 상품담보가 없습니다.")).toBeVisible();
    });
  },
);

test(
  "세목 — 종 2 · 형 2 · 종·형 조합 4",
  { annotation: { type: "좌표없음", description: "기능/상품 §4.4 세목 · 시드 형 축 (2026-09-27)" } },
  async ({ page, ev }) => {
    await ev.action("세목형#1", "관리자로 로그인한다", () => login(page));
    const productPath = await ev.action("세목형#2", "시드 상품을 연다", () => openProduct(page));

    await ev.action("세목형#3", "기본정보 › 보험종목 정의 — 종 2 · 형 2", async () => {
      await page.goto(`${productPath}?tab=basic`);
      const rows = page.locator("#definitions-panel tbody tr");
      await expect(rows).toHaveCount(4);
      const text = (await rows.allInnerTexts()).join("\n");
      for (const label of ["제1종", "제2종", "제1형", "제2형", "보험료 납입면제 미적용형", "보험료 납입면제형", "해약환급금 지급형", "해약환급금미지급형(납입후50%)"]) expect(text).toContain(label);
    });

    await ev.action("세목형#4", "기본정보 › 종·형 조합 — 4건 (1종1형 · 1종2형 · 2종1형 · 2종2형)", async () => {
      await page.getByRole("tab", { name: "종·형 조합" }).click();
      const rows = page.locator("#combinations-panel tbody tr");
      await expect(rows).toHaveCount(4);
      const labels = (await rows.allInnerTexts()).map((t) => (t.match(/제\d종|제\d형/g) ?? []).join(""));
      expect([...labels].sort()).toEqual(["제1종제1형", "제1종제2형", "제2종제1형", "제2종제2형"]);
    });
  },
);
