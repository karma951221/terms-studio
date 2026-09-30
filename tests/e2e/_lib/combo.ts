/**
 * 검색 입력(콤보박스) 고르기 — 참조 고르기는 모두 이 부품이다 (디자인원칙 §1.8, `src/app/_components/Combobox.tsx`).
 *
 * 사람이 하는 대로: 입력칸을 누르고 → 글을 쳐 좁히고 → 목록에서 그 줄을 누른다. `<select>` 의 `selectOption` 대신 쓴다.
 * - `value` — 줄의 `data-value`(코드 · id)로 찾는다. 친 글(`query`)이 없으면 전체 목록에서.
 * - `label` — 줄 이름(보조 글자 제외)이 정확히 같은 줄. 친 글이 없으면 이름을 친다.
 * 서버 조회(담보 탑재)면 `query` 로 좁혀야 목록에 든다 — 이름을 주면 그 이름을 친다.
 */
import { expect, type Locator } from "@playwright/test";

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

export async function pickCombo(input: Locator, pick: { value?: string; label?: string; query?: string }): Promise<void> {
  // 여는 단계는 다시 해 본다 — 바로 앞 제출(서버 액션 → redirect)이 늦게 그린 화면이 입력칸의 초점을 빼앗으면
  // onBlur 가 목록을 닫는다(실물 ⑤ 그룹 배치에서 드물게 보였다). 누르기 · 치기는 몇 번 해도 같은 결과다.
  const text = pick.query ?? (pick.value === undefined ? (pick.label ?? "") : "");
  await expect(async () => {
    await input.click();
    await input.fill(text);
    await expect(input).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  const listId = await input.getAttribute("aria-controls");
  const list = input.page().locator(`[id="${listId}"]`);
  const option =
    pick.value !== undefined
      ? list.locator(`[role="option"][data-value="${pick.value}"]`)
      : list.getByRole("option").filter({ has: input.page().locator(".ts-combo-label", { hasText: exact(pick.label ?? "") }) });
  await option.first().click();
  await expect(input).toHaveAttribute("aria-expanded", "false");
}

/** 목록에 그 이름의 줄이 몇 개인가 — 친 글로 좁힌 뒤 센다 (없어야 하는 후보 확인용). 끝나면 Esc 로 닫는다. */
export async function comboOptionCount(input: Locator, query: string): Promise<number> {
  await input.click();
  await input.fill(query);
  const listId = await input.getAttribute("aria-controls");
  const list = input.page().locator(`[id="${listId}"]`);
  await expect(list.locator("xpath=..").locator(".ts-combo-status, [role=option]").first()).toBeVisible();
  const count = await list.getByRole("option").count();
  await input.press("Escape");
  await input.press("Escape");
  return count;
}
