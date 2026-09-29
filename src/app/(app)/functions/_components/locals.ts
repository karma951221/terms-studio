/**
 * 함수조항 내부 변수 화면의 순수 재료 (최종 결정 2 · 18 · 기능/함수조항 §4.3) — 내부 변수 표의 식 글 ⇄ 저장 식, 조건 · 슬롯 고르기의 「내부 변수」 칸.
 *
 * 식은 저장할 때 열거값 필드를 **키**(F01)로, 화면에서는 **이름**(약관표시명)으로 적는다(ADR-0005 · P2 인계). 대상의 열거형은 인자 · 내부 변수 타입으로 안다.
 * 글이 식으로 안 읽히면 바꾸지 않는다 — 저장 검사가 그 자리의 문법 오류를 알린다.
 */
import { checkLocals, enumInfoOf, planFieldType, type LocalDef, type ParamDef } from "@/domain/clause";
import type { EnumDef } from "@/domain/catalog";
import { format, inferType, parse, type EnumReadTypes, type Expr, type ExprType } from "@/domain/expression";

import type { CtxDiscriminator } from "@/app/(app)/documents/[id]/_components/condition/types";

import { fieldEntries, type EnumChoice } from "./params";

/** 화면 재료(EnumChoice) → 도메인 모양 — 검사 · 추론이 쓴다. */
function enumDefOf(e: EnumChoice): EnumDef {
  return {
    code: e.code,
    label: e.label,
    values: e.values.map((v, i) => ({ code: v.code, label: v.label, order: i })),
    fields: (e.fields ?? []).map((f, i) => ({ key: f.key, label: f.label, type: f.type, order: i + 1 })),
  } as EnumDef;
}

/** 앞에서부터 쌓은 내부 변수 타입 (관대 — 검사가 아니다). `upTo` 앞까지만. */
function typesOf(params: readonly ParamDef[], locals: readonly LocalDef[], upTo = locals.length): EnumReadTypes {
  const p = new Map(params.map((x) => [x.name, x.type as ExprType] as const));
  const l = new Map<string, ExprType>();
  const types: EnumReadTypes = { params: (n) => p.get(n), locals: (n) => l.get(n), planField: planFieldType() };
  for (const def of locals.slice(0, upTo)) {
    const parsed = parse(def.expr);
    const t = parsed.ok ? inferType(parsed.value, types) : undefined;
    if (t && !l.has(def.name)) l.set(def.name, t);
  }
  return types;
}

/** 필드 이름 ⇄ 키를 바꿔 쓴 식 글. `toKey` 면 이름 → 키(저장), 아니면 키 → 이름(화면). */
function rewriteFields(src: string, types: EnumReadTypes, enums: readonly EnumChoice[], toKey: boolean): string {
  const parsed = parse(src);
  if (!parsed.ok) return src;
  const swap = (target: Expr, field: string): string => {
    const t = inferType(target, types);
    const fields = t && "enumCode" in t ? (enums.find((e) => e.code === t.enumCode)?.fields ?? []) : [];
    const hit = toKey ? fields.find((f) => f.label === field) : fields.find((f) => f.key === field);
    return hit ? (toKey ? hit.key : hit.label) : field;
  };
  const walk = (e: Expr): Expr => {
    switch (e.kind) {
      case "member":
        return { ...e, target: walk(e.target), field: swap(e.target, e.field) };
      case "call": {
        const target = walk(e.target);
        return e.op === "거르기" ? { ...e, target, field: swap(e.target, e.field) } : { ...e, target };
      }
      case "not":
        return { ...e, operand: walk(e.operand) };
      case "and":
      case "or":
      case "compare":
        return { ...e, left: walk(e.left), right: walk(e.right) };
      default:
        return e;
    }
  };
  return format(walk(parsed.value));
}

/** 저장 모양 → 화면 글 (필드 키 → 이름). */
export function localsForDisplay(params: readonly ParamDef[], locals: readonly LocalDef[], enums: readonly EnumChoice[]): LocalDef[] {
  return locals.map((l, i) => ({ ...l, expr: rewriteFields(l.expr, typesOf(params, locals, i), enums, false) }));
}

/** 화면 글 → 저장 모양 (필드 이름 → 키, 이름 앞뒤 공백 걷기). 빈 행(이름 · 식 둘 다 빔)은 버린다. */
export function localsForSave(params: readonly ParamDef[], locals: readonly LocalDef[], enums: readonly EnumChoice[]): LocalDef[] {
  const kept = locals.map((l) => ({ name: l.name.trim(), expr: l.expr.trim() })).filter((l) => l.name !== "" || l.expr !== "");
  const out: LocalDef[] = [];
  for (const l of kept) out.push({ ...l, expr: rewriteFields(l.expr, typesOf(params, out), enums, true) });
  return out;
}

/**
 * 내부 변수 → 조건 · 슬롯 고르기의 「내부 변수」 칸 (코드 `var.<이름>`, 열거값이면 필드 칸 `var.<이름>.F01` 도).
 * 타입은 검사 ① 과 같은 규칙으로 쌓는다 — 오류 난 내부 변수 · 목록 · 세목 선택지 목록은 타입 없이(줄 · 슬롯에 고를 수 없게) 둔다.
 */
export function localEntries(params: readonly ParamDef[], locals: readonly LocalDef[], enums: readonly EnumChoice[]): CtxDiscriminator[] {
  const defs = new Map(enums.map((e) => [e.code, enumDefOf(e)] as const));
  const { types } = checkLocals(
    locals.filter((l) => l.name.trim() !== ""),
    params,
    { resolveType: () => undefined, enums: enumInfoOf((c) => defs.get(c)) },
  );
  return locals
    .filter((l) => l.name.trim() !== "")
    .flatMap((l) => {
      const t = types.get(l.name);
      const out: CtxDiscriminator = { code: `var.${l.name}`, label: `${l.name}(내부 변수)`, level: "product", forms: [], local: true };
      if (t && (t.kind === "boolean" || t.kind === "string" || t.kind === "number" || t.kind === "date" || t.kind === "enum")) out.type = t;
      if (t?.kind === "enum") {
        const code = t.enumCode;
        out.enumOptions = (enums.find((e) => e.code === code)?.values ?? []).map((v) => ({ code: v.code, label: v.label }));
        return [out, ...fieldEntries(`var.${l.name}`, l.name, code, enums, "local")];
      }
      return [out];
    });
}
