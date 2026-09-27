/**
 * 카탈로그 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/catalog, 조립은 src/services/catalog).
 *
 * 도메인 객체(Discriminator · EnumDef) ↔ 행 매핑을 여기서 한다.
 * enum 값은 코드 기준 upsert — 코드가 남아 있는 행은 갱신, 없어진 행은 삭제.
 * 구분자는 식 하나라 하위 행이 없다 (ADR-0037).
 */
import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import type { CodeKind, NextSeq } from "@/domain/catalog/codes";
import type { Discriminator, EnumDef, EnumValueDef } from "@/domain/catalog/types";
import type { AttachLevel, Code, Id } from "@/domain/types";

import { codeSequences, discriminators, enumValues, enums } from "../schema";
import type { Db } from "./types";

// ───────────────────────────── 채번 ─────────────────────────────

/**
 * (kind, scope) 의 다음 순번을 원자적으로 뽑는다 — 한 문장의 upsert 라 동시 호출에도 안전.
 * 삭제된 순번은 재사용하지 않는다.
 */
export async function nextSeq(db: Db, kind: CodeKind, scope: string): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind, scope, next: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.kind, codeSequences.scope],
      set: { next: sql`${codeSequences.next} + 1` },
    })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

export function seqSource(db: Db): NextSeq {
  return (kind, scope) => nextSeq(db, kind, scope);
}

// ───────────────────────────── 매핑 ─────────────────────────────

type DiscriminatorRow = typeof discriminators.$inferSelect;
type EnumRow = typeof enums.$inferSelect;
type EnumValueRow = typeof enumValues.$inferSelect;

function toDiscriminator(row: DiscriminatorRow): Discriminator {
  return {
    code: row.code,
    label: row.label,
    description: row.description,
    level: row.level as AttachLevel,
    expression: row.expression,
    ...(row.resultType !== null ? { resultType: row.resultType } : {}),
  };
}

function toRow(def: Discriminator) {
  return {
    code: def.code,
    label: def.label,
    description: def.description,
    level: def.level,
    expression: def.expression,
    resultType: def.resultType ?? null,
  };
}

function toEnum(row: EnumRow, values: EnumValueRow[]): EnumDef {
  return {
    code: row.code,
    label: row.label,
    description: row.description,
    values: values.map<EnumValueDef>((v) => ({ code: v.code, label: v.label, order: v.order })),
  };
}

// ───────────────────────────── 구분자 ─────────────────────────────

export async function findDiscriminatorRow(db: Db, code: Code): Promise<DiscriminatorRow | undefined> {
  const [row] = await db.select().from(discriminators).where(eq(discriminators.code, code)).limit(1);
  return row;
}

export async function loadDiscriminator(db: Db, code: Code): Promise<Discriminator | undefined> {
  const row = await findDiscriminatorRow(db, code);
  return row ? toDiscriminator(row) : undefined;
}

/** 코드 순 전체 목록. */
export async function listDiscriminators(db: Db): Promise<Discriminator[]> {
  const rows = await db.select().from(discriminators).orderBy(asc(discriminators.code));
  return rows.map(toDiscriminator);
}

export async function insertDiscriminator(db: Db, def: Discriminator, who: Id): Promise<void> {
  await db.insert(discriminators).values({ ...toRow(def), createdBy: who, updatedBy: who });
}

/** 기존 정의 덮어쓰기. 코드·레벨은 바뀌지 않는다. */
export async function saveDiscriminator(db: Db, def: Discriminator, who: Id): Promise<void> {
  const [row] = await db
    .update(discriminators)
    .set({ ...toRow(def), updatedAt: new Date(), updatedBy: who })
    .where(eq(discriminators.code, def.code))
    .returning({ id: discriminators.id });
  if (!row) throw new Error(`저장 대상 구분자가 없습니다: ${def.code}`);
}

export async function deleteDiscriminator(db: Db, code: Code): Promise<void> {
  await db.delete(discriminators).where(eq(discriminators.code, code));
}

/** 목록 한 판에 쓸 감사 정보 — code → (언제 · 누가). 코드마다 따로 묻지 않는다. */
export async function discriminatorAudits(db: Db): Promise<Map<Code, { updatedAt: Date; updatedBy: Id | null }>> {
  const rows = await db
    .select({ code: discriminators.code, updatedAt: discriminators.updatedAt, updatedBy: discriminators.updatedBy })
    .from(discriminators);
  return new Map(rows.map((row) => [row.code, { updatedAt: row.updatedAt, updatedBy: row.updatedBy }] as const));
}

/** 감사 정보 (who · when). */
export async function discriminatorAudit(db: Db, code: Code) {
  const row = await findDiscriminatorRow(db, code);
  if (!row) return undefined;
  return { createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy };
}

// ───────────────────────────── enum ─────────────────────────────

async function valuesOf(db: Db, enumId: Id): Promise<EnumValueRow[]> {
  return db
    .select()
    .from(enumValues)
    .where(eq(enumValues.enumId, enumId))
    .orderBy(asc(enumValues.order), asc(enumValues.code));
}

export async function loadEnum(db: Db, code: Code): Promise<EnumDef | undefined> {
  const [row] = await db.select().from(enums).where(eq(enums.code, code)).limit(1);
  if (!row) return undefined;
  return toEnum(row, await valuesOf(db, row.id));
}

/** 목록용 — enum 코드 → 최종수정(언제 · 누가). */
export async function enumAudits(db: Db): Promise<Map<Code, { updatedAt: Date; updatedBy: Id | null }>> {
  const rows = await db.select({ code: enums.code, updatedAt: enums.updatedAt, updatedBy: enums.updatedBy }).from(enums);
  return new Map(rows.map((row) => [row.code, { updatedAt: row.updatedAt, updatedBy: row.updatedBy }] as const));
}

export async function listEnums(db: Db): Promise<EnumDef[]> {
  const rows = await db.select().from(enums).orderBy(asc(enums.code));
  const all = await db.select().from(enumValues).orderBy(asc(enumValues.order), asc(enumValues.code));
  const byOwner = new Map<Id, EnumValueRow[]>();
  for (const v of all) {
    const list = byOwner.get(v.enumId) ?? [];
    list.push(v);
    byOwner.set(v.enumId, list);
  }
  return rows.map((r) => toEnum(r, byOwner.get(r.id) ?? []));
}

export async function insertEnum(db: Db, def: EnumDef, who: Id): Promise<void> {
  const [row] = await db
    .insert(enums)
    .values({ code: def.code, label: def.label, description: def.description ?? "", createdBy: who, updatedBy: who })
    .returning({ id: enums.id });
  if (def.values.length > 0) {
    await db.insert(enumValues).values(
      def.values.map((v) => ({ enumId: row.id, code: v.code, label: v.label, order: v.order, createdBy: who, updatedBy: who })),
    );
  }
}

export async function saveEnum(db: Db, def: EnumDef, who: Id): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(enums)
    .set({ label: def.label, description: def.description ?? "", updatedAt: now, updatedBy: who })
    .where(eq(enums.code, def.code))
    .returning({ id: enums.id });
  if (!row) throw new Error(`저장 대상 enum 이 없습니다: ${def.code}`);

  const keep = def.values.map((v) => v.code);
  if (keep.length === 0) {
    await db.delete(enumValues).where(eq(enumValues.enumId, row.id));
  } else {
    await db.delete(enumValues).where(and(eq(enumValues.enumId, row.id), notInArray(enumValues.code, keep)));
  }
  for (const v of def.values) {
    await db
      .insert(enumValues)
      .values({ enumId: row.id, code: v.code, label: v.label, order: v.order, createdBy: who, updatedBy: who })
      .onConflictDoUpdate({
        target: [enumValues.enumId, enumValues.code],
        set: { label: v.label, order: v.order, updatedAt: now, updatedBy: who },
      });
  }
}

export async function deleteEnum(db: Db, code: Code): Promise<void> {
  await db.delete(enums).where(eq(enums.code, code)); // 값은 FK cascade
}
