import { writeFileSync } from "node:fs";
import path from "node:path";

import { articleTitles, diffArticlesUnordered, referenceNumberIssues, type UnorderedDiff } from "../../../src/domain/assembly/compare";
import { expect, test } from "../_lib/fixtures";
import { NO_COORD, arrive, login, open, submit } from "./_lib/app";
import { renderedLines, sourceLines } from "./_lib/compare";
import { GENERAL_TITLE, SEED } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ⑤ 상품 — 상품 → 보통약관 → 세목(종 2 · 형 2 · 조합 4, 세목 값) → 탑재 11(담보속성) → 그룹 → 조립 미리보기 → 원문 대조.
 * 대조는 Vitest 실물 재현(`src/db/seed/real.test.ts`)과 같은 대조기 — 조 순서는 허용(다중집합), 조 번호 · 조 참조 번호는 조립 순서와 맞아야 한다
 * ([[QA/인수기준]] 허용 차이 ⑥). 미리보기 화면(DOM)을 파싱양식 줄로 되돌려 넣는다(`_lib/compare.ts`).
 */

const product = SEED.products[0];
const coverageOf = (key: string) => SEED.coverages.find((c) => c.key === key)!;
const attributeOf = (code: string) => SEED.attributes.find((a) => a.code === code)!;

/** 상품담보명 — 작명 규칙 `[A0001] [담보명] [A0002]` (값의 상품담보명 표기, 빈 조각은 빠진다). 모델명세 §2.3. */
function mountName(mount: (typeof product.mounts)[number]): string {
  const fragment = (code: string) => {
    const chosen = mount.attributes.find((a) => a.kindCode === code);
    return chosen ? (attributeOf(code).values.find((v) => v.code === chosen.valueCode)?.fragment ?? "") : "";
  };
  return [fragment("A0001"), coverageOf(mount.coverage).name, fragment("A0002")].filter((s) => s !== "").join(" ");
}

/** 특약 제목 → 원문 픽스처 (real.test.ts 와 같은 짝). */
const SPECIALS: [string, string][] = [
  ["일반상해사망보장 특별약관", "일반상해사망보장.md"],
  ["일반상해사망보장 추가 특별약관", "일반상해사망보장_추가.md"],
  ["일반상해80%이상후유장해 생활자금보장 특별약관", "일반상해80%이상후유장해_생활자금보장.md"],
  ["골절(치아파절 제외)진단비Ⅱ보장 특별약관", "골절(치아파절_제외)진단비Ⅱ보장.md"],
  ["일반상해50%이상후유장해 생활자금보장 특별약관", "일반상해50%이상후유장해_생활자금보장.md"],
  ["골절수술비Ⅱ보장 특별약관", "골절수술비Ⅱ보장.md"],
  ["중대한특정상해수술비보장 특별약관", "중대한특정상해수술비보장.md"],
  ["수술비(1-7종, 연간3회한)[상해]보장 특별약관", "수술비(1-7종,_연간3회한)[상해]보장.md"],
  ["갱신형 수술비(1-7종, 연간3회한)[상해]보장 특별약관", "갱신형_수술비(1-7종,_연간3회한)[상해]보장.md"],
  ["신화상치료비보장 특별약관", "신화상치료비보장.md"],
];

/** 진단용 — `E2E_DUMP=<폴더>` 면 화면에서 읽은 줄을 문서마다 파일로 남긴다(원문 · 시드 조립 결과와 diff). */
function dump(title: string, lines: string[]): void {
  if (process.env.E2E_DUMP) writeFileSync(path.join(process.env.E2E_DUMP, `${title}.txt`), lines.join("\n"));
}

const clean: UnorderedDiff = { missing: [], extra: [] };
function describeDiff(d: UnorderedDiff): string {
  const show = (label: string, cs: UnorderedDiff["missing"]) => cs.slice(0, 3).map((c) => `\n── ${label} 「${c.title}」\n${c.lines.map((l) => `    ${l}`).join("\n")}`).join("");
  return `${show("원문에만", d.missing)}${show("조립에만", d.extra)}${d.sections ? `\n── 관 순서: ${JSON.stringify(d.sections)}` : ""}`;
}

/** 세목 값 칸 — 참거짓은 예/아니오 라디오, 목록값(복수)은 체크, 목록값은 선택. */
async function setPlanValue(row: import("@playwright/test").Locator, path: string, value: unknown): Promise<void> {
  const cell = row.locator(`td[data-path="${path}"]`);
  if (typeof value === "boolean") await cell.getByRole("radio", { name: value ? "예" : "아니오", exact: true }).check();
  else if (Array.isArray(value)) for (const code of value) await cell.locator(`input[type=checkbox][value="${code}"]`).check();
  else await cell.locator("select").selectOption(String(value));
}

test.describe.serial("실물 재현(화면) ⑤ 상품 → 조립 → 원문 대조", () => {
  test(`「${product.name}」 — 보통약관 · 세목 · 탑재 11 · 그룹`, NO_COORD, async ({ page, ev }) => {
    test.setTimeout(300_000);
    await ev.action("실물화면#5.1", "관리자로 로그인한다", () => login(page));

    const productUrl = await ev.action("실물화면#5.2", `상품 「${product.name}」을 만든다`, async () => {
      await open(page, "/products/new");
      await page.getByLabel("상품명").fill(product.name);
      await page.getByRole("button", { name: "생성" }).click();
      await arrive(page, /\/products\/[0-9a-f-]+$/);
      return page.url();
    });

    await ev.action("실물화면#5.3", "보통약관 탭 — 보통약관 템플릿을 고른다", async () => {
      await open(page, `${productUrl}?tab=general`);
      await page.getByLabel("보통약관 템플릿").selectOption({ label: GENERAL_TITLE });
      await submit(page, page.getByRole("button", { name: "템플릿 저장" }));
    });

    await ev.action("실물화면#5.4", "기본정보 — 보험종목 정의 종 2 · 형 2(세목유형 · 값)", async () => {
      await open(page, `${productUrl}?tab=basic`);
      await page.getByRole("button", { name: "편집", exact: true }).click();
      for (const [i, option] of product.planOptions.entries()) {
        await page.getByRole("button", { name: "보험종목 추가" }).click();
        const row = page.locator("#definitions-panel tbody tr").nth(i);
        await row.getByLabel("종·형 구분").selectOption(option.axis);
        await row.getByLabel("번호", { exact: true }).fill(String(option.number));
        await row.getByLabel("보험종목명", { exact: true }).fill(option.name);
        await row.getByLabel("세목유형").selectOption(option.planTypeCode);
        for (const v of option.values) {
          if (Array.isArray(v.value) && v.value.length === 0) continue;
          await setPlanValue(row, v.path, v.value);
        }
      }
    });

    await ev.action("실물화면#5.5", "종·형 조합 4 를 고르고 기본정보를 한 번에 저장한다", async () => {
      await page.getByRole("tab", { name: "종·형 조합" }).click();
      const byCode = new Map(product.planOptions.map((o) => [o.code, o]));
      for (const plan of product.plans) {
        const [t, f] = plan.map((c) => byCode.get(c)!);
        await page.getByRole("checkbox", { name: new RegExp(`제${t.number}종.*제${f.number}형.* 사용$`) }).check();
      }
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(page.locator("#combinations-panel tbody tr")).toHaveCount(product.plans.length);
    });

    for (const [i, mount] of product.mounts.entries()) {
      const section = mount.section === "base" ? "보통약관 기본계약" : "특별약관";
      const name = mountName(mount);
      await ev.action(`실물화면#5.6.${i + 1}`, `${section}에 「${name}」 탑재`, async () => {
        await open(page, `${productUrl}?tab=${mount.section === "base" ? "general" : "special"}`);
        const form = page.locator("form", { has: page.getByRole("button", { name: `${section}에 탑재` }) });
        await form.getByLabel("담보").selectOption({ label: coverageOf(mount.coverage).name });
        for (const a of mount.attributes) await form.getByLabel(attributeOf(a.kindCode).label).selectOption(a.valueCode);
        await submit(page, form.getByRole("button", { name: `${section}에 탑재` }));
        await arrive(page, /\/coverages\/[0-9a-f-]+$/);
      });
    }

    await ev.action("실물화면#5.7", `특약 그룹 「${product.groups[0].title}」을 만들고 특약 10 을 배치한다`, async () => {
      await open(page, `${productUrl}?tab=special`);
      await expect(page.getByRole("region", { name: "특별약관", exact: true }).locator("tbody tr")).toHaveCount(product.mounts.filter((m) => m.section === "special").length);
      await page.getByLabel("새 그룹 제목").fill(product.groups[0].title);
      await submit(page, page.getByRole("button", { name: "그룹 추가" }));
      for (const mount of product.mounts.filter((m) => m.group)) {
        const place = page.getByRole("button", { name: `배치 · ${product.groups[0].title} 에` });
        await page.locator("form", { has: place }).locator("select[name=productCoverageId]").selectOption({ label: mountName(mount) });
        await submit(page, place);
      }
      await expect(page.getByText(`미배치 상품담보: ${mountName(product.mounts[0])}`, { exact: true })).toBeVisible();
    });

  });

  test("조립 미리보기 → 원문 대조 (보통약관 + 특약 10)", NO_COORD, async ({ page, ev }) => {
    test.setTimeout(180_000);
    await ev.action("실물화면#5.8.0", "관리자로 로그인하고 상품을 연다", async () => {
      await login(page);
      await open(page, "/products");
      await page.getByRole("link", { name: product.name, exact: true }).click();
      await arrive(page, /\/products\/[0-9a-f-]+/);
    });
    await ev.action("실물화면#5.8", "조립 미리보기 실행 — 오류 0 · 완성본 · 별표 14건(1번 장해분류표)", async () => {
      await page.getByRole("button", { name: "더보기", exact: true }).click();
      await page.getByRole("menuitem", { name: "미리보기", exact: true }).click();
      await expect(page).toHaveURL(/\/products\/.+\/preview/);
      await page.getByRole("button", { name: /^(다시 )?실행$/ }).click();
      await expect(page.getByText(/^조립 검사: 오류 0 · /)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText("오류 없음.")).toBeVisible();
      await expect(page.getByText(/완성본 아님/)).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /^별표 14건$/ })).toBeVisible();
      const appendixList = page.locator("h2", { hasText: /별표 \d+건/ }).locator("xpath=following-sibling::ul[1]");
      await expect(appendixList.getByRole("listitem").first()).toHaveText("【별표1(장해분류표)】");
    });

    const generalLines = await ev.action("실물화면#5.9", "보통약관(관 7 · 조 52, 기본계약 대치)을 원문과 대조한다", async () => {
      const lines = await renderedLines(page.locator("article.ts-doc").first());
      dump("보통약관", lines);
      const diff = diffArticlesUnordered(sourceLines("보통약관.md"), lines);
      expect(diff, describeDiff(diff)).toEqual(clean);
      expect(referenceNumberIssues(lines)).toEqual([]);
      return lines;
    });

    for (const [i, [title, file]] of SPECIALS.entries()) {
      await ev.action(`실물화면#5.10.${i + 1}`, `${title} 을 원문과 대조한다`, async () => {
        const doc = page.locator("article.ts-doc", { has: page.getByRole("heading", { name: title, exact: true }) });
        await expect(doc, title).toHaveCount(1);
        const lines = await renderedLines(doc);
        dump(title, lines);
        const diff = diffArticlesUnordered(sourceLines(file), lines);
        expect(diff, describeDiff(diff)).toEqual(clean);
        expect(referenceNumberIssues(lines, articleTitles(generalLines))).toEqual([]);
      });
    }
  });
});
