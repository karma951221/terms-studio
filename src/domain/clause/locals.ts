/**
 * 함수조항 내부 변수 (순수) — 최종 결정 2 · 18 · 기능/함수조항 §3.7 · 기능/식언어 §12.
 *
 * - 내부 변수: 인자를 가공한 값에 붙인 이름 `{ 이름, 식 }`. 본문과 뒤의 내부 변수가 `var.<이름>` 으로 읽는다.
 *   **앞에 선언한 것만** 읽는다 — 순서대로 평가하므로 뒤 이름 · 자기 자신 · 순환은 검사 ① 오류.
 * - 식은 식 언어에 함수조항 전용 연산을 더한 것 — list<세목 선택지>.합치기(폼.필드) · list<enum>.있음(값…) / 거르기(필드 = 값) / 비었음 ·
 *   enum.필드 · = 값 · boolean 그리고 / 또는 / 아님. **개수 연산은 없다**(타입 검사가 거부). 구분자를 직접 읽지 않는다(인자만).
 * - 평가(`localScope`): 조립이 함수조항을 펼칠 때 **사용처 문맥**에서 푼다. 함수조항 전용 식(내부 변수 · 필드 읽기 · 연산 · 원천 인자)은
 *   그 자리에서 값으로 바꾸고(리터럴 · 슬롯 글), 나머지 인자 참조는 연결로 바꿔 쓴다(bind.ts — 늦은 바인딩 그대로).
 *   내부 변수는 읽힐 때 한 번 평가한다(사용처마다). 빈 필드 값 = 미입력 → notEntered 오류(조용한 거짓 없음, ADR-0004).
 */
import { enumFieldValue } from "../catalog/fields";
import type { EnumDef } from "../catalog/types";
import { checkTypes, evaluate, extractRefs, parse, refPath, RESERVED_WORDS } from "../expression";
import type { EnumInfo, EvalContext, Expr, ExprType, Literal, Ref, TypeResolver } from "../expression";
import { findMasterField, formsOfLevel, MASTER, type MasterTree } from "../master";
import type { Code, Coordinate, Issue, Value } from "../types";
import type { Binding, Bindings, ParamDef } from "./params";

// ───────────────────────────── 모델 ─────────────────────────────

/** 내부 변수 선언 — 순서는 배열 순서(앞 이름만 읽는다). `expr` 은 식 소스(필드는 키 F01 로 저장, 화면은 이름). */
export interface LocalDef {
  name: string;
  expr: string;
}

const IDENT = /^[A-Za-z_ㄱ-ㆎ가-힣][A-Za-z0-9_ㄱ-ㆎ가-힣]*$/;
const RESERVED = new Set(RESERVED_WORDS);

/** 세목 폼 필드 타입 — `합치기(폼.필드)` 검사 재료. 세목 레벨 폼만. */
export function planFieldType(master: MasterTree = MASTER): (form: Code, field: Code) => ExprType | undefined {
  return (form, field) => {
    const f = findMasterField(`${form}.${field}`, master);
    return f && f.level === "plan" ? f.field.type : undefined;
  };
}

/** 열거형 정의 → 타입 검사가 보는 모양(값 코드 · 필드). */
export function enumInfoOf(find: (code: Code) => EnumDef | undefined): EnumInfo {
  return (code) => {
    const def = find(code);
    return def ? { values: def.values.map((v) => v.code), fields: (def.fields ?? []).map((f) => ({ key: f.key, type: f.type })) } : undefined;
  };
}

/** 식이 함수조항 전용 모양(내부 변수 · 필드 읽기 · 연산)을 품는가. `isSource` 는 원천 연결 인자(세목 선택지 목록 — 값으로만 읽힌다). */
export function hasClauseOnly(e: Expr, isSource: (name: string) => boolean = () => false): boolean {
  switch (e.kind) {
    case "member":
    case "call":
      return true;
    case "ref":
      return e.ref.kind === "local" || (e.ref.kind === "param" && isSource(e.ref.name));
    case "not":
      return hasClauseOnly(e.operand, isSource);
    case "and":
    case "or":
    case "compare":
      return hasClauseOnly(e.left, isSource) || hasClauseOnly(e.right, isSource);
    default:
      return false;
  }
}

// ───────────────────────────── 검사 ① 내부 변수 표 ─────────────────────────────

export interface LocalCheckOptions {
  coordinate?: Coordinate;
  /** 있으면 타입까지 검사한다(없으면 이름 · 문법 · 앞 이름 · 직접 읽기만). */
  resolveType?: TypeResolver;
  enums?: EnumInfo;
  master?: MasterTree;
}

export interface LocalCheck {
  issues: Issue[];
  /** 타입 검사를 통과한 내부 변수의 타입 — 본문 식 검사의 문맥. */
  types: Map<string, ExprType>;
  /** 선언은 됐지만 오류가 난 내부 변수 — 이것을 읽는 식은 타입 검사를 건너뛴다(연쇄 오류 방지). */
  failed: Set<string>;
}

/**
 * 내부 변수 표 — 이름(비지 않음 · 겹치지 않음 · 예약어 아님 · 식별자) · 식(문법 · 앞 이름만 · 구분자 직접 읽기 금지 · 선언된 인자 · 타입).
 * 좌표 refPath = `var.<이름>`.
 */
export function checkLocals(locals: readonly LocalDef[], params: readonly ParamDef[], opts: LocalCheckOptions = {}): LocalCheck {
  const issues: Issue[] = [];
  const types = new Map<string, ExprType>();
  const failed = new Set<string>();
  const earlier = new Set<string>();
  const declaredParams = new Map(params.map((p) => [p.name, p.type as ExprType] as const));
  const all = new Set(locals.map((l) => (typeof l.name === "string" ? l.name : "")));
  const base = opts.coordinate ?? {};
  for (const l of locals) {
    const name = typeof l.name === "string" ? l.name : "";
    const here: Coordinate = { ...base, refPath: `var.${name}` };
    const fail = (kind: Issue["kind"], message: string) => {
      issues.push({ kind, message, at: here });
      failed.add(name);
      earlier.add(name);
    };
    if (name.trim() === "") {
      issues.push({ kind: "structure", message: "내부 변수 이름이 비어 있습니다", at: here });
      continue;
    }
    if (earlier.has(name)) {
      issues.push({ kind: "structure", message: `내부 변수 이름이 겹칩니다: ${name}`, at: here });
      continue;
    }
    if (RESERVED.has(name)) {
      fail("structure", `내부 변수 이름으로 예약어를 쓸 수 없습니다: ${name}`);
      continue;
    }
    if (!IDENT.test(name)) {
      fail("structure", `내부 변수 이름은 글자로 시작하고 글자 · 숫자 · 밑줄만 씁니다(띄어쓰기 · 기호 불가): ${name}`);
      continue;
    }
    if (typeof l.expr !== "string" || l.expr.trim() === "") {
      fail("syntax", `내부 변수 ${name} 의 식이 비어 있습니다`);
      continue;
    }
    const parsed = parse(l.expr, here);
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues.map((i) => ({ ...i, message: `내부 변수 ${name} — ${i.message}` })));
      failed.add(name);
      earlier.add(name);
      continue;
    }
    let bad = false;
    let skipTypes = false;
    for (const { ref, path } of extractRefs(parsed.value)) {
      if (ref.kind === "local") {
        if (ref.name === name || !earlier.has(ref.name)) {
          const why = ref.name === name ? "자기 자신" : all.has(ref.name) ? "뒤에 선언한 이름" : "선언되지 않은 이름";
          issues.push({ kind: "structure", message: `내부 변수 ${name} 이(가) ${path} 를 읽습니다 — 앞에 선언한 내부 변수만 읽는다(${why} · 순환 불가)`, at: here });
          bad = true;
        } else if (failed.has(ref.name)) skipTypes = true;
      }
      if (ref.kind === "param" && !declaredParams.has(ref.name) && !opts.resolveType) {
        issues.push({ kind: "brokenRef", message: `내부 변수 ${name} — 선언되지 않은 인자입니다: ${path}`, at: here });
        bad = true;
      }
      if (ref.kind === "discriminator") {
        issues.push({ kind: "typeMismatch", message: `내부 변수 ${name} — 함수조항은 구분자 ${path} 를 직접 읽을 수 없습니다 — 인자를 선언하고 arg.<이름> 으로 읽는다`, at: here });
        bad = true;
      }
    }
    if (bad) {
      failed.add(name);
      earlier.add(name);
      continue;
    }
    if (opts.resolveType && !skipTypes) {
      const r = checkTypes(parsed.value, opts.resolveType, {
        coordinate: here,
        params: (n) => declaredParams.get(n),
        locals: (n) => (earlier.has(n) ? types.get(n) : undefined),
        ...(opts.enums ? { enums: opts.enums } : {}),
        planField: planFieldType(opts.master),
      });
      if (r.ok) types.set(name, r.value);
      else {
        if (r.rejection.reason === "invalid") issues.push(...r.rejection.issues.map((i) => ({ ...i, message: `내부 변수 ${name} — ${i.message}` })));
        failed.add(name);
      }
    } else if (skipTypes) failed.add(name);
    earlier.add(name);
  }
  return { issues, types, failed };
}

// ───────────────────────────── 평가 (조립 — 펼칠 때) ─────────────────────────────

/** 평가 재료 — 사용처 문맥 · 열거형 · 마스터. */
export interface LocalEnv {
  /** 사용처 문맥 (보통약관 · 특약 문서 문맥). */
  ctx: EvalContext;
  enums: ReadonlyMap<Code, EnumDef>;
  master?: MasterTree;
  /** 미결 → 조립 오류 (조립 문맥의 원인 설명). 없으면 brokenRef. */
  explain?: (reason: string, at: Coordinate) => Issue;
  /** 슬롯에 찍을 값 글 — 조립의 값 표기 규칙(열거값은 표시명). 없으면 글 그대로. */
  text?: (value: string | number | boolean, type: ExprType) => string;
}

type Typed = { kind: "value"; value: Value; type: ExprType } | { kind: "options"; form: Code; contexts: EvalContext[] };
type Outcome<T> = { ok: true; value: T } | { ok: false; issue: Issue };

const okv = <T>(value: T): Outcome<T> => ({ ok: true, value });

export interface LocalScope {
  /** 본문 식 하나 — 함수조항 전용 부분을 값(리터럴)으로, 인자를 연결로 바꾼 식. */
  reduce(e: Expr): Outcome<Expr>;
  /** 슬롯 — 함수조항 전용 식(필드 읽기 등)이면 찍을 글, 아니면 undefined(치환 단계가 평가). */
  slotText(e: Expr): Outcome<string | undefined>;
}

/**
 * 사용처 하나의 평가 범위 — `bound` 는 실제 연결(사용처 연결 > 기본 연결). 내부 변수는 읽힐 때 한 번 평가해 둔다.
 * 원천 연결(세목 선택지 목록)은 사용처 문맥의 세목 선택지(그 폼) 중 거름이 참인 것 — 반복 원천 선언과 같은 모양(§7-2).
 */
export function localScope(params: readonly ParamDef[], locals: readonly LocalDef[], bound: Bindings, env: LocalEnv, at: Coordinate): LocalScope {
  const paramOf = new Map(params.map((p) => [p.name, p] as const));
  const localOf = new Map(locals.map((l) => [l.name, l] as const));
  const memo = new Map<string, Outcome<Typed>>();
  const master = env.master ?? MASTER;
  const isSource = (name: string) => bound[name]?.kind === "source";

  const fail = (kind: Issue["kind"], message: string, ref?: Ref): Outcome<never> => ({ ok: false, issue: { kind, message, at: { ...at, ...(ref ? { refPath: refPath(ref) } : {}) } } });

  const fromEval = (e: Expr, type: ExprType): Outcome<Typed> => {
    const r = evaluate(e, { ...env.ctx, coordinate: at });
    if (r.kind === "error") return { ok: false, issue: r.issue };
    if (r.kind === "undetermined") return { ok: false, issue: env.explain ? env.explain(r.reason, at) : { kind: "brokenRef", message: `참조 ${r.reason} 을(를) 해소할 수 없습니다`, at: { ...at, refPath: r.reason } } };
    return okv({ kind: "value", value: r.value, type });
  };

  /** 원천 — 그 폼의 세목 선택지 문맥들 중 거름이 참인 것. */
  const sourceOptions = (b: Binding & { kind: "source" }, ref: Ref): Outcome<Typed> => {
    const form = formsOfLevel("plan", master).find((f) => f.key === b.source.form);
    const probe = form?.fields[0];
    if (!form || !probe) return fail("brokenRef", `원천 폼 ${b.source.form} 이(가) 세목 폼이 아닙니다`, ref);
    const all = env.ctx.children({ kind: "master", form: form.key, field: probe.key });
    if (all === undefined) return fail("brokenRef", `원천 ${form.key} 의 세목 선택지를 이 문맥에서 모읍니다 — 상품 문맥이 아닙니다`, ref);
    if (b.source.filter === undefined || b.source.filter.trim() === "") return okv({ kind: "options", form: form.key, contexts: all });
    const parsed = parse(b.source.filter, at);
    if (!parsed.ok) return parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? { ok: false, issue: parsed.rejection.issues[0] } : fail("syntax", "원천 거름을 읽을 수 없습니다", ref);
    const kept: EvalContext[] = [];
    for (const c of all) {
      const r = evaluate(parsed.value, { ...c, coordinate: at });
      if (r.kind === "error") return { ok: false, issue: r.issue };
      if (r.kind === "undetermined") return fail("brokenRef", `원천 거름의 ${r.reason} 을(를) 해소할 수 없습니다`, ref);
      if (typeof r.value !== "boolean") return fail("typeMismatch", "원천 거름의 결과가 참거짓이 아닙니다", ref);
      if (r.value) kept.push(c);
    }
    return okv({ kind: "options", form: form.key, contexts: kept });
  };

  const paramValue = (ref: Ref & { kind: "param" }): Outcome<Typed> => {
    const p = paramOf.get(ref.name);
    const b = bound[ref.name];
    if (!p) return fail("brokenRef", `선언되지 않은 인자입니다: ${ref.name}`, ref);
    if (!b) return fail("argUnbound", `인자 ${ref.name} 이(가) 연결되지 않았습니다`, ref);
    switch (b.kind) {
      case "discriminator":
        return fromEval({ kind: "ref", ref: { kind: "discriminator", code: b.code } }, p.type);
      case "const":
        return okv({ kind: "value", value: b.value, type: p.type });
      case "source":
        return sourceOptions(b, ref);
      case "current":
        return fail("unsupported", `인자 ${ref.name} — 반복의 현재 원소 연결은 반복 블록과 함께 연다(아직 지원하지 않음)`, ref);
    }
  };

  const localValue = (ref: Ref & { kind: "local" }): Outcome<Typed> => {
    const hit = memo.get(ref.name);
    if (hit) return hit;
    const def = localOf.get(ref.name);
    if (!def) return fail("brokenRef", `선언되지 않은 내부 변수입니다: ${ref.name}`, ref);
    memo.set(ref.name, fail("structure", `내부 변수 ${ref.name} 이(가) 자기 자신을 읽습니다`, ref)); // 순환 가드 — 저장 검사가 막지만 평가도 스스로 멈춘다
    const parsed = parse(def.expr, { ...at, refPath: refPath(ref) });
    const out: Outcome<Typed> = parsed.ok ? value(parsed.value) : parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? { ok: false, issue: parsed.rejection.issues[0] } : fail("syntax", `내부 변수 ${ref.name} 의 식을 읽을 수 없습니다`, ref);
    memo.set(ref.name, out);
    return out;
  };

  const enumDefOf = (t: ExprType): EnumDef | undefined => ("enumCode" in t ? env.enums.get(t.enumCode) : undefined);

  const listOf = (v: Typed, what: string): Outcome<{ codes: string[]; def: EnumDef; type: ExprType }> => {
    if (v.kind !== "value" || v.type.kind !== "list<enum>" || !Array.isArray(v.value)) return fail("typeMismatch", `${what} 은(는) 열거형 목록에만 쓸 수 있습니다`);
    const def = enumDefOf(v.type);
    if (!def) return fail("brokenRef", `열거형 ${v.type.enumCode} 이(가) 없습니다`);
    return okv({ codes: v.value.filter((c): c is string => typeof c === "string"), def, type: v.type });
  };

  const fieldOf = (def: EnumDef, code: string, key: Code): Outcome<string | boolean> => {
    const r = enumFieldValue(def, code, key);
    switch (r.kind) {
      case "value":
        return okv(r.value);
      case "notEntered":
        return fail("notEntered", `열거값 ${code} 의 필드 ${def.fields?.find((f) => f.key === key)?.label ?? key} 이(가) 미입력입니다 — 열거형 ${def.code} 에서 값을 넣는다`);
      case "unknownField":
        return fail("brokenRef", `열거형 ${def.code} 에 필드 ${key} 이(가) 없습니다`);
      case "unknownValue":
        return fail("brokenRef", `없는 값 ${code} — 열거형 ${def.code} 에 없습니다`);
    }
  };

  function value(e: Expr): Outcome<Typed> {
    switch (e.kind) {
      case "literal":
        return okv({ kind: "value", value: e.literal.value, type: { kind: e.literal.type } });
      case "ref":
        if (e.ref.kind === "param") return paramValue(e.ref);
        if (e.ref.kind === "local") return localValue(e.ref);
        return fromEval(e, { kind: "string" });
      case "member": {
        const t = value(e.target);
        if (!t.ok) return t;
        const v = t.value;
        if (v.kind !== "value" || v.type.kind !== "enum" || typeof v.value !== "string") return fail("typeMismatch", `필드 읽기 .${e.field} 는 열거값에만 쓸 수 있습니다`);
        const def = enumDefOf(v.type);
        if (!def) return fail("brokenRef", `열거형 ${v.type.enumCode} 이(가) 없습니다`);
        const f = fieldOf(def, v.value, e.field);
        if (!f.ok) return f;
        return okv({ kind: "value", value: f.value, type: { kind: def.fields?.find((x) => x.key === e.field)?.type ?? "string" } });
      }
      case "call": {
        const t = value(e.target);
        if (!t.ok) return t;
        switch (e.op) {
          case "합치기": {
            if (t.value.kind !== "options") return fail("typeMismatch", "합치기는 세목 선택지 목록에만 쓸 수 있습니다");
            const field = findMasterField(refPath(e.ref), master);
            const type = field?.field.type;
            if (!field || !type || (type.kind !== "enum" && type.kind !== "list<enum>")) return fail("brokenRef", `합치기(${refPath(e.ref)}) — 열거형 필드가 아닙니다`, e.ref);
            const seen = new Set<string>();
            for (const c of t.value.contexts) {
              const r = evaluate({ kind: "ref", ref: e.ref }, { ...c, coordinate: at });
              if (r.kind === "error") return { ok: false, issue: r.issue };
              if (r.kind === "undetermined") return fail("brokenRef", `합치기(${refPath(e.ref)}) 를 해소할 수 없습니다`, e.ref);
              for (const code of Array.isArray(r.value) ? r.value : [r.value]) if (typeof code === "string") seen.add(code);
            }
            // 열거형 순서 (결정 11 「사유 순서 = 열거형 순서」) — 정의에 없는 코드는 읽을 때 이미 「없는 값」 오류다
            const def = env.enums.get(type.enumCode);
            const order = def ? def.values.map((v) => v.code) : [];
            const codes = [...order.filter((c) => seen.has(c)), ...[...seen].filter((c) => !order.includes(c))];
            return okv({ kind: "value", value: codes, type: { kind: "list<enum>", enumCode: type.enumCode } });
          }
          case "있음": {
            const l = listOf(t.value, "있음");
            if (!l.ok) return l;
            return okv({ kind: "value", value: e.values.some((v) => l.value.codes.includes(v)), type: { kind: "boolean" } });
          }
          case "거르기": {
            const l = listOf(t.value, "거르기");
            if (!l.ok) return l;
            const kept: string[] = [];
            for (const code of l.value.codes) {
              const f = fieldOf(l.value.def, code, e.field);
              if (!f.ok) return f;
              if (f.value === e.value.value) kept.push(code);
            }
            return okv({ kind: "value", value: kept, type: l.value.type });
          }
          case "비었음": {
            const l = listOf(t.value, "비었음");
            if (!l.ok) return l;
            return okv({ kind: "value", value: l.value.codes.length === 0, type: { kind: "boolean" } });
          }
        }
        break;
      }
      default:
        break;
    }
    // 비교 · 논리 · 집계 — 함수조항 전용 부분을 값으로 바꾼 뒤 평가기가 푼다
    const reduced = reduce(e);
    if (!reduced.ok) return reduced;
    return fromEval(reduced.value, { kind: e.kind === "aggregate" && e.op === "sum" ? "number" : "boolean" });
  }

  const literalOf = (v: Typed, where: Expr): Outcome<Expr> => {
    if (v.kind === "options") return fail("typeMismatch", "세목 선택지 목록은 조건 · 슬롯에 그대로 쓸 수 없습니다 — 합치기로 가공한다");
    const x = v.value;
    if (Array.isArray(x)) return fail("typeMismatch", `목록 값은 조건 · 슬롯에 그대로 쓸 수 없습니다 — 있음 · 비었음으로 가공한다 (${where.kind})`);
    const lit: Literal = typeof x === "boolean" ? { type: "boolean", value: x } : typeof x === "number" ? { type: "number", value: x } : v.type.kind === "date" ? { type: "date", value: x } : { type: "string", value: x };
    return okv({ kind: "literal", literal: lit });
  };

  /** 인자 참조 → 연결(구분자 · 상수). 원천은 값으로만 읽힌다. */
  const bindParam = (ref: Ref & { kind: "param" }): Outcome<Expr> => {
    const b = bound[ref.name];
    const p = paramOf.get(ref.name);
    if (!p) return fail("brokenRef", `선언되지 않은 인자입니다: ${ref.name}`, ref);
    if (!b) return fail("argUnbound", `인자 ${ref.name} 이(가) 연결되지 않았습니다`, ref);
    if (b.kind === "discriminator") return okv({ kind: "ref", ref: { kind: "discriminator", code: b.code } });
    const v = paramValue(ref);
    return v.ok ? literalOf(v.value, { kind: "ref", ref }) : v;
  };

  function reduce(e: Expr): Outcome<Expr> {
    if (e.kind === "ref" && e.ref.kind === "param" && !isSource(e.ref.name)) return bindParam(e.ref);
    if (e.kind === "member" || e.kind === "call" || (e.kind === "ref" && (e.ref.kind === "local" || e.ref.kind === "param"))) {
      const v = value(e);
      return v.ok ? literalOf(v.value, e) : v;
    }
    switch (e.kind) {
      case "not": {
        const o = reduce(e.operand);
        return o.ok ? okv({ ...e, operand: o.value }) : o;
      }
      case "and":
      case "or":
      case "compare": {
        const l = reduce(e.left);
        if (!l.ok) return l;
        const r = reduce(e.right);
        return r.ok ? okv({ ...e, left: l.value, right: r.value }) : r;
      }
      default:
        return okv(e);
    }
  }

  return {
    reduce,
    slotText: (e) => {
      if (!hasClauseOnly(e, isSource)) return okv(undefined);
      const v = value(e);
      if (!v.ok) return v;
      if (v.value.kind !== "value" || Array.isArray(v.value.value)) return fail("typeMismatch", "슬롯에는 목록 · 세목 선택지 목록을 찍을 수 없습니다");
      const x = v.value.value as string | number | boolean;
      return okv(env.text ? env.text(x, v.value.type) : String(x));
    },
  };
}
