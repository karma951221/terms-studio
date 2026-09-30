import type { NewDiscriminator, NewEnum } from "@/domain/catalog";
import type { NewClause } from "@/domain/clause";
import type { DocumentNode } from "@/domain/document";
import type { Actor, Code, Id, Result, Value } from "@/domain/types";
import type { Services } from "@/services/container";

import appendices from "./data/appendices.json";
import attributes from "./data/attributes.json";
import boxes from "./data/boxes.json";
import clauses from "./data/clauses.json";
import coverages from "./data/coverages.json";
import discriminators from "./data/discriminators.json";
import documents from "./data/documents.json";
import enums from "./data/enums.json";
import generals from "./data/generals.json";
import products from "./data/products.json";

export const ALPHA_PLUS_PRODUCT_NAME = "알파Plus보장보험";
export const MERITZ_PRODUCT_NAME = "메리츠 통합간편건강보험(연만기형)";

export interface SeedResult {
  created: boolean;
  productId: Id;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`[seed:alphaPlus] 기대: ok, 실제: ${JSON.stringify(result.rejection)}`);
  return result.value;
}

function expectCode(actual: Code, expected: string): void {
  if (actual !== expected) throw new Error(`[seed:alphaPlus] 코드 불일치: 기대 ${expected}, 실제 ${actual}`);
}

function omit(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

async function assertAssembles(services: Services, productId: Id): Promise<void> {
  const result = await services.assembly.preview(productId);
  if (!result.ok) throw new Error(`[seed:alphaPlus] 조립 미리보기 실패: ${JSON.stringify(result.rejection)}`);
  if (!result.value.complete) throw new Error(`[seed:alphaPlus] 실물 조립 검증 실패: ${JSON.stringify(result.value.issues)}`);
}

type ClauseRaw = Record<string, unknown> & { code: Code; options: Array<Record<string, unknown>> };

/** 보통약관 문면이 쓰는 함수조항 코드 — 보통약관 가져오기 전에 있어야 한다 (문면 저장 검사가 함수조항 존재를 본다). */
export function clausesUsedByGenerals(): Set<Code> {
  return new Set((generals as unknown as Array<{ tree: DocumentNode }>).flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"clauseCode":"(C\d+)"/g)].map((m) => m[1])));
}

/**
 * 보통약관 조를 가리키는 함수조항인가 — 그 조가 있어야 정의 검사 ① 을 통과하므로 보통약관 뒤에 만든다 (기능/함수조항 §3.4).
 * 범위 있는 조 참조(제 항 · 사용처 위치)는 보통약관이 없어도 성립한다.
 */
export function refsGeneral(raw: unknown): boolean {
  const visit = (n: unknown): boolean => {
    if (Array.isArray(n)) return n.some(visit);
    if (!n || typeof n !== "object") return false;
    const node = n as Record<string, unknown>;
    if (node.kind === "articleRef" && node.scope === undefined) return true;
    return Object.values(node).some(visit);
  };
  return visit(raw);
}

async function createClause(services: Services, actor: Actor, raw: ClauseRaw): Promise<void> {
  const definition = omit(raw, ["code", "description", "required"]);
  definition.options = raw.options.map((option) => ({
    ...omit(option, ["code", "order", "values"]),
    values: (option.values as Array<Record<string, unknown>>).map((value) => omit(value, ["code", "order"])),
  }));
  const created = unwrap(await services.clause.create(actor, definition as unknown as NewClause));
  expectCode(created.code, raw.code);
}

/** 보통약관 문면이 놓는 박스 코드 — 보통약관 가져오기 전에 있어야 한다 (문면 저장 검사가 박스 존재를 본다). */
export function boxesUsedByGenerals(): Set<Code> {
  return new Set((generals as unknown as Array<{ tree: DocumentNode }>).flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"boxCode":"(BX\d+)"/g)].map((m) => m[1])));
}

/**
 * 정적 마스터 박스 — 코드는 시스템 채번(BX000001…)이라 JSON 순서대로 만든다. JSON 의 code 는 채번 대조용 (기능/박스 §3.1).
 * 보통약관이 놓는 박스가 앞 코드다(변환기 `orderBoxes`). `upTo` 가 있으면 그 개수까지만 만든다.
 */
async function loadBoxes(services: Services, actor: Actor, upTo?: number): Promise<void> {
  for (const box of (boxes as Array<{ code: string; name: string; title: string; lines: string[] }>).slice(0, upTo)) {
    const created = unwrap(await services.document.createBox(actor, { name: box.name, title: box.title, lines: box.lines }));
    expectCode(created.code, box.code);
  }
}

async function loadAppendices(services: Services, actor: Actor): Promise<void> {
  // 코드는 시스템 채번(AX000001…) — JSON 의 code 는 채번 순서가 어긋나지 않았는지 대조용 (기능/별표 §3.1).
  for (const appendix of appendices) {
    const created = unwrap(await services.document.createAppendix(actor, { name: appendix.name, description: appendix.description }));
    expectCode(created.code, appendix.code);
  }
}

/** 보통약관 템플릿 전부 — 보통약관 시드 코드 → 문서 id. 별표와 보통약관이 쓰는 함수조항이 먼저 있어야 한다. */
async function loadGenerals(services: Services, actor: Actor): Promise<Map<string, Id>> {
  const generalIds = new Map<string, Id>();
  for (const specification of generals as unknown as Array<{ code: string; tree: DocumentNode }>) {
    const document = unwrap(await services.document.createGeneral(actor, specification.tree.title));
    unwrap(await services.document.importTree(actor, document.id, specification.tree));
    generalIds.set(specification.code, document.id);
  }
  return generalIds;
}

/**
 * 함수조항 전부 + 그 사이에 보통약관 — 코드는 시스템 채번이라 JSON 순서대로 만든다. 보통약관 조를 가리키는 첫 함수조항 앞에서 보통약관을 넣는다
 * (보통약관이 쓰는 함수조항은 그보다 앞 코드다 — 변환기가 검사한다). `upTo` 가 있으면 그 개수까지만 만든다.
 */
async function loadClausesAndGenerals(services: Services, actor: Actor, upTo?: number): Promise<Map<string, Id>> {
  let generalIds: Map<string, Id> | undefined;
  for (const raw of (clauses as unknown as ClauseRaw[]).slice(0, upTo)) {
    if (!generalIds && refsGeneral(raw)) generalIds = await loadGenerals(services, actor);
    await createClause(services, actor, raw);
  }
  return generalIds ?? (await loadGenerals(services, actor));
}

/**
 * 실물 화면 E2E 의 바탕 — 별표 · 보통약관 두 벌과 **보통약관이 쓰는 박스 · 함수조항**만 넣는다 (docs/QA/시나리오/실물재현_E2E_시나리오.md §4).
 * 나머지(열거형 · 구분자 · 담보속성 · 담보 · 나머지 함수조항 · 담보약관 · 상품)는 E2E 가 화면으로 넣는다.
 * 보통약관은 가져오기 화면이 없어 시드로 넣고, 별표 · 보통약관이 쓰는 박스 · 함수조항은 보통약관이 참조해 그보다 먼저 있어야 해서 함께 넣는다
 * (보통약관이 쓰는 박스 · 함수조항은 BX000001 · C0001 부터의 앞 코드다 — 화면 E2E 는 그 뒤 코드부터 친다).
 * 이미 보통약관이 있으면 아무것도 하지 않는다.
 */
export async function loadRealBase(services: Services, actor: Actor): Promise<{ created: boolean }> {
  const titles = (generals as unknown as Array<{ tree: DocumentNode }>).map((g) => g.tree.title);
  const existing = await services.document.list("general");
  if (existing.some((d) => titles.includes(d.title))) return { created: false };
  await loadAppendices(services, actor);
  await loadBoxes(services, actor, boxesUsedByGenerals().size);
  await loadClausesAndGenerals(services, actor, clausesUsedByGenerals().size);
  return { created: true };
}

/** JSON 정본을 서비스 API로 적재한다. JSON의 의미 코드는 참조 키로만 쓰고 UUID는 서비스가 발급한다. */
export async function loadAlphaPlus(services: Services, actor: Actor): Promise<SeedResult> {
  const existing = (await services.product.listProducts()).find((product) => product.name === ALPHA_PLUS_PRODUCT_NAME);
  if (existing) {
    // 기존 상품 · 카탈로그는 사용자가 편집 중일 수 있다 — 아무것도 보충하지 않는다. 조립 완결성 검사는 새 시드 생성 때만 한다.
    return { created: false, productId: existing.id };
  }

  const enumInputs = enums as unknown as Array<{ code: Code; label: string; values: Array<{ label: string }> }>;
  for (const definition of enumInputs) {
    const created = unwrap(await services.catalog.createEnum(actor, { label: definition.label, values: definition.values.map(({ label }) => ({ label })) } as NewEnum));
    expectCode(created.code, definition.code);
  }

  for (const raw of discriminators as unknown as Array<Record<string, unknown> & { code: Code }>) {
    const created = unwrap(await services.catalog.create(actor, omit(raw, ["code"]) as unknown as NewDiscriminator));
    expectCode(created.code, raw.code);
  }

  interface CoverageSpec {
    /** 시드 안의 참조 키 — 상품 탑재(`mounts[].coverage`) · 담보약관(`ownerCoverage`)이 이것으로 담보를 가리킨다. */
    key: string;
    /** 기대 담보코드 — 코드는 시스템 채번(COV000001…)이라 JSON 순서가 곧 코드다. 어긋나지 않았는지 대조용 (기능/담보 §3.1). */
    code: string;
    name: string;
    benefitName: string;
    /** 세부보장이 여럿인 담보 — 각 세부보장에 급부 1. 없으면 담보명 세부보장 1 + benefitName 급부 1. */
    subCoverages?: { name: string; benefitName: string }[];
    coverageValues: { path: string; value: unknown }[];
    benefitValues: { path: string; value: unknown }[];
  }
  const coverageIds = new Map<string, Id>();
  for (const specification of coverages as unknown as CoverageSpec[]) {
    const [first, ...rest] = specification.subCoverages ?? [];
    let tree = unwrap(
      await services.coverage.create(actor, {
        name: specification.name,
        subCoverageName: first?.name,
        benefitName: first?.benefitName ?? specification.benefitName,
      }),
    );
    expectCode(tree.code ?? "", specification.code);
    for (const sub of rest) tree = unwrap(await services.coverage.addSubCoverage(actor, tree.id, sub));
    coverageIds.set(specification.key, tree.id);
    const benefitId = tree.subCoverages[0].benefits[0].id;
    for (const entry of specification.coverageValues) unwrap(await services.coverage.writeValue(actor, { level: "coverage", id: tree.id }, entry.path, entry.value as Value));
    for (const entry of specification.benefitValues) unwrap(await services.coverage.writeValue(actor, { level: "benefit", id: benefitId }, entry.path, entry.value as Value));
  }

  for (const kind of attributes) {
    const created = unwrap(await services.product.createAttributeKind(actor, { label: kind.label }));
    expectCode(created.code, kind.code);
    for (const value of kind.values) {
      const next = unwrap(await services.product.addAttributeValue(actor, kind.code, { label: value.label, fragment: value.fragment }));
      expectCode(next.values.at(-1)?.code ?? "", value.code);
    }
  }

  // 별표 · 박스 → 함수조항(보통약관이 쓰는 것 · 조 참조 없는 것) → 보통약관 → 보통약관 조를 가리키는 함수조항 (기능/함수조항 §3.4)
  await loadAppendices(services, actor);
  await loadBoxes(services, actor);
  const generalIds = await loadClausesAndGenerals(services, actor);

  const documentIds = new Map<string, Id>();
  for (const specification of documents as unknown as Array<{ code: string; ownerCoverage: string; general: string; tree: DocumentNode }>) {
    const coverageId = coverageIds.get(specification.ownerCoverage);
    const generalId = generalIds.get(specification.general);
    if (!coverageId || !generalId) throw new Error(`[seed:alphaPlus] 문서 참조를 찾을 수 없음: ${specification.code}`);
    const document = unwrap(await services.document.createSpecial(actor, coverageId, specification.tree.title));
    unwrap(await services.document.setGeneralDocument(actor, document.id, generalId));
    unwrap(await services.document.importTree(actor, document.id, specification.tree));
    documentIds.set(specification.code, document.id);
  }

  let seededProductId: Id | undefined;
  const productIds: Id[] = [];
  for (const specification of products) {
    const generalId = generalIds.get(specification.general);
    if (!generalId) throw new Error(`[seed:alphaPlus] 보통약관 참조를 찾을 수 없음: ${specification.general}`);
    unwrap(await services.product.setNamingTemplate(actor, specification.namingTemplate));
    const productId = unwrap(await services.product.createProduct(actor, { name: specification.name, generalDocumentId: generalId })).id;
    seededProductId ??= productId;
    productIds.push(productId);
    for (const entry of specification.values as { path: string; value: unknown }[]) unwrap(await services.product.setProductValue(actor, productId, entry.path, entry.value as Value));

    const optionIds = new Map<string, Id>();
    for (const option of specification.planOptions) {
      const created = unwrap(await services.product.addPlanOption(actor, productId, { axis: option.axis as "type" | "form", number: option.number, name: option.name, planTypeCode: option.planTypeCode }));
      optionIds.set(option.code, created.id);
      // 한 제출로 — 폼 교차 규칙(적용여부 = 예면 사유 1개 이상)은 최종 상태로 본다
      unwrap(await services.product.setPlanOptionValues(actor, created.id, option.values.map((entry) => ({ path: entry.path, value: entry.value as Value }))));
    }
    for (const combination of specification.plans) {
      const ids = combination.map((code) => optionIds.get(code));
      if (ids.some((id) => !id)) throw new Error(`[seed:alphaPlus] 세목 선택지 참조를 찾을 수 없음: ${combination.join(",")}`);
      unwrap(await services.product.registerPlan(actor, productId, ids as Id[]));
    }

    const groupIds = new Map<string, Id>();
    for (const group of specification.groups) groupIds.set(group.code, unwrap(await services.product.createGroup(actor, productId, { title: group.title })).id);
    const mountIds = new Map<string, Id>();
    for (const mount of specification.mounts) {
      const coverageId = coverageIds.get(mount.coverage);
      if (!coverageId) throw new Error(`[seed:alphaPlus] 담보 참조를 찾을 수 없음: ${mount.coverage}`);
      const mounted = unwrap(await services.product.mount(actor, productId, coverageId, mount.attributes, mount.section as "base" | "special"));
      mountIds.set(mount.code, mounted.id);
      if (mount.group) {
        const groupId = groupIds.get(mount.group);
        if (!groupId) throw new Error(`[seed:alphaPlus] 그룹 참조를 찾을 수 없음: ${mount.group}`);
        unwrap(await services.product.placeInGroup(actor, groupId, mounted.id));
      }
    }
  }

  if (!seededProductId) throw new Error("[seed:alphaPlus] 상품 JSON이 비어 있습니다");
  for (const productId of productIds) await assertAssembles(services, productId);
  return { created: true, productId: seededProductId };
}
