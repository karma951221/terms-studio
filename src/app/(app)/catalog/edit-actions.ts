"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { InspectInput, InspectResult } from "@/services/catalog";

import type { CatalogEditData } from "./edit-types";
import { resultTypeFromForm, resultTypeSavePlan } from "./lib";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

/**
 * 구분자는 {구분자명 · 식 · 주석 · 결과 타입} 을 고친다 — 레벨은 채번 뒤 불변이다 (ADR-0037).
 *
 * 기존 단일 서비스들을 순서대로 부르고 첫 거부에서 멈춘다 — 새 규칙을 여기서 만들지 않는다 (규칙은 서비스에 있다).
 * 결과 타입과 식을 함께 고쳤으면 **해제 → 식 저장 → 지정** 순이다 (`resultTypeSavePlan`): setExpression 은
 * 저장된 명시 타입과 새 식을 대조하고 setResultType 은 새 타입과 저장된 식을 대조하므로, 어느 쪽을 먼저 해도
 * 옛 값이 새 값을 막는다 (기능/구분자 §3.3).
 */
export async function saveDiscriminatorEditAction(code: string, input: CatalogEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def) return { ok: false, message: `찾을 수 없습니다 — 구분자 ${code}` };

  const resultType = resultTypeFromForm(input.resultTypeKind, input.resultTypeMulti, input.resultTypeEnum);
  const plan = resultTypeSavePlan(def.resultType, resultType, input.expression !== def.expression);

  const rename = await services.catalog.rename(actor, code, input.label);
  let error = failed(rename, "label");
  if (error) return error;
  const description = await services.catalog.setDescription(actor, code, input.description);
  error = failed(description, "description");
  if (error) return error;
  if (plan === "clearThenSet") {
    // 명시 타입을 지우기 **전에** 새 식이 문법·타입으로 서는지 먼저 본다 — 안 그러면 새 식이 거부됐을 때
    // DB 엔 명시 타입만 사라진 채 옛 식이 남는다. (순환·의존 거부는 여기서 못 막는다 — 식+타입을 한 번에
    // 검증하는 서비스 호출로 바꾸는 것이 정답(후속).)
    const checked = await services.catalog.checkExpression(input.expression, def.level);
    error = failed(checked, "expression");
    if (error) return error;
    const cleared = await services.catalog.setResultType(actor, code, undefined);
    error = failed(cleared, "resultTypeKind");
    if (error) return error;
  }
  const expression = await services.catalog.setExpression(actor, code, input.expression);
  error = failed(expression, "expression");
  if (error) return error;
  // 해제→식 뒤에 새 타입이 미지정이면 이미 해제됐다 — 같은 값을 두 번 쓰지 않는다.
  if (plan === "set" || (plan === "clearThenSet" && resultType)) {
    const typed = await services.catalog.setResultType(actor, code, resultType);
    error = failed(typed, "resultTypeKind");
    if (error) return error;
  }
  return { ok: true };
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
