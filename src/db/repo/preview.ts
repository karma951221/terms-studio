/**
 * 미리보기 산출본 repo — `product_previews` 읽기/upsert + 조립 **입력 스탬프** (기능/조립산출 §3.6).
 *
 * 스탬프 = 조립이 읽는 재료 테이블 전부의 `이름=시각:count` 조각을 테이블 이름 순으로 `|` 로 이은 문자열.
 * - `updated_at` 이 있는 테이블은 `max(updated_at)`(UTC · 마이크로초) — 행이 없으면 `-`.
 * - `updated_at` 이 없는 테이블(구성 행 · 관계 행)은 키 열을 정렬해 이은 것의 md5 — 삭제 + 재삽입(그룹 이동 · 기본계약 교체)
 *   처럼 행 수가 그대로인 변경을 잡기 위해서다.
 * - `count` 를 함께 두는 이유: 삭제만으로는 `max(updated_at)` 이 변하지 않는다.
 * - 상품 고유분은 그 상품 행으로 한정하고(FK 경로), 공유 마스터는 전체 — 기능/조립산출 §3.6 「입력 = 마스터(구분자 · 공용조항 ·
 *   문면 · 별표 · 박스) + 상품 고유분(상품 값 · 세목 · 탑재 · 스냅샷 값 · 그룹 · 오버라이드 · 별표 순서) — 조립이 읽는 재료 전부」 ·
 *   열어 둔 것 「공유 마스터는 어느 것이든 바뀌면 전 상품이 오래됨」.
 * - 스탬프는 「같다/다르다」만 말한다. 무엇이 바뀌었는지는 판본(ADR-0026 · MVP 이후)의 몫.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import type { Booklet } from "@/domain/assembly/types";
import type { Id } from "@/domain/types";

import {
  appendices,
  attributeKinds,
  attributeValues,
  benefits,
  boxes,
  clauseOptionOverrides,
  clauses,
  coverages,
  discriminators,
  documents,
  entityValues,
  enumValues,
  enums,
  namingTemplates,
  planOptions,
  productBaseContracts,
  productCoverageAttributes,
  productCoverageNodes,
  productCoveragePlans,
  productCoverages,
  productHiddenArticles,
  productPlanOptions,
  productPlans,
  productPreviews,
  products,
  specialGroupMembers,
  specialGroups,
  subCoverages,
} from "../schema";
import type { Db } from "./types";

// ───────────────────────────── 산출본 행 ─────────────────────────────

/** 결과 등급 — `ok` 완성본 · `withErrors` 오류포함(부분 조립). 실행 실패는 저장하지 않는다 (기능/조립산출 §3.6). */
export type PreviewGrade = "ok" | "withErrors";

export interface StoredPreview {
  productId: Id;
  generatedAt: Date;
  generatedBy: Id | null;
  inputStamp: string;
  grade: PreviewGrade;
  booklet: Booklet;
}

export async function loadPreview(db: Db, productId: Id): Promise<StoredPreview | undefined> {
  const [row] = await db.select().from(productPreviews).where(eq(productPreviews.productId, productId)).limit(1);
  return row;
}

/** 상품당 1행 — 있으면 덮어쓴다 (최신 1벌 · 기능/조립산출 §3 「산출본 · 결정성」). */
export async function savePreview(db: Db, row: StoredPreview): Promise<void> {
  const { generatedAt, generatedBy, inputStamp, grade, booklet } = row;
  await db
    .insert(productPreviews)
    .values(row)
    .onConflictDoUpdate({ target: productPreviews.productId, set: { generatedAt, generatedBy, inputStamp, grade, booklet } });
}

// ───────────────────────────── 입력 스탬프 ─────────────────────────────

interface StampSource {
  /** 조각 이름 — 테이블 이름 (entity_values 는 소유 구분을 괄호로). */
  name: string;
  table: PgTable;
  /** 갱신 시각 열 — 있으면 `max()`. */
  time?: PgColumn;
  /** 갱신 시각이 없는 테이블의 키 열 — 정렬 결합의 md5. */
  keys?: readonly PgColumn[];
  /** 상품 고유분의 한정 조건. 없으면 전체 (공유 마스터 · 상품에 매이지 않는 상품 계열 테이블). */
  where?: (productId: Id) => SQL;
}

const ownedCoverageIds = (productId: Id) => sql`(select ${productCoverages.id} from ${productCoverages} where ${productCoverages.productId} = ${productId})`;
const ownedPlanIds = (productId: Id) => sql`(select ${productPlans.id} from ${productPlans} where ${productPlans.productId} = ${productId})`;
const ownedGroupIds = (productId: Id) => sql`(select ${specialGroups.id} from ${specialGroups} where ${specialGroups.productId} = ${productId})`;
const ownedOptionIds = (productId: Id) => sql`(select ${planOptions.id} from ${planOptions} where ${planOptions.productId} = ${productId})`;
const ownedNodeIds = (productId: Id) =>
  sql`(select ${productCoverageNodes.id} from ${productCoverageNodes} where ${productCoverageNodes.productCoverageId} in ${ownedCoverageIds(productId)})`;

/**
 * 조립 재료 테이블 — 이름 순. 상품 고유분은 그 상품으로 한정, 공유 마스터와 상품에 매이지 않는 상품 계열 테이블
 * (naming_templates · attribute_kinds · attribute_values)은 전체.
 * `entity_values` 는 소유자로 갈라 상품 소유(product · plan · productCoverage · productSubCoverage · productBenefit — 조립이 읽는
 * owner kind)와 마스터 소유(coverage · subCoverage · benefit)를 둘 다 넣는다.
 */
export const ASSEMBLY_STAMP_SOURCES: readonly StampSource[] = [
  { name: "appendices", table: appendices, time: appendices.updatedAt },
  { name: "attribute_kinds", table: attributeKinds, time: attributeKinds.updatedAt },
  { name: "attribute_values", table: attributeValues, time: attributeValues.updatedAt },
  { name: "benefits", table: benefits, time: benefits.updatedAt },
  { name: "boxes", table: boxes, time: boxes.updatedAt },
  {
    name: "clause_option_overrides",
    table: clauseOptionOverrides,
    time: clauseOptionOverrides.updatedAt,
    where: (productId) => and(eq(clauseOptionOverrides.scopeKind, "product"), eq(clauseOptionOverrides.scopeId, productId))!,
  },
  { name: "clauses", table: clauses, time: clauses.updatedAt },
  { name: "coverages", table: coverages, time: coverages.updatedAt },
  { name: "discriminators", table: discriminators, time: discriminators.updatedAt },
  { name: "documents", table: documents, time: documents.updatedAt },
  {
    name: "entity_values(master)",
    table: entityValues,
    time: entityValues.updatedAt,
    where: () => inArray(entityValues.ownerKind, ["coverage", "subCoverage", "benefit"]),
  },
  {
    name: "entity_values(product)",
    table: entityValues,
    time: entityValues.updatedAt,
    where: (productId) =>
      sql`(${entityValues.ownerKind} = 'product' and ${entityValues.ownerId} = ${productId})
        or (${entityValues.ownerKind} = 'plan' and ${entityValues.ownerId} in ${ownedOptionIds(productId)})
        or (${entityValues.ownerKind} = 'productCoverage' and ${entityValues.ownerId} in ${ownedCoverageIds(productId)})
        or (${entityValues.ownerKind} in ('productSubCoverage', 'productBenefit') and ${entityValues.ownerId} in ${ownedNodeIds(productId)})`,
  },
  { name: "enum_values", table: enumValues, time: enumValues.updatedAt },
  { name: "enums", table: enums, time: enums.updatedAt },
  { name: "naming_templates", table: namingTemplates, time: namingTemplates.updatedAt },
  { name: "plan_options", table: planOptions, time: planOptions.updatedAt, where: (productId) => eq(planOptions.productId, productId) },
  {
    name: "product_base_contracts",
    table: productBaseContracts,
    keys: [productBaseContracts.productCoverageId],
    where: (productId) => eq(productBaseContracts.productId, productId),
  },
  {
    name: "product_coverage_attributes",
    table: productCoverageAttributes,
    keys: [productCoverageAttributes.productCoverageId, productCoverageAttributes.kindCode, productCoverageAttributes.valueCode],
    where: (productId) => inArray(productCoverageAttributes.productCoverageId, ownedCoverageIds(productId)),
  },
  {
    name: "product_coverage_nodes",
    table: productCoverageNodes,
    time: productCoverageNodes.updatedAt,
    where: (productId) => inArray(productCoverageNodes.productCoverageId, ownedCoverageIds(productId)),
  },
  {
    name: "product_coverage_plans",
    table: productCoveragePlans,
    keys: [productCoveragePlans.productCoverageId, productCoveragePlans.planId],
    where: (productId) => inArray(productCoveragePlans.productCoverageId, ownedCoverageIds(productId)),
  },
  { name: "product_coverages", table: productCoverages, time: productCoverages.updatedAt, where: (productId) => eq(productCoverages.productId, productId) },
  {
    name: "product_hidden_articles",
    table: productHiddenArticles,
    keys: [productHiddenArticles.articleId],
    where: (productId) => eq(productHiddenArticles.productId, productId),
  },
  {
    name: "product_plan_options",
    table: productPlanOptions,
    keys: [productPlanOptions.planId, productPlanOptions.optionId],
    where: (productId) => inArray(productPlanOptions.planId, ownedPlanIds(productId)),
  },
  { name: "product_plans", table: productPlans, time: productPlans.updatedAt, where: (productId) => eq(productPlans.productId, productId) },
  { name: "products", table: products, time: products.updatedAt, where: (productId) => eq(products.id, productId) },
  {
    name: "special_group_members",
    table: specialGroupMembers,
    keys: [specialGroupMembers.groupId, specialGroupMembers.productCoverageId],
    where: (productId) => inArray(specialGroupMembers.groupId, ownedGroupIds(productId)),
  },
  { name: "special_groups", table: specialGroups, time: specialGroups.updatedAt, where: (productId) => eq(specialGroups.productId, productId) },
  { name: "sub_coverages", table: subCoverages, time: subCoverages.updatedAt },
];

/** `max(time)` 을 UTC ISO(마이크로초)로 — 세션 타임존에 흔들리지 않게. 행이 없으면 null. */
function maxTime(col: PgColumn): SQL<string | null> {
  return sql<string | null>`to_char(max(${col}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** 키 열을 `/` 로 잇고 정렬해 `,` 로 이은 것의 md5. 행이 없으면 빈 문자열의 md5. */
function digest(keys: readonly PgColumn[]): SQL<string> {
  const row = sql.join(
    keys.map((k) => sql`${k}::text`),
    sql` || '/' || `,
  );
  const order = sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  );
  return sql<string>`md5(coalesce(string_agg(${row}, ',' order by ${order}), ''))`;
}

async function stampOf(db: Db, src: StampSource, productId: Id): Promise<string> {
  const mark = src.time ? maxTime(src.time) : digest(src.keys ?? []);
  const [row] = await db
    .select({ mark, n: sql<number>`count(*)::int` })
    .from(src.table)
    .where(src.where?.(productId));
  return `${src.name}=${row?.mark ?? "-"}:${row?.n ?? 0}`;
}

/** 조립 입력 스탬프 — 재료 테이블마다 한 조각, 이름 순 `|` 결합. 같으면 「입력이 바뀌지 않았다」. */
export async function assemblyInputStamp(db: Db, productId: Id): Promise<string> {
  const pieces: string[] = [];
  for (const src of ASSEMBLY_STAMP_SOURCES) pieces.push(await stampOf(db, src, productId));
  return pieces.join("|");
}
