import { type Locator, type Page } from "@playwright/test";

import { pickCombo } from "./_lib/combo";
import { expect, test } from "./_lib/fixtures";

/**
 * 약관 에디터 툴바 · 공용조항 생성 (기능/문면 §4.3 · 기능/공용조항 §4.2, 2026-09-27).
 *
 * 1. 문면 저작 — 편집을 누르면 본문 위에 툴바가 선다. 툴바 「조」 · 「항」으로 쓰고, 「조건식」은 블록 조건이다(팝업 없음):
 *    커서만 있으면 그 항 뒤에 빈 조건 블록, 글을 고르면 그 선택이 걸친 항(여럿이면 여럿)을 감싸고 빈 IF 줄에 초점이 간다.
 *    변수 · 연산자 · 값을 머리 줄에서 고르고 저장 → 읽기 모드의 IF 한 줄.
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
      for (const name of ["조", "관", "항", "호", "목", "표", "글머리 목록", "슬롯", "조 참조", "별표 참조", "조건식", "문장 안 조건", "위로", "아래로", "복제", "삭제"]) await expect(tool(name)).toBeVisible();
      // 「박스」는 정적 마스터 박스를 고른다 (기능/박스 §4.4)
      await expect(tool("박스")).toBeVisible();
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

    await ev.action("툴바#5b", "Enter 로 둘째 항을 넣고 쓴다", async () => {
      const first = body.getByRole("textbox", { name: "항", exact: true });
      await first.press("End");
      await first.press("Enter");
      const second = body.getByRole("textbox", { name: "항", exact: true }).nth(1);
      await expect(second).toBeFocused();
      await second.fill("다만, 고의로 인한 경우에는 지급하지 않습니다.");
    });

    const paragraphs = body.getByRole("textbox", { name: "항", exact: true });

    await ev.action("툴바#6", "오른쪽 클릭 메뉴에는 조건 넣기(조건으로 감싸기 · 문장 안 조건)가 없다", async () => {
      await paragraphs.first().click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "치환 슬롯…" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "조건으로 감싸기…" })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "문장 안 조건…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    });

    await ev.action("툴바#7", "고른 글 없이 커서만 두고 「조건식」 — 팝업 없이 그 항 바로 뒤에 빈 조건 블록(빈 IF 줄 + 빈 항), 두 항은 제자리", async () => {
      await paragraphs.first().click();
      await paragraphs.first().press("End");
      await expect(toolbar).toContainText("자리 — ");
      await expect(tool("조건식")).toBeEnabled();
      await tool("조건식").click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      const head = body.locator("[data-cond-head]");
      await expect(head).toHaveCount(1);
      await expect(head.locator(".ts-cond-badge")).toHaveText("IF");
      await expect(head.getByRole("combobox", { name: "IF 1번 줄 변수" })).toBeFocused();
      const inside = body.locator(".ts-doc-cond").getByRole("textbox", { name: "항", exact: true });
      await expect(inside).toHaveCount(1);
      await expect(inside).toHaveText("");
      await expect(paragraphs).toHaveCount(3);
      await expect(paragraphs.nth(0)).toHaveText("회사는 피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.");
      await expect(paragraphs.nth(2)).toHaveText("다만, 고의로 인한 경우에는 지급하지 않습니다.");
    });

    await ev.action("툴바#7b", "빈 조건 블록을 🗑 로 지운다 — 확인 카드에서 삭제", async () => {
      await body.locator("[data-cond-head]").getByRole("button", { name: "조건 블록 삭제" }).click();
      await page.locator("dialog[open]").getByRole("button", { name: /삭제$/ }).click();
      await expect(body.locator("[data-cond-head]")).toHaveCount(0);
      await expect(paragraphs).toHaveCount(2);
    });

    await ev.action("툴바#7c", "첫 항 문장 일부만 드래그로 고르고 「조건식」 — 문장 안 조건이 아니라 그 항 전체가 조건 블록 안으로", async () => {
      await paragraphs.first().click();
      await paragraphs.first().press("Home");
      for (let i = 0; i < 3; i++) await paragraphs.first().press("Shift+ArrowRight");
      await tool("조건식").click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(body.locator("[data-cond-head]")).toHaveCount(1);
      await expect(body.locator(".ts-doc-cond").getByRole("textbox", { name: "항", exact: true })).toHaveText(["회사는 피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다."]);
      await expect(body.locator(".ts-doc-cond [data-chip]")).toHaveCount(0);
    });

    await ev.action("툴바#7d", "감쌌던 조건을 풀고, 두 항에 걸쳐 고른 뒤 「조건식」 — 두 항이 한 조건 블록의 한 가지에", async () => {
      await body.locator("[data-cond-head]").getByRole("button", { name: "풀기" }).click();
      await expect(body.locator("[data-cond-head]")).toHaveCount(0);
      // 문장 칸 둘에 걸친 선택 — 사람은 첫 항 앞 여백에서 둘째 항까지 끌어 고른다
      await page.evaluate(() => {
        const boxes = document.querySelectorAll<HTMLElement>('.ts-l3-body [role="textbox"][aria-label="항"]');
        const range = document.createRange();
        range.setStart(boxes[0].firstChild ?? boxes[0], 2);
        range.setEnd(boxes[1].firstChild ?? boxes[1], 3);
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.addRange(range);
      });
      await tool("조건식").click();
      await expect(body.locator("[data-cond-head]")).toHaveCount(1);
      await expect(body.locator(".ts-doc-cond").getByRole("textbox", { name: "항", exact: true })).toHaveCount(2);
    });

    await ev.action("툴바#8", "머리 줄에서 변수 · 연산자 · 값을 고른다 — 가지 조작이 켜지고, 저장 한 번 · 새로 읽으면 초록 상자 안 IF 한 줄", async () => {
      const head = body.locator("[data-cond-head]");
      // 시드 구분자는 원문 모델링이 쓰는 담보명(D0001, string) 하나뿐이다 — 값은 글자 칸 (알파플러스_모델명세 §2)
      await pickCombo(head.getByRole("combobox", { name: "IF 1번 줄 변수" }), { value: "D0001" });
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
      await expect(body.locator(".ts-doc-cond .ts-doc-paragraph")).toHaveCount(2);
      await expect(body.locator(".ts-doc-cond select")).toHaveCount(0);
    });

    await ev.action("툴바#9", "머리 줄을 셋으로 늘려 결합을 섞으면 왼쪽부터 묶이는 괄호가 보이고, 같게 바꾸면 사라진다 (기능/문면 §3.3)", async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const head = body.locator("[data-cond-head]");
      for (const [n, value] of [[2, "암"], [3, "수술비"]] as const) {
        await head.getByRole("button", { name: `IF ${n - 1}번 줄 뒤에 조건 줄 추가` }).click();
        await pickCombo(head.getByRole("combobox", { name: `IF ${n}번 줄 변수` }), { value: "D0001" });
        const input = head.getByRole("textbox", { name: `IF ${n}번 줄 값` });
        await input.fill(value);
        await input.press("Enter");
      }
      // 괄호가 있으면 모든 줄이 여는 자리(변수 앞) · 닫는 자리(값 뒤)를 갖는다 — 빈 글자일 수 있다
      const opens = head.locator(".ts-cond-paren-open");
      const closes = head.locator(".ts-cond-paren-close");
      // 모두 AND — 괄호 자리 없음
      await expect(head.locator(".ts-cond-paren")).toHaveCount(0);
      // A or B and C → ( A or B ) and C — 첫 줄 변수 앞 「(」, 둘째 줄 값 뒤 「)」
      await head.getByRole("combobox", { name: "IF 2번 줄 결합" }).selectOption("or");
      await expect(opens).toHaveText(["(", "", ""]);
      await expect(closes).toHaveText(["", ")", ""]);
      await expect(head.locator(".ts-cond-paren-open + .ts-cond-var")).toHaveCount(3);
      await expect(head.locator(".ts-cond-value + .ts-cond-paren-close")).toHaveCount(3);
      // 모두 OR 로 — 괄호가 사라진다
      await head.getByRole("combobox", { name: "IF 3번 줄 결합" }).selectOption("or");
      await expect(head.locator(".ts-cond-paren")).toHaveCount(0);
    });

    await ev.action("툴바#10", "조 참조 — 대상 둘을 고르고 연결어를 안 고르면 적용이 거부된다, 「또는」을 고르면 「제1항 또는 제2항」 (결정 14 · 기능/문면 §3.5)", async () => {
      const inside = body.locator(".ts-doc-cond").getByRole("textbox", { name: "항", exact: true });
      await inside.first().click();
      await inside.first().press("End");
      await tool("조 참조").click();
      const d = page.getByRole("dialog", { name: "조 참조 넣기" });
      await expect(d).toBeVisible();
      // 연결어는 기본값 없이 시작한다 — 대상이 하나 이하면 꺼져 있다
      await expect(d.getByRole("radio", { name: "및", exact: true })).toBeDisabled();
      await d.getByRole("button", { name: /펴기$/ }).first().click();
      const paragraphsInTree = d.getByRole("treeitem", { level: 2 });
      await paragraphsInTree.nth(0).getByRole("checkbox").check();
      await paragraphsInTree.nth(1).getByRole("checkbox").check();
      await expect(d.getByRole("radio", { name: "및", exact: true })).toBeEnabled();
      await expect(d.getByRole("radio", { name: "및", exact: true })).not.toBeChecked();
      await expect(d.getByRole("radio", { name: "또는", exact: true })).not.toBeChecked();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d.getByRole("alert")).toHaveText("대상이 둘 이상이면 연결어(및 · 또는)를 고른다.");
      await expect(d).toBeVisible();
      await d.getByRole("radio", { name: "또는", exact: true }).check();
      await d.getByRole("button", { name: "넣기", exact: true }).click();
      await expect(d).toHaveCount(0);
      await expect(body.locator(".ts-doc-cond [data-chip]")).toContainText(["제1항 또는 제2항"]);
      await submit(page, page.getByRole("button", { name: "저장", exact: true }));
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.reload();
      await expect(body.locator(".ts-doc-cond")).toContainText("제1항 또는 제2항");
    });
  },
);

test(
  "공용조항 생성 — 유형 · 이름 · 본문 · 옵션을 한 화면에서 쓰고 저장하면 상세와 목록에 선다",
  { annotation: { type: "좌표없음", description: "기능/공용조항 §4.2 생성 화면 (2026-09-27 재설계)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("공용조항생성#1", "관리자로 로그인한다", () => login(page));

    await ev.action("공용조항생성#2", "생성 화면(?type=inline)에 들어간다 — 이름 칸 · 유형 세 칸(문구 선택) · 본문 툴바 · 쓸 자리가 보인다", async () => {
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

    await ev.action("공용조항생성#6b", "항 문장을 고른 채 「조건식」 — 팝업 없이 항이 조건 블록 안에 서고, 머리 줄에서 조건을 고른다", async () => {
      const editor = page.locator(".ts-clause-editor");
      const paragraph = editor.getByRole("textbox", { name: "항", exact: true });
      await paragraph.click();
      await paragraph.press("Home");
      await paragraph.press("Shift+End");
      await tool("조건식").click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      const head = editor.locator("[data-cond-head]");
      await expect(head).toHaveCount(1);
      await expect(head.getByRole("combobox", { name: "IF 1번 줄 변수" })).toBeFocused();
      await pickCombo(head.getByRole("combobox", { name: "IF 1번 줄 변수" }), { value: "D0001" });
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

    await ev.action("공용조항생성#8", "공용조항 목록에서 이름으로 찾으면 새 공용조항이 있고, 누르면 그 상세로 간다", async () => {
      // 실물 공용조항이 133건이라 한 쪽(50건)에 다 안 선다 — 검색으로 좁힌다
      await page.goto(`/clauses?q=${encodeURIComponent(CLAUSE_NAME)}`);
      const link = page.getByRole("link", { name: CLAUSE_NAME, exact: true });
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(detailUrl);
    });
  },
);

test(
  "블록 끌어 옮기기 — 항 하나 · 고른 항 여럿 · 목차의 조",
  { annotation: { type: "좌표없음", description: "기능/문면 §4.3 「끌어 옮기기」 (2026-09-28)" } },
  async ({ page, ev }) => {
    test.setTimeout(120_000);
    await ev.action("끌기#1", "관리자로 로그인하고 보통약관 템플릿을 새로 만들어 편집에 들어간다", async () => {
      await login(page);
      await page.goto("/documents/new");
      await page.getByLabel("제목").fill("끌기검증 보통약관");
      await page.getByRole("button", { name: "생성" }).first().click();
      await page.waitForURL(/\/documents\/[0-9a-f-]+$/);
      await page.getByRole("button", { name: "편집", exact: true }).click();
    });

    const body = page.locator(".ts-l3-body");
    const toolbar = page.getByRole("toolbar", { name: "약관 편집 도구" });
    const tool = (name: string) => toolbar.getByRole("button", { name, exact: true });
    const paragraphs = body.getByRole("textbox", { name: "항", exact: true });
    const handle = (n: number) => body.getByRole("button", { name: `제${n}항 끌어 옮기기` });
    const block = (n: number) => body.locator(".ts-doc-paragraph").nth(n - 1);

    await ev.action("끌기#2", "조 하나에 항 넷(가 · 나 · 다 · 라)을 쓴다", async () => {
      await tool("조").click();
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("순서");
      await title.press("Enter");
      await tool("항").click();
      for (const [i, text] of ["가", "나", "다", "라"].entries()) {
        if (i > 0) await paragraphs.nth(i - 1).press("Enter");
        await paragraphs.nth(i).fill(text);
      }
      await expect(paragraphs).toHaveText(["가", "나", "다", "라"]);
    });

    await ev.action("끌기#3", "제4항 손잡이를 제1항 위쪽에 놓는다 — 맨 앞으로, 번호가 다시 매겨진다", async () => {
      await block(4).hover();
      await handle(4).dragTo(block(1), { targetPosition: { x: 40, y: 2 } });
      await expect(paragraphs).toHaveText(["라", "가", "나", "다"]);
    });

    await ev.action("끌기#4", "제1항 손잡이를 누르고 Shift+제2항 손잡이 — 두 항이 골리고, 하나를 끌어 맨 끝 항 아래에 놓으면 둘 다 간다", async () => {
      await block(1).hover();
      await handle(1).click();
      await block(2).hover();
      await handle(2).click({ modifiers: ["Shift"] });
      await expect(body.locator(".ts-doc-paragraph.is-block-sel")).toHaveCount(2);
      const last = block(4);
      const box = (await last.boundingBox())!;
      await handle(2).dragTo(last, { targetPosition: { x: 40, y: box.height - 2 } });
      await expect(paragraphs).toHaveText(["나", "다", "라", "가"]);
    });

    await ev.action("끌기#5", "고른 둘을 툴바 「위로」 — 한 칸 위로 함께", async () => {
      await expect(body.locator(".ts-doc-paragraph.is-block-sel")).toHaveCount(2);
      await tool("위로").click();
      await expect(paragraphs).toHaveText(["나", "라", "가", "다"]);
    });

    await ev.action("끌기#6", "목차 — 둘째 조를 만들고, 목차에서 제2조 줄을 제1조 줄 위에 놓으면 조 순서가 바뀐다", async () => {
      await body.getByRole("textbox", { name: "조 제목" }).click();
      await tool("조").click();
      await expect(body.getByRole("textbox", { name: "조 제목" })).toHaveText("새 조");
      const title = body.getByRole("textbox", { name: "조 제목" });
      await title.fill("둘째");
      await title.press("Enter");
      const toc = page.getByRole("navigation", { name: "관 · 조 목차" });
      await toc.getByRole("button", { name: "제2조(둘째)" }).dragTo(toc.getByRole("button", { name: "제1조(순서)" }), { targetPosition: { x: 20, y: 2 } });
      await expect(toc.getByRole("button", { name: /^제\d조/ })).toHaveText(["제1조(둘째)", "제2조(순서)"]);
      await expect(page.locator(".ts-error-banner")).toHaveCount(0);
    });

    await ev.action("끌기#7", "글머리 목록 — 항 뒤에 넣고 Enter 로 다음 항목, 빈 항목에서 Enter 면 목록이 끝나고 새 항", async () => {
      await body.getByRole("textbox", { name: "조 제목" }).click();
      await tool("항").click();
      await paragraphs.first().fill("다음과 같습니다.");
      await tool("글머리 목록").click();
      const bullets = body.getByRole("textbox", { name: "항목", exact: true });
      await expect(bullets.first()).toBeFocused();
      await bullets.first().fill("화상진단비보장");
      await bullets.first().press("Enter");
      await expect(bullets.nth(1)).toBeFocused();
      await bullets.nth(1).fill("화상수술비보장");
      await bullets.nth(1).press("End");
      await bullets.nth(1).press("Enter");
      await expect(bullets).toHaveCount(3);
      await bullets.nth(2).press("Enter");
      await expect(bullets).toHaveCount(2);
      await expect(paragraphs).toHaveCount(2);
      await expect(paragraphs.nth(1)).toBeFocused();
      await expect(body.locator(".ts-doc-bullets .ts-doc-bullet")).toHaveText(["화상진단비보장", "화상수술비보장"]);
      // 항 번호는 글머리 목록을 세지 않는다 — ① 다음 항은 ②
      await expect(body.locator(".ts-doc-paragraph .ts-doc-num").nth(1)).toHaveText("②");
      await expect(page.locator(".ts-error-banner")).toHaveCount(0);
    });
  },
);
