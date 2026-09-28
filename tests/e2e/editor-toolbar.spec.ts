import { type Locator, type Page } from "@playwright/test";

import { expect, test } from "./_lib/fixtures";

/**
 * 약관 에디터 툴바 · 공용조항 생성 (기능/문면 §4.3 · 기능/공용조항 §4.2, 2026-09-27).
 *
 * 1. 문면 저작 — 편집을 누르면 본문 위에 툴바가 선다. 툴바 「조」 · 「항」으로 쓰고, 항을 고른 채 「조건식」을 누르면
 *    팝업 없이 그 항이 조건 블록 안에 서고 빈 IF 줄에 초점이 간다. 변수 · 연산자 · 값을 머리 줄에서 고르고 저장 → 읽기 모드의 IF 한 줄.
 *    오른쪽 클릭 메뉴에는 조건 넣기가 없다. (기능/문면 §4.3 · §6.2 「조건식 = 블록 삽입 + 머리 줄 인라인 편집」, 2026-09-28)
 * 2. 공용조항 생성 — `/clauses/new` 에서 유형(항) · 공용조항명 · 본문 · 옵션을 쓰고 툴바로 옵션 자리를 넣고, 「조건식」으로 그 항을
 *    조건 블록으로 감싸 머리 줄을 채운 뒤 저장 한 번 → 상세(읽기 모드 IF 줄) · 목록.
 * 시드 문서 · 공용조항은 건드리지 않는다 — 새로 만든 것만 쓴다.
 */

const DOC_TITLE = "툴바검증 보통약관";
const CLAUSE_NAME = "툴바검증 지급제한";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: /admin/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 같은 URL 로 돌아오는 서버 액션 제출 — POST 응답과 네트워크 정지를 기다린다. */
async function submit(page: Page, button: Locator): Promise<void> {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
  await page.waitForLoadState("networkidle");
}

test(
  "문면 편집기 툴바 — 조 · 항을 넣고, 항을 골라 「조건식」을 누르면 조건 블록이 선다",
  { annotation: { type: "좌표없음", description: "기능/문면 §4.3 툴바 · §6.2 「조건 삽입은 툴바 조건식 버튼」" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("툴바#1", "관리자로 로그인한다", () => login(page));

    await ev.action("툴바#2", "보통약관 템플릿을 새로 만든다", async () => {
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill(DOC_TITLE);
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
    });

    const body = page.locator(".ts-l3-body");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });

    await ev.action("툴바#3", "읽기 모드에는 툴바가 없고, 편집을 누르면 본문 위에 선다", async () => {
      await expect(toolbar).toHaveCount(0);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
      await expect(toolbar).toBeVisible();
      for (const name of ["조", "관", "항", "호", "목", "표", "박스", "슬롯", "조 참조", "별표 참조", "조건식", "위로", "아래로", "복제", "삭제"]) await expect(tool(name)).toBeVisible();
    });

    await ev.action("툴바#4", "툴바 「조」로 첫 조를 넣고 제목을 쓴다", async () => {
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("보험금의 지급사유");
      await title.press("Enter");
      await expect(page.getByRole("heading", { name: "제1조(보험금의 지급사유)" })).toBeVisible();
    });

    await ev.action("툴바#5", "툴바 「항」으로 항을 넣고 문장을 쓴다 — 커서가 새 항으로 간다", async () => {
      await tool("항").click();
      const paragraph = body.getByRole("textbox", { name: "항", exact: true });
      await expect(paragraph).toBeFocused();
      await paragraph.fill("회사는 피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.");
    });

    await ev.action("툴바#6", "오른쪽 클릭 메뉴에는 조건 넣기(조건으로 감싸기 · 문장 안 조건)가 없다", async () => {
      await body.getByRole("textbox", { name: "항", exact: true }).click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "치환 슬롯…" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "조건으로 감싸기…" })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "문장 안 조건…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    });

    await ev.action("툴바#7", "항을 고른 채 「조건식」 — 팝업 없이 항이 조건 블록 안에 서고, 빈 IF 줄 첫 칸에 초점이 간다", async () => {
      await body.getByRole("textbox", { name: "항", exact: true }).click();
      await expect(toolbar).toContainText("자리 — ");
      await expect(tool("조건식")).toBeEnabled();
      await tool("조건식").click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      const head = body.locator("[data-cond-head]");
      await expect(head).toHaveCount(1);
      await expect(head.locator(".ts-cond-badge")).toHaveText("IF");
      await expect(head.getByRole("combobox", { name: "IF 1번 줄 변수" })).toBeFocused();
      await expect(body.getByRole("textbox", { name: "항", exact: true })).toHaveText("회사는 피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.");
    });

    await ev.action("툴바#8", "머리 줄에서 변수 · 연산자 · 값을 고른다 — 가지 조작이 켜지고, 저장 한 번 · 새로 읽으면 초록 상자 안 IF 한 줄", async () => {
      const head = body.locator("[data-cond-head]");
      // 시드 구분자는 원문 모델링이 쓰는 담보명(D0001, string) 하나뿐이다 — 값은 글자 칸 (알파플러스_모델명세 §2)
      await head.getByRole("combobox", { name: "IF 1번 줄 변수" }).selectOption("D0001");
      await expect(head.getByRole("combobox", { name: "IF 1번 줄 연산자" })).toHaveValue("=");
      const value = head.getByRole("textbox", { name: "IF 1번 줄 값" });
      await value.fill("사망보험금");
      await value.press("Enter");
      await expect(tool("ELSE")).toBeEnabled();
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.reload();
      // 읽기 모드의 조건 머리는 입력칸이 아니라 글자 한 줄이다 (data-cond-head 는 편집 모드에만)
      await expect(body.locator("[data-cond-head]")).toHaveCount(0);
      await expect(body.locator(".ts-doc-cond .ts-doc-cond-head")).toHaveCount(1);
      await expect(body.locator(".ts-doc-cond .ts-doc-cond-head")).toContainText("IF");
      await expect(body.locator(".ts-doc-cond .ts-doc-cond-head")).toContainText("사망보험금");
      await expect(body.locator(".ts-doc-cond select")).toHaveCount(0);
    });
  },
);

test(
  "공용조항 생성 — 유형 · 이름 · 본문 · 옵션을 한 화면에서 쓰고 저장하면 상세와 목록에 선다",
  { annotation: { type: "좌표없음", description: "기능/공용조항 §4.2 생성 화면 (2026-09-27 재설계)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("공용조항생성#1", "관리자로 로그인한다", () => login(page));

    await ev.action("공용조항생성#2", "생성 화면(?type=inline)에 들어간다 — 이름 칸 · 유형 두 칸(문구 선택) · 본문 툴바 · 쓸 자리가 보인다", async () => {
      await page.goto("/clauses/new?type=inline");
      await expect(page.getByLabel("공용조항명")).toBeVisible();
      await expect(page.getByRole("radio", { name: /^문구/ })).toBeChecked();
      await expect(page.getByRole("toolbar", { name: "약관 편집 도구" })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "문구", exact: true })).toBeVisible();
    });

    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });

    await ev.action("공용조항생성#3", "본문을 쓰기 전이라 유형을 「항」으로 바꿀 수 있다 — 빈 항 하나가 쓸 자리로 선다", async () => {
      await page.getByRole("radio", { name: /^항/ }).check();
      await expect(page.getByRole("radio", { name: /^항/ })).toBeChecked();
      await expect(page.locator(".ts-clause-editor").getByRole("textbox", { name: "항", exact: true })).toHaveCount(1);
    });

    await ev.action("공용조항생성#4", "공용조항명과 항 문장을 쓴다 — 쓰기 시작하면 유형이 잠긴다", async () => {
      await page.getByLabel("공용조항명").fill(CLAUSE_NAME);
      const paragraph = page.locator(".ts-clause-editor").getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.fill("다음의 경우에는 보험금을 지급하지 않습니다. 사유: ");
      await paragraph.press("Tab");
      await expect(page.getByRole("radio", { name: /^문구/ })).toBeDisabled();
    });

    await ev.action("공용조항생성#5", "「옵션 추가」 — 빈 선택지 둘을 품은 옵션이 선다, 이름 · 선택지를 채운다", async () => {
      await page.getByRole("button", { name: "옵션 추가" }).click();
      await page.getByLabel("옵션명").fill("제한 사유");
      await page.getByRole("textbox", { name: "제한 사유 — 선택지 1 이름" }).fill("고의");
      await page.getByRole("textbox", { name: "제한 사유 — 선택지 1 문구" }).fill("피보험자가 고의로 자신을 해친 경우");
      await page.getByRole("textbox", { name: "제한 사유 — 선택지 2 이름" }).fill("전쟁");
      await page.getByRole("textbox", { name: "제한 사유 — 선택지 2 문구" }).fill("전쟁 · 외국의 무력행사로 생긴 경우");
    });

    await ev.action("공용조항생성#6", "항 문장 끝에 커서를 두고 툴바 「옵션 자리」 — 〔제한 사유〕 칩이 선다", async () => {
      const paragraph = page.locator(".ts-clause-editor").getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.press("End");
      await tool("옵션 자리").click();
      await expect(page.locator(".ts-clause-editor")).toContainText("〔제한 사유〕");
    });

    await ev.action("공용조항생성#6b", "항을 고른 채 「조건식」 — 팝업 없이 항이 조건 블록 안에 서고, 머리 줄에서 조건을 고른다", async () => {
      const editor = page.locator(".ts-clause-editor");
      await editor.getByRole("textbox", { name: "항", exact: true }).click();
      await tool("조건식").click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      const head = editor.locator("[data-cond-head]");
      await expect(head).toHaveCount(1);
      await expect(head.getByRole("combobox", { name: "IF 1번 줄 변수" })).toBeFocused();
      await head.getByRole("combobox", { name: "IF 1번 줄 변수" }).selectOption("D0001");
      const value = head.getByRole("textbox", { name: "IF 1번 줄 값" });
      await value.fill("사망보험금");
      await value.press("Enter");
      await expect(editor.locator(".ts-doc-cond")).toContainText("〔제한 사유〕");
    });

    const detailUrl = await ev.action("공용조항생성#7", "저장 한 번 — 만들어지고 상세(읽기)로 간다 · 조건 블록은 IF 한 줄", async () => {
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.waitForURL(/\/clauses\/C\d+$/);
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.locator(".ts-l3-bar")).toContainText(CLAUSE_NAME);
      await expect(page.locator(".ts-clause-editor")).toContainText("다음의 경우에는 보험금을 지급하지 않습니다.");
      await expect(page.locator(".ts-clause-options")).toContainText("〔제한 사유〕");
      await expect(page.locator(".ts-clause-editor .ts-doc-cond .ts-doc-cond-head")).toContainText("IF");
      await expect(page.locator(".ts-clause-editor [data-cond-head]")).toHaveCount(0);
      return page.url();
    });

    await ev.action("공용조항생성#8", "공용조항 목록에 새 공용조항이 있고, 누르면 그 상세로 간다", async () => {
      await page.goto("/clauses");
      const link = page.getByRole("link", { name: CLAUSE_NAME, exact: true });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(detailUrl);
    });
  },
);
