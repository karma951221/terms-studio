"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import { saveOnce } from "@/app/_lib/saveOnce";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { InspectInput, InspectResult } from "@/services/catalog";

import type { CatalogEditData } from "./edit-types";
import { resultTypeFromForm } from "./lib";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

/**
 * 구분자는 {구분자명 · 식 · 주석 · 결과 타입} 을 고친다 — 레벨은 채번 뒤 불변이다 (ADR-0037).
 *
 * 기존 단일 서비스들을 순서대로 부르고 첫 거부에서 멈춘다 — 새 규칙을 여기서 만들지 않는다 (규칙은 서비스에 있다).
 * 전체가 한 트랜잭션이다 (`saveOnce`, 점검 2026-09-27 H1 · D1) — 어느 단계가 거부되든 앞 단계(구분자명 · 주석)까지 롤백된다.
 * 식 · 결과 타입은 `setExpression` 한 번에 함께 싣는다 — 새 식과 새 타입을 서로 대조한다. 결과 타입이 필수라
 * (기능/구분자 §3.1, 2026-10-17) 옛 「해제 → 식 → 지정」 순서가 없다. 빈 타입은 서비스가 「결과 타입을 고르세요」로 거부한다.
 */
export async function saveDiscriminatorEditAction(code: string, input: CatalogEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def) return { ok: false, message: `찾을 수 없습니다 — 구분자 ${code}` };

  const resultType = resultTypeFromForm(input.resultTypeKind, input.resultTypeMulti, input.resultTypeEnum);

  return saveOnce(services, async () => {
    const rename = await services.catalog.rename(actor, code, input.label);
    let error = failed(rename, "label");
    if (error) return error;
    const description = await services.catalog.setDescription(actor, code, input.description);
    error = failed(description, "description");
    if (error) return error;
    const expression = await services.catalog.setExpression(actor, code, input.expression, { resultType });
    error = failed(expression, resultType ? "expression" : "resultTypeKind");
    if (error) return error;
    return { ok: true };
  });
}

export async function removeDiscriminatorEditAction(code: string, confirm = false): Promise<EditOutcome> {
  const result = await getServices().catalog.remove(await currentActor(), code, { confirm });
  return failed(result, "delete") ?? { ok: true };
}

/**
 * 「검사」 — 저장하지 않고 오류 · 경고 · 추론 타입 · 깨질 사용처만 돌려준다 (기능/구분자 §3.3).
 * 생성 화면과 상세 편집이 같이 부른다. 타이핑 중 자동 호출은 없다 — 버튼을 눌렀을 때만.
 */
export async function inspectDiscriminatorAction(input: InspectInput): Promise<InspectResult> {
  // 읽기뿐이지만 서버 액션 POST 는 레이아웃 관문을 거치지 않는다 — 다른 액션과 같은 로그인 게이트 (미로그인은 /login 으로)
  await currentActor();
  return getServices().catalog.inspect(input);
}
