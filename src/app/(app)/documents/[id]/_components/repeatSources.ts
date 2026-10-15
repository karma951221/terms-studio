/**
 * 반복 블록 원천 고르기의 순수 재료 (ADR-0077 · 기능/문면 §4.3) — 팝업의 원천 칸 후보 · 인자 연결 칸의 「반복의 현재 원소」 후보.
 *
 * 원천 칸 후보는 자리로 갈린다(한 단계 중첩 — 안쪽 원천은 바깥 현재 원소의 목록뿐):
 * - 반복 밖: 세목 폼마다 「<폼>종마다」(모든 선택지 · 참거짓 필드 = 예인 선택지) + 목록값 필드의 합집합(열거값 참거짓 필드 = 예로 거르기).
 * - 세목 선택지 반복 안: 바깥 종의 목록값 필드마다 「<필드>마다」.
 * 칸 값은 원천 JSON 이다(`sourceOfValue` 로 되돌린다).
 */
import type { EnumDef } from "@/domain/catalog";
import type { LoopElementType } from "@/domain/clause";
import { isRepeatSource, loopElementType, loopsOnPath, repeatLabel, type RepeatNode, type RepeatSource, type SlotName, type TreeIndex } from "@/domain/document";
import { fieldsOfForm, formsOfLevel, MASTER, type MasterTree } from "@/domain/master";
import type { Id } from "@/domain/types";

export interface RepeatChoice {
  value: string;
  label: string;
  source: RepeatSource;
}

export function sourceValue(source: RepeatSource): string {
  return JSON.stringify(source);
}

export function sourceOfValue(value: string): RepeatSource | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRepeatSource(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 자리를 감싼 반복(블록 · 문장 안) — 바깥 → 안쪽, 자리 자신(반복이면)도 든다. 노드 id 또는 가지 id.
 * 「비었을 때」 칸 안 노드는 그 반복을 빼고 센다 — 칸은 원소 문맥 밖이다(ADR-0088 결정 3). `slot` 이 `fallback` 이면 그 반복의 칸 자리다(자신을 뺀다).
 */
export function loopsAround(ix: TreeIndex, id: Id, slot?: SlotName): RepeatNode[] {
  const path = ix.nodes.get(id)?.path ?? ix.branches.get(id)?.path ?? [];
  return loopsOnPath(ix, path, slot === "fallback" ? id : undefined);
}

/**
 * 「현재 종」 — 감싼 반복 중 세목 선택지(종) 반복이 있으면 그 이름(별칭 또는 원천 이름). 안쪽 사유 반복 안에서도 바깥 종이 커서다.
 * 슬롯 고르기의 「현재 종」 묶음(`builtin.plan.name` · `builtin.plan.number`)이 이것으로 선다 — 합집합 · 반복 밖에는 종 커서가 없다 (ADR-0077 결정 3).
 */
export function currentPlanOf(loops: readonly RepeatNode[], opts: { enumOf?: (code: string) => EnumDef | undefined; master?: MasterTree } = {}): { name: string } | undefined {
  const plan = [...loops].reverse().find((f) => isRepeatSource(f.source) && f.source.kind === "planOptions");
  if (!plan) return undefined;
  return { name: plan.alias ?? repeatLabel(plan.source, { ...(opts.master ? { master: opts.master } : {}), ...(opts.enumOf ? { enumOf: opts.enumOf } : {}) }) };
}

/**
 * 「현재 값」 — 감싼 반복 중 원소가 열거값인 가장 안쪽 반복의 이름과 그 열거형의 글 필드. 슬롯 고르기의 「현재 값」 묶음(`builtin.value.name` ·
 * `builtin.value.<필드키>`)이 이것으로 선다 — 열거값 반복 밖에는 없다 (ADR-0088 결정 1). 열거형을 모르면 필드 없이 값 이름만.
 */
export function currentValueOf(loops: readonly RepeatNode[], opts: { enumOf?: (code: string) => EnumDef | undefined; master?: MasterTree } = {}): { name: string; fields: { key: string; label: string }[] } | undefined {
  for (let i = loops.length - 1; i >= 0; i--) {
    const f = loops[i];
    if (!isRepeatSource(f.source)) continue;
    const outer = i > 0 && isRepeatSource(loops[i - 1].source) ? loops[i - 1].source : undefined;
    const type = loopElementType(f.source, outer, opts.master);
    if (type?.kind !== "enum") continue;
    const name = f.alias ?? repeatLabel(f.source, { ...(outer ? { outer } : {}), ...(opts.master ? { master: opts.master } : {}), ...(opts.enumOf ? { enumOf: opts.enumOf } : {}) });
    const fields = (opts.enumOf?.(type.enumCode)?.fields ?? []).filter((x) => x.type === "string").map((x) => ({ key: x.key, label: x.label }));
    return { name, fields };
  }
  return undefined;
}

/** 원천 칸 후보 — `outer` 는 이 자리를 감싼 가장 안쪽 반복(없으면 반복 밖). 두 단계 안(반복 안 반복 안)이면 후보가 없다. 블록 · 문장 안 반복 공통. */
export function repeatChoices(opts: { outer?: RepeatNode; depth: number; enumOf?: (code: string) => EnumDef | undefined; master?: MasterTree }): RepeatChoice[] {
  const master = opts.master ?? MASTER;
  const label = (source: RepeatSource) => repeatLabel(source, { ...(opts.outer && isRepeatSource(opts.outer.source) ? { outer: opts.outer.source } : {}), master, ...(opts.enumOf ? { enumOf: opts.enumOf } : {}) });
  const choice = (source: RepeatSource, suffix = ""): RepeatChoice => ({ value: sourceValue(source), label: `${label(source)}${suffix}`, source });
  if (opts.depth >= 2) return [];
  if (opts.outer) {
    const outer = opts.outer.source;
    if (!isRepeatSource(outer) || outer.kind !== "planOptions") return [];
    const form = formsOfLevel("plan", master).find((f) => f.key === outer.form);
    return (form ? fieldsOfForm(form) : []).filter((x) => x.field.type.kind === "list<enum>").map((x) => choice({ kind: "listOfCurrent", loop: opts.outer!.id, field: x.field.key }, " — 현재 종의 목록"));
  }
  const out: RepeatChoice[] = [];
  for (const form of formsOfLevel("plan", master)) {
    const fields = fieldsOfForm(form);
    const booleans = fields.filter((x) => x.field.type.kind === "boolean");
    out.push(choice({ kind: "planOptions", form: form.key }, " — 모든 선택지"));
    for (const b of booleans) out.push(choice({ kind: "planOptions", form: form.key, filter: `${form.key}.${b.field.key} = true` }, ` — ${b.field.label} = 예인 선택지`));
    const filter = booleans[0] ? `${form.key}.${booleans[0].field.key} = true` : undefined;
    for (const list of fields.filter((x) => x.field.type.kind === "list<enum>")) {
      const t = list.field.type as { kind: "list<enum>"; enumCode: string };
      const base = { kind: "union" as const, form: form.key, field: list.field.key, ...(filter ? { filter } : {}) };
      out.push(choice(base, booleans[0] ? ` — ${booleans[0].field.label} = 예인 선택지` : ""));
      for (const f of (opts.enumOf?.(t.enumCode)?.fields ?? []).filter((x) => x.type === "boolean")) out.push(choice({ ...base, where: { field: f.key, value: true } }));
    }
  }
  return out;
}

/** 인자 연결 칸의 「반복의 현재 원소」 후보 — 감싼 반복마다 원소 타입 · 이름. */
export function loopChoices(loops: readonly RepeatNode[], opts: { enumOf?: (code: string) => EnumDef | undefined; master?: MasterTree } = {}): { id: Id; label: string; type: LoopElementType }[] {
  return loops.flatMap((f, i) => {
    if (!isRepeatSource(f.source)) return [];
    const outer = i > 0 && isRepeatSource(loops[i - 1].source) ? loops[i - 1].source : undefined;
    const type = loopElementType(f.source, outer, opts.master);
    if (!type) return [];
    const name = f.alias ?? repeatLabel(f.source, { ...(outer ? { outer } : {}), ...(opts.master ? { master: opts.master } : {}), ...(opts.enumOf ? { enumOf: opts.enumOf } : {}) });
    return [{ id: f.id, label: `${type.kind === "planOptions" ? "현재 종" : "현재 원소"} — ${name}`, type }];
  });
}
