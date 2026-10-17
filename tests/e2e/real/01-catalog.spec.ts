import { expect, test } from "../_lib/fixtures";
import { NO_COORD, arrive, login, open, saveEdit } from "./_lib/app";
import { BASE_DISCRIMINATOR_CODES, BASE_ENUM_CODES, SEED } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ① 카탈로그 — 열거형(세목 · 상품특성) · 구분자 · 담보속성 2(+ 값) · 상품담보명 규칙.
 * 바탕 DB(E2E_PROFILE=real)에는 별표 · 보통약관과 보통약관이 쓰는 함수조항 · 그것들이 읽는 열거형(E0001 납입면제사유 · 구분자 식이 읽는 E0002 무저해지 유형)과 구분자(D0001 ~ D0007 — 앞 코드, 보통약관 형 축 문장이 읽는 해약환급금 미지급형 있음까지)가 있다 —
 * 그 뒤 코드부터 친다. 코드는 시스템 채번이라 명세 §1 순서대로 만들면 명세의 코드가 나온다 — 그것을 확인한다.
 * 이 파일부터 05 까지가 한 흐름이다(앞 파일이 만든 것을 뒤 파일이 쓴다). 근거: docs/QA/시나리오/실물재현_E2E_시나리오.md §4 ④
 */

const RESULT_TYPE_LABEL: Record<string, string> = { string: "문자열" };

test.describe.serial("실물 재현(화면) ① 카탈로그", () => {
  const enums = SEED.enums.filter((e) => !BASE_ENUM_CODES.has(e.code));
  test(`열거형 ${enums.map((e) => e.code).join(" · ")} — 이름 · 필드 · 값을 생성 화면에서`, NO_COORD, async ({ page, ev }) => {
    await ev.action("실물화면#1.1", "관리자로 로그인한다", () => login(page));
    let next = BASE_ENUM_CODES.size + 1;
    for (const spec of enums) {
      // 없앤 열거형의 코드 빈자리(옛 「특약 그룹」 E0008 — ADR-0090 결정 3)는 채번이라 건너뛸 수 없다 — 자리표시 열거형을 만들고 상세의 🗑 로 지운다(시드와 같다)
      for (; next < Number(spec.code.slice(1)); next++) {
        const gap = `E${String(next).padStart(4, "0")}`;
        await ev.action(`실물화면#1.2 ${gap}`, `코드 빈자리 ${gap} — 자리표시 열거형을 만들고 지운다`, async () => {
          const label = `(지운 열거형 ${gap})`;
          await open(page, "/enums/new");
          await page.getByLabel("열거형변수 이름").fill(label);
          await page.getByRole("textbox", { name: "값 이름", exact: true }).first().fill("값");
          await page.getByRole("button", { name: "생성", exact: true }).click();
          await arrive(page, new RegExp(`/enums/${gap}$`));
          await page.getByRole("button", { name: `열거형변수 ${label}(${gap}) 삭제`, exact: true }).click();
          await page.getByRole("dialog").getByRole("button", { name: `${label} 삭제`, exact: true }).click();
          await arrive(page, /\/enums$/);
        });
      }
      next++;
      await ev.action(`실물화면#1.2 ${spec.code}`, `열거형 「${spec.label}」 필드 ${spec.fields?.length ?? 0}개 · 값 ${spec.values.length}개를 만든다`, async () => {
        await open(page, "/enums/new");
        await page.getByLabel("열거형변수 이름").fill(spec.label);
        // 필드(ADR-0078) — 「행 추가 · 필드」 → 이름 · 타입. 담보분류의 「그룹 제목」(기본 특약 그룹 제목, ADR-0090)
        for (const field of spec.fields ?? []) {
          await page.getByRole("button", { name: "행 추가 · 필드", exact: true }).click();
          await page.getByRole("textbox", { name: /^필드 이름/ }).last().fill(field.label);
          if (field.type === "boolean") await page.getByRole("combobox", { name: `${field.label} 타입` }).selectOption({ label: "참거짓" });
        }
        // 생성 화면은 빈 값 두 줄로 시작한다 — 남는 빈 행은 생성 때 버린다. 새 값 행의 입력칸은 모두 「값 이름」(상세 값 표와 같은 표)
        for (let i = 2; i < spec.values.length; i++) await page.getByRole("button", { name: "행 추가 · 값", exact: true }).click();
        for (const [i, value] of spec.values.entries()) await page.getByRole("textbox", { name: "값 이름", exact: true }).nth(i).fill(value.label);
        // 값 × 필드 칸 — 「{값 이름} {필드 이름}」
        for (const value of spec.values) {
          for (const field of spec.fields ?? []) {
            const cell = value.fields?.[field.key];
            if (cell === undefined) continue;
            if (field.type === "boolean") await page.getByRole("combobox", { name: `${value.label} ${field.label}`, exact: true }).selectOption({ label: cell ? "예" : "아니오" });
            else await page.getByRole("textbox", { name: `${value.label} ${field.label}`, exact: true }).fill(String(cell));
          }
        }
        await page.getByRole("button", { name: "생성", exact: true }).click();
        await arrive(page, new RegExp(`/enums/${spec.code}$`));
      });
    }
  });

  const discriminators = SEED.discriminators.filter((d) => !BASE_DISCRIMINATOR_CODES.has(d.code));
  // 바탕 DB 가 구분자를 모두 넣었으면(담보명 D0001 은 보통약관의 D0002 보다 앞 코드) 화면으로 칠 구분자가 없다 — 구분자 생성 화면은 기본 E2E 가 본다
  if (discriminators.length > 0) test(`구분자 ${discriminators.map((d) => d.code).join(" · ")} — 식 · 결과 타입`, NO_COORD, async ({ page, ev }) => {
    await ev.action("실물화면#1.3", "관리자로 로그인한다", () => login(page));
    for (const spec of discriminators) {
      await ev.action(`실물화면#1.4 ${spec.code}`, `구분자 「${spec.label}」 = ${spec.expression}`, async () => {
        await open(page, "/catalog/new");
        await page.getByLabel("구분자명").fill(spec.label);
        await page.getByRole("radiogroup", { name: "레벨" }).getByRole("radio", { name: "담보", exact: true }).check();
        await page.getByLabel("식", { exact: true }).fill(spec.expression);
        const type = (spec as unknown as { resultType?: { kind: string } }).resultType?.kind;
        if (type) await page.getByLabel("결과 타입").selectOption({ label: RESULT_TYPE_LABEL[type] });
        await page.getByRole("button", { name: "생성", exact: true }).click();
        await arrive(page, new RegExp(`/catalog/${spec.code}$`));
      });
    }
  });

  test("담보속성 A0001 · A0002 — 유형을 만들고 상세 편집에서 값(코드 1 · 2 · 상품담보명 표기)", NO_COORD, async ({ page, ev }) => {
    await ev.action("실물화면#1.5", "관리자로 로그인한다", () => login(page));
    for (const spec of SEED.attributes) {
      await ev.action(`실물화면#1.6 ${spec.code}`, `담보속성 「${spec.label}」을 만든다`, async () => {
        await open(page, "/attributes/new");
        await page.getByLabel("담보속성명").fill(spec.label);
        await page.getByRole("button", { name: "생성", exact: true }).click();
        await arrive(page, new RegExp(`/attributes/${spec.code}$`));
      });
      await ev.action(`실물화면#1.7 ${spec.code}`, `값 ${spec.values.map((v) => v.label).join(" · ")} — 편집 한 번 · 저장 한 번`, async () => {
        await page.getByRole("button", { name: "편집", exact: true }).click();
        const rows = page.locator("table.ts-attr-values tbody tr");
        for (const [i, value] of spec.values.entries()) {
          await page.locator("table.ts-attr-values tfoot").getByRole("button", { name: "행 추가 · 값", exact: true }).click();
          await rows.nth(i).getByRole("textbox", { name: "값 이름", exact: true }).fill(value.label);
          if (value.fragment) await rows.nth(i).getByRole("textbox", { name: /^상품담보명 표기/ }).fill(value.fragment);
        }
        await saveEdit(page);
        // 저장 뒤 읽기 모드가 서버 채번 코드(1 · 2)를 보인다 — 「새 값」으로 남지 않는다 (EditShell 결함 수정 2026-09-28)
        await expect(page.locator("table.ts-attr-values tbody td.col-code")).toHaveText(spec.values.map((v) => v.code));
      });
    }
  });

  test("상품담보명 규칙 — [A0001] [담보명] [A0002]", NO_COORD, async ({ page, ev }) => {
    await ev.action("실물화면#1.8", "관리자로 로그인한다", () => login(page));
    const template = SEED.products[0].namingTemplate;
    await ev.action("실물화면#1.9", `규칙을 「${template}」로 고친다`, async () => {
      await open(page, "/attributes/template");
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await page.locator(".ts-form-row", { has: page.locator("label", { hasText: /^템플릿$/ }) }).locator("input").fill(template);
      await saveEdit(page);
      await expect(page.locator(".ts-form-row", { has: page.locator("label", { hasText: /^지금 이름$/ }) })).toContainText("[갱신유형] [담보명] [부가유형]");
    });
  });
});
