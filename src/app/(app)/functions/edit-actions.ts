"use server";

/**
 * 함수조항 상세의 저장 · 삭제 — 화면 하나에 저장은 하나다 (디자인원칙 §2 L2 · 기능/함수조항 §4.3).
 *
 * 서비스에는 rename · setBody · addOption … 처럼 잘게 나뉜 API 만 있다. 그 사이의 간극은
 * 여기서 메운다 — 저장된 정의와 화면이 들고 온 값을 견줘 **달라진 것만** 골라 부른다.
 * 새 도메인 API 를 만들지 않는 이유는, 저장 단위가 화면의 사정이지 도메인의 사정이 아니어서다.
 * 대신 전체를 한 트랜잭션으로 감싼다 (`rollbackUnless`, 점검 2026-09-27 H1 · D1) — 어느 단계가 거부되든 이름 · 새 옵션까지 롤백되고,
 * 다시 저장해도 옵션 순번이 타지 않는다.
 */
import { randomUUID } from "node:crypto";

import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import type { Clause } from "@/domain/clause";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";
import { rollbackUnless } from "@/services/txContext";

import type { ClauseEditData, ClauseEditOption, ClauseSaveOutcome } from "./edit-types";
import { isNewCode, remapOptionSlots, textBody, valueText } from "./lib";

type Actor = Awaited<ReturnType<typeof currentActor>>;
type Services = ReturnType<typeof getServices>;
type Failure = Extract<ClauseSaveOutcome, { ok: false }>;

function failed<T>(result: Result<T>): Failure | undefined {
  if (result.ok) return undefined;
  const view = describeRejection(result.rejection);
  return { ok: false, message: view.message, ...(view.issues ? { issues: [...view.issues] } : {}) };
}

export async function saveClauseEditAction(code: string, input: ClauseEditData): Promise<ClauseSaveOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const before = await services.clause.get(code);
  if (!before) return { ok: false, message: `찾을 수 없습니다 — 함수조항 ${code}` };

  return rollbackUnless<ClauseSaveOutcome>(
    services.db,
    async () => {
      if (input.label !== before.label) {
        const error = failed(await services.clause.rename(actor, code, input.label));
        if (error) return error;
      }

      /*
       * 순서가 중요하다 (기능/함수조항 §4.3 「저장」). 본문이 「방금 만든 옵션」을 가리킬 수 있어서다 —
       *  ① 옵션을 먼저 만들어 실제 코드를 받고(`new:1` → `O01`),
       *  ② 그 코드로 본문의 옵션 자리를 고쳐 저장하고,
       *  ③ 남은 옵션의 이름 · 선택지를 맞추고, 뺀 옵션은 마지막에 지운다(본문이 이미 안 가리키므로 안전하다).
       * 본문을 먼저 저장하면 「정의되지 않은 옵션입니다: new:1」로 거절된다.
       */
      const added = await addOptions(actor, services, code, before, input.options);
      if (!("codes" in added)) return added;

      const body = added.codes.size > 0 ? remapOptionSlots(input.body, added.codes) : input.body;
      const bodyChanged = JSON.stringify(body) !== JSON.stringify(before.body);
      // 인자 · 내부 변수가 바뀌면 본문과 한 번에 — 본문이 새 인자를 읽거나 뺀 인자를 더는 안 읽는 중간 상태는 검사 ① 이 거부한다
      // 내부 변수도 같은 저장 — 본문이 새 내부 변수를 읽는 중간 상태도 검사 ① 이 거부한다
      const paramsChanged = input.params !== undefined && JSON.stringify(input.params) !== JSON.stringify(before.params ?? []);
      const localsChanged = input.locals !== undefined && JSON.stringify(input.locals) !== JSON.stringify(before.locals ?? []);
      if (paramsChanged || localsChanged) {
        const error = failed(await services.clause.setParams(actor, code, input.params ?? before.params ?? [], bodyChanged ? body : undefined, localsChanged ? input.locals : undefined));
        if (error) return error;
      } else if (bodyChanged) {
        const error = failed(await services.clause.setBody(actor, code, body));
        if (error) return error;
      }

      const optionError = await syncOptions(actor, services, code, before, input.options);
      if (optionError) return optionError;

      return { ok: true, code };
    },
    (outcome) => outcome.ok === true,
  );
}

/** 새 옵션만 먼저 만들고(선택지 문구까지) `new:*` → 실제 코드 대응표를 돌려준다. */
async function addOptions(actor: Actor, services: Services, code: string, before: Clause, after: readonly ClauseEditOption[]): Promise<{ codes: Map<string, string> } | Failure> {
  const codes = new Map<string, string>();
  const known = new Set(before.options.map((option) => option.code));
  for (const option of after) {
    if (!isNewCode(option.code)) continue;
    const values = option.values.map((value) => ({ label: value.label, body: textBody(value.text, randomUUID()) }));
    const saved = await services.clause.addOption(actor, code, { label: option.label, values });
    const error = failed(saved);
    if (error) return error;
    if (!saved.ok) return { ok: false, message: "옵션을 만들지 못했습니다." };
    const fresh = saved.value.clause.options.find((item) => !known.has(item.code));
    if (fresh) {
      known.add(fresh.code);
      codes.set(option.code, fresh.code);
    }
  }
  return { codes };
}

/**
 * 이름 바뀐 것 · 선택지 · 뺀 것을 맞춘다. 새 옵션은 `addOptions` 가 이미 만들었다.
 *
 * 옵션마다 **이름 → 선택지 추가 → 선택지 이름 · 문구 → 선택지 삭제** 순, 뺀 옵션은 맨 끝이다 (점검 2026-09-27 H2 ②). 선택지 삭제는
 * 「2개 미만이면 거부」(최소 구조)라, 선택지가 2개인 옵션에서 하나를 ✕ 하고 새 것을 더한 교체(최종 2개)를 빼기부터 돌리면
 * 중간 상태에서 거부됐다. 추가를 앞에 두면 중간 개수가 언제나 최종 개수 이상이라, 최종 상태가 유효하면 어느 단계도 걸리지 않는다.
 */
async function syncOptions(actor: Actor, services: Services, code: string, before: Clause, after: readonly ClauseEditOption[]): Promise<Failure | undefined> {
  for (const option of after) {
    if (isNewCode(option.code)) continue;
    const saved = before.options.find((item) => item.code === option.code);
    if (!saved) continue;
    if (option.label !== saved.label) {
      const error = failed(await services.clause.renameOption(actor, code, option.code, option.label));
      if (error) return error;
    }

    for (const value of option.values) {
      if (!isNewCode(value.code)) continue;
      const error = failed(await services.clause.addOptionValue(actor, code, option.code, { label: value.label, body: textBody(value.text, randomUUID()) }));
      if (error) return error;
    }
    for (const value of option.values) {
      const savedValue = isNewCode(value.code) ? undefined : saved.values.find((item) => item.code === value.code);
      if (!savedValue) continue;
      if (savedValue.label !== value.label) {
        const error = failed(await services.clause.renameOptionValue(actor, code, option.code, value.code, value.label));
        if (error) return error;
      }
      // 문구는 평문 한 줄 — 글이 바뀐 것만 고친다(평문 규칙 이전 선택지의 슬롯은 손대지 않으면 남는다)
      if (valueText(savedValue.body) !== value.text) {
        const body = textBody(value.text, savedValue.body.find((node) => node.kind === "text")?.id ?? randomUUID());
        const error = failed(await services.clause.setOptionValueBody(actor, code, option.code, value.code, body));
        if (error) return error;
      }
    }
    const keptValues = new Set(option.values.filter((value) => !isNewCode(value.code)).map((value) => value.code));
    for (const value of saved.values) {
      if (keptValues.has(value.code)) continue;
      const error = failed(await services.clause.removeOptionValue(actor, code, option.code, value.code));
      if (error) return error;
    }
  }

  const kept = new Set(after.filter((option) => !isNewCode(option.code)).map((option) => option.code));
  for (const option of before.options) {
    if (kept.has(option.code)) continue;
    const error = failed(await services.clause.removeOption(actor, code, option.code));
    if (error) return error;
  }
  return undefined;
}

/** 🗑 — 편집자는 거부, 관리자는 깨질 사용처 확인(`confirm`) 뒤 삭제 (기능/함수조항 §4.3). */
export async function removeClauseEditAction(code: string, confirm = false): Promise<EditOutcome> {
  const result = await getServices().clause.remove(await currentActor(), code, { confirm });
  if (result.ok) return { ok: true };
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token: "delete" };
  return { ok: false, message: describeRejection(result.rejection).message };
}
