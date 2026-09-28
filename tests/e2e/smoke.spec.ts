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

    // 상세는 탭 셋 — 기본정보 · 상품담보 · 약관 (기능/상품 §3.8, 2026-09-28 「안 2」) — 탭을 옮겨도 헤더의 [더보기 ▾](미리보기 · 상품 삭제)는 그대로 선다.
    const tabs = page.getByRole("navigation", { name: "상품 하위 탭" });
    for (const name of ["기본정보", "상품담보", "약관"]) await expect(tabs.getByRole("link", { name, exact: true })).toBeVisible();
    await tabs.getByRole("link", { name: "상품담보", exact: true }).click();
    await expect(page).toHaveURL(/\?tab=coverages$/);
    await expect(page.getByRole("heading", { name: "특별약관", exact: true })).toBeVisible();
    // 약관 — 둘째 줄 하위 탭 보통약관 작성 · 담보별 미리보기
    await tabs.getByRole("link", { name: "약관", exact: true }).click();
    await expect(page).toHaveURL(/\?tab=terms$/);
    const sub = page.getByRole("navigation", { name: "약관 하위 탭" });
    await expect(sub.getByRole("link", { name: "보통약관 작성" })).toHaveAttribute("aria-current", "page");
    await expect(sub.getByRole("link", { name: "담보별 미리보기" })).toBeVisible();
    // 옛 주소(?tab=special)는 새 자리로 (북마크 · 옛 링크)
    await page.goto(`${new URL(page.url()).pathname}?tab=special`);
    await expect(page).toHaveURL(/\?tab=coverages$/);

    await page.getByRole("button", { name: "더보기", exact: true }).click();
    await page.getByRole("menuitem", { name: "미리보기", exact: true }).click();
    await expect(page).toHaveURL(/\/products\/.+\/preview/);
    // 저장본이 없으면 「실행」을 눌러 조립해 저장한다 (기능/조립산출 §4.1)
    await page.getByRole("button", { name: "실행", exact: true }).click();
    // 실물 보통약관(기본계약 대치된 제3조) + 특약 10벌 + 참조된 별표 14건(등장 순 자동 번호 — ADR-0063), 오류 없음 — 시드 정본은 src/db/seed/alphaPlus.test.ts
    await expect(page.getByRole("heading", { name: /무배당 알파Plus보장보험2604 보통약관/ })).toBeVisible();
    await expect(page.getByText(/장해지급률이 80% 이상에 해당하는 장해상태가 되었을 때에는 보험수익자에게 최초1회에 한하여/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /^일반상해사망보장 특별약관/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /일반상해사망보장 추가 특별약관/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^별표 14건$/ })).toBeVisible();
    // 조립 검사 한 줄 + 「조립 검사 결과」 오류 패널 (기능/조립산출 §4.1)
    await expect(page.getByText(/^조립 검사: 오류 0 · /)).toBeVisible();
    await expect(page.getByRole("heading", { name: "조립 검사 결과" })).toBeVisible();
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

    // 내비 그룹 「기본정보」 = 메뉴 셋, 참조 순서(열거형 → 폼 → 구분자). 열거형은 제 화면 `/enums`.
    await page.goto("/enums");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("열거형");
    const basicsGroup = page.locator(".ts-nav-group", { has: page.locator(".ts-nav-group-title", { hasText: /^기본정보$/ }) });
    await expect(basicsGroup.getByRole("link")).toHaveText(["열거형", "폼", "구분자"]);
    await expect(basicsGroup.getByRole("link", { name: "열거형" })).toHaveAttribute("aria-current", "page");

    // L1 목록 — 필드 표 전폭, 경로 없음 (2026-09-27 두 칸 → 목록 + 상세). 제목은 메뉴 이름 「폼」.
    await page.goto("/master");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("폼");
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
    // 경로 첫 마디는 메뉴 이름 「폼」 — 폼 조회(/master)로 돌아간다 (기능/마스터 §4).
    await expect(page.locator('a.ts-crumb[href="/master"]')).toHaveText("폼");

    // 시드 상품의 세목 선택지 둘이 값 노드로 잡힌다 — 「입력 화면 →」가 선택지 좌표(?option=)를 싣는다.
    // (실물 재현 E2E 가 같은 DB 에 상품을 하나 더 만드므로 시드 상품 행만 센다.)
    const seedRows = page.locator("tbody tr", { hasText: /^알파Plus보장보험 › / });
    await expect(seedRows).toHaveCount(2);
    const enter = seedRows.getByRole("link", { name: "입력 화면 →" });
    const href = await enter.first().getAttribute("href");
    expect(href).toMatch(/^\/products\/[^?]+\?option=[^&]+&field=waiver\.applies$/);

    // 값 노드 링크 → 상품 기본정보의 보험종목 표에서 그 선택지 행의 그 필드 칸이 강조된다 (기능/마스터 §4.3 「입력 화면 →」).
    // 관리자 코드 칩은 담보 상세 값 폼에만 선다(기능/마스터 §3.5) — 세목 표 칸에는 칩이 없어 마스터로의 왕복은 여기서 보지 않는다.
    await enter.first().click();
    await expect(page).toHaveURL(/\/products\/.+\?option=.+&field=waiver\.applies/);
    const highlighted = page.locator("td.is-highlighted[data-path]");
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toHaveAttribute("data-path", "waiver.applies");
    await expect(highlighted).toBeInViewport();

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
