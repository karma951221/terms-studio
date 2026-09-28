import { pickCombo } from "../_lib/combo";
import { expect, test } from "../_lib/fixtures";
import { NO_COORD, arrive, login, open } from "./_lib/app";
import { DocumentAuthoring } from "./_lib/driver";
import { SEED, generalAncestors, generalTreeOf, outlinePaths } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ④ 담보약관 템플릿 — 담보마다 한 벌. 알파Plus 9벌(수술비 1벌을 비갱신 · 갱신 두 탑재가 함께 쓴다) + 메리츠 9벌. 모델명세 §7 · 메리츠_모델명세 §7.
 * 대응 보통약관은 템플릿마다 그 상품의 것(`spec.general`)이다.
 * 담보약관 템플릿 목록 「+」(생성 화면)에서 담보를 고르고, 문면 저작 화면에서 편집 → 대응 보통약관 → 툴바로 뼈대 → 문장 → 저장 한 번.
 * 문장의 칩(조 참조 · 별표 참조 · 슬롯 · 공용조항(문장)) · 공용조항 블록 · 표 · 박스 · 조연결 · 조건(조 자리 · 문장 안 · 표 셀 안)을 모두 화면으로 넣는다.
 */

const clauseLabels = new Map(SEED.clauses.map((c) => [c.code, c.label]));

test.describe.serial("실물 재현(화면) ④ 담보약관 템플릿", () => {
  for (const spec of SEED.documents) {
    const coverage = SEED.coverages.find((c) => c.key === spec.ownerCoverage)!;
    test(`${coverage.code} ${spec.tree.title}`, NO_COORD, async ({ page, ev }) => {
      test.setTimeout(600_000);
      const general = generalTreeOf(spec.general);
      const authoring = new DocumentAuthoring(page, spec.tree, { selfPaths: outlinePaths(spec.tree), generalAncestors: generalAncestors(general) }, clauseLabels);
      await ev.action("실물화면#4.1", "관리자로 로그인한다", () => login(page));
      await ev.action("실물화면#4.2", `담보약관 템플릿 목록 「+」 — 담보 ${coverage.code} 를 골라 만든다`, async () => {
        await open(page, "/documents?kind=coverage");
        await page.getByRole("link", { name: /^\+|새 담보약관 템플릿/ }).first().click();
        await arrive(page, /\/documents\/new\?kind=coverage/);
        await pickCombo(page.getByRole("combobox", { name: "담보", exact: true }), { label: coverage.name, query: coverage.code });
        await page.getByLabel("제목").fill(spec.tree.title);
        await page.getByRole("button", { name: "생성" }).first().click();
        await arrive(page, /\/documents\/[0-9a-f-]{36}$/);
      });
      await ev.action("실물화면#4.3", `편집 → 대응 보통약관 「${general.title}」을 고른다`, () => authoring.startEdit(general.title));
      await ev.action("실물화면#4.4", "뼈대 — 조 · 항 · 호 · 표 · 박스 · 공용조항 블록 · 조연결 · 조 자리 조건", () => authoring.buildSkeleton());
      await ev.action("실물화면#4.5", "문장 — 글 · 칩 · 문장 안 조건", () => authoring.fillSentences());
      await ev.action("실물화면#4.6", "저장 한 번 — 검증 오류 0", async () => {
        await authoring.save();
        await expect(page.locator("nav.ts-l3-toc button.ts-toc-article")).toHaveCount(spec.tree.children.length);
      });
    });
  }
});
