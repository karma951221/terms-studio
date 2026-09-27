import { expect, test } from "../_lib/fixtures";
import { NO_COORD, arrive, login, open, saveEdit } from "./_lib/app";
import { SEED } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ② 담보 9 — 담보 › 세부보장 › 급부 구조와 담보 값(보험금명). 모델명세 §3.1.
 * 생성 화면에서 담보명 · 첫 세부보장명 · 첫 급부명, 세부보장이 여럿이면 상세 편집의 「+ 세부보장」으로 나머지를 더한다.
 * 보험금명(`coverage_basic.claim_name`)은 같은 편집에서 — 편집 한 번 = 저장 한 번.
 */

test.describe.serial("실물 재현(화면) ② 담보", () => {
  for (const spec of SEED.coverages) {
    test(`${spec.code} ${spec.name}`, NO_COORD, async ({ page, ev }) => {
      test.setTimeout(180_000);
      await ev.action("실물화면#2.1", "관리자로 로그인한다", () => login(page));
      const [first, ...rest] = spec.subCoverages ?? [{ name: spec.name, benefitName: spec.benefitName }];

      await ev.action("실물화면#2.2", `담보를 만든다 — 세부보장 「${first.name}」 › 급부 「${first.benefitName}」`, async () => {
        await open(page, "/coverages/new");
        await page.getByLabel("담보명").fill(spec.name);
        await page.getByLabel("세부보장명").fill(first.name);
        await page.getByLabel("급부명").fill(first.benefitName);
        await page.getByRole("button", { name: "생성", exact: true }).click();
        await arrive(page, /\/coverages\/[0-9a-f-]{36}$/);
        await expect(page.locator(".ts-count code").first()).toHaveText(spec.code);
      });

      await ev.action("실물화면#2.3", `편집 — 세부보장 ${rest.length}개 더하기 · 보험금명 「${spec.coverageValues[0]?.value}」 · 저장 한 번`, async () => {
        await page.getByRole("button", { name: "편집", exact: true }).click();
        for (const [i, sub] of rest.entries()) {
          const n = i + 2;
          await page.getByRole("button", { name: "세부보장 추가", exact: true }).click();
          const card = page.locator("section.ts-cov-card[data-level='subCoverage']").nth(n - 1);
          await card.getByRole("textbox", { name: `세부보장명 · ${n}번`, exact: true }).fill(sub.name);
          await card.getByRole("textbox", { name: "급부명 · 1번", exact: true }).fill(sub.benefitName);
        }
        for (const value of spec.coverageValues) await page.locator(`section.ts-cov-card[data-level='coverage'] input[name="${value.path}"]`).fill(value.value);
        await saveEdit(page);
      });

      await ev.action("실물화면#2.4", "읽기 모드 — 세부보장 · 급부 이름과 보험금명이 저장돼 있다", async () => {
        await page.reload();
        const subs = [first, ...rest];
        await expect(page.locator("section.ts-cov-card[data-level='subCoverage']")).toHaveCount(subs.length);
        await expect(page.locator("section.ts-cov-card[data-level='benefit']")).toHaveCount(subs.length);
        for (const sub of subs) {
          await expect(page.locator(".ts-cov-card-name", { hasText: sub.name }).first()).toBeVisible();
          await expect(page.locator(".ts-cov-card-name", { hasText: sub.benefitName }).first()).toBeVisible();
        }
        for (const value of spec.coverageValues) await expect(page.locator(`input[name="${value.path}"]`)).toHaveValue(value.value);
      });
    });
  }
});
