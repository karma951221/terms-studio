/**
 * 조립 서비스 — 재료를 「공유 마스터 / 상품 고유분」으로 나눠 읽고 순수 조립기 `assemble(master, product)` 를 돌린다 (ADR-0034).
 *
 *   loadMaster()                          공유 마스터 적재 — 구분자 · enum · 담보속성 종류 · 함수조항 · 별표 · 문서 전체 (실행당 1회)
 *   loadProduct(productId, master)        상품 고유분 적재 — 상품 · 세목 선택지 · 상품담보 스냅샷/값/부착 · 그룹 · 오버라이드 · 숨긴 조 (상품당 상수 쿼리)
 *   loadAssemblyInput(productId)          호환 — 위 둘을 한 객체로
 *   preview(productId)                    책자 조립 (매번 재계산 · 저장 없음)
 *   previewSpecial(productId, pcId)       상품담보 미리보기 (담보약관 하나를 그 탑재분 문맥으로)
 *   previewProducts(document)             문면 저작 화면 미리보기의 상품 목록 — 담보약관은 특약 탑재분, 보통약관은 그 템플릿을 쓰는 상품 (기능/문면 §3.9)
 *   previewMaterial(productId)            그 미리보기의 재료 — 공유 마스터(문서는 그 상품이 읽는 것만) + 상품 고유분. 조립은 브라우저가 `previewArticle` 로
 *   assembleMany(actor, productIds)       여러 상품을 마스터 1회 적재로 순서대로 조립 + 산출본 저장 — 다중이 원형이다 (ADR-0034 결정 1)
 *   run(actor, productId)                 = assembleMany 의 1건 (`product_previews` 상품당 1행 · 기능/조립산출 §3.6) — 편집자 가능 · 비파괴
 *   latest(productId)                     저장된 산출본 + 오래됨(`stale` — 입력 스탬프가 지금과 다름)
 *   executionBasedFilter(booklet)         실행 기반 완결성 필터 (도메인 re-export) — B1 `CoverageServiceDeps.completenessFilter` 에 꽂는다
 *
 * - 조립은 읽기 전용이다 — 트랜잭션을 열지 않고 스냅샷 구조 동기화(`product.syncStructure`)도 부르지 않는다
 *   (미리보기가 DB 를 바꾸지 않는다). 마스터 구조가 바뀐 상품담보는 상품모델링 화면이 조회 전에 sync 한다.
 *   `run`/`assembleMany` 만 산출본 행을 쓴다 — 재료는 건드리지 않는다.
 * - **상품당 적재 쿼리 수는 상수다** (ADR-0034 결정 3): 노드 · 담보명 · 부착 세목 · 값(kind 별)을 상품 단위 일괄 조회로 읽는다.
 *   상품담보 · 세부보장 · 급부 수에 비례하는 루프는 두지 않는다 — 테스트가 카운터로 잰다.
 * - **결정적이다** (결정 4): 전역 상태 · 모듈 캐시 · 카운터 · 시각 · 난수를 쓰지 않는다. `generatedAt` 은 저장 메타일 뿐 `Booklet` 에 들어가지 않는다.
 * - 오래됨은 **입력 스탬프** 비교다 (repo/preview `assemblyInputStamp`): 스탬프는 상품마다 **적재 전에** 읽는다 (M09 규칙) —
 *   `assembleMany` 는 모든 상품의 스탬프를 마스터 적재보다 먼저 읽어, 마스터가 도중에 바뀌어도 다음 `latest` 에서 오래됨으로 드러난다.
 *   자동 재실행은 없다 (기능/조립산출 §3.6).
 * - `Booklet` 은 순수 데이터(Map/Set/Date 없음)라 jsonb 에 그대로 넣고 그대로 꺼낸다 — 변환 함수 없음.
 * - 서비스 조회 메서드에 없는 일괄 조회만 repo 로 직접 읽는다 (`readSlotsMany` · `listBaseContractIds` ·
 *   `listAttachedPlansForProduct` · `listDocumentRecords` · `listCoverageGroups`).
 * - 특약 그룹은 담보 마스터의 「특약 그룹」 열거값이라 공유 마스터로 싣는다(`coverageGroups`, ADR-0080).
 * - 세목 선택지는 **유효 조합에 등장하는 것**만 (기능/조립산출 §3.2) — 값은 `readSlotsMany(db, "plan", ids)` 한 번.
 * - 컨테이너(C1 동시 작업)는 쓰지 않는다 — 호출자가 서비스 5개를 넘긴다.
 */
import { assemble, assembleSpecial, type AssemblyCoverage, type AssemblyInput, type AssemblyPlanOption, type Booklet, type MasterBundle, type ProductInput, type SpecialPreview } from "@/domain/assembly";
import type { SlotPath } from "@/domain/catalog";
import type { DocumentNode } from "@/domain/document";
import { PLAN_AXES, type PlanOption } from "@/domain/product";
import type { Actor, Id, Result, ValueSlot } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import { listDocumentRecords } from "@/db/repo/document";
import { assemblyInputStamp, loadPreview, type PreviewGrade, savePreview } from "@/db/repo/preview";
import { listCoverageGroups } from "@/db/repo/coverage";
import { listAttachedPlansForProduct, listBaseContractIds, listProductsByGeneralDocument, listSpecialMountsOfCoverage } from "@/db/repo/product";
import type { Db } from "@/db/repo/types";
import { readSlotsMany } from "@/db/repo/values";
import type { CatalogService } from "./catalog";
import type { ClauseService } from "./clause";
import type { CoverageService } from "./coverage";
import type { DocumentService } from "./document";
import type { ProductService } from "./product";

export { executionBasedFilter } from "@/domain/assembly";
export type { AssemblyInput, Booklet, MasterBundle, ProductInput, SpecialPreview } from "@/domain/assembly";
export type { PreviewGrade } from "@/db/repo/preview";

/** 저장된 미리보기 산출본 — 화면이 보여 주는 넷(생성 시점 · 입력 기준 · 결과 등급 · 결과) (기능/조립산출 §3.6). */
export interface PreviewRecord {
  productId: Id;
  /** 조립이 끝난 시각. */
  generatedAt: Date;
  /** 실행한 사람 (users.id). 없으면 null. */
  generatedBy: Id | null;
  /** `ok` 완성본 · `withErrors` 오류포함 (= `!booklet.complete`). */
  grade: PreviewGrade;
  /** 생성 시점 이후 조립 재료가 바뀌었다 — 「오래된 결과」 배지 + 「다시 실행」. 방금 `run` 한 결과는 false. */
  stale: boolean;
  booklet: Booklet;
}

/** 문면 저작 화면 미리보기의 상품 한 줄 — 담보약관이면 그 특약 탑재분(상품담보)까지. */
export interface PreviewProduct {
  productId: Id;
  productName: string;
  productCoverageId?: Id;
  productCoverageName?: string;
}

/** 미리보기 대상 문서 — 담보약관은 그 담보, 보통약관은 그 템플릿. */
export type PreviewDocument = { kind: "special"; coverageId: Id } | { kind: "general"; documentId: Id };

/** 미리보기 재료 — 브라우저가 편집본으로 `previewArticle` 를 돌린다. Map · Set 은 서버 액션이 그대로 넘긴다. */
export interface PreviewMaterial {
  master: MasterBundle;
  product: ProductInput;
}

export interface AssemblyServices {
  catalog: CatalogService;
  coverage: CoverageService;
  clause: ClauseService;
  document: DocumentService;
  product: ProductService;
}

export interface AssemblyService {
  /** 공유 마스터 — 실행당 1회 읽어 여러 상품에 재사용한다. 쿼리 수 상수. */
  loadMaster(): Promise<MasterBundle>;
  /** 상품 고유분 — 보통약관 문면은 `master.generalDocuments` 에서 id 로 고른다 (없으면 미선택으로 본다). 쿼리 수는 상품담보 수와 무관. */
  loadProduct(productId: Id, master: MasterBundle): Promise<Result<ProductInput>>;
  /** 호환 — `{ ...loadMaster(), ...loadProduct() }`. */
  loadAssemblyInput(productId: Id): Promise<Result<AssemblyInput>>;
  preview(productId: Id): Promise<Result<Booklet>>;
  previewSpecial(productId: Id, productCoverageId: Id): Promise<Result<SpecialPreview>>;
  /** 문면 저작 화면 미리보기의 상품 목록 — 담보약관: 이 담보를 특약으로 탑재한 상품담보마다(기본계약 탑재 제외), 보통약관: 이 템플릿을 쓰는 상품. 이름 순. */
  previewProducts(document: PreviewDocument): Promise<PreviewProduct[]>;
  /** 그 상품의 조립 재료 — 공유 마스터의 문서는 그 상품이 읽는 것(보통약관 · 탑재 담보의 담보약관)만 싣는다. */
  previewMaterial(productId: Id): Promise<Result<PreviewMaterial>>;
  /**
   * 여러 상품을 순서대로 조립해 산출본을 저장한다 — 마스터는 1회 적재. 결과는 상품 id → 건별 결과 (입력 순 · 중복 id 는 한 번).
   * 한 건의 거부(없는 상품 등)나 예외(적재 · 조립 · 저장 중 throw)는 그 건만 `failed` 거부로 남고 나머지는 저장된다
   * (ADR-0034 결정 7 — 잡 러너 · 회차 요약은 MVP 이후).
   */
  assembleMany(actor: Actor, productIds: readonly Id[]): Promise<Map<Id, Result<PreviewRecord>>>;
  /** 조립해 산출본을 저장한다 (상품당 1행 덮어쓰기) — `assembleMany` 의 1건. 조립이 거부되면 저장하지 않고 그 거부를 돌려준다. */
  run(actor: Actor, productId: Id): Promise<Result<PreviewRecord>>;
  /** 저장된 산출본 — 없으면 undefined. `stale` 은 지금 스탬프와 저장 스탬프의 비교. */
  latest(productId: Id): Promise<PreviewRecord | undefined>;
}

export function createAssemblyService(db: Db, services: AssemblyServices): AssemblyService {
  const { catalog, clause, document, product } = services;

  async function loadMaster(): Promise<MasterBundle> {
    const [clauses, appendices, boxes, defs, enums, attributeKinds, docs, coverageGroups] = await Promise.all([
      clause.list(),
      document.listAppendices(),
      document.listBoxes(),
      catalog.list(),
      catalog.listEnums(),
      product.listAttributeKinds(),
      listDocumentRecords(db),
      listCoverageGroups(db),
    ]);
    // 문서는 통째로 1회 — 보통약관은 id 로, 담보약관은 담보 id 로 (담보 1 : 문서 1)
    const generalDocuments = new Map<Id, DocumentNode>();
    const specialDocuments = new Map<Id, DocumentNode>();
    for (const d of docs) {
      if (d.kind === "general") generalDocuments.set(d.id, d.tree);
      else if (d.ownerId) specialDocuments.set(d.ownerId, d.tree);
    }
    return { catalog: defs, enums, attributeKinds, clauses, appendices, boxes, generalDocuments, specialDocuments, coverageGroups };
  }

  /** 유효 조합에 등장하는 선택지 합집합 — 축 순(종 → 형) · 번호 순. 값은 한 번에 읽는다. */
  async function loadPlanOptions(productId: Id): Promise<AssemblyPlanOption[]> {
    const options = new Map<Id, PlanOption>();
    for (const plan of await product.listPlans(productId)) for (const o of plan.options) options.set(o.id, o);
    const sorted = [...options.values()].sort((a, b) => PLAN_AXES.indexOf(a.axis) - PLAN_AXES.indexOf(b.axis) || a.number - b.number);
    const values = await readSlotsMany(db, "plan", sorted.map((o) => o.id));
    return sorted.map((o) => ({ id: o.id, axis: o.axis, number: o.number, name: o.name, planTypeCode: o.planTypeCode, values: values.get(o.id) ?? new Map() }));
  }

  /** 탑재분 전부 — 스냅샷 · 값(kind 별 1회씩, 모든 탑재분의 노드 id 를 모아) · 부착 세목. 상품담보 수와 무관한 쿼리 수. */
  async function loadCoverages(productId: Id): Promise<AssemblyCoverage[]> {
    const [snapshots, plansByPc] = await Promise.all([product.listSnapshots(productId), listAttachedPlansForProduct(db, productId)]);
    const subIds = snapshots.flatMap((s) => s.subCoverages.map((x) => x.id));
    const benIds = snapshots.flatMap((s) => s.subCoverages.flatMap((x) => x.benefits.map((b) => b.id)));
    const [cov, sub, ben] = await Promise.all([
      readSlotsMany(db, "productCoverage", snapshots.map((s) => s.id)),
      readSlotsMany(db, "productSubCoverage", subIds),
      readSlotsMany(db, "productBenefit", benIds),
    ]);
    return snapshots.map((s) => {
      const values = new Map<Id, ReadonlyMap<SlotPath, ValueSlot>>();
      values.set(s.id, cov.get(s.id)!);
      for (const x of s.subCoverages) values.set(x.id, sub.get(x.id)!);
      for (const x of s.subCoverages) for (const b of x.benefits) values.set(b.id, ben.get(b.id)!);
      return { snapshot: s, values, plans: plansByPc.get(s.id) ?? [] };
    });
  }

  async function loadProduct(productId: Id, master: MasterBundle): Promise<Result<ProductInput>> {
    const p = await product.getProduct(productId);
    if (!p) return reject({ reason: "notFound", what: `상품 ${productId}` });

    const [coverages, baseContractIds, productValues, planOptions, definedPlanOptions, productOverrides, hiddenArticleIds, articleCopies] = await Promise.all([
      loadCoverages(productId),
      listBaseContractIds(db, productId),
      product.getProductValues(productId),
      loadPlanOptions(productId),
      product.listPlanOptions(productId),
      product.listOptionOverrides({ kind: "product", id: productId }),
      product.listHiddenArticles(productId),
      product.listArticleCopies(productId),
    ]);
    // 가리키는 문서가 마스터에 없으면 「템플릿 미선택」과 같다 — id 를 싣지 않는다
    const generalDocumentId = p.generalDocumentId && master.generalDocuments.has(p.generalDocumentId) ? p.generalDocumentId : undefined;

    return ok({
      product: {
        id: p.id,
        name: p.name,
        values: productValues,
        planOptions,
        planOptionCount: definedPlanOptions.length,
        baseContractIds,
        ...(generalDocumentId ? { generalDocumentId } : {}),
        overrides: productOverrides,
        hiddenArticleIds: new Set(hiddenArticleIds),
        // 조 사본 (ADR-0079) — 템플릿에 자리가 없는 사본은 조립이 쓰지 않는다(generalDocumentOf)
        ...(articleCopies.length > 0 ? { articleCopies: new Map(articleCopies.map((c) => [c.articleId, c.article] as const)) } : {}),
      },
      coverages,
    });
  }

  async function loadAssemblyInput(productId: Id): Promise<Result<AssemblyInput>> {
    const master = await loadMaster();
    const input = await loadProduct(productId, master);
    return input.ok ? ok({ ...master, ...input.value }) : (input as Result<never>);
  }

  async function assembleMany(actor: Actor, productIds: readonly Id[]): Promise<Map<Id, Result<PreviewRecord>>> {
    // 스탬프는 어느 적재보다 **먼저** (M09 규칙) — 마스터를 한 번만 읽으므로 상품마다 마스터 적재 직전에 읽을 수 없다.
    // 그래서 전 상품의 스탬프를 마스터 적재보다 앞서 읽는다: 그 뒤 바뀐 재료(마스터든 고유분이든)는 다음 latest 에서 오래됨으로 드러난다.
    // 스탬프 수집도 건별 격리 (결정 7) — 한 건의 스탬프 조회 예외(uuid 가 아닌 id 등)는 그 건의 failed 거부이고 나머지는 돈다.
    const ids = [...new Set(productIds)];
    const stamps = new Map<Id, Result<string>>();
    for (const productId of ids) {
      try {
        stamps.set(productId, ok(await assemblyInputStamp(db, productId)));
      } catch (e) {
        stamps.set(productId, failedWith(e));
      }
    }
    const master = await loadMaster();
    const out = new Map<Id, Result<PreviewRecord>>(); // 입력 순서 그대로
    for (const productId of ids) {
      const stamp = stamps.get(productId)!;
      out.set(productId, stamp.ok ? await assembleOne(actor, productId, master, stamp.value) : (stamp as Result<never>));
    }
    return out;
  }

  const failedWith = (e: unknown): Result<never> => reject({ reason: "failed", message: e instanceof Error ? e.message : String(e) });

  /** 한 건 — 적재 → 조립 → 저장. 예외는 이 건의 `failed` 거부로 바꾼다 (회차가 죽지 않는다). */
  async function assembleOne(actor: Actor, productId: Id, master: MasterBundle, inputStamp: string): Promise<Result<PreviewRecord>> {
    try {
      const input = await loadProduct(productId, master);
      if (!input.ok) return input as Result<never>;
      const booklet = assemble(master, input.value);
      const row = { productId, generatedAt: new Date(), generatedBy: actor.userId, inputStamp, grade: (booklet.complete ? "ok" : "withErrors") as PreviewGrade, booklet };
      await savePreview(db, row);
      const { inputStamp: _s, ...rest } = row;
      void _s;
      return ok({ ...rest, stale: false });
    } catch (e) {
      return failedWith(e);
    }
  }

  return {
    loadMaster,
    loadProduct,
    loadAssemblyInput,
    preview: async (productId) => {
      const master = await loadMaster();
      const input = await loadProduct(productId, master);
      return input.ok ? ok(assemble(master, input.value)) : (input as Result<never>);
    },
    previewSpecial: async (productId, productCoverageId) => {
      const master = await loadMaster();
      const input = await loadProduct(productId, master);
      return input.ok ? assembleSpecial(master, input.value, productCoverageId) : (input as Result<never>);
    },
    previewProducts: async (target) => {
      if (target.kind === "general") return (await listProductsByGeneralDocument(db, target.documentId)).map((p) => ({ productId: p.id, productName: p.name }));
      return (await listSpecialMountsOfCoverage(db, target.coverageId)).map((pc) => ({ productId: pc.productId, productName: pc.productName, productCoverageId: pc.id, productCoverageName: pc.name }));
    },
    previewMaterial: async (productId) => {
      const master = await loadMaster();
      const input = await loadProduct(productId, master);
      if (!input.ok) return input as Result<never>;
      // 브라우저로 보내는 재료 — 다른 상품의 문서는 이 조립이 읽지 않는다
      const generalId = input.value.product.generalDocumentId;
      const coverageIds = new Set(input.value.coverages.map((c) => c.snapshot.coverageId));
      return ok({
        master: {
          ...master,
          generalDocuments: new Map([...master.generalDocuments].filter(([id]) => id === generalId)),
          specialDocuments: new Map([...master.specialDocuments].filter(([id]) => coverageIds.has(id))),
        },
        product: input.value,
      });
    },
    assembleMany,
    run: async (actor, productId) => (await assembleMany(actor, [productId])).get(productId)!,
    latest: async (productId) => {
      const row = await loadPreview(db, productId);
      if (!row) return undefined;
      const { inputStamp, ...rest } = row;
      return { ...rest, stale: inputStamp !== (await assemblyInputStamp(db, productId)) };
    },
  };
}
