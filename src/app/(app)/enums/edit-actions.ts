"use server";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import { saveOnce } from "@/app/_lib/saveOnce";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { EnumEditData } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

const isNew = (code: string) => code.startsWith("new:");

/**
 * 열거형변수 상세의 저장 — 이름 · 주석 · 필드 행 · 값 행(추가 · 이름 · 순서 · **삭제** · 필드 칸)이 저장 한 번이다 (디자인원칙 §2 L2 표).
 *
 * 값 표는 최종 목록 한 벌로 서비스 `reviseEnum` 에 넘긴다 — 한 단계씩 고치면 값 이름 A↔B 맞바꾸기가 중간 상태에서
 * 「중복」으로 거부됐다 (점검 2026-09-27 H2 ①). 표에서 ✕ 로 뺀 저장된 값은 여기서 빠지고, 확인은 **저장 시점**에 한 번 —
 * 빠진 값 전부의 영향(값 행 · 사용처)을 합친 대화상자다 (D2). 전체가 한 트랜잭션이라 거부 · 확인 대기 중엔 아무것도 남지 않는다 (H1).
 * 뺀 값을 고른 값 행은 지우지 않고 「없는 값」 오류로 남긴다 (ADR-0078 결정 5). 새 값을 더하면 재검사 목록을 싣는다 (결정 4).
 */
export async function saveEnumEditAction(code: string, input: EnumEditData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  return saveOnce(services, async () => {
    const current = await services.catalog.getEnum(code);
    if (!current) return { ok: false, message: "열거형변수를 찾을 수 없습니다." };
    // 빈 채로 남은 새 필드 행은 버린다 — 새 값 행과 같은 규칙 (디자인원칙 §2 L2). 새 필드는 ref(`new:N`)로, 값의 필드 칸이 같은 키로 가리킨다
    const fieldRows = input.fields?.filter((field) => field.label.trim() || !isNew(field.key));
    const fields = fieldRows?.map((field) => (isNew(field.key) ? { ref: field.key, label: field.label, type: field.type } : { key: field.key, label: field.label, type: field.type }));
    const live = new Set(fieldRows?.map((field) => field.key));
    const values = input.values.map((value) => {
      const cells = fields && value.fields ? Object.fromEntries(Object.entries(value.fields).filter(([key]) => live.has(key))) : value.fields;
      return { ...(isNew(value.code) ? {} : { code: value.code }), label: value.label, ...(cells ? { fields: cells } : {}) };
    });
    const result = await services.catalog.reviseEnum(actor, code, { label: input.label, description: input.description, ...(fields ? { fields } : {}), values }, { confirm });
    if (result.ok) {
      // 값을 더했으면 그 열거형 값을 나열해 비교하는 곳을 재검사 목록으로 돌려준다 — 저장은 막지 않는다 (ADR-0078 결정 4)
      if (!input.values.some((value) => isNew(value.code))) return { ok: true };
      const recheck = await services.catalog.enumValueRecheck(code);
      return recheck.length > 0 ? { ok: true, recheck } : { ok: true };
    }
    if (result.rejection.reason === "needsConfirmation") {
      const { impact } = result.rejection;
      const kept = new Set(input.values.map((value) => value.code));
      const removed = current.values.filter((value) => !kept.has(value.code)).length;
      // 필드 삭제 · 타입 변경 줄은 서비스가 영향의 cascade 에 「필드 「X」 — 값 N개의 입력이 지워진다」로 싣는다 (ADR-0078 결정 2)
      const fieldLines = impact.cascade.filter((line) => line.startsWith("필드 「"));
      if (removed === 0) {
        return {
          ok: "confirm",
          impact: { ...impact, cascade: impact.cascade.filter((line) => !fieldLines.includes(line)) },
          token: "values",
          title: "필드를 빼거나 타입을 바꾸면 값마다 넣은 입력이 지워진다",
          actionLabel: `필드 ${fieldLines.length}개 바꾸고 저장`,
          valueRowsLine: fieldLines.join(" · "),
        };
      }
      // 값 행은 지우지 않는다 — 코드가 남아 「없는 값」 오류가 된다 (ADR-0078 결정 5)
      const valueLine = `그 값을 고른 저장 값 ${impact.valueRowsLost}건이 「없는 값」 오류로 남는다`;
      return {
        ok: "confirm",
        impact: { ...impact, cascade: impact.cascade.filter((line) => !fieldLines.includes(line)) },
        token: "values",
        title: "값을 빼면 그 값을 고른 자리가 「없는 값」 오류가 된다",
        actionLabel: `값 ${removed}개 삭제하고 저장`,
        valueRowsLine: [valueLine, ...fieldLines].join(" · "),
      };
    }
    return failed(result, "values")!;
  });
}

export async function removeEnumEditAction(code: string, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().catalog.removeEnum(await currentActor(), code, { confirm }), "delete") ?? { ok: true };
}
