/**
 * 조건 팝업 문맥 조립 (서버 전용 · 순수) — 담보 트리 · 구분자(타입 · 읽는 폼) · 열린 폼 · 빠른 조건 (ADR-0066 §4~§7).
 *
 * `ConditionDialog` 가 좌변 트리 · 타입별 우변 입력 · 「항상 거짓」 경고를 그리는 데 필요한 자료를
 * 한 번에 만든다. 클라이언트로 그대로 건너가므로(JSON) 함수·Map 은 담지 않는다 — `ConditionContext` 참고.
 */
import { discriminatorResultType, isFormOpened, type Discriminator, type EnumDef } from "@/domain/catalog";
import { nodesOf, slotsOfNode, type Coverage, type MasterValues } from "@/domain/coverage";
import { extractRefs, parse } from "@/domain/expression";
import { findMasterField, formsOfLevel, MASTER, type MasterTree } from "@/domain/master";
import type { Code } from "@/domain/types";

import type { ConditionContext, CtxDiscriminator } from "./types";

/** 구분자가 (구분자 참조를 타고) 읽는 폼 키. 순환은 visiting 으로 끊는다. */
function formsRead(def: Discriminator, byCode: ReadonlyMap<Code, Discriminator>, master: MasterTree, visiting: ReadonlySet<Code> = new Set()): Set<Code> {
  const out = new Set<Code>();
  if (visiting.has(def.code)) return out;
  const parsed = parse(def.expression);
  if (!parsed.ok) return out;
  for (const { ref } of extractRefs(parsed.value)) {
    if (ref.kind === "master") {
      const f = findMasterField(`${ref.form}.${ref.field}`, master);
      if (f) out.add(f.form.key);
    } else if (ref.kind === "discriminator") {
      const inner = byCode.get(ref.code);
      if (inner) for (const k of formsRead(inner, byCode, master, new Set([...visiting, def.code]))) out.add(k);
    }
  }
  return out;
}

export function buildConditionContext(input: {
  coverage?: Coverage;
  values?: MasterValues;
  discriminators: readonly Discriminator[];
  enums: readonly EnumDef[];
  master?: MasterTree;
}): ConditionContext {
  const master = input.master ?? MASTER;
  const byCode = new Map(input.discriminators.map((d) => [d.code, d]));
  const enumOf = (code: Code) => input.enums.find((e) => e.code === code);
  const optionalForms = new Set(master.filter((f) => f.optional).map((f) => f.key));

  const discriminators: CtxDiscriminator[] = input.discriminators.map((d) => {
    const type = discriminatorResultType(d, master, byCode);
    const forms = [...formsRead(d, byCode, master)];
    const out: CtxDiscriminator = { code: d.code, label: d.label, level: d.level, forms };
    if (type) out.type = type;
    if (type && (type.kind === "enum" || type.kind === "list<enum>")) {
      out.enumOptions = [...(enumOf(type.enumCode)?.values ?? [])].sort((a, b) => a.order - b.order).map((v) => ({ code: v.code, label: v.label }));
    }
    return out;
  });

  const openedForms: Record<string, Code[]> = {};
  if (input.coverage && input.values) {
    for (const node of nodesOf(input.coverage)) {
      const slots = slotsOfNode(input.values, node.id);
      const opened = formsOfLevel(node.level, master)
        .filter((f) => f.optional && isFormOpened(f, (p) => slots.get(p)))
        .map((f) => f.key);
      if (opened.length === 0) continue;
      // 집계 구분자는 하위 급부를 읽는다. 자기 값과 후손 값을 합치되 형제에게는 전파하지 않는다.
      for (const target of [node, ...node.ancestors]) {
        openedForms[target.id] = [...new Set([...(openedForms[target.id] ?? []), ...opened])];
      }
    }
  }

  const quick = discriminators
    .filter((d) => d.level === "coverage" && d.type?.kind === "boolean" && d.forms.length > 0 && d.forms.every((f) => optionalForms.has(f)))
    .map((d) => ({ label: `${d.label} = 참`, source: `${d.code} = true` }));

  const ctx: ConditionContext = { discriminators, openedForms, quick };
  if (input.coverage) {
    const nodes = nodesOf(input.coverage).map((n) => ({
      id: n.id,
      level: n.level,
      name: n.name,
      ...(n.ancestors.length > 0 ? { parentId: n.ancestors[n.ancestors.length - 1]!.id } : {}),
    }));
    ctx.coverage = { id: input.coverage.id, name: input.coverage.name, nodes };
  }
  return ctx;
}
