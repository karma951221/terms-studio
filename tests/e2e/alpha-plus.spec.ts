import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";
import { actualArticle, expectedArticles, type ArticleText } from "./_lib/terms";

/**
 * ★ 실물 재현 E2E (하이브리드) — 마스터 재료(구분자·담보·별표·보통약관·담보약관 문면)는 시드가 넣고,
 * 상품모델링은 화면으로 수행한 뒤 조립 미리보기를 원문과 조 단위로 대조한다.
 * 전제: golden 스냅샷(`scripts/e2e/prepare-db.ts`)이 실물 시드를 넣은 새 DB. 시드 상품과 이름이 다른 상품을 새로 만든다.
 * 근거: docs/QA/시나리오/실물재현_E2E_시나리오.md · docs/QA/실물재현/알파플러스_실물재현_설계.md
 *
 * 좌표: 이 두 테스트는 「실물재현_E2E_시나리오」에 대응하는데 그건 절차 문서라 좌표 체계 밖이다 (ADR 없음 — 설계 §3.3).
 * 그래서 `좌표없음` 으로 단다. 액션 좌표(`실물재현#1.N`)는 진단서에서 단계를 짚기 위한 이름일 뿐이다.
 */

/** golden 스냅샷 덕에 매 실행이 새 DB 다 — 유일 이름을 만들 필요가 없다. */
const PRODUCT_NAME = "알파Plus보장보험 E2E";
const DOC_TITLE = "E2E 보통약관";

const SPECIALS: [title: string, file: string][] = [
  ["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "골절(치아파절_제외)진단비Ⅱ보장.md"],
  ["일반상해80%이상후유장해 생활자금보장 특별약관", "일반상해80%이상후유장해_생활자금보장.md"],
  ["일반상해사망보장 특별약관", "일반상해사망보장.md"],
  ["일반상해사망보장 추가 특별약관", "일반상해사망보장_추가.md"],
];

/**
 * 같은 URL 로 돌아오는 서버 액션 제출 — `waitForURL` 은 즉시 풀리므로 POST 응답과 네트워크 정지를 기다린다.
 * 폼이 다시 그려진 뒤에 다음 조작을 해야 이전 제출과 겹치지 않는다.
 */
async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

/** 상세는 탭 셋 — 기본정보 · 상품담보 · 약관(기능/상품 §3.8, 2026-09-28) — 섹션을 만지기 전에 그 탭을 먼저 연다. 약관은 보통약관 작성으로 열린다. */
async function openTab(page: Page, name: "기본정보" | "상품담보" | "약관"): Promise<void> {
  await page.getByRole("navigation", { name: "상품 하위 탭" }).getByRole("link", { name, exact: true }).click();
  await page.waitForLoadState("networkidle");
}

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 미리보기 문서(article.ts-doc) 안의 조들을 (제목, 정규화 본문)으로. */
async function articlesOf(doc: Locator): Promise<ArticleText[]> {
  const sections = doc.locator("section.ts-doc-article");
  const n = await sections.count();
  const out: ArticleText[] = [];
  for (let i = 0; i < n; i++) {
    const heading = await sections.nth(i).locator("h3").first().innerText();
    const text = await sections.nth(i).innerText();
    out.push(actualArticle(heading, text));
  }
  return out;
}

function firstMismatch(expected: ArticleText[], actual: ArticleText[]): string {
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
    const e = expected[i];
    const a = actual[i];
    if (!e || !a || e.title !== a.title || e.text !== a.text) {
      const et = e?.text ?? "";
      const at = a?.text ?? "";
      let k = 0;
      while (k < et.length && k < at.length && et[k] === at[k]) k++;
      return `조 #${i + 1} (${e?.title} / ${a?.title}) — ${k}번째 글자부터 다름\n  기대: …${et.slice(Math.max(0, k - 40), k + 80)}\n  실제: …${at.slice(Math.max(0, k - 40), k + 80)}`;
    }
  }
  return "";
}

test.describe.serial("★ 실물 재현 — 상품모델링을 화면으로 수행하고 조립 결과를 원문과 대조한다", () => {
  test(
    "상품 생성 → 보통약관 → 세목 → 탑재(기본계약 1 + 특약 4) → 그룹 → 미리보기 대조",
    { annotation: { type: "좌표없음", description: "실물재현_E2E_시나리오 — 절차 문서라 좌표 체계 밖" } },
    async ({ page, ev }) => {
      test.setTimeout(180_000);
      await ev.action("실물재현#1.1", "관리자로 로그인한다", () => login(page));

      const productUrl = await ev.action("실물재현#1.2", "상품을 만든다", async () => {
        await page.goto("/products/new");
        await page.getByLabel("상품명").fill(PRODUCT_NAME);
        await page.getByRole("button", { name: "생성" }).click();
        await page.waitForURL(/\/products\/[0-9a-f-]+$/);
        return page.url();
      });

      await ev.action("실물재현#1.3", "보통약관 템플릿을 고른다 — 약관 › 보통약관 작성", async () => {
        await openTab(page, "약관");
        await pickCombo(page.getByRole("combobox", { name: "보통약관 템플릿" }), { label: "무배당 알파Plus보장보험2604 보통약관" });
        await submit(page, page.getByRole("button", { name: "템플릿 저장" }));
      });

      await ev.action("실물재현#1.4", "세목 선택지 3건을 만든다 — 종 축: 1종 적용여부 아니오 · 2종 예 + 사유(암·면책 · 질병 8 · 상해및질병80%), 형 축: 1형 해약환급금 지급형 — 기본정보 탭", async () => {
        await openTab(page, "기본정보");
        await page.getByRole("button", { name: "편집", exact: true }).click();
        // 보통약관의 납입면제 세 조는 「납입면제 있음」 IF · 납입면제종마다 반복 · 사유마다 호로 모델링돼 있다 — 사유가 원문 호 11개를 낸다
        for (const [number, name, reasons] of [
          [1, "보험료 납입면제 미적용형", undefined],
          [2, "보험료 납입면제형", ["암(유사암제외)·면책", "뇌졸중", "급성심근경색증", "말기폐질환", "말기간경화", "말기신부전증", "양성뇌종양", "중대한재생불량성빈혈", "만성당뇨합병증", "상해및질병80%이상후유장해"]],
        ] as const) {
          await page.getByRole("button", { name: "보험종목 추가" }).click();
          const option = page.locator("#definitions-panel tbody tr").nth(number - 1);
          await option.getByLabel("번호", { exact: true }).fill(String(number));
          await option.getByLabel("보험종목명", { exact: true }).fill(name);
          await option.getByLabel("세목유형").selectOption("waiver");
          await option.getByRole("radio", { name: reasons ? "예" : "아니오", exact: true }).check();
          for (const reason of reasons ?? []) await option.getByRole("checkbox", { name: reason, exact: true }).check();
        }
        // 형 축 — 해약환급금 지급형. 제27조의1 ④ 「1형(해약환급금 지급형)의 경우 …」는 상품에 해약환급금 지급형이 있을 때만 선다(최종 결정 24)
        await page.getByRole("button", { name: "보험종목 추가" }).click();
        const form = page.locator("#definitions-panel tbody tr").nth(2);
        await form.getByLabel("종·형 구분").selectOption("form");
        await form.getByLabel("번호", { exact: true }).fill("1");
        await form.getByLabel("보험종목명", { exact: true }).fill("해약환급금 지급형");
        await form.getByLabel("세목유형").selectOption("no_surrender");
        await form.locator('[data-path="no_surrender.type"]').last().locator("select").selectOption("V01");
      });

      await ev.action("실물재현#1.5", "유효 조합 2건을 선택하고 기본정보를 한 번에 저장한다", async () => {
        await page.getByRole("tab", { name: "종·형 조합" }).click();
        for (const label of [/제1종.*제1형.* 사용$/, /제2종.*제1형.* 사용$/]) await page.getByRole("checkbox", { name: label }).check();
        await page.getByRole("button", { name: "저장", exact: true }).click();
        await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
        await expect(page.locator("#combinations-panel tbody tr")).toHaveCount(2);
      });

      // 탑재 — 기본계약 섹션 1 + 특약 섹션 4 (같은 담보 2벌은 부가유형으로 구별)
      const mount = async (step: number, section: "기본계약" | "특별약관", coverage: string, addon?: "기본" | "추가") =>
        ev.action(`실물재현#1.${step}`, `${section}에 ${coverage}${addon ? `(${addon})` : ""} 를 탑재한다`, async () => {
          // 기본계약 · 특약 두 절 모두 상품담보 탭에 산다 (기능/상품 §3.8, 2026-09-28)
          await page.goto(`${productUrl}?tab=coverages`);
          const form = page.locator("form", { has: page.getByRole("button", { name: `${section}에 탑재` }) });
          await pickCombo(form.getByRole("combobox", { name: "담보", exact: true }), { label: coverage });
          if (addon) await form.getByLabel("부가유형").selectOption({ label: addon });
          await submit(page, form.getByRole("button", { name: `${section}에 탑재` }));
          // 탑재는 새 상품담보의 값 화면으로 간다 — 다음 단계가 제 탭을 다시 연다
          await page.waitForURL(/\/coverages\/[0-9a-f-]+$/);
        });
      await mount(7, "기본계약", "일반상해80%이상후유장해");
      await mount(8, "특별약관", "일반상해사망보장", "기본");
      await mount(9, "특별약관", "일반상해사망보장", "추가");
      await mount(10, "특별약관", "일반상해80%이상후유장해 생활자금보장");
      await mount(11, "특별약관", "골절(치아파절 제외)진단비Ⅱ보장");
      // 기본계약 섹션에 탑재하면 곧 기본계약 지정이다 — 담보명 값은 스냅샷으로 복사돼 있다
      // 탑재 표는 상품담보 한 건 = 한 행 · 개수는 페이저 「총 N건」 (기능/상품 §4.6)
      await page.goto(`${productUrl}?tab=coverages`);
      await expect(page.getByRole("region", { name: "보통약관 기본계약", exact: true }).locator("tbody tr")).toHaveCount(1);
      await expect(page.getByRole("region", { name: "특별약관", exact: true }).locator("tbody tr")).toHaveCount(4);

      await ev.action("실물재현#1.12", "특약 그룹을 만든다 — 상품담보 탭", async () => {
        // 그룹 제목은 입력칸 값이라 hasText 로는 못 찾는다: 배치 버튼의 접근성 이름으로 폼을 잡는다
        await page.getByLabel("새 그룹 제목").fill("상해 관련 특별약관");
        await submit(page, page.getByRole("button", { name: "그룹 추가" }));
      });

      const 특약들 = ["일반상해사망보장", "일반상해사망보장 추가", "일반상해80%이상후유장해 생활자금보장", "골절(치아파절 제외)진단비Ⅱ보장"];
      for (const [i, name] of 특약들.entries()) {
        await ev.action(`실물재현#1.${13 + i}`, `${name} 을 그룹에 배치한다`, async () => {
          const place = page.getByRole("button", { name: "배치 · 상해 관련 특별약관 에" });
          await pickCombo(page.locator("form", { has: place }).getByRole("combobox"), { label: name });
          await submit(page, place);
        });
      }
      // 기본계약은 특약 벌로 찍히지 않으므로 배치하지 않는다 — 미배치에 기본계약 하나만 남는다
      await expect(page.getByText(/^미배치 상품담보: 일반상해80%이상후유장해$/)).toBeVisible();

      await ev.action("실물재현#1.17", "조립 미리보기를 연다 — 완성본이어야 한다 · 별표는 참조된 것만 등장 순으로 (ADR-0063)", async () => {
        // 미리보기는 헤더 [더보기 ▾] 메뉴 항목이다 (기능/상품 §4)
        await page.getByRole("button", { name: "더보기", exact: true }).click();
        await page.getByRole("menuitem", { name: "미리보기", exact: true }).click();
        await expect(page).toHaveURL(/\/products\/.+\/preview/);
        // 저장본이 없으면 「실행」을 눌러 조립해 저장한다 → 조립 검사 한 줄 + 「조립 검사 결과」 패널 (기능/조립산출 §4.1)
        await page.getByRole("button", { name: "실행", exact: true }).click();
        await expect(page.getByRole("heading", { name: "조립 검사 결과" })).toBeVisible();
        await expect(page.getByText(/^조립 검사: 오류 0 · /)).toBeVisible();
        await expect(page.getByText("오류 없음.")).toBeVisible();
        await expect(page.getByText(/완성본 아님/)).toHaveCount(0);
        // 별표 마스터 21건 중 이 책자의 문면이 참조한 것만 실린다 · 1번은 보통약관에서 처음 만나는 장해분류표
        await expect(page.getByRole("heading", { name: /^별표 10건$/ })).toBeVisible();
        const appendixList = page.locator("h2", { hasText: /별표 \d+건/ }).locator("xpath=following-sibling::ul[1]");
        await expect(appendixList.getByRole("listitem")).toHaveCount(10);
        await expect(appendixList.getByRole("listitem").first()).toHaveText("【별표1(장해분류표)】");
      });

      await ev.action("실물재현#1.18", "보통약관을 원문과 조 단위로 대조한다 (관 7 · 조 52)", async () => {
        const general = page.locator("article.ts-doc").first();
        await expect(general.locator(".ts-doc-section")).toHaveCount(7);
        const generalActual = await articlesOf(general);
        const generalExpected = expectedArticles("보통약관.md");
        expect(generalActual.length, "보통약관 조 수").toBe(generalExpected.length);
        expect(firstMismatch(generalExpected, generalActual), "보통약관 첫 불일치").toBe("");
      });

      for (const [i, [title, file]] of SPECIALS.entries()) {
        await ev.action(`실물재현#1.${19 + i}`, `${title} 을 원문과 대조한다`, async () => {
          const doc = page.locator("article.ts-doc", { has: page.getByRole("heading", { name: title, exact: true }) });
          await expect(doc, title).toHaveCount(1);
          const actual = await articlesOf(doc);
          const expected = expectedArticles(file);
          expect(actual.length, `${title} 조 수`).toBe(expected.length);
          expect(firstMismatch(expected, actual), `${title} 첫 불일치`).toBe("");
        });
      }
    },
  );

  test(
    "문면 편집기 — 관 안에 제1조(목적)를 화면으로 작성하면 원문 제1조와 같게 렌더된다",
    { annotation: { type: "좌표없음", description: "실물재현_E2E_시나리오 — 절차 문서라 좌표 체계 밖" } },
    async ({ page, ev }) => {
      test.setTimeout(120_000);
      await ev.action("실물재현#2.1", "관리자로 로그인한다", () => login(page));

      const docUrl = await ev.action("실물재현#2.2", "보통약관 문서를 만든다", async () => {
        await page.goto("/documents/new"); // 생성은 제 화면으로 빠졌다 (main 63385fa)
        await page.getByLabel("제목").fill(DOC_TITLE);
        await page.getByRole("button", { name: "생성" }).first().click();
        await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
        return page.url();
      });

      // 편집 → 그 자리 편집 · 오른쪽 클릭 → 저장 (ADR-0074 · 기능/문면 §4.3). 고친 것은 편집본에만 들어가고 서버로 가지 않는다.
      const body = page.locator(".ts-l3-body");
      const menu = async (target: ReturnType<typeof page.locator>, item: string) => {
        await target.click({ button: "right" });
        await page.getByRole("menuitem", { name: item, exact: true }).click();
      };

      await ev.action("실물재현#2.3", "편집을 누르고 빈 본문을 오른쪽 클릭해 관을 넣는다 — 관은 첫 조 하나를 품고 온다", async () => {
        await page.getByRole("button", { name: "편집", exact: true }).click();
        await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
        await menu(body.locator("[data-doc-empty]"), "관 추가");
        const title = body.getByRole("textbox", { name: "관 제목" });
        await title.fill("목적 및 용어의 정의");
        await title.press("Enter");
        await expect(page.getByRole("heading", { name: "제1관 목적 및 용어의 정의" })).toBeVisible();
      });
      await ev.action("실물재현#2.4", "관 안 조의 제목을 그 자리에서 고친다", async () => {
        const title = body.getByRole("textbox", { name: "조 제목" });
        await title.fill("목적");
        await title.press("Enter");
        await expect(page.getByRole("heading", { name: "제1조(목적)" })).toBeVisible();
        await expect(page.locator(".ts-l3-toc")).toContainText("제1관 목적 및 용어의 정의");
      });
      await ev.action("실물재현#2.5", "조 제목을 오른쪽 클릭해 항을 넣는다 — 커서가 새 항으로 간다", async () => {
        await menu(page.getByRole("heading", { name: "제1조(목적)" }), "항 추가");
        await expect(body.getByRole("textbox", { name: "항", exact: true })).toBeFocused();
      });
      await ev.action("실물재현#2.6", "항에 본문을 그 자리에서 쓴다", async () => {
        const paragraph = body.getByRole("textbox", { name: "항", exact: true });
        await paragraph.fill(
          "이 보험계약(이하 「계약」이라 합니다)은 보험계약자(이하 「계약자」라 합니다)와 보험회사(이하 「회사」라 합니다) 사이에 피보험자의 상해에 대한 위험을 보장하기 위하여 체결됩니다.",
        );
        await paragraph.press("Tab");
      });

      await ev.action("실물재현#2.6a", "저장 한 번으로 반영하고 읽기 모드로 돌아온다", async () => {
        await submit(page, page.getByRole("button", { name: "저장", exact: true }));
        await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      });

      await ev.action("실물재현#2.7", "읽기 모드에서 원문 제1조와 같게 렌더되는지 본다", async () => {
        // 관 제목 · 조 제목 · 단항이라 마커 없음 · 본문이 원문 제1조와 같다
        await page.goto(docUrl);
        await expect(page.getByRole("heading", { name: "제1관 목적 및 용어의 정의" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "제1조(목적)" })).toBeVisible();
        const article = page.locator("section.ts-doc-article").first();
        await expect(article.locator(".ts-doc-num")).toHaveCount(0);
        const actual = actualArticle(await article.locator("h3").innerText(), await article.innerText());
        const expected = expectedArticles("보통약관.md")[0];
        expect(actual).toEqual(expected);
      });
    },
  );
});
