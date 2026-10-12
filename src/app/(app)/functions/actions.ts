"use server";

/**
 * 함수조항 생성 — `/functions/new` 에디터의 저장 한 번 (기능/함수조항 §4.2).
 *
 * 이름 · 유형만 받아 빈 함수조항을 먼저 만들지 않는다. 함수조항명 · 유형 · 본문 · 옵션 전체를 한 번에 받아
 * 검사 ① 을 통과해야 그 자리에서 만든다 — 실패하면 아무것도 만들지 않은 채 에디터에 오류를 돌려준다.
 */
import { randomUUID } from "node:crypto";

import { describeRejection } from "@/app/_lib/rejection";
import { formatClauseCode } from "@/domain/clause";
import { currentActor, getServices } from "@/lib/services";
import { rollbackUnless } from "@/services/txContext";

import type { ClauseCreateData, ClauseSaveOutcome } from "./edit-types";
import { presetsForSave, remapOptionSlots, textBody } from "./lib";

export async function createClauseAction(input: ClauseCreateData): Promise<ClauseSaveOutcome> {
  const actor = await currentActor();
  const services = getServices();
  // 새 함수조항의 옵션 순번 범위는 비어 있어 들어온 순서대로 O01 · O02 … 가 된다 (createClause 의 채번 규칙) — 본문의 new:* 를 미리 맞춘다
  const codes = new Map(input.options.map((option, i) => [option.code, formatClauseCode("option", i + 1)] as const));
  const failed = (rejection: Parameters<typeof describeRejection>[0]): ClauseSaveOutcome => {
    const view = describeRejection(rejection);
    return { ok: false, message: view.message, ...(view.issues ? { issues: [...view.issues] } : {}) };
  };
  // 프리셋까지 한 트랜잭션 — 프리셋이 거부되면 만든 함수조항도 되돌린다 (ADR-0084 · 저장 한 번)
  return rollbackUnless<ClauseSaveOutcome>(
    services.db,
    async () => {
      const r = await services.clause.create(actor, {
        label: input.label,
        mode: input.mode,
        body: remapOptionSlots(input.body, codes),
        params: input.params ?? [],
        locals: input.locals ?? [],
        options: input.options.map((option) => ({
          label: option.label,
          values: option.values.map((value) => ({ label: value.label, body: textBody(value.text, randomUUID()) })),
        })),
      });
      if (!r.ok) return failed(r.rejection);
      if ((input.presets ?? []).length > 0) {
        // 프리셋은 만든 뒤에 — 옵션 코드가 정해져야 선택을 옮긴다
        const p = await services.clause.setPresets(actor, r.value.code, presetsForSave(input.presets!, input.options, r.value.options, codes));
        if (!p.ok) return failed(p.rejection);
      }
      return { ok: true, code: r.value.code };
    },
    (outcome) => outcome.ok === true,
  );
}
