/**
 * 구분자 식 검증 — 저장 시점 (기능/구분자 §3.1 · §3.2 · ADR-0013 · ADR-0037).
 *
 * 규칙 넷 (참조 경로는 `폼키.필드키` 또는 구분자 코드, 레벨은 폼 · 정의의 것 — 기능/마스터 §3.2):
 * 1. **마스터 필드와 구분자를 참조한다.** 구분자 → 구분자 참조는 기능/구분자 §3.2 가 열었다 — 규칙은 필드와 같다.
 *    자기 참조 · 순환은 정의 저장(`definitions.ts`)이 카탈로그 전체로 거부한다.
 *    (담보속성 `attr.X` · 내장 경로 `builtin.<레벨>.name` 은 탑재의 좌표 · 뼈대라 그대로 허용.)
 * 2. **같은 레벨은 그대로**, **하위 레벨은 집계 안에서만** — 집계 없이 쓰면 거부.
 * 3. **상위 레벨은 거부** — MVP 는 상위 → 하위 방향만.
 * 4. 파서 · 참조 존재 · 타입 검사를 통과해야 저장된다. 결과 타입은 식에서 추론한다 —
 *    구분자 참조의 타입은 참조한 정의의 결과 타입이다 (재귀 · 순환이면 모름 = brokenRef).
 *
 * 세목(plan) 레벨 구분자는 **세목 폼 하나의 필드만 읽는다** (실물재현2차 설계 §2.3 항목 3) —
 * 선택지는 유형(폼) 하나를 가지므로 두 폼을 읽는 식은 어느 선택지에서도 자리가 없다.
 * 구분자 참조를 타고 들어가 폼키를 구하는 것이 `planFormOf` — 조립의 `children` 과 이 검사가 같은 함수를 쓴다.
 *
 * 항등 투영(`구분자 = 폼.필드`)은 **허용**이다 — 문면이 구분자만 보니 필드 하나를 문면에 내는
 * 길이 그것뿐이다 (ADR-0036 §2).
 */
import { checkTypes, extractRefs, parse, refPath, requiredDiscriminatorCodes } from "../expression";
import type { Expr, ExprType, Ref, TypeResolver } from "../expression";
import {
  ATTACH_LEVEL_LABEL,
  type AttachLevel,
  type Code,
  type Coordinate,
  type FieldType,
  type Issue,
  reject,
  type Result,
} from "../types";
import { findMasterField, levelDepth, masterFieldFullLabel, type MasterTree } from "../master";
import type { Discriminator, DiscriminatorResultType } from "./types";

/** 담보속성 유효값 조회 — 주면 `attr.X = '값'` 의 리터럴을 유효값 목록으로 검사한다 (ADR-0015). */
export type AttributeValues = (kindCode: string) => string[] | undefined;

/** 구분자 참조를 풀 카탈로그 — 코드 → 정의. */
export type DiscriminatorCatalog = ReadonlyMap<Code, Discriminator>;

export interface DiscriminatorExpressionOptions {
  /** 오류 좌표의 기본값. refPath 는 검사기가 얹는다. */
  coordinate?: Coordinate;
  attributeValues?: AttributeValues;
  /** 검사가 볼 마스터 트리. 기본은 MVP 정본. */
  master?: MasterTree;
  /** 구분자 참조를 풀 카탈로그. 없으면 구분자 참조는 모르는 참조(brokenRef)다. */
  catalog?: DiscriminatorCatalog;
}

// ───────────────────────────── 타입 조회 ─────────────────────────────

/**
 * 구분자의 결과 타입을 식에서 푼다. `visiting` 은 지금 타고 들어온 구분자들 — 다시 만나면 순환이라 모름.
 * 참조한 구분자의 식 자체가 안 맞으면(문법 · 타입) 그 구분자의 타입도 모름이다.
 */
function resultTypeOf(
  def: { code?: Code; expression: string },
  master: MasterTree | undefined,
  catalog: DiscriminatorCatalog | undefined,
  visiting: ReadonlySet<Code>,
): ExprType | undefined {
  if (def.code !== undefined && visiting.has(def.code)) return undefined;
  const parsed = parse(def.expression);
  if (!parsed.ok) return undefined;
  const next = def.code === undefined ? visiting : new Set([...visiting, def.code]);
  const checked = checkTypes(parsed.value, resolverWith(undefined, master, catalog, next));
  return checked.ok ? checked.value : undefined;
}

function resolverWith(
  attributeValues: AttributeValues | undefined,
  master: MasterTree | undefined,
  catalog: DiscriminatorCatalog | undefined,
  visiting: ReadonlySet<Code>,
): TypeResolver {
  return (ref: Ref): ExprType | undefined => {
    switch (ref.kind) {
      case "master":
        return findMasterField(refPath(ref), master)?.field.type;
      case "builtin":
        return ref.prop === "name" ? { kind: "string" } : undefined;
      case "attr": {
        const values = attributeValues?.(ref.code);
        return values === undefined ? { kind: "attribute" } : { kind: "attribute", validValues: values };
      }
      case "discriminator": {
        const def = catalog?.get(ref.code);
        return def ? resultTypeOf(def, master, catalog, visiting) : undefined;
      }
    }
  };
}

/**
 * 마스터 · 카탈로그 기반 타입 조회 — 구분자 식의 참조가 무엇인지 언어에 알려준다.
 * 구분자 참조는 참조한 정의의 결과 타입으로 푼다 (재귀). 카탈로그가 없거나 순환이면 모름(brokenRef).
 */
export function masterTypeResolver(
  attributeValues?: AttributeValues,
  master?: MasterTree,
  catalog?: DiscriminatorCatalog,
): TypeResolver {
  return resolverWith(attributeValues, master, catalog, new Set());
}

// ───────────────────────────── 참조 규칙 ─────────────────────────────

function issue(kind: Issue["kind"], message: string, at: Coordinate, path?: string): Issue {
  return { kind, message, at: path === undefined ? { ...at } : { ...at, refPath: path } };
}

const PLAN_ONE_FORM = "세목 레벨 구분자는 폼 하나만 읽는다";

/**
 * 식이 읽는 **세목 폼키** 집합 — 세목 레벨 마스터 필드의 폼키 + 구분자 참조를 타고 들어간 것.
 * 다른 레벨 폼(하위 집계)과 내장 경로는 세지 않는다 — 선택지의 값 자리가 아니다.
 * 순환을 만나거나 참조한 구분자의 식이 안 읽히면 undefined.
 */
function planFormsOf(
  expr: Expr,
  catalog: DiscriminatorCatalog | undefined,
  master: MasterTree | undefined,
  visiting: ReadonlySet<Code>,
): Set<Code> | undefined {
  const forms = new Set<Code>();
  for (const { ref } of extractRefs(expr)) {
    if (ref.kind === "master") {
      const found = findMasterField(refPath(ref), master);
      if (found?.level === "plan") forms.add(found.form.key);
    } else if (ref.kind === "discriminator") {
      const def = catalog?.get(ref.code);
      if (!def) continue; // 모르는 참조는 brokenRef 가 따로 잡는다
      if (def.level !== "plan") continue; // 하위 레벨 구분자의 폼은 선택지 자리가 아니다
      if (visiting.has(def.code)) return undefined;
      const parsed = parse(def.expression);
      if (!parsed.ok) return undefined;
      const inner = planFormsOf(parsed.value, catalog, master, new Set([...visiting, def.code]));
      if (inner === undefined) return undefined;
      for (const f of inner) forms.add(f);
    }
  }
  return forms;
}

/**
 * 세목 레벨 구분자의 **선택지 범위** — 구분자 참조를 타고 들어가 읽는 세목 폼으로 정한다.
 * - `all`     : 세목 폼을 안 읽는다 (내장 경로 · 하위 집계뿐) → 선택지 전부가 범위 (`builtin.plan.name` 과 같다).
 * - `form`    : 폼 하나 → 그 유형의 선택지만.
 * - `invalid` : 둘 이상 읽거나 · 순환이거나 · 문법이 틀리거나 · 세목 레벨이 아니다 → 범위를 정할 수 없다.
 * `all` 과 `invalid` 를 하나로 뭉개면 깨진 정의가 조용히 「선택지 전부」로 평가된다 (코덱스 리뷰 2026-09-14 Important-1).
 * 조립의 `children`(선택지 범위)과 정의 검사(`checkReferenceRules`)가 같은 `planFormsOf` 를 본다.
 */
export type PlanFormScope = { kind: "all" } | { kind: "form"; form: Code } | { kind: "invalid"; forms: readonly Code[] };

export function planFormScope(
  def: { level: AttachLevel; expression: string },
  catalog: DiscriminatorCatalog,
  master?: MasterTree,
): PlanFormScope {
  if (def.level !== "plan") return { kind: "invalid", forms: [] };
  const parsed = parse(def.expression);
  if (!parsed.ok) return { kind: "invalid", forms: [] };
  const forms = planFormsOf(parsed.value, catalog, master, new Set());
  if (forms === undefined) return { kind: "invalid", forms: [] };
  if (forms.size === 0) return { kind: "all" };
  if (forms.size === 1) return { kind: "form", form: [...forms][0]! };
  return { kind: "invalid", forms: [...forms] };
}

/** `planFormScope` 가 `form` 일 때만 그 폼키 — 안 읽거나 깨졌으면 undefined (구분 없이 폼키만 필요할 때). */
export function planFormOf(
  def: { level: AttachLevel; expression: string },
  catalog: DiscriminatorCatalog,
  master?: MasterTree,
): Code | undefined {
  const scope = planFormScope(def, catalog, master);
  return scope.kind === "form" ? scope.form : undefined;
}

/**
 * 참조 규칙 1~3 — 마스터 필드 · 구분자 · 같은 레벨은 직접 · 하위는 집계 안 · 상위는 거부.
 * 세목 레벨이면 읽는 세목 폼이 하나뿐인지도 본다.
 */
export function checkReferenceRules(
  expr: Expr,
  level: AttachLevel,
  at: Coordinate = {},
  master?: MasterTree,
  catalog?: DiscriminatorCatalog,
): Issue[] {
  const issues: Issue[] = [];
  const here = levelDepth(level);

  const checkLevel = (there: AttachLevel, what: string, path: string, aggregate: unknown): void => {
    const depth = levelDepth(there);
    if (depth < here) {
      issues.push(
        issue(
          "typeMismatch",
          `${ATTACH_LEVEL_LABEL[level]} 레벨 구분자는 상위 레벨 ${what} 를 부를 수 없습니다 (MVP 는 상위 → 하위 방향만)`,
          at,
          path,
        ),
      );
      return;
    }
    if (depth > here && aggregate === undefined) {
      issues.push(
        issue(
          "typeMismatch",
          `하위 레벨 ${what} 는 집계(any · all · sum · count · exist · not exist) 안에서만 부를 수 있습니다`,
          at,
          path,
        ),
      );
    }
  };

  for (const { ref, path, aggregate } of extractRefs(expr)) {
    if (ref.kind === "discriminator") {
      const def = catalog?.get(ref.code);
      if (!def) {
        issues.push(issue("brokenRef", `카탈로그에 구분자 ${path} 가 없습니다`, at, path));
        continue;
      }
      checkLevel(def.level, `구분자 ${ATTACH_LEVEL_LABEL[def.level]} · ${def.label}(${def.code})`, path, aggregate);
      continue;
    }
    if (ref.kind !== "master") continue; // attr · builtin 은 이 규칙 밖
    const found = findMasterField(path, master);
    if (!found) {
      issues.push(issue("brokenRef", `마스터에 ${path} 자리가 없습니다`, at, path));
      continue;
    }
    checkLevel(found.level, `자리 ${masterFieldFullLabel(found)}`, path, aggregate);
  }

  if (level === "plan" && issues.length === 0) {
    const forms = planFormsOf(expr, catalog, master, new Set());
    if (forms !== undefined && forms.size > 1) {
      issues.push(issue("typeMismatch", `${PLAN_ONE_FORM} — 이 식은 ${[...forms].join(" · ")} 을 읽습니다`, at));
    }
  }
  return issues;
}

/**
 * 구분자 식 저장 검증 — 파서 → 참조 규칙 → 타입. 통과하면 추론된 결과 타입을 돌려준다.
 * 실패는 `Rejection{reason:'invalid', issues}` (syntax · typeMismatch · brokenRef).
 */
export function checkDiscriminatorExpression(
  source: string,
  level: AttachLevel,
  options: DiscriminatorExpressionOptions = {},
): Result<ExprType> {
  const at = options.coordinate ?? {};
  if (typeof source !== "string" || source.trim().length === 0) {
    return reject({ reason: "invalid", issues: [issue("syntax", "구분자의 식은 비울 수 없습니다", at)] });
  }
  const parsed = parse(source, at);
  if (!parsed.ok) return parsed as Result<ExprType>;

  const refIssues = checkReferenceRules(parsed.value, level, at, options.master, options.catalog);
  if (refIssues.length > 0) return reject({ reason: "invalid", issues: refIssues });

  return checkTypes(parsed.value, masterTypeResolver(options.attributeValues, options.master, options.catalog), {
    coordinate: at,
  });
}

/**
 * 명시 결과 타입과 식에서 추론한 타입을 대조한다 (기능/구분자 §3.1 · §3.3 「명시 타입 ≠ 추론 타입」).
 * 일치하면 `[]`. `createDiscriminator` · `setExpression` · `setResultType` 이 저장 시점에 쓴다.
 */
export function checkResultType(declared: DiscriminatorResultType, inferred: ExprType, coordinate: Coordinate = {}): Issue[] {
  if (inferred.kind === "attribute") {
    return [issue("typeMismatch", "담보속성은 결과 타입이 아닙니다", coordinate)];
  }
  if (declared.kind !== inferred.kind) {
    return [
      issue(
        "typeMismatch",
        `명시한 결과 타입 ${declared.kind} 이(가) 식에서 추론한 타입 ${inferred.kind} 과(와) 다릅니다`,
        coordinate,
      ),
    ];
  }
  if (
    (declared.kind === "enum" || declared.kind === "list<enum>") &&
    (inferred.kind === "enum" || inferred.kind === "list<enum>") &&
    declared.enumCode !== inferred.enumCode
  ) {
    return [
      issue(
        "typeMismatch",
        `명시한 열거형변수 ${declared.enumCode} 이(가) 식이 읽는 열거형변수 ${inferred.enumCode} 과(와) 다릅니다`,
        coordinate,
      ),
    ];
  }
  return [];
}

/**
 * 구분자의 **결과 타입** — `def.resultType` 이 있으면 그것을 그대로 돌려준다(추론하지 않는다).
 * 없으면 식에서 추론한다 (기능/구분자 §3.1: 명시 타입이 있으면 슬롯 규칙은 그것을 본다 — 과도기엔 추론뿐이었다, ADR-0037).
 * 문면 슬롯이 enum 값을 표시명으로 찍을 때(ADR-0005) 어떤 열거형변수인지 여기서 안다.
 * 구분자 참조는 카탈로그로 푼다 — 안 주면 참조 있는 식은 모름. 담보속성 타입은 값 타입이 아니므로 undefined.
 */
export function discriminatorResultType(
  def: { code?: Code; level: AttachLevel; expression: string; resultType?: DiscriminatorResultType },
  master?: MasterTree,
  catalog?: DiscriminatorCatalog,
): FieldType | undefined {
  if (def.resultType) return def.resultType;
  const type = resultTypeOf(def, master, catalog, new Set());
  return type === undefined || type.kind === "attribute" || type.kind === "planOptions" ? undefined : type;
}

// ───────────────────────────── 자기 참조 · 순환 ─────────────────────────────

/**
 * 자기 참조 · 순환 검사 — 새 식이 부르는 구분자에서 출발해 카탈로그를 따라가며 `self` 로 돌아오는지 본다 (기능/구분자 §3.2).
 * 순환이면 그 경로(`self → … → self`)를 문구에 담는다. 파싱 안 되는 식은 식 검증이 먼저 잡았으니 여기선 `[]`.
 * 정의 저장(`definitions.ts` `setExpression`)과 저장 전 검사(`inspectExpression`)가 같은 함수를 본다.
 */
export function checkReferenceCycle(self: Code, expression: string, catalog: DiscriminatorCatalog | undefined, at: Coordinate = {}): Issue[] {
  const parsed = parse(expression);
  if (!parsed.ok) return [];
  const heads = requiredDiscriminatorCodes(parsed.value);
  if (heads.includes(self)) {
    return [issue("typeMismatch", `구분자 ${self} 는 자기 자신을 참조할 수 없습니다`, at, self)];
  }
  if (!catalog) return [];
  const visited = new Set<Code>();
  const walk = (code: Code, trail: Code[]): Code[] | undefined => {
    if (code === self) return [...trail, code];
    if (visited.has(code)) return undefined;
    visited.add(code);
    const def = catalog.get(code);
    if (!def) return undefined;
    const inner = parse(def.expression);
    if (!inner.ok) return undefined;
    for (const next of requiredDiscriminatorCodes(inner.value)) {
      const found = walk(next, [...trail, code]);
      if (found) return found;
    }
    return undefined;
  };
  for (const head of heads) {
    const cycle = walk(head, [self]);
    if (cycle) {
      return [issue("typeMismatch", `구분자 참조가 순환합니다: ${cycle.join(" → ")}`, at, head)];
    }
  }
  return [];
}

// ───────────────────────────── 저장 전 검사 — 오류 · 경고 두 등급 (기능/구분자 §3.3) ─────────────────────────────

/** 경고 계산이 볼 문맥 — 마스터 · 카탈로그. 경고는 저장하지 않고 읽을 때마다 식에서 계산한다. */
export interface WarningContext {
  master?: MasterTree;
  catalog?: DiscriminatorCatalog;
}

/**
 * 구분자 정의의 **경고** — 저장은 되지만 배지로 남는 것 (기능/구분자 §3.3).
 * 지금은 **별칭** 하나: 파싱된 식이 참조 하나(구분자 또는 마스터 필드)뿐이면 「값 하나에 이름 둘」이다 —
 * 허용하되 경고 (기능/구분자 §3.2 · 「별칭형 파생 금지」 폐기). 집계 하나(`any(x)`)는 값을 바꾸니 별칭이 아니다.
 * 파싱 안 되는 식은 경고 대상이 아니다 — 오류는 검사가 따로 낸다.
 */
export function discriminatorWarnings(
  def: { expression: string; level: AttachLevel; resultType?: DiscriminatorResultType },
  _ctx: WarningContext = {},
  at: Coordinate = {},
): Issue[] {
  void _ctx; // 지금의 경고(별칭)는 식만 본다 — 뒤에 올 경고(부착 레벨 변경 등)가 마스터 · 카탈로그를 볼 자리
  const parsed = parse(def.expression);
  if (!parsed.ok) return [];
  const expr = parsed.value;
  if (expr.kind !== "ref" || (expr.ref.kind !== "discriminator" && expr.ref.kind !== "master")) return [];
  const path = refPath(expr.ref);
  return [{ ...issue("alias", `별칭입니다 — 이 구분자는 ${path} 하나를 그대로 돌려줍니다`, at, path), severity: "warning" }];
}

/** 저장 전 검사 결과 — 오류(저장 막음) · 경고(저장되고 배지) · 추론 타입(채울 수 있을 때만). */
export interface Inspection {
  errors: Issue[];
  warnings: Issue[];
  inferred?: ExprType;
}

/**
 * 「검사」 — 식 검증의 오류 + 명시 타입 대조 + (code 가 있으면) 자기 참조 · 순환 + 경고를 한 번에 (기능/구분자 §3.3).
 * 생성 화면에는 code 가 없어 아무도 새 구분자를 부를 수 없다 — 순환은 수정에서만 본다.
 * 오류가 있어도 식 자체가 서면(타입이 추론되면) `inferred` 를 채운다 — 명시 타입 불일치 문구 옆에 추론 타입을 보이려고.
 * 경고는 오류가 없을 때만 낸다.
 * 사용처가 깨지는지(문면 슬롯 · 의존 구분자)는 그래프를 아는 서비스가 얹는다 (`services/catalog` `inspect`).
 */
export function inspectExpression(
  input: { code?: Code; expression: string; level: AttachLevel; resultType?: DiscriminatorResultType },
  ctx: WarningContext & Pick<DiscriminatorExpressionOptions, "attributeValues"> = {},
  at: Coordinate = {},
): Inspection {
  const checked = checkDiscriminatorExpression(input.expression, input.level, { ...ctx, coordinate: at });
  const errors: Issue[] = [];
  let inferred: ExprType | undefined;
  if (checked.ok) inferred = checked.value;
  else if (checked.rejection.reason === "invalid") errors.push(...checked.rejection.issues);
  if (inferred && input.resultType) errors.push(...checkResultType(input.resultType, inferred, at));
  if (input.code !== undefined) errors.push(...checkReferenceCycle(input.code, input.expression, ctx.catalog, at));
  // 오류가 있으면 경고는 내지 않는다 — 고칠 것은 오류 하나씩이고, 깨진 식의 「별칭」은 뜻이 없다 (모르는 참조 하나뿐인 식 등)
  const warnings = errors.length === 0 ? discriminatorWarnings(input, ctx, at) : [];
  return { errors, warnings, ...(inferred ? { inferred } : {}) };
}
