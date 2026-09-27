/**
 * 담보 서비스 — 담보 마스터 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출. 모든 쓰기는 한 트랜잭션.
 *
 * - 비파괴(담보 생성 · 이름/설명/문서 연결 · 세부보장/급부 추가 · 이름 · 순서 · 값 쓰기/지우기)는 editor 도 가능.
 *   노드 추가는 이벤트 없이 단순 추가 — 기존 상품담보의 빈 값 대응은 상품(B4)이 스냅샷 실체를 트리와 맞출 때 한다.
 * - 파괴적(노드 삭제 `coverage.deleteNode`)은 `destructive()` 2단:
 *   editor → forbidden · admin 1차 → needsConfirmation(Impact) · `{ confirm: true }` → 실행 + 값 행 연쇄 삭제.
 *   최소 구조 위반은 precheck 에서 admin 도 거부.
 * - 구조 계획(`applyStructurePlan`, ADR-0052)은 초안 하나를 ① 이름 → ② 추가 → ③ 삭제 → ④ 순서 로 **한 트랜잭션에서 한 번 저장**.
 *   삭제가 섞이면 같은 2단(편집자 forbidden · 관리자 needsConfirmation) — 영향에 탑재 상품담보 · 스냅샷 소실 행(`Impact.mounts`)이
 *   실린다. 저장 뒤 탑재 상품담보 스냅샷을 같은 트랜잭션에서 맞춘다 (`MountSync`, 조립 루트가 product 를 잇는다).
 * - 사용처(문면 조건식·슬롯 · 요구 공용조항 · 파생식)는 `UsageSource` 로 주입 (C1 refs). 기본 NO_USAGE.
 * - 값 자리는 마스터가 정한다 (ADR-0037) — 부착이 없어 `attach`/`detach`/`attachable` 이 사라졌다.
 * - 완결성의 실행 기반 필터는 `CompletenessFilter` 로 주입 (C2). 기본은 마스터 전체.
 */
import { assertCan, destructive, type DestructiveAction } from "@/domain/auth";
import type { EnumLookup, SlotPath } from "@/domain/catalog";
import {
  addBenefit,
  addSubCoverage,
  applyStructurePlanTo,
  checkValueWrite,
  completeness,
  createCoverageTree,
  descendants,
  dryRunStructurePlan,
  findBenefit,
  findNode,
  formPrefill,
  hasRemoves,
  isEmptyPlan,
  nodesOf,
  NO_USAGE,
  nodeDeleteImpact,
  removeBenefit,
  removeSubCoverage,
  renameBenefit,
  renameCoverage,
  renameSubCoverage,
  reorderBenefits,
  reorderSubCoverages,
  setCoverageDescription,
  setCoverageDocument,
  slotsOfNode,
  structurePlan,
  type CompletenessFilter,
  type Coverage,
  type CoverageNode,
  type CoverageNodeRef,
  type MasterValues,
  type MissingSlot,
  type NewCoverage,
  type NewId,
  type NewSubCoverage,
  type StructureDraftSub,
  type StructurePlan,
  type UsageSource,
} from "@/domain/coverage";
import { countedSlotsOf } from "@/domain/catalog";
import { fieldsOfLevel, masterFieldLabel, type MasterFieldRef } from "@/domain/master";
import type { Actor, Id, Impact, MountImpact, Result, Value, ValueSlot } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as repo from "@/db/repo/coverage";
import * as productRepo from "@/db/repo/product";
import type { Db } from "@/db/repo/types";
import * as values from "@/db/repo/values";

/** 탑재 상품담보 스냅샷 동기화 — product 서비스의 `syncStructureIn` 을 조립 루트가 잇는다 (순환 의존은 지연 참조로). */
export interface MountSync {
  syncStructure(tx: Db, productCoverageId: Id, who: Id): Promise<Result<unknown>>;
}

export interface CoverageServiceDeps {
  /** 사용처 역인덱스 (C1). 기본 NO_USAGE — 사용처 없음. */
  usage?: UsageSource;
  /** 완결성 실행 기반 필터 (C2). 기본 항등. */
  completenessFilter?: CompletenessFilter;
  /** id 발급. 기본 crypto.randomUUID. */
  newId?: NewId;
  /** 구조 정정 뒤 탑재 스냅샷 동기화 (ADR-0052 결정 2). 없으면 동기화하지 않는다 — 조회 · 조립 전 `product.syncStructure` 가 잡는다. */
  mountSync?: MountSync;
}

/** 파괴적 액션의 2단 프로토콜 옵션. */
export interface Confirmable {
  confirm?: boolean;
}

/** 노드 하나의 완결성 — 값 탭 왼쪽 목록의 「입력 n / m」(기능/담보 §5 — 걷어낼 대상 · 디자인원칙 §9.2). */
export interface NodeCompleteness {
  node: CoverageNodeRef;
  /** 그 층에서 쓰는 이름 (조상 경로 없이). */
  name: string;
  /** 그 레벨 마스터 값 자리 수 = m. */
  total: number;
  /** 입력된 값 자리 수 = n. */
  entered: number;
}

/** 완결성 요약 — 미입력 목록에 분모(부착된 값 자리 수)를 붙인 것. */
export interface CompletenessSummary {
  total: number;
  missing: MissingSlot[];
  /** 트리 순서대로. 노드별 분자·분모 — 전체 합이 total 이다. */
  byNode: NodeCompleteness[];
}

/** 값 입력 폼 — 그 레벨 마스터 필드 전부 · 명시 값 · 프리필(명시 값 ∪ 기본값). */
export interface FormView {
  level: CoverageNodeRef["level"];
  fields: { path: SlotPath; label: string; ref: MasterFieldRef }[];
  slots: Record<SlotPath, ValueSlot>;
  prefill: Record<SlotPath, Value>;
}

export interface CoverageService {
  // 조회
  get(id: Id): Promise<Coverage | undefined>;
  list(): Promise<Coverage[]>;
  /** L1 목록용 요약 — 트리를 전부 안 읽는다 (리뷰 #38/#48, WP2). */
  listSummaries(): Promise<repo.CoverageSummary[]>;
  audit(id: Id): ReturnType<typeof repo.coverageAudit>;
  /** 실체의 값 폼 — 그 레벨 마스터 필드 전부. */
  form(owner: CoverageNodeRef): Promise<Result<FormView>>;
  /** 담보 하위 트리의 값 전부 — masterEvalContext 의 입력. */
  masterValues(coverageId: Id): Promise<Result<{ tree: Coverage; values: MasterValues }>>;
  /** 완결성 조회 — 마스터 기반 미입력 목록 (필터 주입 시 실행 기반). */
  completeness(coverageId: Id): Promise<Result<MissingSlot[]>>;
  /** 완결성 + 분모 — 「값 자리 N 중 M 입력」(디자인원칙 §9.2·§9.6). 분모는 그 레벨 마스터 자리 수. */
  completenessSummary(coverageId: Id): Promise<Result<CompletenessSummary>>;

  // 담보 — 비파괴
  create(actor: Actor, input: NewCoverage): Promise<Result<Coverage>>;
  rename(actor: Actor, id: Id, name: string): Promise<Result<Coverage>>;
  setDescription(actor: Actor, id: Id, description: string): Promise<Result<Coverage>>;
  setDocument(actor: Actor, id: Id, documentId: Id | undefined): Promise<Result<Coverage>>;

  // 세부보장 · 급부 — 비파괴
  addSubCoverage(actor: Actor, coverageId: Id, input: NewSubCoverage): Promise<Result<Coverage>>;
  addBenefit(actor: Actor, subCoverageId: Id, name: string): Promise<Result<Coverage>>;
  renameSubCoverage(actor: Actor, subCoverageId: Id, name: string): Promise<Result<Coverage>>;
  renameBenefit(actor: Actor, benefitId: Id, name: string): Promise<Result<Coverage>>;
  reorderSubCoverages(actor: Actor, coverageId: Id, order: Id[]): Promise<Result<Coverage>>;
  reorderBenefits(actor: Actor, subCoverageId: Id, order: Id[]): Promise<Result<Coverage>>;

  // 구조 삭제 — 파괴적 (admin · 2단 · coverage.deleteNode)
  removeSubCoverage(actor: Actor, subCoverageId: Id, opts?: Confirmable): Promise<Result<Coverage>>;
  removeBenefit(actor: Actor, benefitId: Id, opts?: Confirmable): Promise<Result<Coverage>>;
  remove(actor: Actor, coverageId: Id, opts?: Confirmable): Promise<Result<void>>;
  /**
   * 노드 삭제의 영향만 — 여러 삭제를 한 번에 확인시키는 저장 화면용 (ADR-0052 결정 1). 역할 검사는 삭제와 같다
   * (편집자 → forbidden). 최소 구조 precheck 는 하지 않는다 — 추가가 삭제보다 먼저 실행되는 계획에서는 지금 트리의
   * 마지막 형제여도 지울 수 있기 때문이다. 아무것도 바꾸지 않는다.
   */
  nodeDeleteImpact(actor: Actor, node: CoverageNodeRef): Promise<Result<Impact>>;

  // 구조 계획 — 초안 하나를 한 트랜잭션에 (ADR-0052)
  /**
   * 초안 → 계획(① 이름 → ② 추가 → ③ 삭제 → ④ 순서) → 드라이런(첫 거부면 무변경) → 삭제가 섞이면 2단
   * (편집자 forbidden · 관리자 1차 needsConfirmation — 마스터 값 행 · 깨질 참조 · 연쇄 + `mounts`) → 결과 트리 한 번 저장 ·
   * 삭제 노드 값 행 정리 → 탑재 상품담보 스냅샷 동기화, 전부 한 트랜잭션. 삭제가 없으면 confirm 무관하게 바로 적용(비파괴 — 편집자 가능).
   * 반환은 새 트리.
   */
  applyStructurePlan(actor: Actor, coverageId: Id, draft: readonly StructureDraftSub[], opts?: Confirmable): Promise<Result<Coverage>>;
  /**
   * 같은 계획의 영향만 — 아무것도 바꾸지 않는다. 삭제가 없어도 `mounts`(탑재 상품담보 · 스냅샷 값 행 전체 · 소실 0)를 준다 —
   * 「구조 편집」 화면이 순서 변경의 영향 목록(ADR 결정 2)과 지금 탑재 상황을 보이는 데 쓴다. 역할 검사는 삭제와 같다(삭제가 섞이면 편집자 forbidden).
   */
  previewStructurePlan(actor: Actor, coverageId: Id, draft: readonly StructureDraftSub[]): Promise<Result<Impact>>;

  // 값 — 비파괴 (미입력 ↔ 명시 값 상태 전이)
  writeValue(actor: Actor, owner: CoverageNodeRef, path: SlotPath, value: Value): Promise<Result<void>>;
  clearValue(actor: Actor, owner: CoverageNodeRef, path: SlotPath): Promise<Result<void>>;
}

export function createCoverageService(db: Db, deps: CoverageServiceDeps = {}): CoverageService {
  const usage = deps.usage ?? NO_USAGE;
  const filter = deps.completenessFilter;
  const newId: NewId = deps.newId ?? (() => crypto.randomUUID());

  // ───────── 공통 헬퍼 ─────────

  function notFound<T>(what: string): Result<T> {
    return reject({ reason: "notFound", what });
  }

  /** 트리 노드 지시자 → 값 저장소 소유자 (레벨 이름 = 소유자 종류). */
  function ownerOf(ref: CoverageNodeRef): values.ValueOwner {
    return { kind: ref.level, id: ref.id };
  }

  async function loadTree(tx: Db, coverageId: Id): Promise<Result<Coverage>> {
    const tree = await repo.loadCoverage(tx, coverageId);
    return tree ? ok(tree) : notFound(`담보 ${coverageId}`);
  }

  /** 노드 지시자 → (트리, 노드). 없으면 notFound. */
  async function loadNode(tx: Db, ref: CoverageNodeRef): Promise<Result<{ tree: Coverage; node: CoverageNode }>> {
    const coverageId = await repo.coverageIdOfNode(tx, ref);
    if (!coverageId) return notFound(`${ref.level} ${ref.id}`);
    const tree = await loadTree(tx, coverageId);
    if (!tree.ok) return tree as Result<never>;
    const node = findNode(tree.value, ref);
    return node ? ok({ tree: tree.value, node }) : notFound(`${ref.level} ${ref.id}`);
  }

  /** 담보 하위 트리 전 노드의 값. */
  async function loadMasterValues(tx: Db, tree: Coverage): Promise<MasterValues> {
    const root: CoverageNodeRef = { level: "coverage", id: tree.id };
    const subs = descendants(tree, root, "subCoverage").map((n) => n.id);
    const bens = descendants(tree, root, "benefit").map((n) => n.id);
    const [cov, sub, ben] = await Promise.all([
      values.readSlotsMany(tx, "coverage", [tree.id]),
      values.readSlotsMany(tx, "subCoverage", subs),
      values.readSlotsMany(tx, "benefit", bens),
    ]);
    const slots = new Map<Id, ReadonlyMap<SlotPath, ValueSlot>>([...cov, ...sub, ...ben]);
    return { slots };
  }

  async function enumLookup(tx: Db): Promise<EnumLookup> {
    const enums = await catalogRepo.listEnums(tx);
    const byCode = new Map(enums.map((e) => [e.code, e]));
    return (c) => byCode.get(c);
  }

  /** 비파괴 트리 편집 — 읽기 → 도메인 → 저장, 한 트랜잭션. */
  function editTree(
    actor: Actor,
    ref: CoverageNodeRef,
    change: (tree: Coverage, tx: Db) => Promise<Result<Coverage>> | Result<Coverage>,
  ): Promise<Result<Coverage>> {
    return db.transaction(async (tx) => {
      const id = await repo.coverageIdOfNode(tx, ref);
      if (!id) return notFound(`${ref.level} ${ref.id}`);
      const loaded = await loadTree(tx, id);
      if (!loaded.ok) return loaded;
      const r = await change(loaded.value, tx);
      if (!r.ok) return r;
      await repo.saveCoverage(tx, r.value, actor.userId);
      return r;
    });
  }

  /** 담보 id 로 트리 편집. */
  function editCoverage(
    actor: Actor,
    coverageId: Id,
    change: (tree: Coverage, tx: Db) => Promise<Result<Coverage>> | Result<Coverage>,
  ): Promise<Result<Coverage>> {
    return editTree(actor, { level: "coverage", id: coverageId }, change);
  }

  /**
   * 노드 삭제(파괴적) — 트리 쪽 결과는 도메인이, 영향은 nodeDeleteImpact 가, 실행은 값 행 clearOwner + 저장.
   * 담보 자체 삭제는 `next` 가 없고 deleteCoverage 로 간다.
   */
  function deleteNode<T>(
    actor: Actor,
    ref: CoverageNodeRef,
    opts: Confirmable,
    change: (tree: Coverage) => Result<Coverage | undefined>,
    done: (next: Coverage | undefined) => T,
  ): Promise<Result<T>> {
    return db.transaction(async (tx) => {
      let tree: Coverage | undefined;
      let next: Coverage | undefined;
      return destructive<T>({
        actor,
        action: "coverage.deleteNode" satisfies DestructiveAction,
        confirm: opts.confirm,
        precheck: async () => {
          const loaded = await loadNode(tx, ref);
          if (!loaded.ok) return loaded as Result<void>;
          tree = loaded.value.tree;
          const changed = change(tree);
          if (!changed.ok) return changed as Result<void>;
          next = changed.value;
          return ok(undefined);
        },
        computeImpact: async (): Promise<Impact> => nodeDeleteImpact(tree!, ref, await loadMasterValues(tx, tree!), usage),
        execute: async () => {
          if (!tree) throw new Error("precheck 없이 execute 호출");
          const gone = ["coverage", "subCoverage", "benefit"] as const;
          for (const level of gone) {
            for (const n of descendants(tree, ref, level)) await values.clearOwner(tx, { kind: level, id: n.id });
          }
          if (next) await repo.saveCoverage(tx, next, actor.userId);
          else await repo.deleteCoverage(tx, tree.id);
          return ok(done(next));
        },
      });
    });
  }

  /** 계획이 지우는 마스터 노드 전부 — 삭제 대상과 그 하위 (스냅샷 소실 행 · 값 행 정리의 기준). */
  function removedNodes(tree: Coverage, plan: StructurePlan): CoverageNode[] {
    const out: CoverageNode[] = [];
    for (const target of plan.removes) {
      const ref: CoverageNodeRef = { level: target.level, id: target.id };
      for (const level of ["subCoverage", "benefit"] as const) out.push(...descendants(tree, ref, level));
    }
    return out;
  }

  /** 탑재 상품담보별 영향 — 스냅샷 값 행 전체와, 지워질 마스터 노드에 대응하는 스냅샷 노드의 값 행(소실). */
  async function mountImpacts(tx: Db, tree: Coverage, plan: StructurePlan): Promise<MountImpact[]> {
    const removed = new Set(removedNodes(tree, plan).map((n) => n.id));
    const out: MountImpact[] = [];
    for (const pc of await productRepo.listProductCoveragesOfCoverage(tx, tree.id)) {
      const nodes = await productRepo.listNodes(tx, pc.id);
      const [own, subs, bens] = await Promise.all([
        values.readSlotsMany(tx, "productCoverage", [pc.id]),
        values.readSlotsMany(tx, "productSubCoverage", nodes.filter((n) => n.kind === "sub").map((n) => n.id)),
        values.readSlotsMany(tx, "productBenefit", nodes.filter((n) => n.kind === "benefit").map((n) => n.id)),
      ]);
      let total = own.get(pc.id)?.size ?? 0;
      let lost = 0;
      for (const n of nodes) {
        const rows = (n.kind === "sub" ? subs : bens).get(n.id)?.size ?? 0;
        total += rows;
        if (removed.has(n.masterNodeId)) lost += rows;
      }
      out.push({ productId: pc.productId, productName: pc.productName, productCoverageId: pc.id, productCoverageName: pc.name, snapshotValueRows: total, snapshotValueRowsLost: lost });
    }
    return out;
  }

  /** 계획 전체의 영향 — 삭제 대상마다 nodeDeleteImpact 를 합치고 탑재 상품담보를 붙인다. */
  async function structureImpact(tx: Db, tree: Coverage, plan: StructurePlan): Promise<Impact> {
    const impact: Impact = { valueRowsLost: 0, brokenRefs: [], cascade: [], mounts: await mountImpacts(tx, tree, plan) };
    if (!hasRemoves(plan)) return impact;
    const masterValues = await loadMasterValues(tx, tree);
    for (const target of plan.removes) {
      const one = await nodeDeleteImpact(tree, { level: target.level, id: target.id }, masterValues, usage);
      impact.valueRowsLost += one.valueRowsLost;
      impact.brokenRefs.push(...one.brokenRefs);
      impact.cascade.push(...one.cascade);
    }
    return impact;
  }

  /** 초안 → 계획 → 드라이런 → (삭제가 섞이면) 역할. 적용과 미리보기가 같은 관문을 지난다. 아무것도 바꾸지 않는다. */
  async function planFor(tx: Db, actor: Actor, coverageId: Id, draft: readonly StructureDraftSub[]): Promise<Result<{ tree: Coverage; plan: StructurePlan }>> {
    const loaded = await loadTree(tx, coverageId);
    if (!loaded.ok) return loaded as Result<never>;
    const plan = structurePlan(loaded.value, draft);
    const dry = dryRunStructurePlan(loaded.value, plan);
    if (!dry.ok) return dry as Result<never>;
    if (hasRemoves(plan)) {
      const allowed = assertCan(actor, "coverage.deleteNode" satisfies DestructiveAction);
      if (!allowed.ok) return allowed as Result<never>;
    }
    return ok({ tree: loaded.value, plan });
  }

  // ───────── 서비스 ─────────

  return {
    get: (id) => repo.loadCoverage(db, id),
    list: () => repo.listCoverages(db),
    listSummaries: () => repo.listCoverageSummaries(db),
    audit: (id) => repo.coverageAudit(db, id),

    form: async (owner) => {
      const loaded = await loadNode(db, owner);
      if (!loaded.ok) return loaded as Result<never>;
      const slots = await values.readSlots(db, ownerOf(owner));
      const fields = fieldsOfLevel(owner.level).map((ref) => ({ path: ref.path, label: masterFieldLabel(ref), ref }));
      return ok({
        level: owner.level,
        fields,
        slots: Object.fromEntries(fields.flatMap((f) => (slots.has(f.path) ? [[f.path, slots.get(f.path)!]] : []))),
        prefill: formPrefill(owner.level, slots),
      });
    },

    masterValues: async (coverageId) => {
      const tree = await loadTree(db, coverageId);
      if (!tree.ok) return tree as Result<never>;
      return ok({ tree: tree.value, values: await loadMasterValues(db, tree.value) });
    },

    completeness: async (coverageId) => {
      const tree = await loadTree(db, coverageId);
      if (!tree.ok) return tree as Result<never>;
      return ok(completeness(tree.value, await loadMasterValues(db, tree.value), filter));
    },

    completenessSummary: async (coverageId) => {
      const tree = await loadTree(db, coverageId);
      if (!tree.ok) return tree as Result<never>;
      const masterValues = await loadMasterValues(db, tree.value);
      const missing = completeness(tree.value, masterValues, filter);
      const missingByNode = new Map<Id, number>();
      for (const slot of missing) missingByNode.set(slot.owner.id, (missingByNode.get(slot.owner.id) ?? 0) + 1);
      let total = 0;
      const byNode: NodeCompleteness[] = [];
      for (const node of nodesOf(tree.value)) {
        const slots = slotsOfNode(masterValues, node.id);
        // 안 연 여는 폼(감액·면책)의 자리는 분모에 안 든다 — 열어야 「자리」가 생긴다 (ADR-0065 §4)
        const nodeTotal = countedSlotsOf(node.level, (p) => slots.get(p)).length;
        total += nodeTotal;
        byNode.push({
          node: { level: node.level, id: node.id },
          name: node.name,
          total: nodeTotal,
          entered: nodeTotal - (missingByNode.get(node.id) ?? 0),
        });
      }
      return ok({ total, missing, byNode });
    },

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = createCoverageTree(input, newId, await repo.listCoverageNames(tx));
        if (!r.ok) return r;
        await repo.insertCoverage(tx, r.value, actor.userId);
        return r;
      }),
    rename: (actor, id, name) => editCoverage(actor, id, async (tree, tx) => renameCoverage(tree, name, await repo.listCoverageNames(tx))),
    setDescription: (actor, id, description) => editCoverage(actor, id, (tree) => setCoverageDescription(tree, description)),
    setDocument: (actor, id, documentId) => editCoverage(actor, id, (tree) => setCoverageDocument(tree, documentId)),

    addSubCoverage: (actor, coverageId, input) => editCoverage(actor, coverageId, (tree) => addSubCoverage(tree, input, newId)),
    addBenefit: (actor, subCoverageId, name) =>
      editTree(actor, { level: "subCoverage", id: subCoverageId }, (tree) => addBenefit(tree, subCoverageId, name, newId)),
    renameSubCoverage: (actor, subCoverageId, name) =>
      editTree(actor, { level: "subCoverage", id: subCoverageId }, (tree) => renameSubCoverage(tree, subCoverageId, name)),
    renameBenefit: (actor, benefitId, name) =>
      editTree(actor, { level: "benefit", id: benefitId }, (tree) => {
        const hit = findBenefit(tree, benefitId);
        return hit ? renameBenefit(tree, hit.subCoverage.id, benefitId, name) : notFound(`급부 ${benefitId}`);
      }),
    reorderSubCoverages: (actor, coverageId, order) => editCoverage(actor, coverageId, (tree) => reorderSubCoverages(tree, order)),
    reorderBenefits: (actor, subCoverageId, order) =>
      editTree(actor, { level: "subCoverage", id: subCoverageId }, (tree) => reorderBenefits(tree, subCoverageId, order)),

    removeSubCoverage: (actor, subCoverageId, opts = {}) =>
      deleteNode(actor, { level: "subCoverage", id: subCoverageId }, opts, (tree) => removeSubCoverage(tree, subCoverageId), (next) => next!),
    removeBenefit: (actor, benefitId, opts = {}) =>
      deleteNode(
        actor,
        { level: "benefit", id: benefitId },
        opts,
        (tree) => {
          const hit = findBenefit(tree, benefitId);
          return hit ? removeBenefit(tree, hit.subCoverage.id, benefitId) : notFound(`급부 ${benefitId}`);
        },
        (next) => next!,
      ),
    remove: (actor, coverageId, opts = {}) =>
      deleteNode(actor, { level: "coverage", id: coverageId }, opts, () => ok(undefined), () => undefined),
    nodeDeleteImpact: async (actor, node) => {
      const allowed = assertCan(actor, "coverage.deleteNode" satisfies DestructiveAction);
      if (!allowed.ok) return allowed as Result<never>;
      const loaded = await loadNode(db, node);
      if (!loaded.ok) return loaded as Result<never>;
      return ok(await nodeDeleteImpact(loaded.value.tree, node, await loadMasterValues(db, loaded.value.tree), usage));
    },

    applyStructurePlan: (actor, coverageId, draft, opts = {}) =>
      db.transaction(async (tx) => {
        const planned = await planFor(tx, actor, coverageId, draft);
        if (!planned.ok) return planned as Result<never>;
        const { tree, plan } = planned.value;
        if (isEmptyPlan(plan)) return ok(tree); // 아무 변화 없음 — 저장도 동기화도 하지 않는다
        // 삭제는 파괴적 — 영향 확인 전엔 아무것도 쓰지 않는다 (ADR-0019). 삭제가 없으면 비파괴라 바로 적용.
        if (hasRemoves(plan) && !opts.confirm) return reject({ reason: "needsConfirmation", impact: await structureImpact(tx, tree, plan) });
        const next = applyStructurePlanTo(tree, plan, newId);
        if (!next.ok) return next; // 드라이런과 같은 규칙이라 여기서 거부될 일은 없다 — 방어
        for (const n of removedNodes(tree, plan)) await values.clearOwner(tx, { kind: n.level, id: n.id });
        await repo.saveCoverage(tx, next.value, actor.userId);
        // 탑재 상품담보 — 추가 노드는 빈 값 자리 · 삭제 노드는 값 행 연쇄 · 이름 · 순서 갱신, 같은 트랜잭션에서 (ADR-0052 결정 2)
        if (deps.mountSync) {
          for (const pc of await productRepo.listProductCoveragesOfCoverage(tx, coverageId)) {
            const synced = await deps.mountSync.syncStructure(tx, pc.id, actor.userId);
            if (!synced.ok) throw new Error(`탑재 상품담보 ${pc.id} 스냅샷 동기화 실패: ${synced.rejection.reason}`); // 트랜잭션 롤백
          }
        }
        return next;
      }),
    previewStructurePlan: async (actor, coverageId, draft) => {
      const planned = await planFor(db, actor, coverageId, draft);
      if (!planned.ok) return planned as Result<never>;
      return ok(await structureImpact(db, planned.value.tree, planned.value.plan));
    },

    writeValue: (actor, owner, path, value) =>
      db.transaction(async (tx) => {
        const loaded = await loadNode(tx, owner);
        if (!loaded.ok) return loaded as Result<never>;
        const checked = checkValueWrite(path, value, owner, await enumLookup(tx), undefined, loaded.value.tree.id);
        if (!checked.ok) return checked as Result<never>;
        await values.writeSlot(tx, ownerOf(owner), checked.value, value, actor.userId);
        return ok(undefined);
      }),

    clearValue: (actor, owner, path) =>
      db.transaction(async (tx) => {
        const loaded = await loadNode(tx, owner);
        if (!loaded.ok) return loaded as Result<never>;
        await values.writeSlot(tx, ownerOf(owner), path, undefined, actor.userId);
        return ok(undefined);
      }),
  };
}
