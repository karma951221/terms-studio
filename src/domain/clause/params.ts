/**
 * 함수조항 인자 · 인자 연결 · 기본 연결 (순수) — 최종 결정 2 · 24 · 기능/함수조항 §3.7.
 *
 * - 인자: 조항 안에서 이름을 정하는 입력 선언 `{ 이름, 타입, 기본 연결? }`. 본문 식은 `arg.<이름>` 으로 읽는다(식언어 §12).
 *   타입 = 구분자 결과 타입(boolean · string · number · date · enum<E> · list<enum<E>>) 또는 세목 선택지 목록(폼 하나).
 * - 인자 연결: 넣는 자리(사용처 참조 노드)에서 인자마다 구분자 · 상수 · 원천(세목 선택지 목록) · 반복의 현재 원소를 댄다.
 *   **없으면 기본 연결**을 쓴다 — 선언 때 정한 기본, 다를 때만 바꾼다. 둘 다 없으면 저장 오류(`argUnbound`).
 * - 원천(§7-2): 세목 선택지 목록 인자에 반복 **밖**에서 대는 연결 — 「세목 폼 + 거름(그 폼 필드의 참거짓 식)」. 반복 원천 선언과 같은 모양이다.
 *   (P7: 선언 · 검사만. 목록을 가공하는 연산은 내부 변수(P8)라 아직 본문이 읽을 수 없다.)
 * - 반복의 현재 원소: 넣는 자리를 감싼 반복 블록의 원소(종 · 열거값, ADR-0077 결정 3). 그 반복 안에서만 · 타입이 맞아야 하고(`BindingEnv.loops`), 기본 연결로는 둘 수 없다.
 * - 인자 이름은 저장되는 식에 그대로 들어간다(`arg.<이름>`) — 이름을 바꾸면 본문 · 사용처 연결도 함께 고쳐야 한다(기능/함수조항 §5).
 */
import { masterTypeResolver } from "../catalog/expression";
import { checkTypes, extractRefs, parse, RESERVED_WORDS, type ExprType } from "../expression";
import { formsOfLevel, MASTER, type MasterTree } from "../master";
import type { Code, Coordinate, FieldType, Id, Issue, ScalarValue } from "../types";
import type { Clause } from "./types";

// ───────────────────────────── 타입 ─────────────────────────────

/** 인자 타입 — 구분자 결과 타입(표 제외) 또는 세목 선택지 목록(폼 하나의 선택지들). */
export type ParamType = Exclude<FieldType, { kind: "table" }> | { kind: "planOptions"; form: Code };

/** 세목 선택지 원천 — 세목 폼 + 거름 (반복 원천 선언과 같은 모양, §7-2). 거름은 그 폼 필드만 읽는 참거짓 식. 없으면 폼의 모든 선택지. */
export interface PlanOptionSource {
  form: Code;
  filter?: string;
}

/** 인자 연결 하나. */
export type Binding =
  /** 사용처 문맥에서 평가하는 구분자 — 늦은 바인딩(구분자는 사용처 문맥에서 푼다). */
  | { kind: "discriminator"; code: Code }
  /** 상수 — 스칼라 인자만. enum 은 값 코드, date 는 `YYYY-MM-DD`. */
  | { kind: "const"; value: ScalarValue }
  /** 반복의 현재 원소 — `loop` = 넣는 자리를 감싼 반복 블록(템플릿) id. 조립이 원소(열거값 코드 · 종)로 바꿔 댄다. */
  | { kind: "current"; loop: Id }
  /** 세목 선택지 원천 — 세목 선택지 목록 인자 전용 (§7-2). */
  | { kind: "source"; source: PlanOptionSource };

/** 인자 선언. 순서는 배열 순서(화면 표 순서). */
export interface ParamDef {
  name: string;
  type: ParamType;
  /** 기본 연결 — 사용처가 연결하지 않으면 이것. */
  default?: Binding;
}

/** 사용처의 인자 연결 — 인자 이름 → 연결. 없는 이름은 기본 연결을 쓴다. */
export type Bindings = Record<string, Binding>;

/** 연결 검사 재료 — 주지 않은 것은 검사하지 않는다(카탈로그 없이도 순수 검사가 되게). */
export interface BindingEnv {
  /** 구분자 코드 → 결과 타입. undefined 면 카탈로그에 없는(또는 타입을 풀 수 없는) 구분자 — brokenRef. */
  discriminatorType?: (code: Code) => ExprType | undefined;
  /** 있으면 카탈로그에 없는 구분자 연결은 건너뛴다 — 없음은 요구 구분자 검사(missingRequired)가 따로 낸다(같은 오류 두 번 방지). */
  discriminatorExists?: (code: Code) => boolean;
  /** 열거형 코드 → 값 코드들 — 상수 enum 연결 검사. */
  enumValues?: (enumCode: Code) => readonly Code[] | undefined;
  /** 원천 폼 · 거름 검사의 마스터. 기본 MVP 정본. */
  master?: MasterTree;
  /**
   * 넣는 자리를 감싼 반복 블록 id → 현재 원소 타입 (세목 선택지 목록<폼> = 종 · enum<E> = 열거값). 주면 반복의 현재 원소 연결을 검사한다
   * — 없는 반복 = 반복 밖 오류 · 타입 불일치 오류. 안 주면 건너뛴다(자리를 모르는 검사 — 함수조항 재검사 등).
   */
  loops?: ReadonlyMap<Id, LoopElementType>;
}

/** 반복의 현재 원소 타입 — 세목 선택지 원천이면 종(세목 선택지 목록<폼> 인자에 댄다), 목록값 원천이면 열거값. */
export type LoopElementType = { kind: "planOptions"; form: Code } | { kind: "enum"; enumCode: Code };

function describeElement(t: LoopElementType): string {
  return t.kind === "planOptions" ? `종(세목 선택지 ${t.form})` : `열거값 enum<${t.enumCode}>`;
}

const MODE_TYPES = new Set(["boolean", "string", "number", "date", "enum", "list<enum>", "planOptions"]);
const IDENT = /^[A-Za-z_ㄱ-ㆎ가-힣][A-Za-z0-9_ㄱ-ㆎ가-힣]*$/;
const RESERVED = new Set(RESERVED_WORDS);

export function paramTypeOf(p: ParamDef): ExprType {
  return p.type;
}

export function describeParamType(t: ExprType): string {
  switch (t.kind) {
    case "enum":
    case "list<enum>":
      return `${t.kind}<${t.enumCode}>`;
    case "planOptions":
      return `세목 선택지 목록<${t.form}>`;
    default:
      return t.kind;
  }
}

function sameType(a: ExprType, b: ExprType): boolean {
  if (a.kind !== b.kind) return false;
  if ("enumCode" in a && "enumCode" in b) return a.enumCode === b.enumCode;
  if (a.kind === "planOptions" && b.kind === "planOptions") return a.form === b.form;
  return true;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ───────────────────────────── 연결 하나 ─────────────────────────────

/** 인자 하나에 댄 연결 하나를 검사한다. `what` 은 문구 머리(「기본 연결」 · 「연결」). */
export function checkBinding(param: ParamDef, binding: Binding, env: BindingEnv, at: Coordinate = {}, what = "연결"): Issue[] {
  const head = `인자 ${param.name} 의 ${what}`;
  const refAt = (refPath: string): Coordinate => ({ ...at, refPath });
  const planOptions = param.type.kind === "planOptions";
  switch (binding.kind) {
    case "discriminator": {
      if (planOptions) return [{ kind: "typeMismatch", message: `${head} — 세목 선택지 목록 인자에는 원천(세목 폼 + 거름)만 댈 수 있습니다`, at: refAt(binding.code) }];
      if (!env.discriminatorType) return [];
      if (env.discriminatorExists && !env.discriminatorExists(binding.code)) return [];
      const t = env.discriminatorType(binding.code);
      if (t === undefined) return [{ kind: "brokenRef", message: `${head} — 구분자 ${binding.code} 이(가) 카탈로그에 없습니다`, at: refAt(binding.code) }];
      if (!sameType(t, param.type)) {
        return [{ kind: "typeMismatch", message: `${head} — 구분자 ${binding.code} 는 ${describeParamType(t)} 라 인자 타입 ${describeParamType(param.type)} 과 다릅니다`, at: refAt(binding.code) }];
      }
      return [];
    }
    case "const": {
      const v = binding.value;
      const bad = (why: string): Issue[] => [{ kind: "typeMismatch", message: `${head} — 상수 ${JSON.stringify(v)} ${why}`, at: refAt(`arg.${param.name}`) }];
      switch (param.type.kind) {
        case "boolean":
          return typeof v === "boolean" ? [] : bad("는 참거짓이 아닙니다");
        case "number":
          return typeof v === "number" ? [] : bad("는 숫자가 아닙니다");
        case "string":
          return typeof v === "string" ? [] : bad("는 문자가 아닙니다");
        case "date":
          return typeof v === "string" && DATE.test(v) ? [] : bad("는 날짜(YYYY-MM-DD)가 아닙니다");
        case "enum": {
          if (typeof v !== "string") return bad("는 열거값 코드가 아닙니다");
          const values = env.enumValues?.(param.type.enumCode);
          if (values && !values.includes(v)) return [{ kind: "brokenRef", message: `${head} — ${v} 는 열거형 ${param.type.enumCode} 의 값이 아닙니다`, at: refAt(v) }];
          return [];
        }
        default:
          return bad(`— 상수는 스칼라 인자에만 댈 수 있습니다 (${describeParamType(param.type)} 불가)`);
      }
    }
    case "current": {
      // 반복의 현재 원소 (ADR-0077 결정 3) — 넣는 자리를 감싼 반복 블록 안에서만, 원소 타입이 인자 타입과 같아야 한다.
      // 종 원소는 세목 선택지 목록 인자에 「종 하나짜리 목록」으로 댄다. 자리를 모르는 검사(`loops` 없음)는 건너뛴다
      if (!env.loops) return [];
      const element = env.loops.get(binding.loop);
      const here = refAt(`arg.${param.name}`);
      if (!element) return [{ kind: "structure", message: `${head} — 반복 밖에서 반복의 현재 원소를 연결했습니다 — 그 반복 블록 안에서만 댈 수 있습니다`, at: here }];
      if (!sameType(element, param.type)) {
        return [{ kind: "typeMismatch", message: `${head} — 반복의 현재 원소는 ${describeElement(element)} 라 인자 타입 ${describeParamType(param.type)} 과 다릅니다`, at: here }];
      }
      return [];
    }
    case "source":
      return checkSource(param, binding.source, env, at, head);
  }
}

/** 원천(세목 폼 + 거름) — 인자가 세목 선택지 목록이고 같은 폼 · 폼은 세목 레벨 · 거름은 그 폼 필드만 읽는 참거짓 식. */
function checkSource(param: ParamDef, source: PlanOptionSource, env: BindingEnv, at: Coordinate, head: string): Issue[] {
  const refAt: Coordinate = { ...at, refPath: source.form };
  if (param.type.kind !== "planOptions") return [{ kind: "typeMismatch", message: `${head} — 원천은 세목 선택지 목록 인자에만 댈 수 있습니다`, at: refAt }];
  if (source.form !== param.type.form) return [{ kind: "typeMismatch", message: `${head} — 원천 폼 ${source.form} 이(가) 인자 타입의 폼 ${param.type.form} 과 다릅니다`, at: refAt }];
  return checkPlanOptionFilter(source, env.master, at, head);
}

/**
 * 세목 선택지 거름 — 그 폼 필드만 읽는 참거짓 식(비면 폼의 선택지 전부). 인자의 원천 연결과 반복 블록의 원천(ADR-0077)이 같은 규칙을 쓴다.
 * `head` 는 문구 머리(「인자 X 의 연결」 · 「반복 원천」).
 */
export function checkPlanOptionFilter(source: PlanOptionSource, master: MasterTree | undefined, at: Coordinate, head: string): Issue[] {
  if (source.filter === undefined || source.filter.trim() === "") return [];
  const parsed = parse(source.filter, at);
  if (!parsed.ok) return parsed.rejection.reason === "invalid" ? parsed.rejection.issues.map((i) => ({ ...i, message: `${head} — 거름: ${i.message}` })) : [];
  const stray = extractRefs(parsed.value).filter(({ ref }) => ref.kind !== "master" || ref.form !== source.form);
  if (stray.length > 0) return [{ kind: "typeMismatch", message: `${head} — 거름은 폼 ${source.form} 의 필드만 읽습니다: ${stray.map((s) => s.path).join(" · ")}`, at: { ...at, refPath: stray[0].path } }];
  const checked = checkTypes(parsed.value, masterTypeResolver(undefined, master), { coordinate: at, expect: "boolean" });
  return checked.ok || checked.rejection.reason !== "invalid" ? [] : checked.rejection.issues.map((i) => ({ ...i, message: `${head} — 거름: ${i.message}` }));
}

// ───────────────────────────── 검사 ① 인자 표 ─────────────────────────────

/** 인자 표 — 이름(식에 쓰는 이름 · 비지 않음 · 겹치지 않음 · 예약어 아님) · 타입 · 세목 폼 · 기본 연결. */
export function checkParams(params: readonly ParamDef[], env: BindingEnv = {}, at: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const planForms = new Set(formsOfLevel("plan", env.master ?? MASTER).map((f) => f.key));
  for (const p of params) {
    const name = typeof p.name === "string" ? p.name : "";
    const here: Coordinate = { ...at, refPath: `arg.${name}` };
    if (name.trim() === "") {
      issues.push({ kind: "structure", message: "인자 이름이 비어 있습니다", at: here });
      continue;
    }
    if (seen.has(name)) {
      issues.push({ kind: "structure", message: `인자 이름이 겹칩니다: ${name}`, at: here });
      continue;
    }
    seen.add(name);
    if (RESERVED.has(name)) {
      issues.push({ kind: "structure", message: `인자 이름으로 예약어를 쓸 수 없습니다: ${name}`, at: here });
      continue;
    }
    if (!IDENT.test(name)) {
      issues.push({ kind: "structure", message: `인자 이름은 글자로 시작하고 글자 · 숫자 · 밑줄만 씁니다(띄어쓰기 · 기호 불가): ${name}`, at: here });
      continue;
    }
    if (!p.type || !MODE_TYPES.has(p.type.kind)) {
      issues.push({ kind: "typeMismatch", message: `인자 ${name} 의 타입은 참거짓 · 문자 · 숫자 · 날짜 · 열거형 · 열거형 목록 · 세목 선택지 목록 중 하나여야 합니다`, at: here });
      continue;
    }
    if (p.type.kind === "planOptions" && !planForms.has(p.type.form)) {
      issues.push({ kind: "typeMismatch", message: `인자 ${name} — ${p.type.form} 은(는) 세목 폼이 아닙니다`, at: here });
      continue;
    }
    if (p.default?.kind === "current") {
      issues.push({ kind: "structure", message: `인자 ${name} 의 기본 연결에는 반복의 현재 원소를 둘 수 없습니다 — 넣는 자리(반복 블록 안)에서 연결한다`, at: here });
      continue;
    }
    if (p.default) issues.push(...checkBinding(p, p.default, env, at, "기본 연결"));
  }
  return issues;
}

// ───────────────────────────── 검사 ② 사용처 연결 ─────────────────────────────

/** 사용처가 실제로 쓰는 연결 — 사용처 연결 > 기본 연결. 둘 다 없는 인자는 빠진다. */
export function effectiveBindings(clause: Clause, bindings: Bindings | undefined): Bindings {
  const out: Bindings = {};
  for (const p of clause.params ?? []) {
    const b = bindings?.[p.name] ?? p.default;
    if (b) out[p.name] = b;
  }
  return out;
}

/**
 * 사용처 연결 검사 — 인자마다 연결(없으면 기본 연결)이 있어야 하고(`argUnbound` = 저장 오류), 댄 것이 인자 타입에 맞아야 한다.
 * 선언에 없는 이름에 연결하면 brokenRef(인자를 지웠거나 이름을 바꾼 뒤 남은 연결).
 */
export function checkUsageBindings(clause: Clause, bindings: Bindings | undefined, env: BindingEnv = {}, at: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  const params = clause.params ?? [];
  for (const p of params) {
    const own = bindings?.[p.name];
    const b = own ?? p.default;
    if (!b) {
      issues.push({ kind: "argUnbound", message: `함수조항 ${clause.code} 의 인자 ${p.name} 이(가) 연결되지 않았습니다 — 기본 연결이 없어 넣는 자리에서 구분자 · 상수를 댄다`, at: { ...at, refPath: `arg.${p.name}` } });
      continue;
    }
    // 기본 연결의 잘못은 정의(검사 ①)가 낸다 — 사용처는 제가 댄 연결만 본다(같은 오류를 사용처마다 되풀이하지 않게). 기본 연결 구분자가 사라진 것은 요구 구분자 검사가 잡는다.
    if (own) issues.push(...checkBinding(p, own, env, at));
  }
  const declared = new Set(params.map((p) => p.name));
  for (const name of Object.keys(bindings ?? {})) {
    if (!declared.has(name)) issues.push({ kind: "brokenRef", message: `함수조항 ${clause.code} 에 없는 인자에 연결했습니다: ${name}`, at: { ...at, refPath: `arg.${name}` } });
  }
  return issues;
}

/** 기본 연결이 가리키는 구분자 — 정의의 요구 구분자에 더한다(구분자 삭제 영향 · 재검사). */
export function defaultBindingCodes(params: readonly ParamDef[] | undefined): Code[] {
  const out: Code[] = [];
  for (const p of params ?? []) if (p.default?.kind === "discriminator" && !out.includes(p.default.code)) out.push(p.default.code);
  return out;
}

/**
 * 사용처가 읽는 구분자 — 실제 연결(사용처 연결 > 기본 연결)의 구분자. 인자 순 · 중복 없이.
 * 사용처가 기본 연결을 다른 것으로 바꿨으면 기본 구분자는 그 사용처가 읽지 않는다. 함수조항은 구분자를 직접 읽지 않는다(검사 ①).
 */
export function boundDiscriminators(clause: Clause, bindings: Bindings | undefined): Code[] {
  const out: Code[] = [];
  for (const b of Object.values(effectiveBindings(clause, bindings))) if (b.kind === "discriminator" && !out.includes(b.code)) out.push(b.code);
  return out;
}

/** 정의가 기대는 구분자 전부 — 기본 연결(`required.discriminators`, 저장 때 계산) + 지금 인자 표의 기본 연결. 정의 쪽 존재 검사 · 삭제 영향의 단위. */
export function definitionDiscriminators(clause: Clause): Code[] {
  const out = [...clause.required.discriminators];
  for (const c of defaultBindingCodes(clause.params)) if (!out.includes(c)) out.push(c);
  return out;
}
