/**
 * 함수조항 인자 화면의 순수 재료 (최종 결정 2 · 기능/함수조항 §4.3) — 인자 표 칸 값 ⇄ 인자 선언, 조건 · 슬롯 고르기의 「인자」 칸, 사용처 연결 칸.
 *
 * 고르기 칸의 값은 글자 하나다 — 타입 `boolean` · `enum:E0001` · `list<enum>:E0001` · `planOptions:waiver`,
 * 연결 `""`(없음 · 기본 연결) · `d:D0001`(구분자) · `c:true` · `c:false` · `c:V01`(상수 — 참거짓 · 열거값) · `s:waiver` · `s:waiver:applies`(원천 — 폼 전체 · 참거짓 필드 = 예) ·
 * `r:<반복 블록 id>`(반복의 현재 원소 — 넣는 자리를 감싼 반복만, ADR-0077 결정 3).
 */
import { checkParams, type Binding, type LoopElementType, type ParamDef, type ParamType } from "@/domain/clause";
import { fieldsOfForm, formsOfLevel } from "@/domain/master";
import type { FieldType } from "@/domain/types";

import type { CtxDiscriminator } from "@/app/(app)/documents/[id]/_components/condition/types";

export interface EnumChoice {
  code: string;
  label: string;
  values: { code: string; label: string }[];
  /** 유저 정의 필드(ADR-0078) — 필드 읽기 칸(`arg.사유.F01`) · 내부 변수 식의 이름 ⇄ 키. 없으면 빈 목록. */
  fields?: { key: string; label: string; type: "string" | "boolean" }[];
}

/** 열거형 값의 필드 칸 — 인자 · 내부 변수(열거값)마다 `<경로>.<필드키>`, 이름 「<이름>.<필드 이름>」. */
export function fieldEntries(path: string, name: string, enumCode: string, enums: readonly EnumChoice[], flag: "param" | "local"): CtxDiscriminator[] {
  const fields = enums.find((e) => e.code === enumCode)?.fields ?? [];
  return fields.map((f) => ({ code: `${path}.${f.key}`, label: `${name}.${f.label}`, level: "product" as const, forms: [], type: { kind: f.type }, ...(flag === "param" ? { param: true as const } : { local: true as const }) }));
}

/** 세목 폼 — 원천 연결 후보(폼 전체 · 참거짓 필드 = 예). */
export interface PlanFormChoice {
  key: string;
  label: string;
  booleanFields: { key: string; label: string }[];
}

/** 세목 폼 — 원천 후보(폼 전체 · 참거짓 필드 = 예). 마스터는 코드라 서버 · 브라우저가 같다. */
export function planFormChoices(): PlanFormChoice[] {
  return formsOfLevel("plan").map((f) => ({ key: f.key, label: f.label, booleanFields: fieldsOfForm(f).filter((x) => x.field.type.kind === "boolean").map((x) => ({ key: x.field.key, label: x.field.label })) }));
}

export const SCALAR_TYPES = [
  { value: "boolean", label: "참거짓" },
  { value: "string", label: "문자" },
  { value: "number", label: "숫자" },
  { value: "date", label: "날짜" },
] as const;

export function typeValue(t: ParamType): string {
  switch (t.kind) {
    case "enum":
    case "list<enum>":
      return `${t.kind}:${t.enumCode}`;
    case "planOptions":
      return `planOptions:${t.form}`;
    default:
      return t.kind;
  }
}

export function typeOfValue(value: string): ParamType {
  const [kind, arg] = value.split(":");
  if ((kind === "enum" || kind === "list<enum>") && arg) return { kind, enumCode: arg };
  if (kind === "planOptions" && arg) return { kind: "planOptions", form: arg };
  if (kind === "string" || kind === "number" || kind === "date") return { kind };
  return { kind: "boolean" };
}

export function typeLabel(t: ParamType, enums: readonly EnumChoice[], forms: readonly PlanFormChoice[]): string {
  switch (t.kind) {
    case "enum":
      return `열거형 ${enums.find((e) => e.code === t.enumCode)?.label ?? t.enumCode}`;
    case "list<enum>":
      return `열거형 목록 ${enums.find((e) => e.code === t.enumCode)?.label ?? t.enumCode}`;
    case "planOptions":
      return `세목 선택지 목록 ${forms.find((f) => f.key === t.form)?.label ?? t.form}`;
    default:
      return SCALAR_TYPES.find((s) => s.value === t.kind)?.label ?? t.kind;
  }
}

export function bindingValue(b: Binding | undefined): string {
  if (!b) return "";
  switch (b.kind) {
    case "discriminator":
      return `d:${b.code}`;
    case "const":
      return `c:${String(b.value)}`;
    case "source": {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*) = true$/.exec(b.source.filter ?? "");
      return m && m[1] === b.source.form ? `s:${b.source.form}:${m[2]}` : `s:${b.source.form}`;
    }
    case "current":
      return `r:${b.loop}`;
  }
}

/** 넣는 자리를 감싼 반복 — 인자 연결 칸의 「반복의 현재 원소」 후보 (`repeatSources.loopChoices`). */
export interface LoopChoice {
  id: string;
  label: string;
  type: LoopElementType;
}

/** 칸 값 → 연결. 상수는 인자 타입으로 푼다(참거짓 · 열거값만 칸에서 고른다). */
export function bindingOfValue(value: string, type: ParamType): Binding | undefined {
  if (value === "") return undefined;
  const [kind, ...rest] = value.split(":");
  const arg = rest.join(":");
  if (kind === "d") return { kind: "discriminator", code: arg };
  if (kind === "c") return { kind: "const", value: type.kind === "boolean" ? arg === "true" : type.kind === "number" ? Number(arg) : arg };
  if (kind === "r" && arg) return { kind: "current", loop: arg };
  if (kind === "s") {
    const [form, field] = arg.split(":");
    return { kind: "source", source: field ? { form, filter: `${form}.${field} = true` } : { form } };
  }
  return undefined;
}

function sameType(a: FieldType | undefined, t: ParamType): boolean {
  if (!a || a.kind !== t.kind) return false;
  if ("enumCode" in a && "enumCode" in t) return a.enumCode === t.enumCode;
  return true;
}

/** 연결 칸 후보 — 타입이 같은 구분자 · 참거짓/열거값 상수 · (세목 선택지 목록이면) 원천. */
export function bindingOptions(
  t: ParamType,
  discriminators: readonly CtxDiscriminator[],
  enums: readonly EnumChoice[],
  forms: readonly PlanFormChoice[],
  withConst: boolean,
  loops: readonly LoopChoice[] = [],
): { value: string; label: string; group: string }[] {
  // 반복의 현재 원소 — 원소 타입이 인자 타입과 같은 감싼 반복만 (종 → 세목 선택지 목록<폼> · 열거값 → enum<E>)
  const current = loops
    .filter((l) => (l.type.kind === "planOptions" ? t.kind === "planOptions" && t.form === l.type.form : t.kind === "enum" && t.enumCode === l.type.enumCode))
    .map((l) => ({ value: `r:${l.id}`, label: l.label, group: "반복" }));
  if (t.kind === "planOptions") {
    const form = forms.find((f) => f.key === t.form);
    if (!form) return current;
    return [
      ...current,
      { value: `s:${form.key}`, label: `${form.label} — 모든 선택지`, group: "원천" },
      ...form.booleanFields.map((f) => ({ value: `s:${form.key}:${f.key}`, label: `${form.label} — ${f.label} = 예인 선택지`, group: "원천" })),
    ];
  }
  const out = [...current, ...discriminators.filter((d) => !d.param && sameType(d.type, t)).map((d) => ({ value: `d:${d.code}`, label: `${d.label} (${d.code})`, group: "구분자" }))];
  if (!withConst) return out;
  if (t.kind === "boolean") out.push({ value: "c:true", label: "예(상수)", group: "상수" }, { value: "c:false", label: "아니오(상수)", group: "상수" });
  if (t.kind === "enum") for (const v of enums.find((e) => e.code === t.enumCode)?.values ?? []) out.push({ value: `c:${v.code}`, label: `${v.label}(상수)`, group: "상수" });
  return out;
}

/** 연결 표시 — 「갱신여부(D0001)」 · 「예」 · 「납입면제 — 적용여부 = 예인 선택지」. */
export function bindingLabel(b: Binding | undefined, t: ParamType, discriminators: readonly CtxDiscriminator[], enums: readonly EnumChoice[], forms: readonly PlanFormChoice[], loops: readonly LoopChoice[] = []): string {
  if (!b) return "없음";
  const found = bindingOptions(t, discriminators, enums, forms, true, loops).find((o) => o.value === bindingValue(b));
  if (found) return found.label;
  if (b.kind === "discriminator") return `${b.code}(없는 구분자)`;
  if (b.kind === "const") return String(b.value);
  if (b.kind === "source") return `${b.source.form}${b.source.filter ? ` — ${b.source.filter}` : ""}`;
  return "반복의 현재 원소";
}

/** 인자 → 조건 · 슬롯 고르기의 「인자」 칸 (코드 `arg.<이름>`). 세목 선택지 목록은 조건 · 슬롯에 서지 않아 타입 없이(고를 수 없게) 둔다. */
export function paramEntries(params: readonly ParamDef[], enums: readonly EnumChoice[]): CtxDiscriminator[] {
  return params
    .filter((p) => p.name.trim() !== "")
    .flatMap((p) => {
      const out: CtxDiscriminator = { code: `arg.${p.name}`, label: `${p.name}(인자)`, level: "product", forms: [], param: true };
      if (p.type.kind !== "planOptions") out.type = p.type;
      if (p.type.kind === "enum" || p.type.kind === "list<enum>") {
        const code = p.type.enumCode;
        out.enumOptions = (enums.find((e) => e.code === code)?.values ?? []).map((v) => ({ code: v.code, label: v.label }));
      }
      // 열거값 인자는 필드 읽기 칸도 (최종 결정 18 — `arg.사유.약관표시명`)
      return p.type.kind === "enum" ? [out, ...fieldEntries(`arg.${p.name}`, p.name, p.type.enumCode, enums, "param")] : [out];
    });
}

/**
 * 인자 추가 줄의 이름 검사 — 더하기 전에 막는다(2026-10-01). 비었음 · 이미 있는 이름 · 예약어 · 이름 모양은 저장 검사 ①(`checkParams`)의 문구 그대로.
 * 타입 · 기본 연결은 고르기 칸이 맞는 것만 내므로 여기서 보지 않는다. 문제가 없으면 null.
 */
export function newParamNameError(params: readonly ParamDef[], name: string): string | null {
  const n = name.trim();
  if (n === "") return "인자 이름을 적는다";
  if (params.some((p) => p.name === n)) return `인자 이름이 겹칩니다: ${n}`;
  const issue = checkParams([{ name: n, type: { kind: "boolean" } }]).find((i) => i.kind === "structure");
  return issue ? issue.message : null;
}
