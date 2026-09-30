import { expect, test } from "./_lib/fixtures";

/**
 * 상품 기본정보 — 와이어프레임 §20.2 (읽기 · 편집 · 종·형 조합) + 상품정보(평균공시이율 · 상품특성, 2026-09-28).
 * 헤더의 편집/더보기 ↔ 취소/저장, 상품정보 칸 · 보험종목 표의 추가 · 선택 삭제 · 인라인 값, 조합 체크, 저장 하나.
 */
test(
  "기본정보: 읽기 → 편집 → 단일 저장, 종목·조합과 취소",
  {
    annotation: {
      type: "좌표없음",
      description: "와이어프레임 §20.2 기본정보 — 화면 편집 원칙(읽기 → 편집 → 저장 하나 · 취소 · 더보기) 검증. 세목구성#2 · #3 과 일부 겹치나 형 축 · 유형 중복 거부를 다루지 않아 좌표를 달지 않는다",
    },
  },
  async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/login");
    await page.getByRole("button", { name: /admin/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    const originalName = `기본정보 UI 검증 ${Date.now()}`;
    let productUrl: string | undefined;
    try {
      await page.goto("/products/new");
      await page.getByLabel("상품명", { exact: true }).fill(originalName);
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await page.waitForURL(/\/products\/[0-9a-f-]{36}(?:\?tab=basic)?$/);
      productUrl = page.url();

      // ── 읽기: 경로 + 편집 · 더보기. 목록 버튼 · 미리보기 · 삭제 버튼은 헤더에 없다.
      const name = page.getByRole("textbox", { name: "상품명", exact: true });
      await expect(name).toHaveAttribute("readonly", "");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(originalName);
      await expect(page.getByRole("heading", { level: 1 }).getByRole("link", { name: "상품" })).toHaveAttribute("href", "/products");
      await expect(page.getByRole("link", { name: "상품 목록" })).toHaveCount(0);
      await expect(page.getByText(/완결성 — 값 자리/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "보험종목 추가" })).toHaveCount(0);
      const more = page.getByRole("button", { name: "더보기" });
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("menuitem", { name: "미리보기" })).toHaveAttribute("href", /\/preview$/);
      await expect(page.getByRole("menuitem", { name: "상품 삭제" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);

      // ── 편집 → 취소: 고친 것이 있으면 「버립니까?」 — 계속 편집은 초안 유지, 버리기는 초안을 버린다. 편집 중에는 더보기가 없다.
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await expect(page.getByRole("button", { name: "더보기" })).toHaveCount(0);
      await name.fill("취소할 이름");
      await page.getByRole("button", { name: "취소", exact: true }).click();
      await page.getByRole("button", { name: "계속 수정" }).click();
      await expect(name).toHaveValue("취소할 이름");
      await page.getByRole("button", { name: "취소", exact: true }).click();
      await page.getByRole("button", { name: "저장하지 않고 나가기" }).click();
      await expect(name).toHaveValue(originalName);
      await expect(name).toHaveAttribute("readonly", "");

      // ── 편집: 이름 · 보험종목 두 행(인라인 값) · 선택 삭제 · 조합 체크 → 저장 하나
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await name.fill(`${originalName} 수정`);
      // 상품정보 — 평균공시이율 · 상품특성(갱신형여부 · 간편심사유형)도 같은 저장 하나에 실린다
      const info = page.getByRole("region", { name: "상품정보" });
      await expect(info.locator("th[scope=row]")).toHaveText(["상품명", "평균공시이율", "갱신형여부", "태아보장여부", "단체계약여부", "간편심사유형", "건강고지유형"]);
      await info.locator('tr[data-path="disclosure.avg_rate"] input').fill("2.5");
      await info.locator('tr[data-path="feature.renewable"]').getByRole("radio", { name: "예", exact: true }).check();
      await info.locator('tr[data-path="feature.review_type"] select').selectOption({ label: "통합간편심사" });
      await expect(page.getByRole("button", { name: "선택 삭제" })).toHaveCount(0);
      await page.getByRole("button", { name: "보험종목 추가" }).click();
      const rows = page.locator("#definitions-panel tbody tr");
      await expect(rows).toHaveCount(1);
      await rows.nth(0).getByRole("textbox", { name: "보험종목명" }).fill("보험료납입면제미적용형");
      await rows.nth(0).getByRole("combobox", { name: "세목유형" }).selectOption("waiver");
      await rows.nth(0).getByRole("radio", { name: "아니오", exact: true }).check();
      await page.getByRole("button", { name: "보험종목 추가" }).click();
      await rows.nth(1).getByRole("textbox", { name: "보험종목명" }).fill("보험료납입면제적용형");
      await rows.nth(1).getByRole("combobox", { name: "세목유형" }).selectOption("waiver");
      await rows.nth(1).getByRole("radio", { name: "예", exact: true }).check();
      // 세 번째 행은 선택 삭제로 지운다 — 행별 삭제 버튼은 없다
      await page.getByRole("button", { name: "보험종목 추가" }).click();
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(2).getByRole("button")).toHaveCount(0);
      await rows.nth(2).getByRole("checkbox", { name: /선택$/ }).check();
      await page.getByRole("button", { name: "선택 삭제" }).click();
      await expect(rows).toHaveCount(2);
      await expect(page.getByRole("button", { name: "선택 삭제" })).toHaveCount(0);

      await page.getByRole("tab", { name: "종·형 조합" }).click();
      await page.getByRole("checkbox", { name: /제1종.*사용$/ }).check();
      await page.getByRole("checkbox", { name: /제2종.*사용$/ }).check();
      await page.getByRole("tab", { name: "보험종목 정의" }).click();
      await expect(rows.nth(0).getByRole("textbox", { name: "보험종목명" })).toHaveValue("보험료납입면제미적용형");
      await expect(page.getByRole("button", { name: "저장", exact: true })).toHaveCount(1);
      await page.screenshot({ path: "/tmp/terms-basic-edit.png", fullPage: true });
      // 납입면제 폼 검사 (결정 16) — 적용여부 「예」인데 사유를 안 고르면 저장이 거부되고 어느 종목인지 알린다
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByText("제2종(보험료납입면제적용형) — 적용여부가 「예」면 납입면제사유를 1개 이상 고르세요")).toBeVisible();
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
      await rows.nth(1).getByRole("checkbox", { name: "뇌졸중", exact: true }).check();
      await page.getByRole("button", { name: "저장", exact: true }).click();

      // ── 저장 후 읽기: 표에 종·형 · 이름 · 값이 함께 보인다
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(name).toHaveValue(`${originalName} 수정`);
      await expect(name).toHaveAttribute("readonly", "");
      await expect(page.getByRole("cell", { name: "제1종", exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: "보험료납입면제미적용형", exact: true })).toBeVisible();
      await expect(page.getByRole("cell", { name: "아니오", exact: true })).toBeVisible();
      await expect(info.locator('tr[data-path="disclosure.avg_rate"] td')).toHaveText("2.5");
      await expect(info.locator('tr[data-path="feature.renewable"] td')).toHaveText("예");
      await expect(info.locator('tr[data-path="feature.review_type"] td')).toHaveText("통합간편심사");
      await expect(info.locator('tr[data-path="feature.fetal"] td')).toHaveText("—");
      await page.reload();
      await expect(name).toHaveValue(`${originalName} 수정`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`${originalName} 수정`);
      await page.screenshot({ path: "/tmp/terms-basic-read.png", fullPage: true });
      await page.getByRole("tab", { name: "종·형 조합" }).click();
      await expect(page.locator("#combinations-panel tbody tr")).toHaveCount(2);
      await expect(page.getByRole("checkbox")).toHaveCount(0);

      // ── 모바일: 가로 스크롤은 표 상자 안에서만
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("tab", { name: "보험종목 정의" }).click();
      await page.screenshot({ path: "/tmp/terms-basic-mobile.png", fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      if (productUrl) {
        await page.goto(`${productUrl.split("?")[0]}?confirm=product`);
        await page.locator('.ts-confirm button[type="submit"]').click();
        await page.waitForURL(/\/products$/);
      }
    }
  },
);
