/**
 * 공용 값 저장소 repo — 실체 × 마스터 필드 값 자리. drizzle 쿼리만, 규칙 없음.
 *
 * 담보(B1)·상품(B4) 영역이 함께 쓴다. 값의 타입 검증은 catalog `validateValue` 가,
 * 어느 자리가 그 레벨의 것인지는 마스터가 정한다 (ADR-0037). 부착 관계는 없다.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { ImpactSource, ImpactTarget } from "@/domain/catalog/impact";
import type { SlotPath } from "@/domain/catalog/types";
import type { Id, Value, ValueSlot } from "@/domain/types";

import { entityValues } from "../schema";
import type { Db } from "./types";

/** 값 자리를 소유하는 실체의 종류. 5레벨 + 탑재 스냅샷 실체. */
export type ValueOwnerKind =
  | "product"
  | "plan"
  | "coverage"
  | "subCoverage"
  | "benefit"
  | "productCoverage"
  | "productSubCoverage"
  | "productBenefit"
  | "productPlan";

export interface ValueOwner {
  kind: ValueOwnerKind;
  id: Id;
}

// ───────────────────────────── 값 자리 ─────────────────────────────

/** 소유자의 명시 입력 값 전부. 키는 마스터 경로. 없는 경로 = 미입력. */
export async function readSlots(db: Db, owner: ValueOwner): Promise<Map<SlotPath, ValueSlot>> {
  const rows = await db
    .select({ path: entityValues.fieldPath, value: entityValues.value })
    .from(entityValues)
    .where(and(eq(entityValues.ownerKind, owner.kind), eq(entityValues.ownerId, owner.id)));
  const map = new Map<SlotPath, ValueSlot>();
  for (const r of rows) map.set(r.path, { entered: true, value: r.value });
  return map;
}

/**
 * 여러 소유자의 값을 한 번에. 키 = ownerId (요청 순), 자리는 경로 순.
 * 정렬은 결정성을 위해 명시한다 (ADR-0034 결정 4) — 플래너가 인덱스를 타든 말든 같은 순서.
 */
export async function readSlotsMany(
  db: Db,
  kind: ValueOwnerKind,
  ids: Id[],
): Promise<Map<Id, Map<SlotPath, ValueSlot>>> {
  const out = new Map<Id, Map<SlotPath, ValueSlot>>();
  for (const id of ids) out.set(id, new Map());
  if (ids.length === 0) return out;
  const rows = await db
    .select({ ownerId: entityValues.ownerId, path: entityValues.fieldPath, value: entityValues.value })
    .from(entityValues)
    .where(and(eq(entityValues.ownerKind, kind), inArray(entityValues.ownerId, ids)))
    .orderBy(asc(entityValues.ownerId), asc(entityValues.fieldPath));
  for (const r of rows) out.get(r.ownerId)!.set(r.path, { entered: true, value: r.value });
  return out;
}

/**
 * 값 자리 쓰기. `value === undefined` 면 값 지우기(행 삭제 → 미입력).
 * 기본값이 여기로 자동 유입되는 경로는 없다 — 호출자는 사람이 확인한 값만 넘긴다.
 */
export async function writeSlot(
  db: Db,
  owner: ValueOwner,
  fieldPath: SlotPath,
  value: Value | undefined,
  by?: Id,
): Promise<void> {
  if (value === undefined) {
    await db
      .delete(entityValues)
      .where(
        and(
          eq(entityValues.ownerKind, owner.kind),
          eq(entityValues.ownerId, owner.id),
          eq(entityValues.fieldPath, fieldPath),
        ),
      );
    return;
  }
  await db
    .insert(entityValues)
    .values({ ownerKind: owner.kind, ownerId: owner.id, fieldPath, value, updatedBy: by })
    .onConflictDoUpdate({
      target: [entityValues.ownerKind, entityValues.ownerId, entityValues.fieldPath],
      set: { value, updatedAt: sql`now()`, updatedBy: by },
    });
}

/** 소유자의 값 행 전부 삭제 (실체 삭제 시 연쇄). 삭제한 행 수. */
export async function clearSlots(db: Db, owner: ValueOwner): Promise<number> {
  const rows = await db
    .delete(entityValues)
    .where(and(eq(entityValues.ownerKind, owner.kind), eq(entityValues.ownerId, owner.id)))
    .returning({ id: entityValues.id });
  return rows.length;
}

/**
 * 탑재 스냅샷 — from 의 명시 값을 to 로 복사한다 (ADR-0002). 미입력은 복사할 게 없어 그대로 미입력.
 * to 에 이미 있는 자리는 덮어쓴다. 복사한 행 수를 돌려준다.
 */
export async function copySlots(db: Db, from: ValueOwner, to: ValueOwner, by?: Id): Promise<number> {
  const rows = await db
    .select({ path: entityValues.fieldPath, value: entityValues.value })
    .from(entityValues)
    .where(and(eq(entityValues.ownerKind, from.kind), eq(entityValues.ownerId, from.id)));
  for (const r of rows) await writeSlot(db, to, r.path, r.value, by);
  return rows.length;
}

/** 소유자의 값 관계 전부 삭제 (실체 삭제 연쇄). */
export async function clearOwner(db: Db, owner: ValueOwner): Promise<void> {
  await clearSlots(db, owner);
}

// ───────────────────────────── 영향 (ImpactSource) ─────────────────────────────

function targetFilter(target: ImpactTarget) {
  switch (target.kind) {
    case "discriminator":
      // 구분자는 식이라 값 행이 없다 (ADR-0037) — 삭제해도 사라질 값이 없다.
      return undefined;
    case "enumValue":
    case "enum":
      // enum 값 행은 「그 enum 을 타입으로 쓰는 마스터 자리」를 알아야 찾는다 —
      // 서비스가 `enumReferences` 로 경로를 구해 `countPathRows` 로 묻는다.
      return undefined;
  }
}

/** 주어진 마스터 경로들의 값 행 수 — enum 삭제 영향의 재료. */
export async function countPathRows(db: Db, paths: readonly SlotPath[]): Promise<number> {
  if (paths.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entityValues)
    .where(inArray(entityValues.fieldPath, [...paths]));
  return row?.n ?? 0;
}

/** 주어진 마스터 경로들의 값 행 삭제. */
export async function purgePathRows(db: Db, paths: readonly SlotPath[]): Promise<void> {
  if (paths.length === 0) return;
  await db.delete(entityValues).where(inArray(entityValues.fieldPath, [...paths]));
}

/**
 * 값 저장소의 ImpactSource 구현. findBrokenRefs 는 참조 역인덱스(C1 refs)가 담당하므로
 * 여기서는 빈 목록 — refs 가 생기면 합성(`{...valuesImpactSource(db), findBrokenRefs}`)한다.
 */
export function valuesImpactSource(db: Db): ImpactSource {
  return {
    async countValueRows(target) {
      const where = targetFilter(target);
      if (!where) return 0;
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(entityValues).where(where);
      return row?.n ?? 0;
    },
    async findBrokenRefs() {
      return [];
    },
    async purgeValueRows(target) {
      const where = targetFilter(target);
      if (!where) return;
      await db.delete(entityValues).where(where);
    },
  };
}
