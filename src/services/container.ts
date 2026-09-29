/**
 * 조립 루트 (composition root) — 모든 서비스를 실제 주입 구현으로 연결해 한 벌로 만든다.
 *
 * 연결 (공통/기술/아키텍처 「경계와 책임」 · 각 서비스 파일 머리말):
 * - catalog  ← ImpactSource = `catalogImpactSource` (값 저장소 + refs 그래프 역조회) · attributeValues = 담보속성 유효값 ·
 *              graph = refs 그래프 (「검사」의 깨질 사용처)
 * - coverage ← UsageSource = `coverageUsageSource` (노드 삭제의 문면 사용처) · MountSync = product.syncStructureIn (구조 정정 뒤 탑재 스냅샷)
 * - clause   ← UsageSource = `clauseUsageSource` (참조 문서)
 * - document ← ClauseGate = 공용조항 정의(존재·요구 구분자·옵션 검증) · TypeResolver = 카탈로그 정의 + 담보속성 유효값 ·
 *              UsageSource = `documentUsageSource` (상품 템플릿 · 담보 문서 연결 · 옵션 오버라이드 · 공용조항의 별표 참조)
 * - product  ← CoverageMasterSource = coverage.get (구조적 상위집합) · GeneralDocumentGate = document.get 이 general 인가 ·
 *              GeneralAttachmentCheck = document.requiredDiscriminators + 카탈로그 레벨 ·
 *              OptionValidator = clause 정의의 validateOptionSelection · AttributeRefSource = `attributeRefSource`
 * - refs     ← 그래프 서비스 (관계정보 · 무결성)
 * - master   ← refs 그래프(필드 → 구분자 → 문면) · catalog · coverage · product 의 조회 (읽기 전용 · 사용처 패널)
 * - assembly ← 위 서비스들의 조회 메서드 (읽기 전용 · 매번 재계산)
 *
 * 트랜잭션: 서비스마다 자기 트랜잭션을 열고 주입 소스를 그 안에서 부른다. PGlite 는 단일 연결이라 소스가 바깥 핸들로
 * 쿼리하면 교착하므로, 모든 서비스·소스에 `contextualDb()` 프록시를 넘긴다 (txContext.ts) — 열린 tx 를 자동으로 탄다.
 *
 * 순환 의존(clause ↔ coverage · clause → product · coverage ↔ product)은 지연 참조로 푼다 — 주입 객체가 호출 시점에 `services.*` 를 본다.
 */
import type { Discriminator } from "@/domain/catalog";
import { validateOptionSelection } from "@/domain/clause";
import { catalogTypeResolver, clauseGateFrom, indexTree, type ClauseGate } from "@/domain/document";
import { checkTypes, parse, type TypeResolver } from "@/domain/expression";
import type { RequiredCoverageRef } from "@/domain/product";
import type { Code, Id } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as clauseRepo from "@/db/repo/clause";
import * as productRepo from "@/db/repo/product";
import type { Db } from "@/db/repo/types";

import { createAssemblyService, type AssemblyService } from "./assembly";
import { createAuthService, type AuthService, type AuthServiceOptions } from "./auth";
import { createCatalogService, type CatalogService } from "./catalog";
import { createClauseService, type ClauseService } from "./clause";
import { createCoverageService, type CoverageService } from "./coverage";
import { createDocumentService, type DocumentService } from "./document";
import { createMasterService, type MasterService } from "./master";
import { createProductService, type ProductService } from "./product";
import { attributeRefSource, catalogImpactSource, clauseUsageSource, coverageUsageSource, createRefsService, documentUsageSource, type RefsService } from "./refs";
import { contextualDb } from "./txContext";

export interface Services {
  /** 문맥 인식 Db — 서버 액션이 직접 repo 를 읽을 일이 있으면 이것을 쓴다. */
  db: Db;
  auth: AuthService;
  catalog: CatalogService;
  coverage: CoverageService;
  clause: ClauseService;
  document: DocumentService;
  product: ProductService;
  refs: RefsService;
  master: MasterService;
  assembly: AssemblyService;
}

export interface ContainerOptions {
  /** 노드·트리 id 발급 (테스트용 결정적 id). 기본 uuid. */
  newId?: () => Id;
  auth?: AuthServiceOptions;
}

// ───────────────────────────── 주입 구현 ─────────────────────────────

/**
 * 문서 검증용 공용조항 게이트 — 정의 존재 · 요구 구분자 · 옵션 선택 검증 (ADR-0010 · 기능/공용조항 §3.2).
 * `missingRequired` 는 검사 ② (a) 의 재료 — 요구 구분자를 카탈로그 목록과 대조한다 (기능/공용조항 §3.4).
 */
async function clauseGateOf(tx: Db): Promise<ClauseGate> {
  const [clauses, defs] = await Promise.all([clauseRepo.listClauses(tx), catalogRepo.listDiscriminators(tx)]);
  // 브라우저 편집본도 같은 정의로 같은 게이트를 만든다 (ADR-0074) — 구성은 도메인 한 벌
  return clauseGateFrom(clauses, defs.map((d) => d.code));
}

/** 식 타입 조회 — 카탈로그 정의 + 담보속성 카탈로그(`attr.X` 의 유효값). 없는 담보속성은 깨진 참조. */
async function typeResolverOf(tx: Db): Promise<TypeResolver> {
  const [defs, kinds] = await Promise.all([catalogRepo.listDiscriminators(tx), productRepo.listAttributeKinds(tx)]);
  const validValues = new Map(kinds.map((k) => [k.code, k.values.map((v) => v.code)]));
  return catalogTypeResolver(defs, (code) => validValues.get(code));
}

/**
 * 보통약관이 요구하는 담보 레벨 참조 (기능/조립산출 §3.2) — 문서의 요구 구분자를 카탈로그 레벨로 푼다.
 * 구분자는 식 하나라 펼칠 하위 구분자가 없다 (구분자 → 구분자 참조 금지 — ADR-0037).
 */
function requiredCoverageRefs(codes: readonly Code[], defs: readonly Discriminator[], generalDocumentId: Id): RequiredCoverageRef[] {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const out: RequiredCoverageRef[] = [];
  for (const code of new Set(codes)) {
    const def = byCode.get(code);
    if (!def) continue;
    if (def.level === "coverage" || def.level === "subCoverage" || def.level === "benefit") {
      out.push({ level: def.level, discriminatorCode: code, at: { document: "general", ownerId: generalDocumentId, refPath: code } });
    }
  }
  return out;
}

/** 담보속성 유효값 조회 — 구분자 식의 `attr.X = '값'` 리터럴 검사에 쓴다. */
async function attributeValuesOf(tx: Db): Promise<(kindCode: Code) => string[] | undefined> {
  const kinds = await productRepo.listAttributeKinds(tx);
  const map = new Map(kinds.map((k) => [k.code, k.values.map((v) => v.code)]));
  return (code) => map.get(code);
}

// ───────────────────────────── 조립 ─────────────────────────────

export function createServices(root: Db, opts: ContainerOptions = {}): Services {
  const db = contextualDb(root);
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  // 지연 참조 — 주입 객체는 호출 시점에 services 를 본다 (clause ↔ coverage · clause → product).
  const services = {} as Services;

  const refs = createRefsService(db);
  const catalog = createCatalogService(db, {
    impact: catalogImpactSource(db),
    attributeValues: () => attributeValuesOf(db),
    // 「검사」의 깨질 사용처 판정 — 문면 슬롯 · 조건식 간선을 그래프로 본다 (기능/구분자 §3.3)
    graph: refs.graph,
  });
  // 구조 정정 뒤 탑재 스냅샷 동기화 — product 가 coverage 를 마스터로 보므로 지연 참조 (coverage ↔ product).
  const coverage = createCoverageService(db, { usage: coverageUsageSource(db), newId, mountSync: { syncStructure: (tx, pcId, who) => services.product.syncStructureIn(tx, pcId, who) } });
  const clause = createClauseService(db, { usage: clauseUsageSource(db) });
  const document = createDocumentService(db, { clauseGate: clauseGateOf, typeResolver: typeResolverOf, usages: documentUsageSource(), newId });
  const product = createProductService(db, {
    coverageMaster: { tree: (id) => services.coverage.get(id) },
    generalDocuments: {
      exists: async (id) => (await services.document.get(id))?.kind === "general",
      articleIds: async (id) => {
        const doc = await services.document.get(id);
        return doc ? [...indexTree(doc.tree).nodes.values()].flatMap((e) => (e.node.kind === "article" ? [e.node.id] : [])) : [];
      },
      clauseRef: async (id, nodeId) => {
        const doc = await services.document.get(id);
        const node = doc && indexTree(doc.tree).nodes.get(nodeId)?.node;
        if (!node || (node.kind !== "clauseBlockRef" && node.kind !== "clauseInlineRef")) return undefined;
        return { clauseCode: node.clauseCode, options: node.options };
      },
    },
    generalAttachment: {
      requiredRefs: async (generalDocumentId) => {
        const [codes, defs] = [await services.document.requiredDiscriminators(generalDocumentId), await services.catalog.list()];
        return requiredCoverageRefs(codes, defs, generalDocumentId);
      },
    },
    optionValidator: {
      validate: async (clauseCode, options) => {
        const def = await services.clause.get(clauseCode);
        if (!def) return [{ kind: "brokenRef", message: `함수조항 ${clauseCode} 가 없습니다`, at: { refPath: clauseCode } }];
        return validateOptionSelection(def, options, { refPath: clauseCode });
      },
    },
    attributeRefs: attributeRefSource(db),
  });
  const auth = createAuthService(db, opts.auth);
  const master = createMasterService(db, { refs, catalog, coverage, product });
  const assembly = createAssemblyService(db, { catalog, coverage, clause, document, product });

  Object.assign(services, { db, auth, catalog, coverage, clause, document, product, refs, master, assembly });
  return services;
}

/** 문면 식의 타입을 카탈로그로 검사한다 — 서버 액션이 조건식 저장 전에 쓸 수 있는 보조. */
export async function checkDocumentExpression(db: Db, expression: string) {
  const parsed = parse(expression);
  if (!parsed.ok) return parsed;
  return checkTypes(parsed.value, await typeResolverOf(db));
}
