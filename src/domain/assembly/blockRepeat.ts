/**
 * 블록 반복의 원소 (순수) — 조립이 반복 블록을 펼칠 때 원천(document/blockRepeat.ts `RepeatSource`)을 원소 목록으로 푼다 (ADR-0077 결정 2 · 3).
 *
 * - 세목 선택지(`planOptions`): 상품의 세목 선택지 중 그 폼의 것 — **세목 선택지 순서**(축 · 번호) — 가운데 거름이 참인 것.
 *   거름이 읽는 값이 미입력인 종(세목 값 없는 종)은 건너뛴다. 원소 = 종(세목 선택지 id).
 * - 바깥 현재 원소의 목록(`listOfCurrent`): 바깥 반복의 현재 종이 가진 목록값(복수) — **열거형 순서**. 원소 = 열거값 코드.
 * - 합집합(`union`): 거른 종들의 목록값을 합친 것(같은 값 한 번 · 열거형 순서) ∩ 열거값 필드 거름. 원소 = 열거값 코드.
 * - 목록값 · 필드가 미입력이면 오류(조용한 거짓 없음 — ADR-0004). 지운 열거값은 읽을 때 「없는 값」 오류다(context.ts `checkEnum`).
 * - 담보 트리(`subCoverages` · `benefits` · `benefitsOfCurrent`, ADR-0087 결정 5): 특약 문맥의 행 원천(`deps.rows` — 스냅샷 트리)의 노드 —
 *   **트리 순서**(키 순 아님). 원소 = 스냅샷 노드, 복제 접미사 = 노드 키(평평한 급부는 키 경로 `01.2`) — 인쇄 표기는 트리 순번 그대로(결정 9).
 */

import { enumCoordinate, enumFieldValue } from "../catalog/fields";
import type { EnumDef } from "../catalog/types";
import { isRepeatSource, type RepeatSource } from "../document/blockRepeat";
import { evaluate, parse, type EvalContext } from "../expression";
import { findMasterField, MASTER, type MasterTree } from "../master";
import type { RowSource, StructNode } from "../structure";
import type { Code, Coordinate, Id, Issue } from "../types";
import type { AssemblyPlanOption } from "./types";

/** 반복의 원소 — 종(세목 선택지) · 열거값 · 담보 트리 노드. `repeatElementId` 가 복제 접미사다. */
export type RepeatElement =
  | { kind: "planOption"; id: Id; form: Code }
  | { kind: "enumValue"; code: Code; enumCode: Code }
  /** 담보 트리 원소 — 스냅샷 노드 (ADR-0087 결정 5). `path` = 키 경로, `suffix` = 복제 접미사 원소(세부보장 `01` · 평평한 급부 `01.2` · 현재 세부보장의 급부 `2`). */
  | { kind: "coverageNode"; level: "subCoverage" | "benefit"; id: Id; path: string; suffix: string };

/** 복제 접미사에 쓰는 원소 id — 종이면 세목 선택지 id, 열거값이면 값 코드, 담보 트리 노드면 노드 키(중첩이면 바깥 접미사와 이어져 유일하다). */
export function repeatElementId(e: RepeatElement): string {
  return e.kind === "planOption" ? e.id : e.kind === "enumValue" ? e.code : e.suffix;
}

export interface RepeatDeps {
  options: readonly AssemblyPlanOption[];
  /** 세목 선택지 하나를 커서로 세운 문맥. */
  optionContext(id: Id): EvalContext | undefined;
  /** 바깥 반복의 현재 원소 — 템플릿 반복 id 로. */
  current(loop: Id): RepeatElement | undefined;
  enums: ReadonlyMap<Code, EnumDef>;
  master?: MasterTree;
  /** 특약 문맥의 행 원천(스냅샷 트리) — 담보 트리 원천의 재료. 없으면(보통약관) 담보 트리 원천은 오류. */
  rows?: RowSource<EvalContext>;
  /** 미결 → 조립 오류. */
  explain(reason: string, at: Coordinate): Issue;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; issue: Issue };

/** 실패에 원천 좌표를 얹는다 — 열거형이 고치는 곳인 오류(필드 미입력 · 없는 필드). */
const withEnumSource = (o: Outcome<never>, source: Coordinate): Outcome<never> => (o.ok ? o : { ok: false, issue: { ...o.issue, source } });

export function repeatElements(source: RepeatSource | unknown, deps: RepeatDeps, at: Coordinate): Outcome<RepeatElement[]> {
  const master = deps.master ?? MASTER;
  const fail = (kind: Issue["kind"], message: string, refPath?: string): Outcome<never> => ({ ok: false, issue: { kind, message, at: { ...at, ...(refPath !== undefined ? { refPath } : {}) } } });
  const s = source as RepeatSource;
  if (!isRepeatSource(source)) {
    return fail("structure", "반복 블록의 원천이 없습니다 — 편집기에서 원천을 고른다");
  }

  /** 그 폼의 종 가운데 거름이 참인 것 (세목 선택지 순서). 거름이 읽는 값이 미입력인 종은 건너뛴다. */
  const kept = (form: Code, filter: string | undefined): Outcome<AssemblyPlanOption[]> => {
    const options = deps.options.filter((o) => o.planTypeCode === form);
    if (filter === undefined || filter.trim() === "") return { ok: true, value: options };
    const parsed = parse(filter, at);
    if (!parsed.ok) return parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? { ok: false, issue: parsed.rejection.issues[0] } : fail("syntax", "반복 원천 거름을 읽을 수 없습니다");
    const out: AssemblyPlanOption[] = [];
    for (const o of options) {
      const ctx = deps.optionContext(o.id);
      if (!ctx) return fail("brokenRef", `세목 선택지 ${o.name} 의 문맥을 만들 수 없습니다`);
      const r = evaluate(parsed.value, { ...ctx, coordinate: at });
      if (r.kind === "error") {
        if (r.issue.kind === "notEntered") continue; // 세목 값 없는 종 — 원소가 아니다
        return { ok: false, issue: r.issue };
      }
      if (r.kind === "undetermined") return { ok: false, issue: deps.explain(r.reason, at) };
      if (typeof r.value !== "boolean") return fail("typeMismatch", "반복 원천 거름의 결과가 참거짓이 아닙니다");
      if (r.value) out.push(o);
    }
    return { ok: true, value: out };
  };

  /** 종 하나의 목록값(복수) 코드. */
  const listOf = (optionId: Id, form: Code, field: Code): Outcome<string[]> => {
    const ctx = deps.optionContext(optionId);
    if (!ctx) return fail("brokenRef", `세목 선택지 ${optionId} 의 문맥을 만들 수 없습니다`);
    const r = evaluate({ kind: "ref", ref: { kind: "master", form, field } }, { ...ctx, coordinate: { ...at, refPath: `${form}.${field}` } });
    if (r.kind === "error") return { ok: false, issue: r.issue };
    if (r.kind === "undetermined") return { ok: false, issue: deps.explain(r.reason, at) };
    return { ok: true, value: (Array.isArray(r.value) ? r.value : [r.value]).filter((v): v is string => typeof v === "string") };
  };

  const enumOf = (form: Code, field: Code): Outcome<EnumDef> => {
    const t = findMasterField(`${form}.${field}`, master)?.field.type;
    if (!t || t.kind !== "list<enum>") return fail("typeMismatch", `반복 원천 필드 ${form}.${field} 은(는) 목록값(복수) 필드가 아닙니다`, `${form}.${field}`);
    const def = deps.enums.get(t.enumCode);
    return def ? { ok: true, value: def } : fail("brokenRef", `열거형 ${t.enumCode} 이(가) 없습니다`, t.enumCode);
  };

  /** 열거형 순서로 — 정의에 없는 코드는 읽을 때 이미 「없는 값」 오류다. */
  const ordered = (def: EnumDef, codes: ReadonlySet<string>): RepeatElement[] => def.values.filter((v) => codes.has(v.code)).map((v) => ({ kind: "enumValue", code: v.code, enumCode: def.code }));

  switch (s.kind) {
    case "planOptions": {
      const r = kept(s.form, s.filter);
      return r.ok ? { ok: true, value: r.value.map((o) => ({ kind: "planOption", id: o.id, form: s.form })) } : r;
    }
    case "listOfCurrent": {
      const cur = deps.current(s.loop);
      if (!cur || cur.kind !== "planOption") return fail("structure", "현재 원소의 목록 원천이 바깥 반복(종) 밖에 있습니다");
      const def = enumOf(cur.form, s.field);
      if (!def.ok) return def;
      const codes = listOf(cur.id, cur.form, s.field);
      return codes.ok ? { ok: true, value: ordered(def.value, new Set(codes.value)) } : codes;
    }
    case "union": {
      const def = enumOf(s.form, s.field);
      if (!def.ok) return def;
      const options = kept(s.form, s.filter);
      if (!options.ok) return options;
      const seen = new Set<string>();
      for (const o of options.value) {
        const codes = listOf(o.id, s.form, s.field);
        if (!codes.ok) return codes;
        codes.value.forEach((c) => seen.add(c));
      }
      let elements = ordered(def.value, seen);
      if (s.where) {
        const out: RepeatElement[] = [];
        for (const e of elements) {
          const code = (e as { code: Code }).code;
          const f = enumFieldValue(def.value, code, s.where.field);
          // 고치는 곳은 그 열거형 — 원천 좌표를 실어 「고치러 가기」가 /enums/<코드> 로 간다
          if (f.kind === "notEntered") return withEnumSource(fail("notEntered", `열거값 ${code} 의 필드 ${def.value.fields?.find((x) => x.key === s.where!.field)?.label ?? s.where.field} 이(가) 미입력입니다 — 열거형 ${def.value.code} 에서 값을 넣는다`, code), enumCoordinate(def.value, code));
          if (f.kind !== "value") return withEnumSource(fail("brokenRef", `합집합 거름 필드 ${s.where.field} 이(가) 열거형 ${def.value.code} 에 없습니다`, s.where.field), enumCoordinate(def.value));
          if (f.value === s.where.value) out.push(e);
        }
        elements = out;
      }
      return { ok: true, value: elements };
    }
    case "subCoverages":
    case "benefits":
    case "benefitsOfCurrent": {
      if (!deps.rows) return fail("structure", "담보 트리 반복은 문맥 담보가 있는 문서(담보약관)에서만 펼칩니다");
      const { root, providers } = deps.rows;
      // 제공자는 order 순으로 낸다 — 트리 순서
      const subsOf = (): StructNode[] => providers.coverage?.children(root) ?? [];
      const bensOf = (sub: StructNode): StructNode[] => providers.subCoverage?.children(sub) ?? [];
      const node = (level: "subCoverage" | "benefit", n: StructNode, path: string, suffix: string): RepeatElement => ({ kind: "coverageNode", level, id: n.id, path, suffix });
      if (s.kind === "subCoverages") return { ok: true, value: subsOf().map((sub) => node("subCoverage", sub, sub.key!, sub.key!)) };
      if (s.kind === "benefits") return { ok: true, value: subsOf().flatMap((sub) => bensOf(sub).map((b) => node("benefit", b, `${sub.key}.${b.key}`, `${sub.key}.${b.key}`))) };
      const cur = deps.current(s.loop);
      if (!cur || cur.kind !== "coverageNode" || cur.level !== "subCoverage") return fail("structure", "「현재 세부보장의 급부마다」가 「세부보장마다」 반복 밖에 있습니다");
      const sub = subsOf().find((x) => x.id === cur.id);
      return { ok: true, value: sub ? bensOf(sub).map((b) => node("benefit", b, `${cur.path}.${b.key}`, b.key!)) : [] };
    }
  }
}
