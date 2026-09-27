/**
 * 담보 마스터 평가 문맥 — 담보 트리 + 마스터 값으로 식 언어의 `EvalContext` 를 만든다.
 *
 * 쓰는 곳: B3 문면 사전평가(담보약관 편집 화면의 톤다운·미결), C2 조립(상품 문맥이 이 위에 담보속성·상품 값을 얹는다),
 * 완결성 조회의 실행 기반 필터.
 *
 * 규칙 (기능/구분자 §3.2 · 기능/조립산출 §3.2 · ADR-0013 · ADR-0037 · 기능/담보 §3.1 이름):
 * - **마스터 필드 참조**(`coverage_basic.claim_name`)는 자기 레벨 또는 조상에서 읽는다 (급부 문맥이 담보 값을
 *   읽는 것은 자연스럽다). 아래 레벨 자리를 집계 없이 직접 읽으면 값 자리 없음.
 * - **구분자 참조**(`D0001`)는 그 구분자의 레벨 문맥에서 **식을 평가한 값**이다. 값 행이 없다.
 *   평가가 오류를 내면 그 자리를 「미입력」으로 보고한다 (LookupResult 에 오류 변형이 없다).
 * - 집계 범위 = 이 노드의 하위 트리 (`descendants`). 자기 레벨이면 [자기], 위 레벨이면 [그 조상].
 * - 내장 경로 `builtin.<레벨>.name` = 뼈대 이름.
 * - 담보속성(attr) · 상품/세목 레벨 참조는 마스터 문맥에서 **미결(undetermined)** — 조립 때 결정.
 */
import { isFormOpened, type Discriminator } from "../catalog";
import type { EvalContext, LookupResult, ValueRef } from "../expression";
import { evaluate, parse, refPath } from "../expression";
import { findMasterField, type MasterTree } from "../master";
import type { ChildrenProviders, RowSource, StructNode, StructNodeRef } from "../structure";
import { type AttachLevel, type Code, entered, NOT_ENTERED, type Value } from "../types";
import { descendants, findNode, findNodeById, nodeName, nodesOf } from "./tree";
import type { Coverage, CoverageNode, CoverageNodeLevel, CoverageNodeRef } from "./types";
import { slotsOfNode, type MasterValues } from "./values";

/** 카탈로그 조회 — 문맥이 구분자 정의를 찾는 창구. */
export interface MasterCatalog {
  find(code: Code): Discriminator | undefined;
}

export function masterCatalog(defs: readonly Discriminator[]): MasterCatalog {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  return { find: (code) => byCode.get(code) };
}

const DEPTH: Record<CoverageNodeLevel, number> = { coverage: 0, subCoverage: 1, benefit: 2 };

function isTreeLevel(level: AttachLevel): level is CoverageNodeLevel {
  return level in DEPTH;
}

const MISSING: LookupResult = { kind: "missing" };
const BROKEN: LookupResult = { kind: "missing", issue: "brokenRef" };
const UNDETERMINED: LookupResult = { kind: "undetermined" };

interface Env {
  tree: Coverage;
  values: MasterValues;
  catalog: MasterCatalog;
  /** 값 자리를 정하는 마스터 트리. 기본은 MVP 정본. */
  master?: MasterTree;
  /** 평가 중인 구분자 코드 — 순환 가드 */
  evaluating: Set<Code>;
}

/** 자기 레벨이면 자기, 위 레벨이면 그 조상. 아래 레벨이면 undefined. */
function ancestorOrSelf(env: Env, node: CoverageNode, level: CoverageNodeLevel): CoverageNode | undefined {
  if (node.level === level) return node;
  const ref = node.ancestors.find((a) => a.level === level);
  return ref ? findNode(env.tree, ref) : undefined;
}

function slotOf(value: Value): LookupResult {
  return { kind: "slot", slot: entered(value) };
}

function lookupBuiltin(env: Env, node: CoverageNode, ref: ValueRef & { kind: "builtin" }): LookupResult {
  if (!isTreeLevel(ref.level)) return UNDETERMINED;
  if (ref.prop !== "name") return BROKEN;
  const target = ancestorOrSelf(env, node, ref.level);
  return target ? slotOf(target.name) : MISSING;
}

/** 마스터 필드 자리 — 그 레벨 노드의 저장 값. 자리는 항상 있다 (부착 없음). */
function lookupMaster(env: Env, node: CoverageNode, ref: ValueRef & { kind: "master" }): LookupResult {
  const field = findMasterField(refPath(ref), env.master);
  if (!field) return BROKEN;
  if (!isTreeLevel(field.level)) return UNDETERMINED;
  const target = ancestorOrSelf(env, node, field.level);
  if (!target) return MISSING;
  const slots = slotsOfNode(env.values, target.id);
  // 여는 폼: 값 행이 하나도 없으면 자리 없음 — exist 는 false, 직접 읽기는 notAttached (ADR-0065 §4)
  if (field.form.optional && !isFormOpened(field.form, (p) => slots.get(p))) return MISSING;
  return { kind: "slot", slot: slots.get(field.path) ?? NOT_ENTERED };
}

/** 구분자 — 그 레벨 문맥에서 식을 평가한다. 값 행은 없다. */
function lookupDiscriminator(env: Env, node: CoverageNode, ref: ValueRef & { kind: "discriminator" }): LookupResult {
  const def = env.catalog.find(ref.code);
  if (!def) return BROKEN;
  if (!isTreeLevel(def.level)) return UNDETERMINED;
  let target: CoverageNode | undefined;
  if (ref.node) {
    // 한정자: 문맥 노드 대신 그 노드에서. 없거나 레벨이 다르면 끊어진 참조 (ADR-0066 §3)
    const found = findNodeById(env.tree, ref.node.id);
    if (!found || found.level !== def.level) return BROKEN;
    target = found;
  } else {
    target = ancestorOrSelf(env, node, def.level);
    if (!target) return MISSING;
  }
  if (env.evaluating.has(def.code)) return BROKEN; // 순환 — 구분자 → 구분자는 애초에 금지다
  const parsed = parse(def.expression);
  if (!parsed.ok) return BROKEN;
  const next: Env = { ...env, evaluating: new Set([...env.evaluating, def.code]) };
  const result = evaluate(parsed.value, contextFor(next, target));
  switch (result.kind) {
    case "value":
      return slotOf(result.value);
    case "undetermined":
      return UNDETERMINED;
    case "error":
      return { kind: "slot", slot: NOT_ENTERED };
  }
}

/** 참조가 사는 레벨. 없는 정의·없는 자리는 null. */
function levelOfRef(env: Env, ref: ValueRef): AttachLevel | null {
  switch (ref.kind) {
    case "builtin":
      return ref.level;
    case "master":
      return findMasterField(refPath(ref), env.master)?.level ?? null;
    case "discriminator":
      return env.catalog.find(ref.code)?.level ?? null;
  }
}

function contextFor(env: Env, node: CoverageNode): EvalContext {
  return {
    coordinate: { document: "coverageMaster", ownerId: env.tree.id, ownerName: nodeName(env.tree, node) ?? node.name, node: { level: node.level, id: node.id } },
    lookup: (ref) => {
      switch (ref.kind) {
        case "builtin":
          return lookupBuiltin(env, node, ref);
        case "master":
          return lookupMaster(env, node, ref);
        case "discriminator":
          return lookupDiscriminator(env, node, ref);
      }
    },
    attribute: () => ({ kind: "undetermined" }),
    children: (ref) => {
      const level = levelOfRef(env, ref);
      if (level === null) return [contextFor(env, node)]; // 없는 자리 — lookup 이 brokenRef 를 낸다
      if (!isTreeLevel(level)) return undefined;
      if (DEPTH[level] < DEPTH[node.level]) {
        const up = ancestorOrSelf(env, node, level);
        return up ? [contextFor(env, up)] : undefined;
      }
      return descendants(env.tree, node, level).map((n) => contextFor(env, n));
    },
  };
}

/** 담보 노드의 문맥 — 담보약관 사전평가의 기본 문맥. */
export function masterEvalContext(
  tree: Coverage,
  values: MasterValues,
  catalog: MasterCatalog,
  master?: MasterTree,
): EvalContext {
  const root = nodesOf(tree)[0];
  return contextFor({ tree, values, catalog, master, evaluating: new Set() }, root);
}

/** 임의 노드(세부보장·급부)의 문맥 — 반복문 본문·세부보장 단위 조건식용. 트리에 없으면 undefined. */
export function nodeEvalContext(
  tree: Coverage,
  node: CoverageNodeRef,
  values: MasterValues,
  catalog: MasterCatalog,
  master?: MasterTree,
): EvalContext | undefined {
  const found = findNode(tree, node);
  return found ? contextFor({ tree, values, catalog, master, evaluating: new Set() }, found) : undefined;
}

// ───────────────────────────── 자식 제공자 · 행 원천 (ADR-0070 결정 2 · 6) ─────────────────────────────

/** 담보 트리의 뿌리 구조 노드. */
export function coverageStructNode(tree: Coverage): StructNode {
  return { level: "coverage", id: tree.id, name: tree.name, order: 0 };
}

/**
 * 담보 트리의 자식 제공자 — coverage → 세부보장 · subCoverage → 급부 (order 오름차순).
 * 담보 마스터 트리에도, 조립의 스냅샷 트리(`snapshotTree` — 같은 모양 · 스냅샷 id)에도 쓴다.
 * plan · product 제공자는 없다 (탑재 제공자는 이후 — 상품 문맥 반복).
 */
export function coverageChildrenProviders(tree: Coverage): ChildrenProviders {
  const byOrder = <T extends { order: number }>(xs: readonly T[]) => [...xs].sort((a, b) => a.order - b.order);
  return {
    coverage: {
      children: (node: StructNodeRef) =>
        node.id === tree.id ? byOrder(tree.subCoverages).map((s) => ({ level: "subCoverage" as const, id: s.id, name: s.name, order: s.order })) : [],
    },
    subCoverage: {
      children: (node: StructNodeRef) => {
        const sub = tree.subCoverages.find((s) => s.id === node.id);
        return sub ? byOrder(sub.benefits).map((b) => ({ level: "benefit" as const, id: b.id, name: b.name, order: b.order })) : [];
      },
    },
  };
}

/** 담보 마스터 행 원천 — 담보약관 편집 미리보기의 반복 표 펼침용. 행 문맥 = `nodeEvalContext`. */
export function coverageRowSource(
  tree: Coverage,
  values: MasterValues,
  catalog: MasterCatalog,
  master?: MasterTree,
): RowSource<EvalContext> {
  return {
    root: coverageStructNode(tree),
    providers: coverageChildrenProviders(tree),
    rowContext: (node) => (isTreeLevel(node.level) ? nodeEvalContext(tree, { level: node.level, id: node.id }, values, catalog, master) : undefined),
  };
}
