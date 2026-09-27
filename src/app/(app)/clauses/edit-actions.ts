"use server";

/**
 * 공용조항 상세의 저장 · 삭제 — 화면 하나에 저장은 하나다 (디자인원칙 §2 L2, 2026-09-06 확정).
 *
 * 서비스에는 rename · setBody · addOption … 처럼 잘게 나뉜 API 만 있다. 그 사이의 간극은
 * 여기서 메운다 — 저장된 정의와 화면이 들고 온 값을 견줘 **달라진 것만** 골라 부른다.
 * 새 도메인 API 를 만들지 않는 이유는, 저장 단위가 화면의 사정이지 도메인의 사정이 아니어서다.
 * 대신 전체를 한 트랜잭션으로 감싼다 (`saveOnce`, 점검 2026-09-27 H1 · D1) — 어느 단계가 거부되든 이름 · 새 옵션까지 롤백되고,
 * 다시 저장해도 옵션 순번이 타지 않는다.
 */
import type { EditOutcome } from "@/app/_lib/edit";
import { describeRejection } from "@/app/_lib/rejection";
import { saveOnce } from "@/app/_lib/saveOnce";
import { isInlineBody, type Block, type ClauseBody, type Inline } from "@/domain/clause";
import type { Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { ClauseEditData, ClauseEditOption } from "./edit-types";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

const isNew = (code: string) => code.startsWith("new:");

export async function saveClauseEditAction(code: string, input: ClauseEditData): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const before = await services.clause.get(code);
  if (!before) return { ok: false, message: `찾을 수 없습니다 — 공용조항 ${code}` };

  return saveOnce(services, async () => {
    if (input.label !== before.label) {
      const error = failed(await services.clause.rename(actor, code, input.label), "label");
      if (error) return error;
    }

    /*
     * 순서가 중요하다. 본문이 「방금 만든 옵션」을 가리킬 수 있어서다 —
     *  ① 옵션을 먼저 만들어 실제 코드를 받고(`new:1` → `O01`),
     *  ② 그 코드로 본문의 옵션 자리를 고쳐 저장하고,
     *  ③ 남은 옵션의 이름 · 선택지를 맞추고, 뺀 옵션은 마지막에 지운다(본문이 이미 안 가리키므로 안전하다).
     * 본문을 먼저 저장하면 「정의되지 않은 옵션입니다: new:1」로 거절된다.
     */
    const added = await addOptions(actor, services, code, before.options, input.options);
    if ("ok" in added) return added;

    const body = added.codes.size > 0 ? remapOptionSlots(input.body, added.codes) : input.body;
    if (JSON.stringify(body) !== JSON.stringify(before.body)) {
      const error = failed(await services.clause.setBody(actor, code, body), "body");
      if (error) return error;
    }

    const optionError = await syncOptions(actor, services, code, before.options, input.options);
    if (optionError) return optionError;

    return { ok: true };
  });
}

/** 새 옵션만 먼저 만들고 `new:*` → 실제 코드 대응표를 돌려준다. */
async function addOptions(
  actor: Awaited<ReturnType<typeof currentActor>>,
  services: ReturnType<typeof getServices>,
  code: string,
  before: readonly { code: string }[],
  after: readonly ClauseEditOption[],
): Promise<{ codes: Map<string, string> } | EditOutcome> {
  const codes = new Map<string, string>();
  const known = new Set(before.map((option) => option.code));
  for (const option of after) {
    if (!isNew(option.code)) continue;
    const values = option.values.map((value) => ({ label: value.label }));
    const saved = await services.clause.addOption(actor, code, { label: option.label, values });
    const error = failed(saved, "option");
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

/** 본문의 옵션 자리에 박힌 임시 코드를 실제 코드로 바꾼다. */
function remapOptionSlots(body: ClauseBody, codes: ReadonlyMap<string, string>): ClauseBody {
  const remapInline = (nodes: readonly Inline[]): Inline[] =>
    nodes.map((node) => {
      if (node.kind === "optionSlot") {
        const next = codes.get(node.optionCode);
        return next ? { ...node, optionCode: next } : node;
      }
      if (node.kind === "inlineCond") {
        return { ...node, branches: node.branches.map((branch) => ({ ...branch, children: remapInline(branch.children) })) };
      }
      return node;
    });

  const remapBlocks = (nodes: readonly Block[]): Block[] =>
    nodes.map((node) => {
      if (node.kind === "condBlock") {
        return { ...node, branches: node.branches.map((branch) => ({ ...branch, children: remapBlocks(branch.children) })) };
      }
      return {
        ...node,
        children: remapInline(node.children),
        ...(node.items
          ? {
              items: node.items.map((item) => ({
                ...item,
                children: remapInline(item.children),
                ...(item.subitems ? { subitems: item.subitems.map((sub) => ({ ...sub, children: remapInline(sub.children) })) } : {}),
              })),
            }
          : {}),
      };
    });

  return isInlineBody(body) ? remapInline(body) : remapBlocks(body as Block[]);
}

/**
 * 이름 바뀐 것 · 선택지 · 뺀 것을 맞춘다. 새 옵션은 `addOptions` 가 이미 만들었다.
 *
 * 옵션마다 **이름 → 선택지 추가 → 선택지 이름 → 선택지 삭제** 순, 뺀 옵션은 맨 끝이다 (점검 2026-09-27 H2 ②). 선택지 삭제는
 * 「2개 미만이면 거부」(최소 구조)라, 선택지가 2개인 옵션에서 하나를 ✕ 하고 새 것을 더한 교체(최종 2개)를 빼기부터 돌리면
 * 중간 상태에서 거부됐다. 추가를 앞에 두면 중간 개수가 언제나 최종 개수 이상이라, 최종 상태가 유효하면 어느 단계도 걸리지 않는다.
 */
async function syncOptions(
  actor: Awaited<ReturnType<typeof currentActor>>,
  services: ReturnType<typeof getServices>,
  code: string,
  before: readonly { code: string; label: string; values: readonly { code: string; label: string }[] }[],
  after: readonly ClauseEditOption[],
): Promise<EditOutcome | undefined> {
  for (const option of after) {
    if (isNew(option.code)) continue;

    const saved = before.find((item) => item.code === option.code);
    if (!saved) continue;
    if (option.label !== saved.label) {
      const error = failed(await services.clause.renameOption(actor, code, option.code, option.label), "option");
      if (error) return error;
    }

    for (const value of option.values) {
      if (!isNew(value.code)) continue;
      const error = failed(await services.clause.addOptionValue(actor, code, option.code, { label: value.label }), "optionValue");
      if (error) return error;
    }
    for (const value of option.values) {
      const savedValue = isNew(value.code) ? undefined : saved.values.find((item) => item.code === value.code);
      if (savedValue && savedValue.label !== value.label) {
        const error = failed(await services.clause.renameOptionValue(actor, code, option.code, value.code, value.label), "optionValue");
        if (error) return error;
      }
    }
    const keptValues = new Set(option.values.filter((value) => !isNew(value.code)).map((value) => value.code));
    for (const value of saved.values) {
      if (keptValues.has(value.code)) continue;
      const error = failed(await services.clause.removeOptionValue(actor, code, option.code, value.code), "optionValue");
      if (error) return error;
    }
  }

  const kept = new Set(after.filter((option) => !isNew(option.code)).map((option) => option.code));
  for (const option of before) {
    if (kept.has(option.code)) continue;
    const error = failed(await services.clause.removeOption(actor, code, option.code), "option");
    if (error) return error;
  }
  return undefined;
}

export async function removeClauseEditAction(code: string, confirm = false): Promise<EditOutcome> {
  const result = await getServices().clause.remove(await currentActor(), code, { confirm });
  return failed(result, "delete") ?? { ok: true };
}
