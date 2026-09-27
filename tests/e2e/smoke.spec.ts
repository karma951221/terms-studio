import { expect, test } from "./_lib/fixtures";

/**
 * 스모크 — 화면이 깨졌나만 본다 (QA/테스트전략 소수 정예). 조립이 맞나는 Vitest 스냅샷 몫.
 * 전제: `npm run db:seed` 로 관통 1 축약 시드가 들어간 개발 DB.
 */

test(
  "헬스체크가 DB 왕복에 성공한다",
  { annotation: { type: "좌표없음", description: "스모크 — QA/테스트전략 소수 정예, 화면이 깨졌나만 본다" } },
  async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.status).toBe("ok");
  },
);

test(
  "로그인 없이 앱에 들어가면 /login 으로 보낸다",
  { annotation: { type: "좌표없음", description: "스모크 — QA/테스트전략 소수 정예, 화면이 깨졌나만 본다" } },
  async ({ page }) => {
    await page.goto("/catalog");
    await expect(page).toHaveURL(/\/login/);
  },
);

test(
  "관통 1: 로그인 → 상품 → 조립 미리보기가 완성본으로 렌더된다",
  { annotation: { type: "좌표없음", description: "스모크 — QA/테스트전략 소수 정예, 화면이 깨졌나만 본다" } },
  async ({ page }) => {
    await page.goto("/login");
    // 시드 admin 으로 로그인 (이름 선택 최소형)
    const submit = page.getByRole("button", { name: /admin/ });
    await expect(submit).toBeVisible();
    await submit.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto("/products");
    const product = page.getByRole("link", { name: /^알파Plus보장보험$/ });
    await expect(product).toBeVisible();
    await product.click();

    // 상세는 세 탭이다 (기능/상품 §3.8) — 탭을 옮겨도 헤더(미리보기 · 삭제)는 그대로 선다.
    const tabs = page.locator("nav.ts-subtabs");
    for (const name of ["기본정보", "보통약관", "특별약관"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
    await tabs.getByRole("link", { name: "특별약관" }).click();
    await expect(page).toHaveURL(/\?tab=special$/);
    await expect(page.getByRole("heading", { name: /^특약 담보 \d+건$/ })).toBeVisible();

    await page.getByRole("link", { name: "미리보기", exact: true }).first().click();
    await expect(page).toHaveURL(/\/products\/.+\/preview/);
    // 실물 보통약관(기본계약 대치된 제3조) + 특약 4벌 + 참조된 별표 10건(등장 순 자동 번호 — ADR-0063), 오류 없음
    await expect(page.getByRole("heading", { name: /무배당 알파Plus보장보험2604 보통약관/ })).toBeVisible();
    await expect(page.getByText(/장해지급률이 80% 이상에 해당하는 장해상태가 되었을 때에는 보험수익자에게 최초1회에 한하여/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /^일반상해사망보장 특별약관/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /일반상해사망보장 추가 특별약관/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^별표 10건$/ })).toBeVisible();
    // 오류 패널 제목은 분모를 함께 갖는다 — 「오류 0 / 조 N」 (디자인원칙 §9.6)
    await expect(page.getByRole("heading", { name: /^오류 0 \/ 조 \d+$/ })).toBeVisible();
    await expect(page.getByText("오류 없음.")).toBeVisible();
    await expect(page.getByText(/완성본 아님/)).toHaveCount(0);
  },
);

test(
  "관계정보: 구분자(담보명) 이웃을 그리고 노드 링크로 조회 대상을 바꾼다",
  { annotation: { type: "좌표없음", description: "스모크 — QA/테스트전략 소수 정예, 화면이 깨졌나만 본다" } },
  async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /admin/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    await page.goto("/relations?kind=discriminator&code=D0001");
    const graph = page.getByRole("img", { name: "조회 대상의 이웃 그래프" });
    await expect(graph).toBeVisible();

    const neighbor = graph.locator('a[data-graph-node^="article:"]').first();
    await expect(neighbor).toBeVisible();
    const neighborId = await neighbor.getAttribute("data-graph-node");
    await neighbor.click();

    await expect(page).toHaveURL((url) => url.searchParams.get("kind") === "article");
    await expect(page.locator(`[data-graph-node="${neighborId}"]`).first()).toBeVisible();
  },
);

test(
  "마스터: 목록 검색 · 행 클릭이 상세 화면으로 가고, 값 노드 링크가 입력 화면의 그 행을 강조한다",
  { annotation: { type: "좌표없음", description: "스모크 — QA/테스트전략 소수 정예, 화면이 깨졌나만 본다" } },
  async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /admin/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    // L1 목록 — 필드 표 전폭, 경로 없음 (2026-09-27 두 칸 → 목록 + 상세).
    await page.goto("/master");
    const waiverLeaf = page.locator('a[href="/master/waiver.applies"]').first();
    const rateLeaf = page.locator('a[href="/master/pay.rate"]').first();
    await expect(waiverLeaf).toBeVisible();
    await expect(rateLeaf).toBeVisible();

    // 검색은 GET ?q= — 맞는 행만 남는다.
    const search = page.getByRole("searchbox", { name: "코드 · 표시명 · 폼 검색" });
    await search.fill("지급률");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/master\?q=/);
    await expect(rateLeaf).toBeVisible();
    await expect(page.locator('a[href="/master/waiver.applies"]')).toHaveCount(0);
    await page.goto("/master");

    // 행의 빈 자리(타입 칸)를 눌러도 필드 상세.
    await page.locator("tr", { has: page.locator('a[href="/master/waiver.applies"]') }).locator(".ts-master-type").click();
    await expect(page).toHaveURL(/\/master\/waiver\.applies$/);
    await expect(page.locator(".ts-crumb-current")).toHaveText("적용여부");
    await expect(page.locator('a.ts-crumb[href="/master/waiver"]')).toBeVisible();

    // 시드 상품의 세목 선택지 둘이 값 노드로 잡힌다 — 「입력 화면 →」가 선택지 좌표(?option=)를 싣는다.
    // (실물 재현 E2E 가 같은 DB 에 상품을 하나 더 만드므로 시드 상품 행만 센다.)
    const seedRows = page.locator("tbody tr", { hasText: /^알파Plus보장보험 › / });
    await expect(seedRows).toHaveCount(2);
    const enter = seedRows.getByRole("link", { name: "입력 화면 →" });
    const href = await enter.first().getAttribute("href");
    expect(href).toMatch(/^\/products\/[^?]+\?option=[^&]+&field=waiver\.applies$/);

    // 값 노드 링크 → 상품 화면의 그 선택지 폼에서 그 행이 강조된다 (기능/마스터 §4.3 「입력 화면 →」).
    await enter.first().click();
    await expect(page).toHaveURL(/\/products\/.+\?option=.+&field=waiver\.applies/);
    const highlighted = page.locator(".ts-field-highlight");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toHaveAttribute("data-path", "waiver.applies");
    await expect(highlighted).toBeInViewport();
    // 관리자 코드 칩이 마스터로 되돌아간다 — 추적의 왕복.
    await expect(highlighted.locator('a.ts-chip-code[href="/master/waiver.applies"]')).toBeVisible();

    // 옛 주소는 새 상세 경로로 돌려보낸다 (북마크 · 옛 링크). 폼 상세 · 없는 코드.
    await page.goto("/master?field=pay.rate");
    await expect(page).toHaveURL(/\/master\/pay\.rate$/);
    await expect(page.locator(".ts-crumb-current")).toHaveText("지급률");
    await page.goto("/master?form=pay");
    await expect(page).toHaveURL(/\/master\/pay$/);
    await page.goto("/master/gone.away");
    await expect(page.getByText("찾을 수 없습니다.")).toBeVisible();
  },
);
