/**
 * 상품·탑재 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출 · 트랜잭션.
 *
 * - 비파괴 액션(채번 · 표시명 · 작명 규칙 · 순서 · 상품 생성 · 값 입력 · 선택지 · 조합 등록 · 탑재 ·
 *   세목 부착 · 기본계약 지정/해제 · 그룹 · 오버라이드)은 editor 도 가능.
 * - 파괴적 액션은 `destructive()` 2단 (ADR-0019): editor → forbidden · admin 1차 → needsConfirmation(Impact) ·
 *   `{ confirm: true }` → 실행. 여기서 쓰는 액션: `product.delete` · `product.unmount` · `product.detachPlan`
 *   (세목 부착 해제 · 유효 조합 삭제 · 선택지 삭제 — 셋 다 「세목 조합 제거」 결) · `attribute.delete` · `attribute.deleteValue`.
 * - 값(상품 레벨 · 세목 유형 값 · 스냅샷)은 공용 값 저장소(`db/repo/values`)에. 스냅샷은 탑재 순간
 *   마스터 owner(coverage/subCoverage/benefit) → 스냅샷 owner(productCoverage/productSubCoverage/productBenefit) `copySlots` (ADR-0002).
 * - 다른 영역은 주입: `CoverageMasterSource`(B1 트리) · `GeneralDocumentGate`(B3 존재) · `GeneralAttachmentCheck`(B2/B3 요구 참조) ·
 *   `OptionValidator`(B2 옵션 집합) · `AttributeRefSource`(C1 식 참조). 기본 구현은 「없음/통과」.
 */
import { destructive, type DestructiveAction } from "@/domain/auth";
import { countedSlotsOf, slotType, validateValue, valueSlotsOf, type Discriminator, type SlotPath } from "@/domain/catalog";
import { validateSlotValue } from "@/domain/coverage";
import {
  addAttributeValue,
  baseContractCountIssue,
  baseContractDesignationIssues,
  checkGeneralAttachment,
  combinationKey,
  createAttributeKind,
  defaultCoverageName,
  diffStructure,
  missingSlotsOf,
  normalizeSelections,
  planCombinationKey,
  planCombinationLabel,
  planOptionLabel,
  removeAttributeValue,
  renameAttributeKind,
  renameAttributeValue,
  reorderAttributeKinds,
  reorderAttributeValues,
  reviseAttributeKind,
  setNamingFragment,
  sortInGroup,
  validateGroupTemplate,
  validateNewPlanOption,
  validatePlanCombination,
  validatePlanType,
  validateSelections,
  type AttributeKind,
  type AttributeKindRevision,
  type AttributeRefSource,
  type AttributeSelection,
  type BaseContractCheck,
  type ClauseOptionOverride,
  type ClauseOptionSelection,
  type CoverageMasterSource,
  type GeneralAttachmentCheck,
  type GeneralDocumentGate,
  type MissingSlot,
  type NewAttributeKind,
  type NewAttributeValue,
  type NewPlanOption,
  type NewProduct,
  type NewSpecialGroup,
  type OptionValidator,
  type PlanOption,
  type Product,
  type ProductCoverage,
  type ProductCoverageSnapshot,
  type ProductPlan,
  type SnapshotNode,
  type SpecialGroup,
} from "@/domain/product";
import { findForm, findMasterField, type MasterForm } from "@/domain/master";
import type { Actor, AttachLevel, Code, Coordinate, Id, Impact, Issue, Result, Value, ValueSlot } from "@/domain/types";
import { mergeImpacts, ok, reject } from "@/domain/types";

import * as catalog from "@/db/repo/catalog";
import * as repo from "@/db/repo/product";
import type { Db } from "@/db/repo/types";
import { clearOwner, copySlots, readSlots, writeSlot, type ValueOwner } from "@/db/repo/values";

import { rollbackUnless } from "./txContext";

// ───────────────────────────── 계약 ─────────────────────────────

export interface ProductServiceDeps {
  /** 담보 마스터 트리 (B1). 필수 — 없으면 탑재가 notFound. */
  coverageMaster?: CoverageMasterSource;
  /** 보통약관 템플릿 존재 게이트 (B3). 기본: 모두 존재. */
  generalDocuments?: GeneralDocumentGate;
  /** 보통약관이 요구하는 담보 레벨 참조 (B2/B3). 기본: 없음 → 부착 검사 통과. */
  generalAttachment?: GeneralAttachmentCheck;
  /** 공용조항 옵션 유효 집합 (B2). 기본: 모두 유효. */
  optionValidator?: OptionValidator;
  /** 담보속성의 식 참조 사용처 (C1). 기본: 없음. */
  attributeRefs?: AttributeRefSource;
}

export interface Confirmable {
  confirm?: boolean;
}

/**
 * 확인 2단에 「쓰지 않고 판정만 받는다」를 더한 옵션.
 *
 * 화면이 확인 카드를 그릴 때는 GET 한 번이 서비스를 호출한다 — `confirm` 없는 호출은 잃을 것이 없으면
 * 그대로 써 버리므로, 예전에는 화면이 「잃을 것이 있는가」를 **서비스와 똑같이 다시 계산해** 호출 여부를
 * 정했다 (page.tsx). 그 술어가 둘로 갈리면 화면만 조용히 틀린다 — `dryRun` 으로 판정을 서비스에 맡긴다.
 */
export interface ConfirmableDryRun extends Confirmable {
  /** true 면 **아무것도 쓰지 않고** 진짜 호출과 같은 거부·ok 를 돌려준다. */
  dryRun?: boolean;
}

export type SnapshotOwner = { kind: "productCoverage" | "productSubCoverage" | "productBenefit"; id: Id };

/**
 * 완결성 요약 — 미입력 목록에 **분모**를 붙인다 (디자인원칙 §9.2 목표 구배 · §9.6 앵커링).
 * `total` 은 노출된 구분자(`exposedDiscriminators`)의 값 자리 수이고, 입력된 자리는 `total - missing.length`.
 */
export interface CompletenessSummary {
  total: number;
  missing: MissingSlot[];
}
export type CoverageSection = "base" | "special";
export type OverrideScope = ClauseOptionOverride["scope"];
export type SpecialGroupView = SpecialGroup & { members: ProductCoverage[] };
export interface SyncResult {
  added: number;
  removed: number;
  updated: number;
}

/** 한 제출의 값 하나 — `value === undefined` 는 미입력으로 되돌리기. */
export interface SlotWrite {
  path: SlotPath;
  value: Value | undefined;
}

export interface ProductBasicInput {
  name: string;
  values: SlotWrite[];
  options: (NewPlanOption & { id: Id; isNew: boolean; values: SlotWrite[] })[];
  combinations: Id[][];
}

export interface ProductService {
  saveBasic(actor: Actor, id: Id, input: ProductBasicInput, opts?: Confirmable): Promise<Result<void>>;
  // ── 담보속성 카탈로그
  listAttributeKinds(): Promise<AttributeKind[]>;
  getAttributeKind(code: Code): Promise<AttributeKind | undefined>;
  getNamingTemplate(): Promise<string>;
  setNamingTemplate(actor: Actor, template: string): Promise<Result<string>>;
  createAttributeKind(actor: Actor, input: NewAttributeKind): Promise<Result<AttributeKind>>;
  renameAttributeKind(actor: Actor, code: Code, label: string): Promise<Result<AttributeKind>>;
  reorderAttributeKinds(actor: Actor, order: Code[]): Promise<Result<AttributeKind[]>>;
  addAttributeValue(actor: Actor, code: Code, input: NewAttributeValue): Promise<Result<AttributeKind>>;
  renameAttributeValue(actor: Actor, code: Code, valueCode: Code, label: string): Promise<Result<AttributeKind>>;
  setNamingFragment(actor: Actor, code: Code, valueCode: Code, fragment: string): Promise<Result<AttributeKind>>;
  reorderAttributeValues(actor: Actor, code: Code, order: Code[]): Promise<Result<AttributeKind>>;
  removeAttributeValue(actor: Actor, code: Code, valueCode: Code, opts?: Confirmable): Promise<Result<AttributeKind>>;
  /**
   * 담보속성 편집 화면 한 벌 저장 — 종류명 · 최종 유효값 목록(이름 · 조각 · 순서 · 새 값)을 최종 상태로 한 번에 검사해 한 번 저장한다
   * (점검 2026-09-27 D1). 빠진 유효값이 있으면 `attribute.deleteValue` 2단 — 편집자 forbidden · 관리자 1차는 빠진 값 전부의
   * 사용처를 합쳐 needsConfirmation · confirm 이면 저장 (D2). 거부 · 확인 필요면 롤백한다 — 순번도 타지 않는다.
   */
  reviseAttributeKind(actor: Actor, code: Code, revision: AttributeKindRevision, opts?: Confirmable): Promise<Result<AttributeKind>>;
  removeAttributeKind(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
  /** 사용처 — 이 속성(값)을 조합에 쓰는 상품담보 + 식 참조. */
  attributeUsage(code: Code, valueCode?: Code): Promise<Coordinate[]>;

  // ── 상품
  listProducts(): Promise<Product[]>;
  getProduct(id: Id): Promise<Product | undefined>;
  productAudit(id: Id): ReturnType<typeof repo.productAudit>;
  createProduct(actor: Actor, input: NewProduct): Promise<Result<Product>>;
  renameProduct(actor: Actor, id: Id, name: string): Promise<Result<Product>>;
  /**
   * 보통약관 템플릿 선택·교체·해제(undefined).
   *
   * 조 노출·옵션 오버라이드는 **템플릿 기준** 설정이라 템플릿이 실제로 바뀌면 함께 초기화된다
   * (기능/상품 §3.6). 잃는 것이 있으면 1차 호출은
   * `needsConfirmation(Impact)` 으로 거부하고, `{ confirm: true }` 재호출이 **한 트랜잭션**에서
   * 둘을 비우고 교체한다 — 한쪽만 조용히 버리거나(숨김) 교체 자체를 막지(오버라이드) 않는다
   * (코덱스 리뷰 2026-09-15 Important-6). 같은 템플릿을 다시 고르면 아무것도 잃지 않는다.
   *
   * 역할 관문은 두지 않는다 — `destructive()` 카탈로그에 넣지 않고 **확인 2단만** 쓴다. 편집자도 한다
   * (기능/상품 §3.6).
   */
  setGeneralDocument(actor: Actor, id: Id, generalDocumentId: Id | undefined, opts?: ConfirmableDryRun): Promise<Result<Product>>;
  /** 이 상품이 숨긴 보통약관 조 id — 숨긴 순 (기능/상품 §3.6). */
  listHiddenArticles(productId: Id): Promise<Id[]>;
  /**
   * 보통약관 조 하나의 노출 토글 (기능/상품 §3.6). 멱등 — 이미 그 상태면 그대로 `ok`.
   * 템플릿이 없으면 invalid · 템플릿에 없는 조 id 면 notFound.
   */
  setArticleHidden(actor: Actor, productId: Id, articleId: Id, hidden: boolean): Promise<Result<void>>;
  deleteProduct(actor: Actor, id: Id, opts?: Confirmable): Promise<Result<void>>;
  setProductValue(actor: Actor, id: Id, path: SlotPath, value: Value | undefined): Promise<Result<void>>;
  /** 한 제출의 값 여럿 — 전부 검사한 뒤 한 트랜잭션으로 쓴다. 하나라도 거부되면 아무것도 안 바뀐다. */
  setProductValues(actor: Actor, id: Id, entries: readonly SlotWrite[]): Promise<Result<void>>;
  getProductValues(id: Id): Promise<Map<SlotPath, ValueSlot>>;
  /** 상품 미입력 — 상품 레벨 자리 + 세목 선택지마다 제 세목유형 폼의 자리. */
  productMissing(id: Id): Promise<MissingSlot[]>;
  /** 상품 완결성 — `productMissing` 에 분모(상품 레벨 자리 수 + 선택지별 폼 자리 수 합)를 붙인 것. */
  productCompleteness(id: Id): Promise<CompletenessSummary>;

  // ── 세목
  listPlanOptions(productId: Id): Promise<PlanOption[]>;
  addPlanOption(actor: Actor, productId: Id, input: NewPlanOption): Promise<Result<PlanOption>>;
  updatePlanOption(actor: Actor, optionId: Id, patch: { number?: number; name?: string }): Promise<Result<PlanOption>>;
  removePlanOption(actor: Actor, optionId: Id, opts?: Confirmable): Promise<Result<void>>;
  setPlanOptionValue(actor: Actor, optionId: Id, path: SlotPath, value: Value | undefined): Promise<Result<void>>;
  /** `setProductValues` 와 같은 규칙 — 한 제출, 전부 검사 후 쓰기. 폼 소속 검사도 자리마다 본다. */
  setPlanOptionValues(actor: Actor, optionId: Id, entries: readonly SlotWrite[]): Promise<Result<void>>;
  getPlanOptionValues(optionId: Id): Promise<Map<SlotPath, ValueSlot>>;
  listPlans(productId: Id): Promise<ProductPlan[]>;
  registerPlan(actor: Actor, productId: Id, optionIds: Id[]): Promise<Result<ProductPlan>>;
  removePlan(actor: Actor, planId: Id, opts?: Confirmable): Promise<Result<void>>;

  // ── 상품담보 = 탑재
  mount(actor: Actor, productId: Id, coverageId: Id, selections: AttributeSelection[], section?: CoverageSection): Promise<Result<ProductCoverage>>;
  getProductCoverage(id: Id): Promise<ProductCoverage | undefined>;
  listProductCoverages(productId: Id): Promise<ProductCoverage[]>;
  getSnapshot(id: Id): Promise<Result<ProductCoverageSnapshot>>;
  /** 상품의 모든 탑재분 스냅샷 — `listProductCoverages` 순. 쿼리 수가 상품담보·노드 수와 무관하다 (조립 적재용 · ADR-0034 결정 3). */
  listSnapshots(productId: Id): Promise<ProductCoverageSnapshot[]>;
  /** owner id(상품담보 id · 노드 id) → 값 자리. */
  getSnapshotValues(id: Id): Promise<Map<Id, Map<SlotPath, ValueSlot>>>;
  setSnapshotValue(actor: Actor, id: Id, owner: SnapshotOwner, path: SlotPath, value: Value | undefined): Promise<Result<void>>;
  /** `setProductValues` 와 같은 규칙 — 한 제출, 전부 검사 후 쓰기. */
  setSnapshotValues(actor: Actor, id: Id, owner: SnapshotOwner, entries: readonly SlotWrite[]): Promise<Result<void>>;
  renameProductCoverage(actor: Actor, id: Id, name: string): Promise<Result<ProductCoverage>>;
  regenerateName(actor: Actor, id: Id): Promise<Result<ProductCoverage>>;
  setAttributes(actor: Actor, id: Id, selections: AttributeSelection[], opts?: { regenerateName?: boolean }): Promise<Result<ProductCoverage>>;
  /** 마스터 트리와 대조 — 없는 노드 추가(빈 값) · 사라진 노드 값 삭제. 조회·조립 전에 호출. */
  syncStructure(id: Id): Promise<Result<SyncResult>>;
  /**
   * 같은 동기화를 **호출자의 트랜잭션 안에서** — 담보 마스터의 구조 정정(`coverage.applyStructurePlan`)이 저장 직후
   * 탑재 상품담보를 맞출 때 쓴다 (ADR-0075 결정 2). 마스터 트리는 그 tx 위에서 읽힌다 (contextualDb).
   */
  syncStructureIn(tx: Db, productCoverageId: Id, who: Id): Promise<Result<SyncResult>>;
  unmount(actor: Actor, id: Id, opts?: Confirmable): Promise<Result<void>>;
  coverageMissing(id: Id): Promise<MissingSlot[]>;
  /** 상품담보(스냅샷) 완결성 — 미입력 목록 + 분모(스냅샷 실체마다 노출된 값 자리 수). */
  coverageCompleteness(id: Id): Promise<CompletenessSummary>;
  /**
   * 탑재 후 마스터와 달라진 값 자리 수 = 「되돌릴 수 있는 필드」(디자인원칙 §1.2).
   * 스냅샷에 입력돼 있고 마스터의 같은 자리가 없거나 값이 다른 자리를 센다.
   */
  snapshotDrift(id: Id): Promise<number>;
  /**
   * owner id(상품담보 id · 노드 id) → 마스터의 값 자리 — 폼의 스냅샷 문법(§1.2 되돌리기)이 손댄 자리를
   * 가려내는 근거. 마스터를 못 찾으면(주입 없음 등) 빈 맵 — 이 경우 폼은 모두 direct 로 보인다.
   */
  getSnapshotMasterValues(id: Id): Promise<Map<Id, Map<SlotPath, ValueSlot>>>;
  attachPlan(actor: Actor, id: Id, planId: Id): Promise<Result<void>>;
  detachPlan(actor: Actor, id: Id, planId: Id, opts?: Confirmable): Promise<Result<void>>;
  listAttachedPlans(id: Id): Promise<ProductPlan[]>;

  // ── 기본계약
  designateBaseContract(actor: Actor, productId: Id, productCoverageId: Id): Promise<Result<BaseContractCheck>>;
  releaseBaseContract(actor: Actor, productId: Id, productCoverageId: Id): Promise<Result<void>>;
  listBaseContractIds(productId: Id): Promise<Id[]>;
  /** 「정확히 1개」 검증 + 부착 검사. 0개 → invalid(noBaseContract). */
  checkBaseContract(productId: Id): Promise<Result<BaseContractCheck[]>>;

  // ── 특약 그룹
  listGroups(productId: Id): Promise<SpecialGroupView[]>;
  createGroup(actor: Actor, productId: Id, input: NewSpecialGroup): Promise<Result<SpecialGroup>>;
  renameGroup(actor: Actor, groupId: Id, title: string): Promise<Result<SpecialGroup>>;
  reorderGroups(actor: Actor, productId: Id, order: Id[]): Promise<Result<SpecialGroup[]>>;
  deleteGroup(actor: Actor, groupId: Id): Promise<Result<void>>;
  placeInGroup(actor: Actor, groupId: Id, productCoverageId: Id): Promise<Result<void>>;
  removeFromGroup(actor: Actor, productCoverageId: Id): Promise<Result<void>>;
  listUnplaced(productId: Id): Promise<ProductCoverage[]>;

  // ── 옵션 오버라이드
  /**
   * 보통약관 공용조항 자리의 상품별 옵션 선택 (기능/상품 §3.6).
   *
   * `options` 는 **부분 선택**이어도 된다 — 자리의 마스터 선택에 얹어 합친 결과를 검사하고
   * (`resolveOptions` 와 같은 규칙), 마스터와 **다른 키만** 저장한다. 전부 마스터와 같아지면
   * 행을 지우고 `ok(undefined)` 다 (코덱스 리뷰 2026-09-15 Important-1).
   * 상품의 보통약관 템플릿에 그 참조 노드가 없거나, 그 자리의 공용조항이 `clauseCode` 와 다르면 `notFound`.
   */
  setOptionOverride(actor: Actor, scope: OverrideScope, nodeId: Id, clauseCode: Code, options: ClauseOptionSelection): Promise<Result<ClauseOptionOverride | undefined>>;
  listOptionOverrides(scope: OverrideScope): Promise<ClauseOptionOverride[]>;
  removeOptionOverride(actor: Actor, scope: OverrideScope, nodeId: Id, clauseCode: Code): Promise<Result<void>>;
}

// ───────────────────────────── 구현 ─────────────────────────────

const LEVEL_OF: Record<ValueOwner["kind"], AttachLevel> = {
  product: "product",
  plan: "plan",
  coverage: "coverage",
  subCoverage: "subCoverage",
  benefit: "benefit",
  productCoverage: "coverage",
  productSubCoverage: "subCoverage",
  productBenefit: "benefit",
  productPlan: "plan",
};

const NO_MASTER: CoverageMasterSource = { tree: async () => undefined };

function notFound<T>(what: string): Result<T> {
  return reject({ reason: "notFound", what });
}
function invalid<T>(issues: Issue[]): Result<T> {
  return reject({ reason: "invalid", issues });
}
function issue(kind: Issue["kind"], message: string, at: Coordinate = {}): Issue {
  return { kind, message, at };
}
/** 완결성 분모 — 이 레벨의 마스터 값 자리 수 (디자인원칙 §9.6 「분모 없는 카운트를 두지 않는다」). */
function countLevelSlots(level: AttachLevel): number {
  return valueSlotsOf(level).length;
}

/**
 * 세목 선택지의 값 자리 = **제 세목유형 폼**의 필드만 (마스터 조회 `services/master.ts` 의 세목 값 노드 규칙과 같다).
 * 같은 plan 레벨이라도 다른 폼의 자리는 이 선택지의 것이 아니다. 폼이 마스터에서 사라졌으면 자리가 없다.
 */
function planOptionForm(o: PlanOption): MasterForm[] {
  const form = findForm(o.planTypeCode);
  return form ? [form] : [];
}

function cleanName(name: unknown): string | undefined {
  const t = typeof name === "string" ? name.trim() : "";
  return t.length > 0 ? t : undefined;
}

export function createProductService(db: Db, deps: ProductServiceDeps = {}): ProductService {
  const master = deps.coverageMaster ?? NO_MASTER;
  const gate: GeneralDocumentGate = { exists: async () => true, articleIds: async () => [], clauseRef: async () => undefined, ...deps.generalDocuments };
  const attachment = deps.generalAttachment ?? { requiredRefs: async () => [] };
  const optionValidator = deps.optionValidator ?? { validate: async () => [] };
  const attributeRefs = deps.attributeRefs ?? { findExpressionRefs: async () => [] };

  // ── 공통 헬퍼

  async function catalogDefs(tx: Db): Promise<{ defs: Discriminator[]; findEnum: Parameters<typeof validateValue>[2] }> {
    const [defs, enums] = await Promise.all([catalog.listDiscriminators(tx), catalog.listEnums(tx)]);
    const byCode = new Map(enums.map((e) => [e.code, e]));
    return { defs, findEnum: (c) => byCode.get(c) };
  }

  /**
   * 값 자리 검사 — 마스터 자리 존재 · 레벨 일치 · 타입 (ADR-0037: 부착이 없어 노출 검사가 없다).
   * `value === undefined` 는 미입력으로 되돌리기 (D-P5-15) — 자리만 있으면 된다.
   */
  async function checkSlot(tx: Db, owner: ValueOwner, path: SlotPath, value: Value | undefined): Promise<Issue[]> {
    const level = LEVEL_OF[owner.kind];
    const type = slotType(level, path);
    if (!type) return [issue("brokenRef", `${level} 레벨에 값 자리 ${path} 이(가) 없습니다`, { refPath: path })];
    if (value === undefined) return [];
    const { findEnum } = await catalogDefs(tx);
    return validateSlotValue(path, type, value, findEnum, { refPath: path });
  }

  /** 값 자리 하나 쓰기 (검증 포함). */
  async function writeChecked(tx: Db, actor: Actor, owner: ValueOwner, path: SlotPath, value: Value | undefined): Promise<Result<void>> {
    return writeAllChecked(tx, actor, owner, [{ path, value }]);
  }

  /**
   * 값 자리 여럿을 **한 제출**로 쓰기 — 전부 검사한 뒤에 쓴다. 하나라도 거부되면 아무것도 쓰지 않는다
   * (코덱스 리뷰 2026-09-14 Important-2: 자리마다 따로 저장하면 뒤 자리가 거부돼도 앞 자리는 이미 바뀌어 있었다).
   * 트랜잭션 콜백이 Result 실패를 돌려주는 것만으로는 앞선 쓰기가 롤백되지 않으므로 쓰기 전에 검사를 끝낸다.
   * 거부 issue 는 제출 전체에서 모아 돌려준다 — 폼이 한 번에 다 보여 준다.
   */
  async function writeAllChecked(tx: Db, actor: Actor, owner: ValueOwner, entries: readonly SlotWrite[]): Promise<Result<void>> {
    const issues: Issue[] = [];
    for (const e of entries) issues.push(...(await checkSlot(tx, owner, e.path, e.value)));
    if (issues.length > 0) return invalid(issues);
    for (const e of entries) await writeSlot(tx, owner, e.path, e.value, actor.userId);
    return ok(undefined);
  }

  /**
   * 상품 완결성 = 상품 레벨 자리 + **세목 선택지마다 제 폼의 자리** (실물 재현 2차 T2 ④ — 세목 값을 빠뜨리면
   * 집계 범위가 조용히 비므로 완결성이 잡아야 한다). 선택지 순서는 목록 순(축 · 번호).
   */
  async function productCompletenessOf(id: Id): Promise<CompletenessSummary> {
    const p = await repo.loadProduct(db, id);
    if (!p) return { total: 0, missing: [] };
    const slots = await readSlots(db, { kind: "product", id });
    let total = countLevelSlots("product");
    const missing = missingSlotsOf({ kind: "product", id }, p.name, "product", (path) => slots.get(path));
    for (const o of await repo.listPlanOptions(db, id)) {
      const master = planOptionForm(o);
      total += master.reduce((n, f) => n + f.fields.length, 0);
      const mine = await readSlots(db, { kind: "plan", id: o.id });
      missing.push(...missingSlotsOf({ kind: "plan", id: o.id }, planOptionLabel(o), "plan", (path) => mine.get(path), master));
    }
    return { total, missing };
  }

  async function withProduct<T>(tx: Db, id: Id, fn: (p: Product) => Promise<Result<T>>): Promise<Result<T>> {
    const p = await repo.loadProduct(tx, id);
    return p ? fn(p) : notFound(`상품 ${id}`);
  }
  /** 세목 선택지 값 — 같은 plan 레벨이라도 이 선택지의 세목유형 폼이 아니면 자리가 아니다 (코덱스 리뷰 Important 1). */
  function setPlanOptionValues(actor: Actor, optionId: Id, entries: readonly SlotWrite[]): Promise<Result<void>> {
    return db.transaction(async (tx) => {
      const o = await repo.loadPlanOption(tx, optionId);
      if (!o) return notFound(`세목 선택지 ${optionId}`);
      const foreign = entries.filter((e) => {
        const ref = findMasterField(e.path);
        return ref && ref.form.key !== o.planTypeCode;
      });
      if (foreign.length > 0) {
        return invalid(
          foreign.map((e) => issue("brokenRef", `세목 선택지 ${planOptionLabel(o)} 의 세목유형은 ${o.planTypeCode} 라 ${e.path} 자리가 없습니다`, { refPath: e.path })),
        );
      }
      return writeAllChecked(tx, actor, { kind: "plan", id: optionId }, entries);
    });
  }

  function setSnapshotValues(actor: Actor, id: Id, owner: SnapshotOwner, entries: readonly SlotWrite[]): Promise<Result<void>> {
    return db.transaction((tx) =>
      withCoverage(tx, id, async () => {
        const owners = await snapshotOwners(tx, id);
        if (!owners.some((o) => o.owner.kind === owner.kind && o.owner.id === owner.id)) return notFound(`상품담보 ${id} 의 스냅샷 실체 ${owner.kind}/${owner.id}`);
        return writeAllChecked(tx, actor, owner, entries);
      }),
    );
  }

  async function withCoverage<T>(tx: Db, id: Id, fn: (pc: ProductCoverage) => Promise<Result<T>>): Promise<Result<T>> {
    const pc = await repo.loadProductCoverage(tx, id);
    return pc ? fn(pc) : notFound(`상품담보 ${id}`);
  }
  async function withKind<T>(tx: Db, code: Code, fn: (k: AttributeKind, all: AttributeKind[]) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const all = await repo.listAttributeKinds(tx);
    const k = all.find((x) => x.code === code);
    return k ? fn(k, all) : notFound(`담보속성 종류 ${code}`);
  }
  function editKind(actor: Actor, code: Code, change: (k: AttributeKind, all: AttributeKind[], tx: Db) => Promise<Result<AttributeKind>> | Result<AttributeKind>) {
    return db.transaction((tx) =>
      withKind(tx, code, async (k, all) => {
        const r = await change(k, all, tx); // 채번 등 tx 안 쿼리는 반드시 tx 로 (PGlite 단일 연결 — db 로 치면 교착)
        if (r.ok) await repo.saveAttributeKind(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  /** 스냅샷 실체 owner 목록 (상품담보 + 노드). */
  async function snapshotOwners(tx: Db, pcId: Id): Promise<{ owner: SnapshotOwner; node?: SnapshotNode }[]> {
    const nodes = await repo.listNodes(tx, pcId);
    return [
      { owner: { kind: "productCoverage", id: pcId } },
      ...nodes.map((n) => ({ owner: { kind: n.kind === "sub" ? "productSubCoverage" : "productBenefit", id: n.id } as SnapshotOwner, node: n })),
    ];
  }

  async function countSlots(tx: Db, owners: readonly ValueOwner[]): Promise<number> {
    let n = 0;
    for (const o of owners) n += (await readSlots(tx, o)).size;
    return n;
  }

  /** 마스터 실체 → 스냅샷 실체 값·부착 복사 (ADR-0002). */
  async function snapshotFrom(tx: Db, from: { kind: "coverage" | "subCoverage" | "benefit"; id: Id }, to: SnapshotOwner, who: Id): Promise<void> {
    if (master.masterSlots) {
      const slots = await master.masterSlots(from);
      for (const [path, slot] of slots) {
        if (!slot.entered) continue;
        await writeSlot(tx, to, path, slot.value, who);
      }
    } else {
      await copySlots(tx, from, to, who);
    }
  }

  /** actor 없는 동기화(조회·조립 전 호출) — 노드 감사 컬럼은 비운다. */
  async function syncStructureIn(tx: Db, pc: ProductCoverage, who?: Id): Promise<Result<SyncResult>> {
    const tree = await master.tree(pc.coverageId);
    if (!tree) return notFound(`담보 마스터 ${pc.coverageId}`);
    const nodes = await repo.listNodes(tx, pc.id);
    const diff = diffStructure(tree, nodes);
    const snapIdOf = new Map(nodes.map((n) => [n.masterNodeId, n.id]));
    for (const n of diff.add) {
      const parentId = n.parentMasterId ? snapIdOf.get(n.parentMasterId) : undefined;
      const row = await repo.insertNode(tx, { productCoverageId: pc.id, kind: n.kind, masterNodeId: n.masterNodeId, parentId, name: n.name, order: n.order }, who);
      snapIdOf.set(n.masterNodeId, row.id);
    }
    for (const n of diff.remove) await clearOwner(tx, { kind: n.kind === "sub" ? "productSubCoverage" : "productBenefit", id: n.id });
    await repo.deleteNodes(tx, diff.remove.map((n) => n.id));
    for (const u of diff.update) await repo.updateNode(tx, u.id, { name: u.name, order: u.order }, who);
    return ok({ added: diff.add.length, removed: diff.remove.length, updated: diff.update.length });
  }

  /** 상품담보 + 노드 목록(`listNodes` 순) + 탑재 시점 담보명 → 스냅샷. 단건·일괄이 같은 모양을 만든다. */
  function toSnapshot(pc: ProductCoverage, nodes: readonly SnapshotNode[], coverageName: string): ProductCoverageSnapshot {
    const subs = nodes.filter((n) => n.kind === "sub");
    return {
      ...pc,
      coverageName,
      subCoverages: subs.map((s) => ({ ...s, benefits: nodes.filter((b) => b.kind === "benefit" && b.parentId === s.id) })),
    };
  }

  async function snapshotOf(tx: Db, pc: ProductCoverage): Promise<ProductCoverageSnapshot> {
    return toSnapshot(pc, await repo.listNodes(tx, pc.id), (await repo.coverageNameOf(tx, pc.id)) ?? "");
  }

  /** 상품 전체 스냅샷 — 상품담보 목록 · 노드 · 담보명을 각각 한 번에 읽는다 (상품담보 수와 무관한 쿼리 수). */
  async function snapshotsOf(tx: Db, productId: Id): Promise<ProductCoverageSnapshot[]> {
    const pcs = await repo.listProductCoverages(tx, productId);
    const [nodesByPc, names] = await Promise.all([repo.listNodesForProduct(tx, productId), repo.coverageNamesOf(tx, pcs.map((pc) => pc.id))]);
    return pcs.map((pc) => toSnapshot(pc, nodesByPc.get(pc.id) ?? [], names.get(pc.id) ?? ""));
  }

  async function checkOne(tx: Db, product: Product, pc: ProductCoverage): Promise<Result<BaseContractCheck>> {
    if (!product.generalDocumentId) return invalid([issue("brokenRef", "보통약관 템플릿이 선택되지 않았습니다", { document: "product", ownerId: product.id })]);
    const { defs } = await catalogDefs(tx);
    const required = await attachment.requiredRefs(product.generalDocumentId);
    const known = defs.map((d) => d.code);
    return ok({ productCoverageId: pc.id, issues: checkGeneralAttachment(required, known, { id: pc.id, name: pc.name }) });
  }

  async function groupViews(tx: Db, productId: Id): Promise<SpecialGroupView[]> {
    const [groups, members, coverages, kinds] = await Promise.all([repo.listGroups(tx, productId), repo.listMembersByGroup(tx, productId), repo.listProductCoverages(tx, productId), repo.listAttributeKinds(tx)]);
    const byId = new Map(coverages.map((c) => [c.id, c]));
    // 담보 순서 = 탑재 시점 담보명 순 (B1 마스터 순서는 통합 때 어댑터로 바꿀 수 있다) — 담보명은 한 번에 읽는다
    const namesByPc = await repo.coverageNamesOf(tx, coverages.map((c) => c.id));
    const nameOf = new Map<Id, string>();
    for (const c of coverages) if (!nameOf.has(c.coverageId)) nameOf.set(c.coverageId, namesByPc.get(c.id) ?? "");
    const names = [...new Set(nameOf.values())].sort((a, b) => a.localeCompare(b));
    const coverageOrder = (id: Id) => names.indexOf(nameOf.get(id) ?? "");
    return groups.map((g) => ({
      ...g,
      members: sortInGroup((members.get(g.id) ?? []).map((id) => byId.get(id)).filter((c): c is ProductCoverage => !!c), kinds, coverageOrder),
    }));
  }

  /** 기본정보 전체를 검증한 후 한 트랜잭션으로 저장한다. */
  function saveBasic(actor: Actor, id: Id, input: ProductBasicInput, opts: Confirmable = {}): Promise<Result<void>> {
    return db.transaction((tx) => withProduct(tx, id, async () => {
      const name = cleanName(input.name);
      if (!name) return invalid([issue("typeMismatch", "상품명은 비울 수 없습니다")]);
      const duplicate = await repo.findProductByName(tx, name);
      if (duplicate && duplicate.id !== id) return reject({ reason: "duplicate", what: `상품명 ${name}` });
      const currentOptions = await repo.listPlanOptions(tx, id);
      const currentPlans = await repo.listPlans(tx, id);
      const nextOptions: PlanOption[] = input.options.map((o) => ({ ...o, productId: id }));
      const issues: Issue[] = [];
      if (new Set(nextOptions.map((o) => o.id)).size !== nextOptions.length) issues.push(issue("typeMismatch", "보험종목이 중복되었습니다"));
      for (const option of input.options) {
        const existing = currentOptions.find((o) => o.id === option.id);
        if (option.isNew ? !!existing : !existing) issues.push(issue("brokenRef", "보험종목이 변경되었습니다. 화면을 새로고침해 주세요"));
        if (existing && (existing.axis !== option.axis || existing.planTypeCode !== option.planTypeCode)) issues.push(issue("typeMismatch", "기존 보험종목의 종·형 구분과 세목유형은 변경할 수 없습니다"));
        issues.push(...validatePlanType(option.planTypeCode), ...validateNewPlanOption(option, nextOptions, option.id));
        for (const entry of option.values) {
          const field = findMasterField(entry.path);
          if (!field || field.form.key !== option.planTypeCode) issues.push(issue("brokenRef", `보험종목의 입력 항목이 아닙니다: ${entry.path}`));
          issues.push(...await checkSlot(tx, { kind: "plan", id: option.id }, entry.path, entry.value));
        }
      }
      for (const entry of input.values) issues.push(...await checkSlot(tx, { kind: "product", id }, entry.path, entry.value));
      const nextPlans: ProductPlan[] = [];
      for (const optionIds of input.combinations) {
        const result = validatePlanCombination(optionIds, nextOptions, nextPlans);
        if (!result.ok) { if (result.rejection.reason === "invalid") issues.push(...result.rejection.issues); else issues.push(issue("typeMismatch", "중복되거나 유효하지 않은 종·형 조합입니다")); }
        else nextPlans.push({ id: planCombinationKey(optionIds), productId: id, options: result.value });
      }
      if (issues.length) return invalid(issues);
      const removedOptions = currentOptions.filter((o) => !nextOptions.some((n) => n.id === o.id));
      const keys = new Set(input.combinations.map(planCombinationKey));
      const removedPlans = currentPlans.filter((p) => !keys.has(planCombinationKey(p.options.map((o) => o.id))));
      const execute = async (): Promise<Result<void>> => {
        for (const plan of removedPlans) await repo.deletePlan(tx, plan.id);
        for (const option of removedOptions) {
          await clearOwner(tx, { kind: "plan", id: option.id });
          await repo.deletePlanOption(tx, option.id);
        }
        // 번호 교환도 unique 제약을 지키도록 트랜잭션 안에서 임시 번호를 사용한다.
        for (const [index, option] of currentOptions.filter((o) => !removedOptions.includes(o)).entries()) await repo.updatePlanOption(tx, option.id, { number: -index - 1 }, actor.userId);
        const ids = new Map<Id, Id>();
        for (const option of input.options) {
          const savedId = option.isNew ? (await repo.insertPlanOption(tx, id, { ...option, name: option.name.trim() }, actor.userId)).id : option.id;
          if (!option.isNew) await repo.updatePlanOption(tx, savedId, { number: option.number, name: option.name.trim() }, actor.userId);
          ids.set(option.id, savedId);
          for (const entry of option.values) await writeSlot(tx, { kind: "plan", id: savedId }, entry.path, entry.value, actor.userId);
        }
        const existingKeys = new Set(currentPlans.filter((p) => !removedPlans.includes(p)).map((p) => planCombinationKey(p.options.map((o) => o.id))));
        for (const combination of input.combinations) {
          const optionIds = combination.map((key) => ids.get(key)!);
          const key = planCombinationKey(optionIds);
          if (!existingKeys.has(key)) await repo.insertPlan(tx, id, key, optionIds, actor.userId);
        }
        await repo.updateProduct(tx, id, { name }, actor.userId);
        for (const entry of input.values) await writeSlot(tx, { kind: "product", id }, entry.path, entry.value, actor.userId);
        return ok(undefined);
      };
      if (!removedOptions.length && !removedPlans.length) return execute();
      return destructive<void>({
        actor, action: "product.detachPlan", confirm: opts.confirm,
        precheck: async () => ok(undefined),
        computeImpact: async () => ({
          valueRowsLost: await countSlots(tx, removedOptions.map((o) => ({ kind: "plan" as const, id: o.id }))),
          brokenRefs: [],
          cascade: [
            ...removedOptions.map((o) => `보험종목 ${planOptionLabel(o)}`),
            ...removedPlans.map((p) => `종·형 조합 ${planCombinationLabel(p.options)}`),
            ...(await Promise.all(removedPlans.map(async (p) => (await repo.listCoveragesAttachingPlan(tx, p.id)).map((c) => `세목 부착 ${c.name}`)))).flat(),
          ],
        }),
        execute,
      });
    }));
  }

  /** 세목 관련 파괴적 액션 공통 (product.detachPlan). */
  function planDestructive(actor: Actor, opts: Confirmable, precheck: (tx: Db) => Promise<Result<void>>, impact: (tx: Db) => Promise<Impact>, execute: (tx: Db) => Promise<void>) {
    return db.transaction((tx) =>
      destructive<void>({
        actor,
        action: "product.detachPlan",
        confirm: opts.confirm,
        precheck: () => precheck(tx),
        computeImpact: () => impact(tx),
        execute: async () => {
          await execute(tx);
          return ok(undefined);
        },
      }),
    );
  }

  function attributeDestructive<T>(actor: Actor, action: DestructiveAction, opts: Confirmable, code: Code, valueCode: Code | undefined, run: (tx: Db, kind: AttributeKind) => Promise<Result<T>>) {
    return db.transaction(async (tx) => {
      let loaded: AttributeKind | undefined;
      return destructive<T>({
        actor,
        action,
        confirm: opts.confirm,
        precheck: () =>
          withKind(tx, code, (k) => {
            if (valueCode && !k.values.some((v) => v.code === valueCode)) return notFound(`담보속성 유효값 ${valueCode}`);
            loaded = k;
            return ok(undefined);
          }),
        computeImpact: async () => ({
          valueRowsLost: 0,
          brokenRefs: await usage(tx, code, valueCode),
          cascade: valueCode ? [] : loaded!.values.map((v) => `값 ${v.label}(${v.code})`),
        }),
        execute: () => run(tx, loaded!),
      });
    });
  }

  async function usage(tx: Db, code: Code, valueCode?: Code): Promise<Coordinate[]> {
    const covs = await repo.listCoveragesUsingAttribute(tx, code, valueCode);
    return [...covs.map<Coordinate>((c) => ({ document: "special", ownerId: c.id, ownerName: c.name })), ...(await attributeRefs.findExpressionRefs(code, valueCode))];
  }

  // ── 서비스

  return {
    // 담보속성
    listAttributeKinds: () => repo.listAttributeKinds(db),
    getAttributeKind: (code) => repo.loadAttributeKind(db, code),
    getNamingTemplate: () => repo.loadNamingTemplate(db),
    setNamingTemplate: (actor, template) =>
      db.transaction(async (tx) => {
        await repo.saveNamingTemplate(tx, template, actor.userId);
        return ok(template);
      }),
    createAttributeKind: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createAttributeKind(input, await repo.listAttributeKinds(tx), repo.attributeSeqSource(tx));
        if (r.ok) await repo.insertAttributeKind(tx, r.value, actor.userId);
        return r;
      }),
    renameAttributeKind: (actor, code, label) => editKind(actor, code, (k, all) => renameAttributeKind(k, label, all)),
    reorderAttributeKinds: (actor, order) =>
      db.transaction(async (tx) => {
        const r = reorderAttributeKinds(await repo.listAttributeKinds(tx), order);
        if (r.ok) await repo.saveAttributeKindOrders(tx, r.value, actor.userId);
        return r;
      }),
    addAttributeValue: (actor, code, input) => editKind(actor, code, (k, _all, tx) => addAttributeValue(k, input, repo.attributeSeqSource(tx))),
    renameAttributeValue: (actor, code, valueCode, label) => editKind(actor, code, (k) => renameAttributeValue(k, valueCode, label)),
    setNamingFragment: (actor, code, valueCode, fragment) => editKind(actor, code, (k) => setNamingFragment(k, valueCode, fragment)),
    reorderAttributeValues: (actor, code, order) => editKind(actor, code, (k) => reorderAttributeValues(k, order)),
    removeAttributeValue: (actor, code, valueCode, opts = {}) =>
      attributeDestructive(actor, "attribute.deleteValue", opts, code, valueCode, async (tx, kind) => {
        const r = removeAttributeValue(kind, valueCode);
        if (r.ok) await repo.saveAttributeKind(tx, r.value, actor.userId);
        return r;
      }),
    reviseAttributeKind: (actor, code, revision, opts = {}) =>
      rollbackUnless(
        db,
        (tx) =>
          withKind(tx, code, async (kind, all) => {
            const revised = await reviseAttributeKind(kind, all, revision, repo.attributeSeqSource(tx));
            if (!revised.ok) return revised as Result<AttributeKind>;
            const { kind: next, removed } = revised.value;
            const save = async (): Promise<Result<AttributeKind>> => {
              await repo.saveAttributeKind(tx, next, actor.userId);
              return ok(next);
            };
            if (removed.length === 0) return save();
            return destructive<AttributeKind>({
              actor,
              action: "attribute.deleteValue",
              confirm: opts.confirm,
              computeImpact: async () => mergeImpacts(await Promise.all(removed.map(async (valueCode) => ({ valueRowsLost: 0, brokenRefs: await usage(tx, code, valueCode), cascade: [] })))),
              execute: save,
            });
          }),
        (r) => r.ok,
      ),
    removeAttributeKind: (actor, code, opts = {}) =>
      attributeDestructive(actor, "attribute.delete", opts, code, undefined, async (tx) => {
        await repo.deleteAttributeKind(tx, code); // 상품담보의 조합 행은 남아 깨진 참조가 된다 (오류화)
        return ok(undefined);
      }),
    attributeUsage: (code, valueCode) => usage(db, code, valueCode),

    // 상품
    saveBasic,
    listProducts: () => repo.listProducts(db),
    getProduct: (id) => repo.loadProduct(db, id),
    productAudit: (id) => repo.productAudit(db, id),
    createProduct: (actor, input) =>
      db.transaction(async (tx) => {
        const name = cleanName(input.name);
        if (!name) return invalid([issue("typeMismatch", "상품명은 비울 수 없습니다")]);
        if (await repo.findProductByName(tx, name)) return reject({ reason: "duplicate", what: `상품명 ${name}` });
        if (input.generalDocumentId && !(await gate.exists(input.generalDocumentId))) return notFound(`보통약관 템플릿 ${input.generalDocumentId}`);
        return ok(await repo.insertProduct(tx, { name, generalDocumentId: input.generalDocumentId }, actor.userId));
      }),
    renameProduct: (actor, id, name) =>
      db.transaction((tx) =>
        withProduct(tx, id, async (p) => {
          const clean = cleanName(name);
          if (!clean) return invalid([issue("typeMismatch", "상품명은 비울 수 없습니다", { document: "product", ownerId: id })]);
          const dup = await repo.findProductByName(tx, clean);
          if (dup && dup.id !== id) return reject({ reason: "duplicate", what: `상품명 ${clean}` });
          await repo.updateProduct(tx, id, { name: clean }, actor.userId);
          return ok({ ...p, name: clean });
        }),
      ),
    setGeneralDocument: (actor, id, generalDocumentId, opts = {}) =>
      db.transaction((tx) =>
        withProduct(tx, id, async (p) => {
          if (generalDocumentId && !(await gate.exists(generalDocumentId))) return notFound(`보통약관 템플릿 ${generalDocumentId}`);
          const changes = p.generalDocumentId !== generalDocumentId;
          // 조 노출·오버라이드는 템플릿의 노드에 매달린 설정이다 — 교체(해제 포함)면 **둘 다** 초기화된다.
          // 잃는 것이 있으면 세어 확인부터 받는다 (기능/상품 §3 「보통약관」).
          if (changes) {
            const [hidden, overrides] = await Promise.all([repo.listHiddenArticles(tx, id), repo.listOverrides(tx, { kind: "product", id })]);
            if (!opts.confirm && hidden.length + overrides.length > 0) {
              const cascade = [...(hidden.length > 0 ? [`숨긴 조 ${hidden.length}`] : []), ...(overrides.length > 0 ? [`옵션 오버라이드 ${overrides.length}`] : [])];
              return reject({ reason: "needsConfirmation", impact: { valueRowsLost: 0, brokenRefs: [], cascade } });
            }
          }
          const { generalDocumentId: _old, ...rest } = p;
          void _old;
          const next = generalDocumentId ? { ...rest, generalDocumentId } : rest;
          // 여기부터가 쓰기다 — `dryRun` 은 판정만 받고 멈춘다 (화면의 확인 카드가 쓰는 길).
          if (opts.dryRun) return ok(next);
          if (changes) {
            // 같은 트랜잭션에서 비우고 바꾼다 — 한쪽만 비워진 상태로 끝나지 않는다.
            await repo.clearHiddenArticles(tx, id);
            await repo.deleteOverridesOf(tx, { kind: "product", id });
          }
          await repo.updateProduct(tx, id, { generalDocumentId: generalDocumentId ?? null }, actor.userId);
          return ok(next);
        }),
      ),
    listHiddenArticles: (productId) => repo.listHiddenArticles(db, productId),
    /**
     * 조회(상품 · 템플릿의 조 id)와 쓰기를 **한 트랜잭션**에서 한다 — 사이에 템플릿이 바뀌면
     * 새 템플릿을 쓰는 상품에 옛 조의 숨김 행이 남는다 (코덱스 리뷰 2026-09-15 Minor-1).
     * 게이트는 문서 서비스를 거치지만 문맥 DB(`txContext`)가 열린 tx 를 그대로 태우므로 교착하지 않는다
     * (교착하는 것은 원시 DB 핸들을 따로 주입한 경우다 — 그런 주입은 문맥 DB 로 바꾼다).
     */
    setArticleHidden: (actor, productId, articleId, hidden) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async (p) => {
          if (!p.generalDocumentId) {
            return invalid([issue("typeMismatch", "보통약관 템플릿을 먼저 고르세요 — 숨길 조가 없습니다", { document: "product", ownerId: productId })]);
          }
          const ids = await gate.articleIds(p.generalDocumentId);
          if (!ids.includes(articleId)) return notFound(`보통약관 템플릿 ${p.generalDocumentId} 의 조 ${articleId}`);
          if (hidden) await repo.addHiddenArticle(tx, productId, articleId, actor.userId);
          else await repo.removeHiddenArticle(tx, productId, articleId);
          return ok(undefined);
        }),
      ),
    deleteProduct: (actor, id, opts = {}) =>
      db.transaction(async (tx) => {
        let owners: ValueOwner[] = [];
        let cascade: string[] = [];
        let coverages: ProductCoverage[] = [];
        return destructive<void>({
          actor,
          action: "product.delete",
          confirm: opts.confirm,
          precheck: () =>
            withProduct(tx, id, async () => {
              coverages = await repo.listProductCoverages(tx, id);
              const options = await repo.listPlanOptions(tx, id);
              const groups = await repo.listGroups(tx, id);
              owners = [{ kind: "product", id }, ...options.map<ValueOwner>((o) => ({ kind: "plan", id: o.id }))];
              for (const c of coverages) owners.push(...(await snapshotOwners(tx, c.id)).map((s) => s.owner));
              cascade = [...coverages.map((c) => `상품담보 ${c.name}`), ...options.map((o) => `세목 선택지 ${planOptionLabel(o)}`), ...groups.map((g) => `그룹 ${g.title}`)];
              return ok(undefined);
            }),
          computeImpact: async () => ({ valueRowsLost: await countSlots(tx, owners), brokenRefs: [], cascade }),
          execute: async () => {
            for (const o of owners) await clearOwner(tx, o);
            await repo.deleteOverridesOf(tx, { kind: "product", id });
            await repo.deleteProduct(tx, id);
            return ok(undefined);
          },
        });
      }),
    setProductValue: (actor, id, path, value) =>
      db.transaction((tx) => withProduct(tx, id, () => writeChecked(tx, actor, { kind: "product", id }, path, value))),
    setProductValues: (actor, id, entries) =>
      db.transaction((tx) => withProduct(tx, id, () => writeAllChecked(tx, actor, { kind: "product", id }, entries))),
    getProductValues: (id) => readSlots(db, { kind: "product", id }),
    productMissing: async (id) => (await productCompletenessOf(id)).missing,
    productCompleteness: (id) => productCompletenessOf(id),

    // 세목
    listPlanOptions: (productId) => repo.listPlanOptions(db, productId),
    addPlanOption: (actor, productId, input) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          const issues = [...validatePlanType(input.planTypeCode), ...validateNewPlanOption(input, await repo.listPlanOptions(tx, productId))];
          if (issues.length > 0) return invalid(issues);
          return ok(await repo.insertPlanOption(tx, productId, { ...input, name: input.name.trim() }, actor.userId));
        }),
      ),
    updatePlanOption: (actor, optionId, patch) =>
      db.transaction(async (tx) => {
        const o = await repo.loadPlanOption(tx, optionId);
        if (!o) return notFound(`세목 선택지 ${optionId}`);
        const next = { ...o, ...patch };
        const issues = validateNewPlanOption(next, await repo.listPlanOptions(tx, o.productId), o.id);
        if (issues.length > 0) return invalid(issues);
        await repo.updatePlanOption(tx, optionId, { number: next.number, name: next.name.trim() }, actor.userId);
        return ok({ ...next, name: next.name.trim() });
      }),
    removePlanOption: (actor, optionId, opts = {}) => {
      let option: PlanOption | undefined;
      let plans: ProductPlan[] = [];
      return planDestructive(
        actor,
        opts,
        async (tx) => {
          option = await repo.loadPlanOption(tx, optionId);
          if (!option) return notFound(`세목 선택지 ${optionId}`);
          const ids = new Set(await repo.listPlansUsingOption(tx, optionId));
          plans = (await repo.listPlans(tx, option.productId)).filter((p) => ids.has(p.id));
          return ok(undefined);
        },
        async (tx) => {
          const cascade: string[] = [];
          for (const p of plans) {
            cascade.push(`상품세목 ${planCombinationLabel(p.options)}`);
            for (const c of await repo.listCoveragesAttachingPlan(tx, p.id)) cascade.push(`세목 부착 ${c.name}`);
          }
          return { valueRowsLost: await countSlots(tx, [{ kind: "plan", id: optionId }]), brokenRefs: [], cascade };
        },
        async (tx) => {
          for (const p of plans) await repo.deletePlan(tx, p.id);
          await clearOwner(tx, { kind: "plan", id: optionId });
          await repo.deletePlanOption(tx, optionId);
        },
      );
    },
    setPlanOptionValue: (actor, optionId, path, value) => setPlanOptionValues(actor, optionId, [{ path, value }]),
    setPlanOptionValues,
    getPlanOptionValues: (optionId) => readSlots(db, { kind: "plan", id: optionId }),
    listPlans: (productId) => repo.listPlans(db, productId),
    registerPlan: (actor, productId, optionIds) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          const r = validatePlanCombination(optionIds, await repo.listPlanOptions(tx, productId), await repo.listPlans(tx, productId));
          if (!r.ok) return r as Result<ProductPlan>;
          const ids = r.value.map((o) => o.id);
          return ok(await repo.insertPlan(tx, productId, planCombinationKey(ids), ids, actor.userId));
        }),
      ),
    removePlan: (actor, planId, opts = {}) =>
      planDestructive(
        actor,
        opts,
        async (tx) => ((await repo.loadPlan(tx, planId)) ? ok(undefined) : notFound(`상품세목 ${planId}`)),
        async (tx) => ({ valueRowsLost: 0, brokenRefs: [], cascade: (await repo.listCoveragesAttachingPlan(tx, planId)).map((c) => `세목 부착 ${c.name}`) }),
        (tx) => repo.deletePlan(tx, planId),
      ),

    // 상품담보
    mount: (actor, productId, coverageId, selections, section = "special") =>
      db.transaction((tx) =>
        withProduct(tx, productId, async (product) => {
          const tree = await master.tree(coverageId);
          if (!tree) return notFound(`담보 마스터 ${coverageId}`);
          // 기본계약으로 탑재 = 탑재 + 지정 — 지정 규칙(MVP 정확히 1개)을 먼저 본다. 상품담보를 만들고 나서 거부하면 반쪽이 남는다.
          if (section === "base") {
            const blocked = baseContractDesignationIssues((await repo.listBaseContractIds(tx, productId)).length, product);
            if (blocked.length > 0) return invalid(blocked);
          }
          const kinds = await repo.listAttributeKinds(tx);
          const issues = validateSelections(selections, kinds);
          if (issues.length > 0) return invalid(issues);
          const attributes = normalizeSelections(selections, kinds);
          const key = combinationKey(coverageId, attributes);
          if (await repo.findByCombination(tx, productId, key)) return reject({ reason: "duplicate", what: `상품담보 조합 ${tree.name} × ${attributes.map((a) => `${a.kindCode}=${a.valueCode}`).join(",") || "(속성 없음)"}` });
          const pc = await repo.insertProductCoverage(tx, { productId, coverageId, coverageName: tree.name, name: defaultCoverageName(tree.name, attributes, kinds, await repo.loadNamingTemplate(tx)), attributes, combinationKey: key }, actor.userId);
          if (section === "base") await repo.insertBaseContract(tx, productId, pc.id, actor.userId);
          // 값 스냅샷 (ADR-0002): 담보 → 세부보장 → 급부
          await snapshotFrom(tx, { kind: "coverage", id: coverageId }, { kind: "productCoverage", id: pc.id }, actor.userId);
          for (const sub of tree.subCoverages) {
            const s = await repo.insertNode(tx, { productCoverageId: pc.id, kind: "sub", masterNodeId: sub.id, name: sub.name, order: sub.order }, actor.userId);
            await snapshotFrom(tx, { kind: "subCoverage", id: sub.id }, { kind: "productSubCoverage", id: s.id }, actor.userId);
            for (const b of sub.benefits) {
              const bn = await repo.insertNode(tx, { productCoverageId: pc.id, kind: "benefit", masterNodeId: b.id, parentId: s.id, name: b.name, order: b.order }, actor.userId);
              await snapshotFrom(tx, { kind: "benefit", id: b.id }, { kind: "productBenefit", id: bn.id }, actor.userId);
            }
          }
          return ok(pc);
        }),
      ),
    getProductCoverage: (id) => repo.loadProductCoverage(db, id),
    listProductCoverages: (productId) => repo.listProductCoverages(db, productId),
    getSnapshot: (id) => withCoverage(db, id, async (pc) => ok(await snapshotOf(db, pc))),
    listSnapshots: (productId) => snapshotsOf(db, productId),
    getSnapshotValues: async (id) => {
      const out = new Map<Id, Map<SlotPath, ValueSlot>>();
      for (const { owner } of await snapshotOwners(db, id)) out.set(owner.id, await readSlots(db, owner));
      return out;
    },
    setSnapshotValue: (actor, id, owner, path, value) => setSnapshotValues(actor, id, owner, [{ path, value }]),
    setSnapshotValues,
    renameProductCoverage: (actor, id, name) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const clean = cleanName(name);
          if (!clean) return invalid([issue("typeMismatch", "상품담보명은 비울 수 없습니다", { document: "special", ownerId: id })]);
          await repo.updateProductCoverage(tx, id, { name: clean }, actor.userId);
          return ok({ ...pc, name: clean });
        }),
      ),
    regenerateName: (actor, id) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const name = defaultCoverageName((await repo.coverageNameOf(tx, id)) ?? "", pc.attributes, await repo.listAttributeKinds(tx), await repo.loadNamingTemplate(tx));
          await repo.updateProductCoverage(tx, id, { name }, actor.userId);
          return ok({ ...pc, name });
        }),
      ),
    setAttributes: (actor, id, selections, opts = {}) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const kinds = await repo.listAttributeKinds(tx);
          const issues = validateSelections(selections, kinds);
          if (issues.length > 0) return invalid(issues);
          const attributes = normalizeSelections(selections, kinds);
          const key = combinationKey(pc.coverageId, attributes);
          const dup = await repo.findByCombination(tx, pc.productId, key);
          if (dup && dup !== id) return reject({ reason: "duplicate", what: `상품담보 조합 ${key}` });
          const name = opts.regenerateName ? defaultCoverageName((await repo.coverageNameOf(tx, id)) ?? "", attributes, kinds, await repo.loadNamingTemplate(tx)) : pc.name;
          await repo.updateProductCoverage(tx, id, { attributes, combinationKey: key, name }, actor.userId);
          return ok({ ...pc, attributes, name });
        }),
      ),
    syncStructure: (id) => db.transaction((tx) => withCoverage(tx, id, (pc) => syncStructureIn(tx, pc))),
    syncStructureIn: (tx, id, who) => withCoverage(tx, id, (pc) => syncStructureIn(tx, pc, who)),
    unmount: (actor, id, opts = {}) =>
      db.transaction(async (tx) => {
        let owners: SnapshotOwner[] = [];
        let cascade: string[] = [];
        return destructive<void>({
          actor,
          action: "product.unmount",
          confirm: opts.confirm,
          precheck: () =>
            withCoverage(tx, id, async (pc) => {
              if (await repo.isBaseContract(tx, id)) return invalid([issue("brokenRef", `「${pc.name}」 은(는) 기본계약입니다 — 지정을 먼저 해제하세요 (D-P5-7)`, { document: "special", ownerId: id, ownerName: pc.name })]);
              const snaps = await snapshotOwners(tx, id);
              owners = snaps.map((s) => s.owner);
              const plans = await repo.listAttachedPlanIds(tx, id);
              cascade = [
                ...snaps.filter((s) => s.node).map((s) => `${s.node!.kind === "sub" ? "세부보장" : "급부"} ${s.node!.name}`),
                ...(plans.length ? [`세목 부착 ${plans.length}건`] : []),
                ...((await repo.groupOf(tx, id)) ? ["그룹 배치"] : []),
              ];
              return ok(undefined);
            }),
          computeImpact: async () => ({ valueRowsLost: await countSlots(tx, owners), brokenRefs: [], cascade }),
          execute: async () => {
            for (const o of owners) await clearOwner(tx, o);
            await repo.deleteProductCoverage(tx, id);
            return ok(undefined);
          },
        });
      }),
    coverageMissing: async (id) => {
      const pc = await repo.loadProductCoverage(db, id);
      if (!pc) return [];
      const out: MissingSlot[] = [];
      for (const { owner, node } of await snapshotOwners(db, id)) {
        const slots = await readSlots(db, owner);
        out.push(...missingSlotsOf(owner, node ? node.name : pc.name, LEVEL_OF[owner.kind], (p) => slots.get(p)));
      }
      return out;
    },
    coverageCompleteness: async (id) => {
      const pc = await repo.loadProductCoverage(db, id);
      if (!pc) return { total: 0, missing: [] };
      const missing: MissingSlot[] = [];
      let total = 0;
      for (const { owner, node } of await snapshotOwners(db, id)) {
        const slots = await readSlots(db, owner);
        const level = LEVEL_OF[owner.kind];
        // 안 연 여는 폼(감액·면책)의 자리는 분모에 안 든다 — 열어야 「자리」가 생긴다 (ADR-0065 §4)
        total += countedSlotsOf(level, (p) => slots.get(p)).length;
        missing.push(...missingSlotsOf(owner, node ? node.name : pc.name, level, (p) => slots.get(p)));
      }
      return { total, missing };
    },
    snapshotDrift: async (id) => {
      const pc = await repo.loadProductCoverage(db, id);
      if (!pc) return 0;
      const nodes = await repo.listNodes(db, id);
      const pairs: { snapshot: ValueOwner; master: { kind: "coverage" | "subCoverage" | "benefit"; id: Id } }[] = [
        { snapshot: { kind: "productCoverage", id }, master: { kind: "coverage", id: pc.coverageId } },
        ...nodes.map((n) => ({
          snapshot: { kind: n.kind === "sub" ? "productSubCoverage" : "productBenefit", id: n.id } as ValueOwner,
          master: { kind: n.kind === "sub" ? "subCoverage" : "benefit", id: n.masterNodeId } as { kind: "subCoverage" | "benefit"; id: Id },
        })),
      ];
      let changed = 0;
      for (const { snapshot, master: from } of pairs) {
        const mine = await readSlots(db, snapshot);
        if (mine.size === 0) continue;
        const theirs = master.masterSlots ? await master.masterSlots(from) : await readSlots(db, from);
        for (const [path, slot] of mine) {
          if (!slot.entered) continue;
          const origin = theirs.get(path);
          if (!origin?.entered || JSON.stringify(origin.value) !== JSON.stringify(slot.value)) changed += 1;
        }
      }
      return changed;
    },
    getSnapshotMasterValues: async (id) => {
      const pc = await repo.loadProductCoverage(db, id);
      const out = new Map<Id, Map<SlotPath, ValueSlot>>();
      if (!pc) return out;
      const nodes = await repo.listNodes(db, id);
      const pairs: { snapshotId: Id; from: { kind: "coverage" | "subCoverage" | "benefit"; id: Id } }[] = [
        { snapshotId: id, from: { kind: "coverage", id: pc.coverageId } },
        ...nodes.map((n) => ({
          snapshotId: n.id,
          from: { kind: n.kind === "sub" ? "subCoverage" : "benefit", id: n.masterNodeId } as { kind: "subCoverage" | "benefit"; id: Id },
        })),
      ];
      for (const { snapshotId, from } of pairs) {
        out.set(snapshotId, master.masterSlots ? await master.masterSlots(from) : await readSlots(db, from));
      }
      return out;
    },
    attachPlan: (actor, id, planId) =>
      db.transaction((tx) =>
        withCoverage(tx, id, async (pc) => {
          const plan = await repo.loadPlan(tx, planId);
          if (!plan || plan.productId !== pc.productId) return notFound(`상품세목 ${planId}`);
          await repo.attachPlan(tx, id, planId, actor.userId);
          return ok(undefined);
        }),
      ),
    detachPlan: (actor, id, planId, opts = {}) =>
      planDestructive(
        actor,
        opts,
        async (tx) => ((await repo.listAttachedPlanIds(tx, id)).includes(planId) ? ok(undefined) : notFound(`상품담보 ${id} 의 세목 부착 ${planId}`)),
        async () => ({ valueRowsLost: 0, brokenRefs: [], cascade: [] }),
        (tx) => repo.detachPlan(tx, id, planId),
      ),
    listAttachedPlans: async (id) => {
      const ids = await repo.listAttachedPlanIds(db, id);
      const plans: ProductPlan[] = [];
      for (const pid of ids) {
        const p = await repo.loadPlan(db, pid);
        if (p) plans.push(p);
      }
      return plans;
    },

    // 기본계약
    designateBaseContract: (actor, productId, productCoverageId) =>
      db.transaction((tx) =>
        withProduct(tx, productId, (product) =>
          withCoverage(tx, productCoverageId, async (pc) => {
            if (pc.productId !== productId) return notFound(`상품 ${productId} 의 상품담보 ${productCoverageId}`);
            // 이미 기본계약이 있으면 거부 — 같은 상품담보의 재지정도 (기능/상품 §3 「기본계약」 · MVP 정확히 1개)
            // DB 유일성 제약 없음 — pg 드라이버 도입 시 부분 유일 인덱스 검토 (기존 2행 데이터가 있어 지금 마이그레이션은 못 건다)
            const blocked = baseContractDesignationIssues((await repo.listBaseContractIds(tx, productId)).length, product);
            if (blocked.length > 0) return invalid(blocked);
            if (!product.generalDocumentId) return invalid([issue("brokenRef", "보통약관 템플릿이 선택되지 않았습니다", { document: "product", ownerId: productId })]);
            await repo.insertBaseContract(tx, productId, productCoverageId, actor.userId);
            await repo.removeMember(tx, productCoverageId);
            return checkOne(tx, product, pc); // 부착 검사 — 실패는 거부가 아니라 오류 목록 (D-P5-13)
          }),
        ),
      ),
    listBaseContractIds: (productId) => repo.listBaseContractIds(db, productId),
    releaseBaseContract: (actor, productId, productCoverageId) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async () => {
          void actor;
          if (!(await repo.listBaseContractIds(tx, productId)).includes(productCoverageId)) return notFound(`기본계약 ${productCoverageId}`);
          await repo.deleteBaseContract(tx, productId, productCoverageId);
          return ok(undefined);
        }),
      ),
    checkBaseContract: (productId) =>
      withProduct(db, productId, async (product) => {
        const ids = await repo.listBaseContractIds(db, productId);
        // 0 · 2+ 판정은 도메인 한 곳 — 조립(booklet) 과 같은 문구·좌표(refPath baseContract → 보통약관 탭 링크)
        const countIssue = baseContractCountIssue(ids.length, product);
        if (countIssue) return invalid([countIssue]);
        const checks: BaseContractCheck[] = [];
        for (const id of ids) {
          const pc = await repo.loadProductCoverage(db, id);
          if (!pc) continue;
          const r = await checkOne(db, product, pc);
          if (!r.ok) return r as Result<BaseContractCheck[]>;
          checks.push(r.value);
        }
        return ok(checks);
      }),

    // 특약 그룹
    listGroups: (productId) => groupViews(db, productId),
    createGroup: (actor, productId, input) =>
      db.transaction((tx) =>
        withProduct(tx, productId, async (p) => {
          const title = cleanName(input.title);
          if (!title) return invalid([issue("typeMismatch", "그룹 제목은 비울 수 없습니다")]);
          const issues = validateGroupTemplate(input.generalDocumentId, p.generalDocumentId);
          if (issues.length > 0) return invalid(issues);
          const order = (await repo.listGroups(tx, productId)).reduce((m, g) => Math.max(m, g.order + 1), 0);
          return ok(await repo.insertGroup(tx, productId, title, order, input.generalDocumentId, actor.userId));
        }),
      ),
    renameGroup: (actor, groupId, title) =>
      db.transaction(async (tx) => {
        const g = await repo.loadGroup(tx, groupId);
        if (!g) return notFound(`그룹 ${groupId}`);
        const clean = cleanName(title);
        if (!clean) return invalid([issue("typeMismatch", "그룹 제목은 비울 수 없습니다")]);
        await repo.updateGroup(tx, groupId, { title: clean }, actor.userId);
        return ok({ ...g, title: clean });
      }),
    reorderGroups: (actor, productId, order) =>
      db.transaction(async (tx) => {
        const groups = await repo.listGroups(tx, productId);
        const ids = new Set(groups.map((g) => g.id));
        if (order.length !== ids.size || new Set(order).size !== order.length || order.some((id) => !ids.has(id))) {
          return invalid([issue("typeMismatch", "그룹 순서는 상품의 모든 그룹 id 를 한 번씩 담아야 합니다")]);
        }
        const byId = new Map(groups.map((g) => [g.id, g]));
        const out: SpecialGroup[] = [];
        for (const [i, id] of order.entries()) {
          await repo.updateGroup(tx, id, { order: i }, actor.userId);
          out.push({ ...byId.get(id)!, order: i });
        }
        return ok(out);
      }),
    deleteGroup: (actor, groupId) =>
      db.transaction(async (tx) => {
        void actor;
        if (!(await repo.loadGroup(tx, groupId))) return notFound(`그룹 ${groupId}`);
        await repo.deleteGroup(tx, groupId); // 소속은 cascade — 상품담보는 미배치로 돌아간다 (값 손실 없음)
        return ok(undefined);
      }),
    placeInGroup: (actor, groupId, productCoverageId) =>
      db.transaction(async (tx) => {
        void actor;
        const g = await repo.loadGroup(tx, groupId);
        if (!g) return notFound(`그룹 ${groupId}`);
        return withCoverage(tx, productCoverageId, async (pc) => {
          if (pc.productId !== g.productId) return notFound(`상품 ${g.productId} 의 상품담보 ${productCoverageId}`);
          await repo.placeMember(tx, groupId, productCoverageId);
          return ok(undefined);
        });
      }),
    removeFromGroup: (actor, productCoverageId) =>
      db.transaction(async (tx) => {
        void actor;
        if (!(await repo.groupOf(tx, productCoverageId))) return notFound(`상품담보 ${productCoverageId} 의 그룹 배치`);
        await repo.removeMember(tx, productCoverageId);
        return ok(undefined);
      }),
    listUnplaced: async (productId) => {
      const placed = new Set([...(await repo.listMembersByGroup(db, productId)).values()].flat());
      return (await repo.listProductCoverages(db, productId)).filter((c) => !placed.has(c.id));
    },

    // 옵션 오버라이드
    setOptionOverride: (actor, scope, nodeId, clauseCode, options) =>
      db.transaction(async (tx) => {
        const p = await repo.loadProduct(tx, scope.id);
        if (!p) return notFound(`상품 ${scope.id}`);
        if (!p.generalDocumentId) return notFound(`상품 ${scope.id} 의 보통약관 템플릿`);
        // 오버라이드는 「그 자리의 마스터 선택에 얹는 차이」다 — 자리를 먼저 찾아 마스터를 읽는다.
        const ref = await gate.clauseRef(p.generalDocumentId, nodeId);
        if (!ref) return notFound(`보통약관 템플릿 ${p.generalDocumentId} 의 공용조항 참조 ${nodeId}`);
        // 그 자리의 공용조항과 **다른 코드**로 온 행은 받지 않는다 — 조립은 오버라이드를 `nodeId` 로만 얹으므로
        // (`domain/assembly/booklet.ts`) 어긋난 코드로 저장된 선택이 그 자리에 조용히 적용된다 (코덱스 리뷰 후속).
        if (ref.clauseCode !== clauseCode) return notFound(`보통약관 템플릿 ${p.generalDocumentId} 의 자리 ${nodeId} 에 걸린 공용조항 ${clauseCode}`);
        // 검사는 **합친 결과**로 한다 — 부분 선택(한 옵션만 바꾸기)이 미선택으로 거부되지 않도록 (Important-1).
        // clauseCode 자체의 유효성(없는 공용조항)은 검증기가 본다.
        const merged = { ...ref.options, ...options };
        const issues = await optionValidator.validate(clauseCode, merged);
        if (issues.length > 0) return invalid(issues);
        // 저장은 **차이만** — 마스터와 같은 키는 남기지 않는다. 전부 같으면 행 자체를 지운다.
        const diff = Object.fromEntries(Object.entries(merged).filter(([code, value]) => ref.options[code] !== value));
        if (Object.keys(diff).length === 0) {
          await repo.deleteOverride(tx, scope, nodeId, clauseCode);
          return ok(undefined);
        }
        return ok(await repo.upsertOverride(tx, scope, nodeId, clauseCode, diff, actor.userId));
      }),
    listOptionOverrides: (scope) => repo.listOverrides(db, scope),
    removeOptionOverride: (actor, scope, nodeId, clauseCode) =>
      db.transaction(async (tx) => {
        void actor;
        const found = (await repo.listOverrides(tx, scope)).some((o) => o.nodeId === nodeId && o.clauseCode === clauseCode);
        if (!found) return notFound(`옵션 오버라이드 ${clauseCode}@${nodeId}`);
        await repo.deleteOverride(tx, scope, nodeId, clauseCode);
        return ok(undefined);
      }),
  };
}
