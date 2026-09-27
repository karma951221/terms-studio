/**
 * 카탈로그 서버 액션의 입력 파싱 — 순수 함수 (FormData → 서비스 인자). `*.test.ts` 로 검증.
 * "use server" 파일(actions.ts)은 async 함수만 export 할 수 있어 여기 따로 둔다.
 */
import { baseKind, isMulti, resolveType } from "@/app/_lib/fieldType";
import { ENTITY_LABEL, TYPE_LABEL, TYPE_OPTIONS } from "@/app/_lib/labels";
import { discriminatorResultType } from "@/domain/catalog/expression";
import type { Discriminator, DiscriminatorResultType } from "@/domain/catalog/types";
import type { ExprType } from "@/domain/expression";
import { allMasterFields, levelDepth, masterFieldFullLabel, type MasterTree } from "@/domain/master";
import type { AttachLevel, Code, FieldType, FieldTypeKind, Issue, Value } from "@/domain/types";
import type { InspectInput } from "@/services/catalog";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** 폼 입력(문자열) → FieldType. enum · list<enum> 은 enumCode 가 있어야 유효. */
export function fieldTypeFrom(kind: string, enumCode: string): FieldType | undefined {
  switch (kind) {
    case "string":
      return { kind: "string" };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "date":
      return { kind: "date" };
    case "enum":
      return enumCode ? { kind: "enum", enumCode } : undefined;
    case "list<enum>":
      return enumCode ? { kind: "list<enum>", enumCode } : undefined;
    default:
      return undefined;
  }
}

/** 문자열 입력 → 값 (타입에 맞춰). 빈 문자열은 undefined(=기본값 없음/지우기). */
export function valueFromInput(type: FieldType, raw: string): Value | undefined {
  if (raw === "") return undefined;
  switch (type.kind) {
    case "string":
    case "date":
    case "enum":
      return raw;
    case "number":
      return Number(raw);
    case "boolean":
      return raw === "true";
    case "list<enum>":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  }
}

// ───────────────────────────── 결과 타입 (기능/구분자 §3.1) ─────────────────────────────

/** 종류 셀렉트의 선택지 — 결과 타입은 선택이라 첫 옵션이 「미지정」(`""`)이다. 생성 폼과 상세 편집이 같이 쓴다. */
export const RESULT_TYPE_OPTIONS = [{ value: "", label: "미지정" }, ...TYPE_OPTIONS] as const;
export const RESULT_TYPE_HINT = "식에서 추론한 타입과 다르면 저장이 거부된다. 미지정이면 추론 타입을 쓴다.";

/**
 * 결과 타입으로 받을 수 있는 종류 — `table` 은 뺀다(값 타입이 아니다). 화면 셀렉트엔 없지만 이미 저장된
 * `date` 값은 읽혀야 하니 `RESULT_TYPE_OPTIONS`(셀렉트 선택지)보다 넓다 — `TYPE_LABEL` 전체에서 `table` 만 뺀 것.
 */
const RESULT_TYPE_KINDS: ReadonlySet<string> = new Set(Object.keys(TYPE_LABEL).filter((k) => k !== "table"));

/** 화면의 결과 타입 입력 모양 — 종류 셀렉트(`""` = 미지정) + 복수 토글 + 열거형변수 셀렉트. */
export interface ResultTypeForm {
  kind: string;
  multi: boolean;
  enumCode: string;
}

/**
 * 폼 입력 → 명시 결과 타입. `kind === ""` 는 미지정(undefined).
 * `kind` 가 `RESULT_TYPE_KINDS`(즉 `table` 이거나 폼 변조로 들어온 값)에 없으면 마찬가지로 undefined —
 * 화면 옵션 밖의 값이 도메인까지 닿지 않게 여기서 막는다.
 *
 * enum 계열에 열거형변수를 안 골랐어도 undefined 로 바꾸지 않는다 — 사용자의 실수를 조용히
 * 「미지정」으로 삼키면 추론 타입만 남아 저장이 통과해 버린다. 빈 enumCode 를 그대로 넘겨
 * 서비스가 `brokenRef` 로 거부하게 둔다 (`fieldTypeFrom` 과 다른 점).
 */
export function resultTypeFromForm(kind: string, multi: boolean, enumCode: string): DiscriminatorResultType | undefined {
  if (!RESULT_TYPE_KINDS.has(kind)) return undefined;
  return resolveType(kind as Exclude<FieldTypeKind, "table">, multi, enumCode) as DiscriminatorResultType;
}

/** 명시 결과 타입 → 폼 입력 (역변환). `list<enum>` 은 종류 enum + 복수. */
export function resultTypeToForm(t: DiscriminatorResultType | undefined): ResultTypeForm {
  if (!t) return { kind: "", multi: false, enumCode: "" };
  return { kind: baseKind(t.kind), multi: isMulti(t.kind), enumCode: "enumCode" in t ? t.enumCode : "" };
}

/** 읽기 표시 — `참거짓` · `목록값 · 해약환급금유형` · `목록값(복수) · …`. 미지정이면 `미지정`. */
export function resultTypeLabel(t: DiscriminatorResultType | undefined, enumLabel: (code: string) => string | undefined): string {
  if (!t) return "미지정";
  const base = TYPE_LABEL[t.kind];
  return "enumCode" in t ? `${base} · ${enumLabel(t.enumCode) ?? t.enumCode}` : base;
}

/**
 * 저장 순서 결정 — 명시 타입과 식을 한 화면에서 함께 고칠 수 있어서다.
 *
 * - `none`: 타입이 같다 → 건드리지 않는다.
 * - `set`: 타입만 바뀌었다 → 식 저장 뒤 지정.
 * - `clearThenSet`: 타입도 식도 바뀌었다 → **해제 → 식 저장 → 지정**. 옛 명시 타입이 새 식을
 *   막거나(setExpression 이 명시 타입과 대조한다) 새 명시 타입이 옛 식에 걸려 거부되지 않도록.
 */
export function resultTypeSavePlan(
  before: DiscriminatorResultType | undefined,
  after: DiscriminatorResultType | undefined,
  expressionChanged: boolean,
): "none" | "set" | "clearThenSet" {
  if (sameResultType(before, after)) return "none";
  return expressionChanged ? "clearThenSet" : "set";
}

function sameResultType(a: DiscriminatorResultType | undefined, b: DiscriminatorResultType | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return ("enumCode" in a ? a.enumCode : undefined) === ("enumCode" in b ? b.enumCode : undefined);
}

/** 추론 타입 표시 — 결과 타입 후보(`DiscriminatorResultType`)면 그 표시명, 담보속성 · 표는 이름만, 없으면 「추론 불가」. */
export function inferredLabel(inferred: ExprType | undefined, enumLabel: (code: string) => string | undefined): string {
  if (!inferred) return "추론 불가";
  if (inferred.kind === "attribute") return ENTITY_LABEL.attribute;
  if (inferred.kind === "table") return TYPE_LABEL.table;
  return resultTypeLabel(inferred, enumLabel);
}

// ───────────────────────────── 「검사」 (기능/구분자 §3.3) ─────────────────────────────

/** 「검사」가 보는 폼 값 — 상세 편집(`CatalogEditData`)과 생성 폼이 같은 모양으로 넘긴다. */
export interface InspectForm {
  expression: string;
  resultTypeKind: string;
  resultTypeMulti: boolean;
  resultTypeEnum: string;
}

/** 폼 값 → 서비스 `inspect` 입력. `code` 는 수정 화면에서만 (생성은 아직 코드가 없어 순환을 볼 수 없다). */
export function inspectInputFrom(code: Code | undefined, level: AttachLevel, form: InspectForm): InspectInput {
  const resultType = resultTypeFromForm(form.resultTypeKind, form.resultTypeMulti, form.resultTypeEnum);
  return { ...(code !== undefined ? { code } : {}), expression: form.expression.trim(), level, ...(resultType ? { resultType } : {}) };
}

/** 검사 결과가 지금 폼 값에 대한 것인지 — 식 · 레벨 · 결과 타입이 하나라도 다르면 「오래된 결과」다 (타이핑 중 자동 검사 없음). */
export function sameInspectInput(a: InspectInput, b: InspectInput): boolean {
  return a.code === b.code && a.expression === b.expression && a.level === b.level && sameResultType(a.resultType, b.resultType);
}

/** 읽기 모드 제목 옆 배지 — 별칭은 「별칭」, 사용처 경고는 건수로 묶는다. title 에 문구를 싣는다. */
export function warningBadges(warnings: readonly Issue[]): { label: string; title: string }[] {
  const out: { label: string; title: string }[] = [];
  const alias = warnings.filter((w) => w.kind === "alias");
  if (alias.length > 0) out.push({ label: "별칭", title: alias.map((w) => w.message).join("\n") });
  const rest = warnings.filter((w) => w.kind !== "alias");
  if (rest.length > 0) out.push({ label: `깨질 사용처 ${rest.length}`, title: rest.map((w) => w.message).join("\n") });
  return out;
}

// ───────────────────────────── 넣기 패널 (기능/구분자 §4.3) ─────────────────────────────

/** 토큰 앞뒤로 붙어도 되는 글자 — 여는 괄호 뒤 · 닫는 괄호 앞 · 공백. 그 밖이면 공백을 넣어 토큰을 뗀다. */
const NO_PAD_BEFORE = /[\s(]$/;
const NO_PAD_AFTER = /^[\s)]/;

/**
 * 커서 자리에 텍스트를 넣는다. 돌아오는 커서는 넣은 텍스트 뒤 — `caret` 을 주면 넣은 텍스트 안 그 자리
 * (집계 `any()` 는 괄호 안). 앞뒤에 글자가 붙어 있으면 공백을 넣어 토큰이 붙지 않게 한다.
 */
export function insertAt(value: string, cursor: number, text: string, caret: number = text.length): { value: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, at);
  const after = value.slice(at);
  const padBefore = before.length > 0 && !NO_PAD_BEFORE.test(before) ? " " : "";
  const padAfter = after.length > 0 && !NO_PAD_AFTER.test(after) ? " " : "";
  const inserted = `${padBefore}${text}${padAfter}`;
  return { value: `${before}${inserted}${after}`, cursor: before.length + padBefore.length + caret };
}

/**
 * 참조 항목 하나를 식에 넣을 토큰 — 같은 레벨은 경로 그대로, **하위** 레벨은 집계로 감싼다,
 * **상위** 레벨은 부를 수 없다(undefined — 패널이 흐리게 둔다). 규칙은 `checkReferenceRules` 와 같다 (기능/구분자 §3.2).
 * 집계는 타입에 맞춰 고른다 — `any`/`all` 은 boolean 경로만, `sum` 은 number 만 받는다 (typecheck):
 * 참거짓 → `any(…)` · 숫자 → `sum(…)` · 그 밖(문자열 · 목록값 · 날짜 · 모름) → `exist(…)`.
 * 커서가 이미 집계 괄호 안이면(`insideAggregate`) 감싸지 않는다 — `any(any(x))` 가 되지 않게.
 */
export function referenceToken(path: string, refLevel: AttachLevel, level: AttachLevel, typeKind?: string, opts: { insideAggregate?: boolean } = {}): string | undefined {
  const diff = levelDepth(refLevel) - levelDepth(level);
  if (diff < 0) return undefined;
  if (diff === 0 || opts.insideAggregate) return path;
  const op = typeKind === "boolean" ? "any" : typeKind === "number" ? "sum" : "exist";
  return `${op}(${path})`;
}

const AGGREGATE_OPEN = /(?:^|[^A-Za-z0-9_.])(?:any|all|sum|count|exist|notexist)\($/;

/** 커서 바로 앞이 「집계 이름 + 여는 괄호」인가 — 그 자리에 넣는 참조는 이미 집계 안이다. */
export function insideAggregate(value: string, cursor: number): boolean {
  return AGGREGATE_OPEN.test(value.slice(0, Math.max(0, Math.min(cursor, value.length))));
}

export interface OperatorToken {
  label: string;
  text: string;
  /** 넣은 뒤 커서 자리 (텍스트 안 오프셋). 없으면 뒤. */
  caret?: number;
  hint: string;
}

/** 연산 탭 — 집계 6종 · 논리 · 비교. 집계는 괄호 안에 커서를 둔다. `not exist` 는 소스에서 한 단어(`notexist`)다. */
export const OPERATOR_TOKENS: readonly OperatorToken[] = [
  { label: "any()", text: "any()", caret: 4, hint: "하위 중 하나라도 참" },
  { label: "all()", text: "all()", caret: 4, hint: "하위 전부 참" },
  { label: "sum()", text: "sum()", caret: 4, hint: "하위 숫자 합" },
  { label: "count()", text: "count()", caret: 6, hint: "하위 개수" },
  { label: "exist()", text: "exist()", caret: 6, hint: "값이 하나라도 있다" },
  { label: "not exist()", text: "notexist()", caret: 9, hint: "값이 하나도 없다" },
  { label: "and", text: "and", hint: "둘 다 참" },
  { label: "or", text: "or", hint: "하나라도 참" },
  { label: "not", text: "not", hint: "부정" },
  { label: "=", text: "=", hint: "같다" },
  { label: "≠", text: "≠", hint: "다르다" },
  { label: ">", text: ">", hint: "크다" },
  { label: "<", text: "<", hint: "작다" },
];

/** 패널의 마스터 필드 항목 — 서버가 직렬화해 넘긴다 (클라이언트는 마스터 트리를 모른다). */
export interface PanelField {
  path: string;
  /** `masterFieldFullLabel` — 「급부 · 보험금지급 › 면책여부」. */
  label: string;
  typeKind: FieldTypeKind;
}

export interface PanelForm {
  key: Code;
  label: string;
  level: AttachLevel;
  fields: PanelField[];
}

export interface PanelDiscriminator {
  code: Code;
  label: string;
  level: AttachLevel;
  /** 결과 타입(명시 또는 추론) — 하위 레벨을 집계로 감쌀 때 `sum` 인지 고른다. 모르면 없음. */
  typeKind?: FieldTypeKind;
}

/** 패널에서 넣는 참조 하나 — 마스터 필드 경로 또는 구분자 코드 + 그 레벨 · 타입. `referenceToken` 의 재료. */
export interface PanelRef {
  path: string;
  level: AttachLevel;
  typeKind?: FieldTypeKind;
}

export interface InsertPanelData {
  forms: PanelForm[];
  discriminators: PanelDiscriminator[];
}

/** 넣기 패널 재료 — 마스터 필드를 폼별로 묶고, 구분자에 결과 타입을 붙인다. 레벨 · 자기 제외 거르기는 패널이 한다. */
export function insertPanelData(master: MasterTree, defs: readonly Discriminator[]): InsertPanelData {
  const forms = new Map<Code, PanelForm>();
  for (const f of allMasterFields(master)) {
    let form = forms.get(f.form.key);
    if (!form) {
      form = { key: f.form.key, label: f.form.label, level: f.level, fields: [] };
      forms.set(f.form.key, form);
    }
    form.fields.push({ path: f.path, label: masterFieldFullLabel(f), typeKind: f.field.type.kind });
  }
  const catalog = new Map(defs.map((d) => [d.code, d]));
  const discriminators = defs.map((d) => {
    const type = discriminatorResultType(d, master, catalog);
    return { code: d.code, label: d.label, level: d.level, ...(type ? { typeKind: type.kind } : {}) };
  });
  return { forms: [...forms.values()], discriminators };
}
