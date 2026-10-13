import { withCodes, type DocumentNode } from "../../../src/domain/document";
import { pickCombo } from "../_lib/combo";
import { expect, test } from "../_lib/fixtures";
import { NO_COORD, arrive, login, open, saveEdit } from "./_lib/app";
import { ClauseAuthoringDriver, DocumentAuthoring } from "./_lib/driver";
import { ALL_GENERAL_ANCESTORS, HUMAN_CLAUSE_CODE, SEED, generalAncestors, generalTreeOf, outlinePaths } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ③b 사람처럼 넣는 담보 — 알파Plus2607 질병 특약 「말기신부전증진단비보장」 (QA/실물재현/알파플러스2607_모델명세 §6).
 * 시드 JSON 을 따라 치지 않는다 — 원문(tests/fixtures/terms/알파2607/말기신부전증진단비보장.md)을 보고 사람이 하듯 이 파일에 적은 글을,
 * 홈의 메뉴에서 들어가 담보 → 함수조항 → 담보약관 템플릿 순으로 화면만으로 넣는다(시드 · API 지름길 없음). 상품 탑재 · 원문 대조는 06-human.
 * 담보 · 함수조항은 시드 코드의 맨 뒤(COV000023 · C0071)라 ②③ 이 다 친 뒤 여기서 만들어도 같은 코드가 나온다 — 다른 질병 템플릿(④)이 이 함수조항을 쓰므로 ④ 앞.
 * 근거: docs/QA/시나리오/실물재현_E2E_시나리오.md §4 ④ · §9
 */

const NAME = "말기신부전증진단비보장";
const CLAIM = "말기신부전증진단비";
const GENERAL_2607 = "alpha2607-general";
/** 쓰는 함수조항 — 이름으로 고른다(코드는 시스템 채번). */
const clauseCode = (label: string) => SEED.clauses.find((c) => c.label === label)!.code;
const THIRD_PARTY = clauseCode("보험금 지급에 관한 세부규정(제3자 합의)");
const LAPSE = clauseCode("특별약관의 소멸(지급사유 발생)");

/** 메뉴 내비의 항목으로 들어간다 — 사람이 왼쪽 메뉴를 누르듯. */
async function menu(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.locator("nav").getByRole("link", { name: label, exact: true }).first().click();
  await page.waitForLoadState("networkidle");
}

test.describe.serial("실물 재현(화면) ③b 사람처럼 — 말기신부전증진단비보장", () => {
  test("담보 — 메뉴 「담보」 → + → 담보명 · 세부보장 · 급부 → 생성 → 편집: 보험금명 · 특약 그룹(질병) → 저장", NO_COORD, async ({ page, ev }) => {
    await ev.action("실물사람#1.1", "관리자로 로그인하고 홈에서 메뉴 「담보」로 들어간다", async () => {
      await login(page);
      await open(page, "/");
      await menu(page, "담보");
      await expect(page).toHaveURL(/\/coverages/);
    });
    await ev.action("실물사람#1.2", `「+」 — 담보명 「${NAME}」 · 세부보장명 · 급부명 「${CLAIM}」 → 생성`, async () => {
      await page.getByRole("link", { name: "새 담보", exact: true }).click();
      await arrive(page, /\/coverages\/new/);
      await page.getByLabel("담보명").fill(NAME);
      await page.getByLabel("세부보장명").fill(NAME);
      await page.getByLabel("급부명").fill(CLAIM);
      await page.getByRole("button", { name: "생성", exact: true }).click();
      await arrive(page, /\/coverages\/[0-9a-f-]{36}$/);
      await expect(page.locator(".ts-count code").first()).toHaveText("COV000023");
    });
    await ev.action("실물사람#1.3", `편집 — 보험금명 「${CLAIM}」 · 특약 그룹 「질병 관련 특별약관」 → 저장`, async () => {
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.locator(`section.ts-cov-card[data-level='coverage'] input[name="coverage_basic.claim_name"]`).fill(CLAIM);
      await page.getByRole("combobox", { name: "특약 그룹", exact: true }).selectOption({ label: "질병 관련 특별약관" });
      await saveEdit(page);
      await page.reload();
      await expect(page.locator(`input[name="coverage_basic.claim_name"]`)).toHaveValue(CLAIM);
      await expect(page.locator('[data-path="specialGroup"] .ts-form-control')).toHaveText("질병 관련 특별약관");
    });
  });

  test("함수조항 「준용규정(알파Plus 질병)」 — 메뉴 「함수조항」 → + › 항 → 이름 · 인자 · 본문(보통약관 조 참조 · 문장 안 조건) → 저장", NO_COORD, async ({ page, ev }) => {
    test.setTimeout(180_000);
    const driver = new ClauseAuthoringDriver(page, ALL_GENERAL_ANCESTORS);
    await ev.action("실물사람#2.1", "메뉴 「함수조항」 → 「+」 → 유형 「항」", async () => {
      await login(page);
      await open(page, "/");
      await menu(page, "함수조항");
      await page.getByRole("button", { name: "새 함수조항", exact: true }).click();
      await page.getByRole("menuitem", { name: /^항/ }).first().click();
      await arrive(page, /\/functions\/new\?type=block/);
      await expect(page.getByRole("radio", { name: /^항/ })).toBeChecked();
      await page.getByLabel("함수조항명").fill("준용규정(알파Plus 질병)");
    });
    await ev.action("실물사람#2.2", "인자 「납입면제_있음」(참거짓 · 기본 연결 D0002 납입면제 있음) — 1종 가입 시 제외 문장을 가른다", () =>
      driver.params([{ name: "납입면제_있음", type: { kind: "boolean" }, default: { kind: "discriminator", code: "D0002" } }]),
    );
    await ev.action("실물사람#2.3", "본문 — 「… 다만, 보통약관 제5조 · 제9조 · 제10조 및 제38조」 + 문장 안 조건(납입면제 있음이면 1종 가입 시 납입면제 두 조도 제외)", () =>
      driver.body("block", [
        {
          id: "p",
          kind: "paragraph",
          children: [
            { id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다. 다만, " },
            { id: "r1", kind: "articleRef", targets: [{ articleId: "g-a5" }, { articleId: "g-a9" }, { articleId: "g-a10" }, { articleId: "g-a38" }], connector: "및", scope: "general" },
            {
              id: "c",
              kind: "inlineCond",
              branches: [
                {
                  id: "c1",
                  when: "arg.납입면제_있음 = true",
                  children: [
                    { id: "t2", kind: "text", text: "은 제외하며, 보통약관 1종(보험료 납입면제 미적용형)으로 가입한 경우 " },
                    { id: "r2", kind: "articleRef", targets: [{ articleId: "g-a27_1" }, { articleId: "g-a27_2" }], connector: "및", scope: "general" },
                    { id: "t3", kind: "text", text: "도 제외합니다." },
                  ],
                },
                { id: "c2", children: [{ id: "t4", kind: "text", text: "은 제외합니다." }] },
              ],
            },
          ],
        },
      ] as never),
    );
    await ev.action("실물사람#2.4", `저장 — ${HUMAN_CLAUSE_CODE} 로 만들어진다(맨 뒤 코드)`, () => driver.save(HUMAN_CLAUSE_CODE));
  });

  test("담보약관 템플릿 — 메뉴 「담보약관 템플릿」 → + → 담보 고르기 → 편집 · 대응 보통약관(2607) → 조 다섯 → 저장", NO_COORD, async ({ page, ev }) => {
    test.setTimeout(600_000);
    const general = generalTreeOf(GENERAL_2607);
    const a = (n: number) => `h-a${n}`;
    // 원문을 보고 친 글 — 제1조 보험금명은 담보 값 슬롯(D0001), 제2조 · 제4조 · 제5조는 함수조항 블록(조 참조 인자 「보험금의 지급사유 조」 ← 제1조)
    const firstArticle = { articleId: a(1) };
    const tree = withCodes({
      id: "h-doc",
      kind: "document",
      title: `${NAME} 특별약관`,
      children: [
        {
          id: a(1),
          kind: "article",
          title: "보험금의 지급사유",
          children: [
            { id: "h-a1-p1", kind: "paragraph", children: [
              { id: "x1", kind: "text", text: "회사는 보험증권에 기재된 피보험자가 이 특별약관의 보험기간 중에「말기신부전증」으로 진단확정되었을 때에는 보험수익자에게 최초 1회에 한하여 이 특별약관의 보험가입금액을 " },
              { id: "x2", kind: "slot", ref: "D0001" },
              { id: "x3", kind: "text", text: "로 지급합니다." },
            ] },
            { id: "h-a1-p2", kind: "paragraph", children: [
              { id: "y1", kind: "text", text: "피보험자가 보험기간 중 보장개시일 이후에 사망하고 그 후에 말기신부전증으로 사망한 사실이 확인된 경우에는 그 사망일을 진단확정일로 보고 " },
              { id: "y2", kind: "articleRef", targets: [{ articleId: a(1), code: "P0100" }], connector: "및", scope: "self" },
              { id: "y3", kind: "text", text: "의 " },
              { id: "y4", kind: "slot", ref: "D0001" },
              { id: "y5", kind: "text", text: "를 지급합니다. 다만, " },
              // 「제4조(특별약관의 소멸) 제3항」 — 소멸 함수조항 블록 안 셋째 항(펼친 함수조항 안쪽)
              { id: "y6", kind: "articleRef", targets: [{ articleId: a(4), code: "P0100", innerCode: "P0300" }], connector: "및", scope: "self" },
              { id: "y7", kind: "text", text: "에 따라 이 특별약관의 계약자적립액 및 미경과보험료를 지급한 경우에는 " },
              { id: "y8", kind: "slot", ref: "D0001" },
              { id: "y9", kind: "text", text: "에서 이미 지급된 계약자적립액 및 미경과보험료를 차감한 금액을 지급합니다." },
            ] },
          ],
        },
        { id: a(2), kind: "article", title: "보험금 지급에 관한 세부규정", children: [
          { id: "h-a2-k", kind: "clauseBlockRef", clauseCode: THIRD_PARTY, options: {}, bindings: { "보험금의 지급사유 조": { kind: "articleRef", targets: [firstArticle], connector: "및", scope: "self" } } },
        ] },
        { id: a(3), kind: "article", title: "말기신부전증의 정의 및 진단 확정", children: [
          { id: "h-a3-p1", kind: "paragraph", children: [{ id: "z1", kind: "text", text: "이 특별약관에서「말기신부전증」이라 함은 양쪽 신장 모두가 비가역적 기능부전을 보이는 말기신질환(End Stage Renal Disease)으로서 만성콩팥병(제9차 한국표준질병사인분류 N18)에 해당하는 질병 중에서 보전요법으로는 치료가 불가능하여 정기적인 신장투석요법(혈액투석이나 복막투석)을 받고 있거나 받은 경우를 말하며, 일시적으로 투석치료를 필요로 하는 신부전증은 말기신부전증으로 보지 않습니다." }] },
          { id: "h-a3-p2", kind: "paragraph", children: [{ id: "z2", kind: "text", text: "「말기신부전증」의 진단확정은 의료법 제3조에서 정한 국내의 병원, 의원 또는 국외의 의료관련법에서 정한 의료기관의 의사(한의사, 치과의사는 제외합니다) 면허를 가진 자가 작성한 문서화된 기록 또는 검사결과를 기초로 하여 내려져야 합니다. 또한, 회사가「말기신부전증」의 조사나 확인을 위하여 필요하다고 인정하는 경우에는 검사결과, 진료기록부의 사본 제출을 요청할 수 있습니다." }] },
        ] },
        { id: a(4), kind: "article", title: "특별약관의 소멸", children: [
          { id: "h-a4-k", kind: "clauseBlockRef", clauseCode: LAPSE, options: { O01: "V01" }, bindings: { "보험금의 지급사유 조": { kind: "articleRef", targets: [firstArticle], connector: "및", scope: "self" } } },
        ] },
        { id: a(5), kind: "article", title: "준용규정", children: [
          { id: "h-a5-k", kind: "clauseBlockRef", clauseCode: HUMAN_CLAUSE_CODE, options: {} },
        ] },
      ],
    } as unknown as DocumentNode);
    const clauseLabels = new Map(SEED.clauses.map((c) => [c.code, c.label]));
    const boxNames = new Map(SEED.boxes.map((b) => [b.code, b.name]));
    const authoring = new DocumentAuthoring(page, tree, { selfPaths: outlinePaths(tree), generalAncestors: generalAncestors(general) }, clauseLabels, boxNames);

    await ev.action("실물사람#3.1", "메뉴 「담보약관 템플릿」 → 「+」 → 담보 고르기 · 제목 → 생성", async () => {
      await login(page);
      await open(page, "/");
      await menu(page, "담보약관 템플릿");
      await page.getByRole("link", { name: /^\+|새 담보약관 템플릿/ }).first().click();
      await arrive(page, /\/documents\/new\?kind=coverage/);
      await pickCombo(page.getByRole("combobox", { name: "담보", exact: true }), { label: NAME, query: "COV000023" });
      await page.getByLabel("제목").fill(`${NAME} 특별약관`);
      await page.getByRole("button", { name: "생성" }).first().click();
      await arrive(page, /\/documents\/[0-9a-f-]{36}$/);
    });
    await ev.action("실물사람#3.2", `편집 → 대응 보통약관 「${general.title}」`, () => authoring.startEdit(general.title));
    await ev.action("실물사람#3.3", "조 다섯 — 제목 · 항 · 함수조항 블록(세부규정 · 소멸 · 준용규정, 인자 「보험금의 지급사유 조」 ← 제1조)", () => authoring.buildSkeleton());
    await ev.action("실물사람#3.4", "문장 — 글 · 보험금명 슬롯 · 조 참조(제1항 · 제4조 제3항 = 소멸 함수조항 안쪽)", () => authoring.fillSentences());
    await ev.action("실물사람#3.5", "저장 한 번 — 검증 오류 0", async () => {
      await authoring.save();
      await expect(page.locator("nav.ts-l3-toc button.ts-toc-article")).toHaveCount(5);
    });
  });
});
