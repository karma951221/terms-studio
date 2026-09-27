import type { NewDiscriminator, NewEnum } from "@/domain/catalog";
import type { NewClause } from "@/domain/clause";
import type { DocumentNode } from "@/domain/document";
import { format, parse, refPath } from "@/domain/expression";
import type { Actor, Code, Id, Result, Value } from "@/domain/types";
import type { Services } from "@/services/container";

import appendices from "./data/appendices.json";
import attributes from "./data/attributes.json";
import clauses from "./data/clauses.json";
import coverages from "./data/coverages.json";
import discriminators from "./data/discriminators.json";
import documents from "./data/documents.json";
import enums from "./data/enums.json";
import generals from "./data/generals.json";
import products from "./data/products.json";

export const ALPHA_PLUS_PRODUCT_NAME = "알파Plus보장보험";

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

/** 기존 시드 DB의 급부 특성을 보충한다. 사용자 코드는 보존하고 집계 참조는 실제 발급 코드로 바꾼다. */
async function ensureBenefitTraits(services: Services, actor: Actor): Promise<void> {
  const existing = await services.catalog.list();
  const codes = new Map<Code, Code>();
  // D0001(담보명)은 기존 시드의 문면에서 이미 참조한다. 추가된 특성 정의만 보충한다.
  for (const raw of discriminators.filter((d) => d.code !== "D0001")) {
    const parsed = unwrap(parse(raw.expression));
    const expression = format(parsed, (ref) => ref.kind === "discriminator" ? codes.get(ref.code) ?? refPath(ref) : refPath(ref));
    const found = existing.find((d) => {
      if (d.level !== raw.level) return false;
      const current = parse(d.expression);
      return current.ok && format(current.value) === expression;
    });
    const definition = found ?? unwrap(await services.catalog.create(actor, { ...omit(raw, ["code"]), expression } as unknown as NewDiscriminator));
    codes.set(raw.code, definition.code);
    if (!found) existing.push(definition);
  }
}

/** JSON 정본을 서비스 API로 적재한다. JSON의 의미 코드는 참조 키로만 쓰고 UUID는 서비스가 발급한다. */
export async function loadAlphaPlus(services: Services, actor: Actor): Promise<SeedResult> {
  const existing = (await services.product.listProducts()).find((product) => product.name === ALPHA_PLUS_PRODUCT_NAME);
  if (existing) {
    await ensureBenefitTraits(services, actor);
    // 기존 상품은 사용자가 편집 중일 수 있다. 조립 완결성 검사는 새 시드 생성 때만 한다.
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
    for (const sub of rest) tree = unwrap(await services.coverage.addSubCoverage(actor, tree.id, sub));
    coverageIds.set(specification.code, tree.id);
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

  for (const raw of clauses as unknown as Array<Record<string, unknown> & { code: Code; options: Array<Record<string, unknown>> }>) {
    const code = raw.code;
    const definition = omit(raw, ["code", "description", "required"]);
    definition.options = raw.options.map((option) => ({
      ...omit(option, ["code", "order", "values"]),
      values: (option.values as Array<Record<string, unknown>>).map((value) => omit(value, ["code", "order"])),
    }));
    const created = unwrap(await services.clause.create(actor, definition as unknown as NewClause));
    expectCode(created.code, code);
  }

  // 코드는 시스템 채번(AX000001…) — JSON 의 code 는 채번 순서가 어긋나지 않았는지 대조용 (기능/별표 §3.1).
  for (const appendix of appendices) {
    const created = unwrap(await services.document.createAppendix(actor, { name: appendix.name, description: appendix.description }));
    expectCode(created.code, appendix.code);
  }

  const generalIds = new Map<string, Id>();
  for (const specification of generals as unknown as Array<{ code: string; tree: DocumentNode }>) {
    const document = unwrap(await services.document.createGeneral(actor, specification.tree.title));
    unwrap(await services.document.importTree(actor, document.id, specification.tree));
    generalIds.set(specification.code, document.id);
  }

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
  for (const specification of products) {
    const generalId = generalIds.get(specification.general);
    if (!generalId) throw new Error(`[seed:alphaPlus] 보통약관 참조를 찾을 수 없음: ${specification.general}`);
    unwrap(await services.product.setNamingTemplate(actor, specification.namingTemplate));
    const productId = unwrap(await services.product.createProduct(actor, { name: specification.name, generalDocumentId: generalId })).id;
    seededProductId ??= productId;
    for (const entry of specification.values as { path: string; value: unknown }[]) unwrap(await services.product.setProductValue(actor, productId, entry.path, entry.value as Value));

    const optionIds = new Map<string, Id>();
    for (const option of specification.planOptions) {
      const created = unwrap(await services.product.addPlanOption(actor, productId, { axis: option.axis as "type" | "form", number: option.number, name: option.name, planTypeCode: option.planTypeCode }));
      optionIds.set(option.code, created.id);
      for (const entry of option.values) unwrap(await services.product.setPlanOptionValue(actor, created.id, entry.path, entry.value as Value));
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
  await assertAssembles(services, seededProductId);
  return { created: true, productId: seededProductId };
}
