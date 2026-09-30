/**
 * 1단계 — 문맥 구성. 상품담보(탑재 스냅샷)마다 식 언어의 `EvalContext` 를 만든다.
 *
 * B1 `coverage/evalContext.ts`(담보 마스터 문맥)와 같은 방식이되 재료가 다르다:
 *   - 담보·세부보장·급부 레벨 = **스냅샷 값** (owner: 상품담보 · 스냅샷 노드). 마스터 필드 참조는 자기 레벨 또는
 *     조상에서, 집계 범위는 하위 트리 (기능/구분자 §3.2). 부착이 없으므로 자리는 늘 있다 (ADR-0037).
 *   - 상품 레벨 = 상품 값. 구분자 = 그 레벨 문맥에서 식 평가 (오류면 미입력 자리로 보고 — B1 과 같은 규약).
 *   - 담보속성 = 상품담보의 조합 (쓰면 값, 아니면 unused — ADR-0015).
 *   - 세목(plan) 레벨 = 상품의 **세목 선택지**(`AssemblyProduct.planOptions`, 유효 조합에 등장하는 것 — 기능/조립산출 §3.2).
 *     집계 범위는 참조가 읽는 폼의 선택지 (선택지는 유형 하나), 선택지 하나가 **세목 커서**로 문맥에 실린다.
 *     커서 없이 세목 필드를 직접 읽는 식은 정의 시점에 거부된다 (상위 → 하위는 집계만) — 만나면 자리 없음.
 *     보통약관 · 담보약관 문맥이 같은 범위를 쓴다 — 부착 세목(`AssemblyCoverage.plans`)은 읽지 않는다 (기능/조립산출 §3.2).
 * 보통약관 문맥 = 상품 레벨 + **기본계약 상품담보의 담보 레벨** (기능/조립산출 §3.2). 기본계약이 없으면 담보 레벨 참조는
 * 미결로 두고 조립이 `noBaseContract` 오류로 바꾼다 (`explainUndetermined`).
 *
 * 실행이 읽은 값 자리는 `ReadRecord` 로 남긴다 — 조립 문맥 조회(D-P6-7)·실행 기반 완결성 필터의 재료.
 */

import { planFormScope, type PlanFormScope } from "../catalog/expression";
import type { Discriminator, EnumDef, SlotPath } from "../catalog/types";
import { isFormOpened, missingEnumCodes, missingValueMessage } from "../catalog/values";
import { coverageChildrenProviders, coverageStructNode } from "../coverage/evalContext";
import { descendants, findNode, findNodeById, nodeName, nodesOf } from "../coverage/tree";
import type { Coverage, CoverageNode, CoverageNodeLevel } from "../coverage/types";
import type { DocumentNode } from "../document/nodes";
import type { EvalContext, LookupResult, ValueRef } from "../expression";
import { evaluate, parse, refPath } from "../expression";
import { findMasterField, isMasterPathShape, type MasterFieldRef, type MasterTree } from "../master";
import type { RowSource } from "../structure";
import { type AttachLevel, type Code, type Coordinate, entered, type Id, type Issue, NOT_ENTERED, type Value, type ValueSlot } from "../types";
import type { AssemblyCoverage, AssemblyInput, AssemblyPlanOption, AssemblyProduct, ContextTrace, ReadRecord } from "./types";

// ───────────────────────────── 계약 ─────────────────────────────

/** 조립이 쓰는 문맥 — EvalContext + 미결의 원인 설명 + 실행 추적. */
export interface AssemblyContext {
  eval: EvalContext;
  /** 미결(`undetermined`)을 조립 오류로 바꾼다 — 원인에 맞는 Issue kind (noBaseContract · brokenRef). */
  explainUndetermined(reason: string, at: Coordinate): Issue;
  /** 이 문맥이 값을 읽는 상품담보 (보통약관 문맥이면 기본계약). 없으면 undefined. */
  trace?: ContextTrace;
  /**
   * 반복 표 행 원천 — 특약(상품담보) 문맥에만 있다 (ADR-0070 결정 6 「담보 약관 문서에서만」).
   * 뿌리 = 상품담보 스냅샷, 자식 = 스냅샷 세부보장 · 급부, 행 문맥 = 그 스냅샷 노드 문맥 (같은 추적에 읽기가 실린다).
   */
  rows?: RowSource<EvalContext>;
  /**
   * 세목 커서 — 블록 반복(세목 선택지 원천, ADR-0077)의 원소 문맥. 선택지 = 상품의 세목 선택지(세목 범위), 문맥 = 그 선택지를 커서로 세운 문서 문맥
   * (세목 레벨 구분자 · `builtin.plan.name` 이 그 종을 읽는다).
   */
  plans?: { options: readonly AssemblyPlanOption[]; context(optionId: Id): EvalContext | undefined };
}

export interface AssemblyContexts {
  general: AssemblyContext;
  /** 상품담보 id → 문맥. */
  specials: ReadonlyMap<Id, AssemblyContext>;
  /** 상품담보별 실행 추적 (읽은 값 자리). */
  traces: ContextTrace[];
}

// ───────────────────────────── 내부 환경 ─────────────────────────────

const DEPTH: Record<CoverageNodeLevel, number> = { coverage: 0, subCoverage: 1, benefit: 2 };

function isTreeLevel(level: AttachLevel): level is CoverageNodeLevel {
  return level in DEPTH;
}

const MISSING: LookupResult = { kind: "missing" };
const BROKEN: LookupResult = { kind: "missing", issue: "brokenRef" };
const UNDETERMINED: LookupResult = { kind: "undetermined" };

/** 구분자 정의가 원인인 오류의 원천 — 구분자 편집기, 그 구분자 (ADR-0049 §4). */
function catalogSource(def: Discriminator): Coordinate {
  return { document: "catalog", ownerId: def.code, ownerName: def.label };
}

/** 구분자 식 자체가 깨져 자리가 없다 — 문면의 참조가 아니라 그 구분자를 고쳐야 사라진다. */
function brokenDefinition(def: Discriminator): LookupResult {
  return { kind: "missing", issue: "brokenRef", source: catalogSource(def) };
}

function slotOf(value: Value): LookupResult {
  return { kind: "slot", slot: entered(value) };
}

interface Env {
  product: AssemblyProduct;
  catalog: ReadonlyMap<Code, Discriminator>;
  /** 열거형변수 — 값 자리의 열거값 코드가 정의에 있는지 본다 (「없는 값」, ADR-0078 결정 5). */
  enums: ReadonlyMap<Code, EnumDef>;
  /** 스냅샷을 담보 트리 모양으로 (id = 상품담보 id · 스냅샷 노드 id). 없으면 담보 레벨을 모른다 (기본계약 없는 보통약관). */
  tree?: Coverage;
  /** 세목 집계 범위 — 상품의 선택지 (= `product.planOptions`). */
  planOptions: readonly AssemblyPlanOption[];
  /** owner id(상품 · 세목 선택지 · 상품담보 · 스냅샷 노드) → 값 자리. */
  values: ReadonlyMap<Id, ReadonlyMap<SlotPath, ValueSlot>>;
  attributes: ReadonlyMap<Code, Code>;
  /** 값 자리를 정하는 마스터 트리. 기본은 MVP 정본. */
  master?: MasterTree;
  /** owner id → 값 소유자 종류·마스터 id (추적용). */
  owners: ReadonlyMap<Id, { kind: ReadRecord["owner"]["kind"]; masterId: Id }>;
  /** 마스터 노드 id → 스냅샷 노드 id — 문면의 @노드 한정자를 이 트리로 옮긴다. */
  snapshotOf: ReadonlyMap<Id, Id>;
  trace?: ContextTrace;
  /** 평가 중인 파생 코드 — 순환 가드. */
  evaluating: ReadonlySet<Code>;
}

const EMPTY_SLOTS: ReadonlyMap<SlotPath, ValueSlot> = new Map();

function record(env: Env, ownerId: Id, path: SlotPath, slot: ValueSlot | "missing"): void {
  const owner = env.owners.get(ownerId);
  if (!env.trace || !owner) return;
  const r = env.trace.reads;
  if (r.some((x) => x.owner.id === ownerId && x.path === path)) return;
  r.push({ owner: { kind: owner.kind, id: ownerId }, masterId: owner.masterId, path, slot });
}

/** 실체의 값 자리를 읽는다 — 읽은 자리를 추적에 남긴다. 마스터 자리는 늘 있다 (부착 없음). */
function readSlot(env: Env, ownerId: Id, path: SlotPath): LookupResult {
  const slot = (env.values.get(ownerId) ?? EMPTY_SLOTS).get(path) ?? NOT_ENTERED;
  record(env, ownerId, path, slot);
  return { kind: "slot", slot };
}

/** 자기 레벨이면 자기, 위 레벨이면 그 조상. 아래 레벨·트리 없음이면 undefined. */
function ancestorOrSelf(env: Env, node: CoverageNode | undefined, level: CoverageNodeLevel): CoverageNode | undefined {
  if (!env.tree || !node) return undefined;
  if (node.level === level) return node;
  const ref = node.ancestors.find((a) => a.level === level);
  return ref ? findNode(env.tree, ref) : undefined;
}

/**
 * 세목 커서 — 지금 평가 중인 세목 선택지. 집계(`children`)가 선택지마다 하나씩 세운다.
 * 트리 노드(`node`)와 독립이다 — 세목은 담보 트리의 레벨이 아니라 상품의 축이다.
 */
type PlanCursor = AssemblyPlanOption | undefined;

function lookupBuiltin(env: Env, node: CoverageNode | undefined, plan: PlanCursor, ref: ValueRef & { kind: "builtin" }): LookupResult {
  // 세목 선택지는 번호도 뼈대다 — 종형명 표기 「2종(보험료 납입면제형)」 = `builtin.plan.number` + 「종(」 + `builtin.plan.name` + 「)」 (기능/상품 §3.2)
  if (ref.level === "plan" && ref.prop === "number") return plan ? slotOf(String(plan.number)) : MISSING;
  if (ref.prop !== "name") return BROKEN;
  if (ref.level === "product") return slotOf(env.product.name);
  if (ref.level === "plan") return plan ? slotOf(plan.name) : MISSING;
  if (!env.tree) return UNDETERMINED; // 기본계약 없음
  const target = ancestorOrSelf(env, node, ref.level);
  return target ? slotOf(target.name) : MISSING;
}

/** 구분자 — 그 레벨 문맥에서 식을 평가한다. 값 행이 없다. */
function lookupDiscriminator(env: Env, node: CoverageNode | undefined, plan: PlanCursor, ref: ValueRef & { kind: "discriminator" }, coordinate: Coordinate): LookupResult {
  const def = env.catalog.get(ref.code);
  if (!def) return BROKEN; // 없는 구분자 — 고칠 자리는 문면의 참조다 (편집기로 갈 구분자가 없다)
  if (env.evaluating.has(def.code)) return brokenDefinition(def); // 순환 — 정의 저장이 거부하지만(기능/구분자 §3.2) 평가도 스스로 멈춘다
  const parsed = parse(def.expression);
  if (!parsed.ok) return brokenDefinition(def);
  const next: Env = { ...env, evaluating: new Set([...env.evaluating, def.code]) };
  let target: CoverageNode | undefined;
  if (def.level === "product") target = undefined;
  else if (def.level === "plan") {
    if (!plan) return MISSING; // 커서 없이 세목 구분자를 직접 읽는 식은 정의 시점에 거부된다
    target = node;
  } else {
    if (!env.tree) return UNDETERMINED;
    if (ref.node) {
      const sid = env.snapshotOf.get(ref.node.id);
      const found = sid ? findNodeById(env.tree, sid) : undefined;
      if (!found || found.level !== def.level) return BROKEN;
      target = found;
    } else {
      target = ancestorOrSelf(env, node, def.level);
      if (!target) return MISSING;
    }
  }
  const result = evaluate(parsed.value, contextFor(next, def.level === "product" ? node : target, coordinate, plan));
  switch (result.kind) {
    case "value":
      return slotOf(result.value);
    case "undetermined":
      return UNDETERMINED;
    case "error":
      return { kind: "slot", slot: NOT_ENTERED }; // 구분자 자리를 미입력으로 보고 (B1 규약)
  }
}

/**
 * 마스터 필드 — 그 레벨 실체의 값 자리. 상품 레벨은 상품 값, 세목 레벨은 커서 선택지의 값(유형이 그 폼일 때만),
 * 담보 트리는 스냅샷 노드 값.
 */
function lookupMaster(env: Env, node: CoverageNode | undefined, plan: PlanCursor, ref: ValueRef & { kind: "master" }): LookupResult {
  const field = findMasterField(refPath(ref), env.master);
  if (!field) return BROKEN;
  const product = { document: "product" as const, ownerId: env.product.id, ownerName: env.product.name, refPath: field.path };
  if (field.level === "product") return checkEnum(env, field, readSlot(env, env.product.id, field.path), product);
  if (field.level === "plan") {
    // 선택지는 유형(폼) 하나 — 다른 폼의 필드는 그 선택지에 자리가 없다. 커서 없음도 자리 없음.
    return plan && plan.planTypeCode === field.form.key ? checkEnum(env, field, readSlot(env, plan.id, field.path), { ...product, subjectName: plan.name }) : MISSING;
  }
  if (!env.tree) return UNDETERMINED; // 기본계약 없음
  const target = ancestorOrSelf(env, node, field.level);
  if (!target) return MISSING;
  const slots = env.values.get(target.id) ?? EMPTY_SLOTS;
  // 여는 폼: 값 행이 하나도 없으면 자리 없음 — exist 는 false, 직접 읽기는 notAttached (ADR-0065 §4)
  if (field.form.optional && !isFormOpened(field.form, (p) => slots.get(p))) return MISSING;
  const root = nodesOf(env.tree)[0];
  return checkEnum(env, field, readSlot(env, target.id, field.path), { ...product, nodePath: root ? [root.id] : [], subjectName: nodeName(env.tree, target) });
}

/**
 * 열거값 자리의 「없는 값」 — 지운 열거값 코드가 저장 값에 남았으면 읽는 곳마다 오류다 (ADR-0078 결정 5 · ADR-0049 〔D-P1-18〕).
 * 조용히 빼고 읽으면 조건이 말없이 거짓이 된다. `source` = 그 값을 고치는 값 자리. 없는 열거형변수 자체는 여기서 보지 않는다 (치환 · 정의 검사 몫).
 */
function checkEnum(env: Env, field: MasterFieldRef, r: LookupResult, source: Coordinate): LookupResult {
  const type = field.field.type;
  if (r.kind !== "slot" || !r.slot.entered || (type.kind !== "enum" && type.kind !== "list<enum>")) return r;
  const def = env.enums.get(type.enumCode);
  if (!def) return r;
  const value = r.slot.value;
  const codes = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" ? [value] : [];
  const missing = missingEnumCodes(def, codes);
  return missing.length === 0 ? r : { kind: "invalid", issue: "brokenRef", message: missingValueMessage(def, missing), source };
}

/** 참조가 사는 레벨. 없는 정의·없는 자리는 null. */
function levelOfRef(env: Env, ref: ValueRef): AttachLevel | null {
  switch (ref.kind) {
    case "builtin":
      return ref.level;
    case "master":
      return findMasterField(refPath(ref), env.master)?.level ?? null;
    case "discriminator":
      return env.catalog.get(ref.code)?.level ?? null;
  }
}

/**
 * 참조가 읽는 세목 폼키 — 집계 범위의 폼 필터. 마스터 참조면 그 폼, 구분자 참조면 `planFormOf`(구분자 참조를 타고 들어간 폼 하나),
 * 내장 경로(`builtin.plan.name`)와 폼을 못 정하는 구분자(정의 검사가 거부하는 꼴)는 undefined = 선택지 전부.
 */
function planFormKey(env: Env, ref: ValueRef): PlanFormScope {
  switch (ref.kind) {
    case "builtin":
      return { kind: "all" };
    case "master": {
      const form = findMasterField(refPath(ref), env.master)?.form.key;
      return form === undefined ? { kind: "invalid", forms: [] } : { kind: "form", form };
    }
    case "discriminator": {
      const def = env.catalog.get(ref.code);
      return def ? planFormScope(def, env.catalog, env.master) : { kind: "invalid", forms: [] };
    }
  }
}

/**
 * 세목 레벨 집계 범위 — 그 폼의 선택지마다 커서를 세운 문맥.
 * 범위를 정할 수 없는 참조(복수 폼 · 순환 · 깨진 식)는 undefined → 미결 → brokenRef 오류.
 * 「선택지 전부」로 조용히 평가하면 안 된다 (코덱스 리뷰 2026-09-14 Important-1).
 */
function planChildren(env: Env, node: CoverageNode | undefined, coordinate: Coordinate, ref: ValueRef): EvalContext[] | undefined {
  const scope = planFormKey(env, ref);
  if (scope.kind === "invalid") return undefined;
  const options = scope.kind === "all" ? env.planOptions : env.planOptions.filter((o) => o.planTypeCode === scope.form);
  return options.map((o) => contextFor(env, node, coordinate, o));
}

function contextFor(env: Env, node: CoverageNode | undefined, coordinate: Coordinate, plan?: AssemblyPlanOption): EvalContext {
  return {
    coordinate,
    lookup: (ref) => {
      switch (ref.kind) {
        case "builtin":
          return lookupBuiltin(env, node, plan, ref);
        case "master":
          return lookupMaster(env, node, plan, ref);
        case "discriminator":
          return lookupDiscriminator(env, node, plan, ref, coordinate);
      }
    },
    attribute: (code) => {
      const value = env.attributes.get(code);
      return value === undefined ? { kind: "unused" } : { kind: "value", value };
    },
    children: (ref) => {
      const level = levelOfRef(env, ref);
      if (level === null || level === "product") return [contextFor(env, node, coordinate, plan)];
      if (level === "plan") return plan ? [contextFor(env, node, coordinate, plan)] : planChildren(env, node, coordinate, ref);
      if (!env.tree) return undefined; // 기본계약 없음
      if (!node) return undefined;
      if (DEPTH[level] < DEPTH[node.level]) {
        const up = ancestorOrSelf(env, node, level);
        return up ? [contextFor(env, up, coordinate, plan)] : undefined;
      }
      return descendants(env.tree, node, level).map((n) => contextFor(env, n, coordinate, plan));
    },
  };
}

/**
 * 미결의 원인 — 참조 레벨로 가른다. 구분자의 세목 범위를 정할 수 없어서면(`planFormScope` invalid — 세목 폼 둘 · 순환 · 깨진 식)
 * 원천은 구분자 편집기, 그 구분자다 (ADR-0049 §4).
 */
function explain(env: Env, reason: string, at: Coordinate): Issue {
  const here = { ...at, refPath: reason };
  const level = levelOfPath(env, reason);
  if (!env.tree && level !== undefined && isTreeLevel(level)) {
    return { kind: "noBaseContract", message: `기본계약이 지정되지 않아 담보 레벨 참조 ${reason} 을(를) 해소할 수 없습니다`, at: here };
  }
  const def = env.catalog.get(reason);
  const source = def && planFormScope(def, env.catalog, env.master).kind === "invalid" ? { source: catalogSource(def) } : {};
  return { kind: "brokenRef", message: `참조 ${reason} 을(를) 해소할 수 없습니다`, at: here, ...source };
}

/** 경로 문자열(refPath)의 레벨. `builtin.<레벨>.…` · `attr.…`(없음) · 마스터 경로(`폼.필드`) · 구분자 코드. */
function levelOfPath(env: Env, path: string): AttachLevel | undefined {
  if (path.startsWith("builtin.")) return path.split(".")[1] as AttachLevel;
  if (path.startsWith("attr.")) return undefined;
  if (isMasterPathShape(path)) return findMasterField(path, env.master)?.level;
  return env.catalog.get(path)?.level;
}

// ───────────────────────────── 스냅샷 → 트리 ─────────────────────────────

/** 스냅샷 노드 트리를 B1 담보 트리 모양으로 — id 는 스냅샷 쪽(상품담보 id · 노드 id). */
export function snapshotTree(c: AssemblyCoverage): Coverage {
  const s = c.snapshot;
  return {
    id: s.id,
    name: s.coverageName,
    description: "",
    subCoverages: [...s.subCoverages]
      .sort((a, b) => a.order - b.order)
      .map((sub) => ({
        id: sub.id,
        name: sub.name,
        order: sub.order,
        benefits: [...sub.benefits].sort((a, b) => a.order - b.order).map((b) => ({ id: b.id, name: b.name, order: b.order })),
      })),
  };
}

type Owners = Map<Id, { kind: ReadRecord["owner"]["kind"]; masterId: Id }>;

/** 상품 · 세목 선택지 — 모든 문맥이 갖는 소유자 (선택지의 마스터 id 는 자기 id). */
function productOwners(product: AssemblyProduct): Owners {
  const out: Owners = new Map();
  out.set(product.id, { kind: "product", masterId: product.id });
  for (const o of product.planOptions) out.set(o.id, { kind: "plan", masterId: o.id });
  return out;
}

function ownersOf(c: AssemblyCoverage, product: AssemblyProduct): Owners {
  const out = productOwners(product);
  out.set(c.snapshot.id, { kind: "productCoverage", masterId: c.snapshot.coverageId });
  for (const sub of c.snapshot.subCoverages) {
    out.set(sub.id, { kind: "productSubCoverage", masterId: sub.masterNodeId });
    for (const b of sub.benefits) out.set(b.id, { kind: "productBenefit", masterId: b.masterNodeId });
  }
  return out;
}

/** 마스터 노드 id → 스냅샷 노드 id (담보 자신 포함). */
function snapshotIndex(c: AssemblyCoverage): Map<Id, Id> {
  const out = new Map<Id, Id>([[c.snapshot.coverageId, c.snapshot.id]]);
  for (const sub of c.snapshot.subCoverages) {
    out.set(sub.masterNodeId, sub.id);
    for (const b of sub.benefits) out.set(b.masterNodeId, b.id);
  }
  return out;
}

// ───────────────────────────── 진입점 ─────────────────────────────

export function specialCoordinate(c: AssemblyCoverage): Coordinate {
  return { document: "special", ownerId: c.snapshot.id, ownerName: c.snapshot.name };
}

/** 상품이 고른 보통약관 문면 — `generalDocumentId` 로 마스터 문서 맵에서. 없으면 undefined (오류 + 특약만 조립). */
export function generalDocumentOf(input: Pick<AssemblyInput, "product" | "generalDocuments">): DocumentNode | undefined {
  const id = input.product.generalDocumentId;
  return id === undefined ? undefined : input.generalDocuments.get(id);
}

export function generalCoordinate(product: AssemblyProduct, general: DocumentNode | undefined): Coordinate {
  return { document: "general", ownerId: product.generalDocumentId ?? general?.id ?? product.id, ownerName: general?.title ?? product.name };
}

function envOf(input: AssemblyInput, catalog: ReadonlyMap<Code, Discriminator>, c: AssemblyCoverage | undefined, trace: ContextTrace | undefined): Env {
  const product = input.product;
  const values = new Map<Id, ReadonlyMap<SlotPath, ValueSlot>>(c ? c.values : []);
  values.set(product.id, product.values);
  for (const o of product.planOptions) values.set(o.id, o.values);
  return {
    product,
    catalog,
    enums: new Map(input.enums.map((e) => [e.code, e])),
    master: input.master,
    tree: c ? snapshotTree(c) : undefined,
    planOptions: product.planOptions,
    values,
    attributes: new Map(c ? c.snapshot.attributes.map((a) => [a.kindCode, a.valueCode]) : []),
    owners: c ? ownersOf(c, product) : productOwners(product),
    snapshotOf: c ? snapshotIndex(c) : new Map(),
    trace,
    evaluating: new Set(),
  };
}

/** 스냅샷 트리의 반복 표 행 원천 — 행 노드 id 는 스냅샷 노드 id. */
function rowSourceOf(env: Env, tree: Coverage, coordinate: Coordinate): RowSource<EvalContext> {
  const nodes = nodesOf(tree);
  return {
    root: coverageStructNode(tree),
    providers: coverageChildrenProviders(tree),
    rowContext: (ref) => {
      const node = nodes.find((n) => n.id === ref.id && n.level === ref.level);
      return node ? contextFor(env, node, coordinate) : undefined;
    },
  };
}

function contextOf(env: Env, coordinate: Coordinate, repeatable = false): AssemblyContext {
  const root = env.tree ? nodesOf(env.tree)[0] : undefined;
  return {
    eval: contextFor(env, root, coordinate),
    plans: {
      options: env.planOptions,
      context: (optionId) => {
        const option = env.planOptions.find((o) => o.id === optionId);
        return option ? contextFor(env, root, coordinate, option) : undefined;
      },
    },
    explainUndetermined: (reason, at) => explain(env, reason, at),
    trace: env.trace,
    ...(repeatable && env.tree ? { rows: rowSourceOf(env, env.tree, coordinate) } : {}),
  };
}

/** 상품담보 하나의 문맥 (좌표 = 그 특약). */
export function specialContext(input: AssemblyInput, c: AssemblyCoverage, trace?: ContextTrace): AssemblyContext {
  const catalog = new Map(input.catalog.map((d) => [d.code, d]));
  return contextOf(envOf(input, catalog, c, trace), specialCoordinate(c), true);
}

/** 임의 스냅샷 노드의 문맥 — 반복문 본문용(P7). 트리에 없으면 undefined. */
export function snapshotNodeContext(input: AssemblyInput, c: AssemblyCoverage, nodeId: Id): EvalContext | undefined {
  const catalog = new Map(input.catalog.map((d) => [d.code, d]));
  const env = envOf(input, catalog, c, undefined);
  const node = env.tree ? nodesOf(env.tree).find((n) => n.id === nodeId) : undefined;
  return node ? contextFor(env, node, { ...specialCoordinate(c), ownerName: nodeName(env.tree!, node) }) : undefined;
}

/** 전 상품담보 + 보통약관 문맥. 보통약관은 기본계약 상품담보의 환경을 좌표만 바꿔 쓴다 (읽은 값은 기본계약 추적에 실린다). */
export function buildContexts(input: AssemblyInput): AssemblyContexts {
  const catalog = new Map(input.catalog.map((d) => [d.code, d]));
  const specials = new Map<Id, AssemblyContext>();
  const traces: ContextTrace[] = [];
  const envs = new Map<Id, Env>();
  for (const c of input.coverages) {
    const trace: ContextTrace = { productCoverageId: c.snapshot.id, productCoverageName: c.snapshot.name, coverageId: c.snapshot.coverageId, reads: [] };
    traces.push(trace);
    const env = envOf(input, catalog, c, trace);
    envs.set(c.snapshot.id, env);
    specials.set(c.snapshot.id, contextOf(env, specialCoordinate(c), true));
  }
  // 2개 이상은 조립 계층에서 unsupported로 보고하되 부분 조립 문맥은 첫 등록분으로 계속 만든다.
  const base = input.product.baseContractIds.length > 0 ? envs.get(input.product.baseContractIds[0]) : undefined;
  const general = contextOf(base ?? envOf(input, catalog, undefined, undefined), generalCoordinate(input.product, generalDocumentOf(input)));
  return { general, specials, traces };
}
