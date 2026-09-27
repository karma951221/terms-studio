/**
 * 구분자·enum 정의의 생성·변경 규칙 (순수).
 *
 * 근거: docs/기능/구분자/구분자.md §3.1 · §3.2 · ADR-0005 · ADR-0036 · ADR-0037.
 *
 * - 구분자는 **식 하나**다. 생성은 코드를 채번한다 — 순번은 주입된 `nextSeq` 가 준다 (저장소).
 * - 식은 다른 구분자를 참조할 수 있다 (기능/구분자 §3.2). **자기 참조 · 순환**은 여기서 카탈로그 전체를
 *   따라가(DFS) 저장을 막는다 — 평가 시점의 가드(`assembly/context.ts`)는 두 번째 방어선이다.
 * - 비파괴 변경(표시명 · 설명 · 식 · enum 값 추가 · 순서)은 여기서 새 정의를 돌려준다. 원본은 안 바꾼다.
 * - 부착 레벨은 **채번 뒤 못 고친다** — 식의 참조 규칙(같은 레벨 · 하위는 집계 안)이 레벨에 매여 있고,
 *   레벨이 바뀌면 문면 사용처의 의미가 조용히 달라진다. 고치려면 새로 만든다.
 * - 파괴적 변경(enum 값 삭제)의 **정의 쪽 결과**도 여기 있다 — 영향 계산·확인·값 행 삭제는
 *   서비스가 `destructive()` + `ImpactSource` 로 두른다.
 */
import {
  ATTACH_LEVEL_LABEL,
  ATTACH_LEVELS,
  type AttachLevel,
  type Code,
  type Coordinate,
  type Issue,
  ok,
  reject,
  type Result,
} from "../types";
import { parse, requiredDiscriminatorCodes } from "../expression";
import type { ExprType } from "../expression";
import { allocateCode, type NextSeq } from "./codes";
import { checkDiscriminatorExpression, checkReferenceCycle, checkResultType, type DiscriminatorCatalog } from "./expression";
import type {
  Discriminator,
  DiscriminatorResultType,
  EnumDef,
  EnumLookup,
  EnumValueDef,
  NewDiscriminator,
  NewEnum,
  NewEnumValue,
} from "./types";

// ───────────────────────────── 문맥 ─────────────────────────────

/** 표시명 중복 검사에 필요한 최소 정보. */
export interface DiscriminatorSummary {
  code: Code;
  label: string;
  level: AttachLevel;
}

/**
 * 구분자 식 검증기 — 담보속성 유효값을 아는 자리(서비스)가 주입한다. 기본은 순수 카탈로그 검증.
 * `catalog` 를 주면 문맥의 카탈로그 대신 그것으로 참조를 푼다 — 식을 바꾼 뒤의 카탈로그로 사용처를 재검사할 때.
 */
export type ExpressionCheck = (source: string, level: AttachLevel, catalog?: DiscriminatorCatalog) => Result<unknown>;

export interface CatalogContext {
  nextSeq: NextSeq;
  /** 현재 카탈로그의 구분자들 (중복 검사용). */
  existing: readonly DiscriminatorSummary[];
  /** 현재 카탈로그 전체 — 구분자 참조를 풀고 순환을 찾는다. 없으면 구분자 참조는 모르는 참조다. */
  catalog?: DiscriminatorCatalog;
  findEnum: EnumLookup;
  /** 현재 enum 표시명들 (D-P1-7 중복 검사용). */
  existingEnumLabels?: readonly string[];
  /** 식 검증 — 기본 `checkDiscriminatorExpression`. */
  checkExpression?: ExpressionCheck;
}

// ───────────────────────────── 공통 검사 ─────────────────────────────

function invalid<T>(issues: Issue[]): Result<T> {
  return reject({ reason: "invalid", issues });
}

function issue(kind: Issue["kind"], message: string, refPath?: string): Issue {
  return { kind, message, at: refPath ? { refPath } : {} };
}

function checkLabel(label: unknown, what: string): Issue[] {
  return typeof label === "string" && label.trim().length > 0
    ? []
    : [issue("typeMismatch", `${what} 표시명은 비울 수 없습니다`)];
}

function checkLevel(level: unknown): Issue[] {
  return (ATTACH_LEVELS as readonly string[]).includes(level as string)
    ? []
    : [issue("typeMismatch", `부착 레벨은 ${ATTACH_LEVELS.join(" · ")} 중 하나여야 합니다`)];
}

/** 같은 부착 레벨 안 표시명 완전 중복 (D-P1-1). */
function findDuplicateLabel(
  label: string,
  level: AttachLevel,
  existing: readonly DiscriminatorSummary[],
  selfCode?: Code,
): Result<void> {
  const hit = existing.find((e) => e.code !== selfCode && e.level === level && e.label === label);
  if (!hit) return ok(undefined);
  return reject({
    reason: "duplicate",
    what: `${ATTACH_LEVEL_LABEL[level]} 레벨 표시명 「${label}」`,
  });
}

function expressionCheck(ctx: Pick<CatalogContext, "checkExpression" | "catalog">): ExpressionCheck {
  return ctx.checkExpression ?? ((source, level, catalog) => checkDiscriminatorExpression(source, level, { catalog: catalog ?? ctx.catalog }));
}

/**
 * 명시 결과 타입이 enum 계열이면 그 열거형변수가 있어야 한다 (기능/구분자 §3.1).
 * enumCode 가 비어있으면(고르지 않음) 「없는 참조」(brokenRef)가 아니라 「아직 안 골랐다」(typeMismatch) —
 * 둘은 원인이 다르다: 전자는 화면이 있는 코드를 가리키게 하면 되고, 후자는 사용자가 값을 채워야 한다.
 */
function checkResultTypeEnum(resultType: DiscriminatorResultType, findEnum: EnumLookup): Issue[] {
  if (resultType.kind !== "enum" && resultType.kind !== "list<enum>") return [];
  if (resultType.enumCode === "") return [issue("typeMismatch", "열거형변수를 고르세요")];
  return findEnum(resultType.enumCode) ? [] : [issue("brokenRef", `열거형변수 ${resultType.enumCode} 이(가) 없습니다`)];
}

/**
 * `code` 를 (전이적으로) 참조하는 구분자들 — 카탈로그 순서대로, 각 하나씩.
 * `through` 는 그 정의가 **직접 읽는** 구분자 (직접 참조자면 `code` 자신) — 깨질 때 식 안에서 고칠 자리다.
 */
export function dependentPaths(code: Code, catalog: DiscriminatorCatalog): { def: Discriminator; through: Code }[] {
  const refs = new Map<Code, Code[]>();
  for (const def of catalog.values()) {
    const parsed = parse(def.expression);
    if (parsed.ok) refs.set(def.code, requiredDiscriminatorCodes(parsed.value));
  }
  const out: { def: Discriminator; through: Code }[] = [];
  const seen = new Set<Code>([code]);
  const queue = [code];
  while (queue.length > 0) {
    const target = queue.shift()!;
    for (const def of catalog.values()) {
      if (seen.has(def.code) || !refs.get(def.code)?.includes(target)) continue;
      seen.add(def.code);
      out.push({ def, through: target });
      queue.push(def.code);
    }
  }
  return out;
}

/** `code` 를 (전이적으로) 참조하는 구분자들 — 카탈로그 순서대로, 각 하나씩. */
export function dependentsOf(code: Code, catalog: DiscriminatorCatalog): Discriminator[] {
  return dependentPaths(code, catalog).map((d) => d.def);
}

/** 참조하는 구분자가 깨질 때의 좌표 — 「어느 구분자를 고쳐야 하나」는 그 구분자의 편집기다 (ADR-0049 §4). */
function dependentAt(dep: Discriminator, through: Code): Coordinate {
  return { document: "catalog", ownerId: dep.code, ownerName: dep.label, refPath: through };
}

/**
 * 식을 바꾼 뒤에도 이 구분자를 참조하는 정의들이 여전히 유효한지 — 바뀐 정의를 끼운 카탈로그로 다시 검사한다.
 * 결과 타입이 같아도 세목 폼 · 레벨 규칙이 깨질 수 있다 (코덱스 리뷰 2026-09-14 Important-1:
 * D0002 = `D0001 and waiver.applies` 인데 D0001 이 `no_surrender.type = …` 로 바뀌면 D0002 가 두 폼을 읽는다).
 *
 * 저장(`setExpression`)이 거부 사유로 쓰고, 저장 전 검사(`services/catalog` `inspect`)도 같은 오류를 미리 보인다.
 * 식 검사 자체는 통과해도(예: 의존 구분자가 참조 하나뿐인 bare 식이면 타입 제약이 없다) 의존 구분자에
 * 명시 결과 타입(`dep.resultType`)이 있으면 새로 추론된 타입과 대조한다 — 아니면 D0005 의 식이 바뀌어
 * 추론 타입이 조용히 달라져도 D0005 를 참조하는 D0011 의 명시 타입만 옛 값인 채 남는다
 * (final-review fix: setExpression(D0005) 는 D0005 자신에 명시 타입이 없으면 이 대조를 건너뛰므로 여기서 잡는다).
 */
export function checkDependents(next: Discriminator, ctx: Pick<CatalogContext, "checkExpression" | "catalog">): Issue[] {
  if (!ctx.catalog) return [];
  const candidate = new Map(ctx.catalog);
  candidate.set(next.code, next);
  const check = expressionCheck(ctx);
  const issues: Issue[] = [];
  for (const { def: dep, through } of dependentPaths(next.code, candidate)) {
    const r = check(dep.expression, dep.level, candidate);
    if (!r.ok) {
      const why = r.rejection.reason === "invalid" ? r.rejection.issues.map((i) => i.message).join(" · ") : r.rejection.reason;
      issues.push({ kind: "typeMismatch", message: `이 식으로 바꾸면 참조하는 구분자 ${dep.code}(${dep.label}) 가 깨집니다: ${why}`, at: dependentAt(dep, through) });
      continue;
    }
    if (!dep.resultType) continue;
    const mismatch = checkResultType(dep.resultType, r.value as ExprType);
    if (mismatch.length === 0) continue;
    const why = mismatch.map((i) => i.message).join(" · ");
    issues.push({ kind: "typeMismatch", message: `이 식으로 바꾸면 참조하는 구분자 ${dep.code}(${dep.label}) 의 명시 결과 타입이 어긋납니다: ${why}`, at: dependentAt(dep, through) });
  }
  return issues;
}

// ───────────────────────────── 생성 ─────────────────────────────

/** 구분자 채번. 코드는 여기서 태어난다 — 입력에 code 는 없다. */
export async function createDiscriminator(
  input: NewDiscriminator,
  ctx: CatalogContext,
): Promise<Result<Discriminator>> {
  const issues = [...checkLabel(input.label, "구분자"), ...checkLevel(input.level)];
  if (issues.length > 0) return invalid(issues);

  const dup = findDuplicateLabel(input.label, input.level, ctx.existing);
  if (!dup.ok) return dup as Result<Discriminator>;

  const checked = expressionCheck(ctx)(input.expression, input.level);
  if (!checked.ok) return checked as Result<Discriminator>;

  if (input.resultType) {
    const resultIssues = [
      ...checkResultTypeEnum(input.resultType, ctx.findEnum),
      ...checkResultType(input.resultType, checked.value as ExprType),
    ];
    if (resultIssues.length > 0) return invalid(resultIssues);
  }

  const code = await allocateCode("discriminator", "", ctx.nextSeq);
  return ok({
    code,
    label: input.label,
    description: input.description ?? "",
    level: input.level,
    expression: input.expression,
    ...(input.resultType ? { resultType: input.resultType } : {}),
  });
}

// ───────────────────────────── 비파괴 변경 ─────────────────────────────

/** 표시명 변경 — 자유. 같은 레벨 중복만 막는다 (자기 자신 제외). */
export function renameDiscriminator(
  def: Discriminator,
  label: string,
  existing: readonly DiscriminatorSummary[],
): Result<Discriminator> {
  const issues = checkLabel(label, "구분자");
  if (issues.length > 0) return invalid(issues);
  const dup = findDuplicateLabel(label, def.level, existing, def.code);
  if (!dup.ok) return dup as Result<Discriminator>;
  return ok({ ...def, label });
}

export function setDescription(def: Discriminator, description: string): Result<Discriminator> {
  return ok({ ...def, description });
}

/**
 * 식 수정 — 비파괴 (D-P1-12). 채번과 같은 검증 + 자기 참조 · 순환 거부 (기능/구분자 §3.2).
 * 생성 시점에는 코드가 아직 없어 아무도 새 구분자를 부를 수 없다 — 순환은 수정에서만 생긴다.
 * 이 구분자를 참조하는 구분자들은 바뀐 카탈로그로 다시 검사한다 (`checkDependents`).
 * `resultType` 이 있으면 새 식의 추론 타입과 대조한다 — 식을 바꿔 결과 타입이 조용히 바뀌어
 * 슬롯이 깨지는 것을 저장 시점에 잡는 게 기능/구분자 §3.1 이 명시 타입을 둔 이유다.
 * (그 외 문면 사용처가 깨지는지는 서비스가 사용처 검사로 본다 — 기능/구분자 §3.4.)
 */
export function setExpression(
  def: Discriminator,
  expression: string,
  ctx: Pick<CatalogContext, "checkExpression" | "catalog"> = {},
): Result<Discriminator> {
  const checked = expressionCheck(ctx)(expression, def.level);
  if (!checked.ok) return checked as Result<Discriminator>;
  if (def.resultType) {
    const mismatch = checkResultType(def.resultType, checked.value as ExprType);
    if (mismatch.length > 0) return invalid(mismatch);
  }
  const cycle = checkReferenceCycle(def.code, expression, ctx.catalog);
  if (cycle.length > 0) return invalid(cycle);
  const next = { ...def, expression };
  const dependents = checkDependents(next, ctx);
  if (dependents.length > 0) return invalid(dependents);
  return ok(next);
}

/**
 * 명시 결과 타입 설정·해제 (기능/구분자 §3.1). `undefined` 를 주면 미지정으로 되돌린다(키 제거).
 * 있으면 열거형변수 존재 → 현재 식의 추론 타입과 대조 순으로 본다. 식 검사 자체가 실패하면 그 거부를 그대로 돌려준다.
 */
export function setResultType(
  def: Discriminator,
  resultType: DiscriminatorResultType | undefined,
  ctx: Pick<CatalogContext, "checkExpression" | "catalog" | "findEnum">,
): Result<Discriminator> {
  if (resultType === undefined) {
    const { resultType: _dropped, ...rest } = def;
    void _dropped;
    return ok(rest);
  }
  const enumIssues = checkResultTypeEnum(resultType, ctx.findEnum);
  if (enumIssues.length > 0) return invalid(enumIssues);
  const checked = expressionCheck(ctx)(def.expression, def.level);
  if (!checked.ok) return checked as Result<Discriminator>;
  const mismatch = checkResultType(resultType, checked.value as ExprType);
  if (mismatch.length > 0) return invalid(mismatch);
  return ok({ ...def, resultType });
}

// ───────────────────────────── enum ─────────────────────────────

function checkEnumLabel(label: string, existing: readonly string[], self?: string): Result<void> {
  const issues = checkLabel(label, "enum");
  if (issues.length > 0) return invalid(issues);
  if (label !== self && existing.includes(label)) {
    return reject({ reason: "duplicate", what: `enum 표시명 「${label}」` });
  }
  return ok(undefined);
}

/**
 * enum 값 표시명의 동일성 — 앞뒤 공백 · 연속 공백 · 대소문자를 무시한다. 저장은 적은 그대로, 비교만 이걸로.
 * 생성 화면(EnumValuesInput)의 중복 표시와 서버 거부가 같은 정책이어야 한다 (코덱스 리뷰 2026-09-14 Minor-1).
 */
export function enumValueLabelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

async function buildEnumValues(
  enumCode: Code,
  inputs: readonly NewEnumValue[],
  startOrder: number,
  nextSeq: NextSeq,
  taken: readonly string[],
): Promise<Result<EnumValueDef[]>> {
  const labels = new Set(taken.map(enumValueLabelKey));
  for (const v of inputs) {
    const issues = checkLabel(v.label, "enum 값");
    if (issues.length > 0) return invalid(issues);
    const key = enumValueLabelKey(v.label);
    if (labels.has(key)) return reject({ reason: "duplicate", what: `enum 값 표시명 「${v.label}」` });
    labels.add(key);
  }
  const values: EnumValueDef[] = [];
  for (const [i, v] of inputs.entries()) {
    values.push({ code: await allocateCode("enumValue", enumCode, nextSeq), label: v.label, order: startOrder + i });
  }
  return ok(values);
}

/** enum 정의 생성 — E0001 부터, 값은 그 enum 안에서 V01 부터. */
export async function createEnum(
  input: NewEnum,
  ctx: Pick<CatalogContext, "nextSeq" | "existingEnumLabels">,
): Promise<Result<EnumDef>> {
  const labelOk = checkEnumLabel(input.label, ctx.existingEnumLabels ?? []);
  if (!labelOk.ok) return labelOk as Result<EnumDef>;
  const code = await allocateCode("enum", "", ctx.nextSeq);
  const values = await buildEnumValues(code, input.values ?? [], 0, ctx.nextSeq, []);
  if (!values.ok) return values as Result<EnumDef>;
  return ok({ code, label: input.label, description: input.description ?? "", values: values.value });
}

export function renameEnum(def: EnumDef, label: string, existingEnumLabels: readonly string[]): Result<EnumDef> {
  const r = checkEnumLabel(label, existingEnumLabels, def.label);
  if (!r.ok) return r as Result<EnumDef>;
  return ok({ ...def, label });
}

/** enum 값 추가 — 자유. 코드 배포 없이 유효값이 늘어난다. */
export async function addEnumValue(def: EnumDef, input: NewEnumValue, nextSeq: NextSeq): Promise<Result<EnumDef>> {
  const built = await buildEnumValues(
    def.code,
    [input],
    def.values.length,
    nextSeq,
    def.values.map((v) => v.label),
  );
  if (!built.ok) return built as Result<EnumDef>;
  return ok({ ...def, values: [...def.values, ...built.value] });
}

function findEnumValue(def: EnumDef, valueCode: Code): Result<EnumValueDef> {
  const v = def.values.find((x) => x.code === valueCode);
  return v ? ok(v) : reject({ reason: "notFound", what: `enum 값 ${valueCode}` });
}

export function renameEnumValue(def: EnumDef, valueCode: Code, label: string): Result<EnumDef> {
  const issues = checkLabel(label, "enum 값");
  if (issues.length > 0) return invalid(issues);
  const v = findEnumValue(def, valueCode);
  if (!v.ok) return v as Result<EnumDef>;
  if (def.values.some((x) => x.code !== valueCode && enumValueLabelKey(x.label) === enumValueLabelKey(label))) {
    return reject({ reason: "duplicate", what: `enum 값 표시명 「${label}」` });
  }
  return ok({ ...def, values: def.values.map((x) => (x.code === valueCode ? { ...x, label } : x)) });
}

/** 값 순서 변경 (D-P1-8) — 전체 값 코드를 새 순서로. */
export function reorderEnumValues(def: EnumDef, order: readonly Code[]): Result<EnumDef> {
  const have = def.values.map((v) => v.code).sort();
  const want = [...order].sort();
  if (have.length !== want.length || have.some((c, i) => c !== want[i])) {
    return invalid([issue("typeMismatch", "값 순서에는 모든 값 코드가 한 번씩 있어야 합니다")]);
  }
  const byCode = new Map(def.values.map((v) => [v.code, v]));
  return ok({ ...def, values: order.map((c, i) => ({ ...byCode.get(c)!, order: i })) });
}

/** enum 값 삭제의 정의 쪽 결과 — 값 행 삭제·참조 오류화는 서비스 몫. */
export function removeEnumValue(def: EnumDef, valueCode: Code): Result<EnumDef> {
  const v = findEnumValue(def, valueCode);
  if (!v.ok) return v as Result<EnumDef>;
  return ok({
    ...def,
    values: def.values.filter((x) => x.code !== valueCode).map((x, i) => ({ ...x, order: i })),
  });
}
