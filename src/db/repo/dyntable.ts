/**
 * 동적표 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/dyntable, 조립은 src/services/dyntable).
 *
 * 도메인 객체(DynTable) ↔ 행 매핑. 인자 · 템플릿은 jsonb 그대로.
 * 채번은 함수조항 · 박스와 같은 code_sequences 테이블을 쓰되 kind `dynTable` (scope 전역 "").
 */
import { asc, eq, sql } from "drizzle-orm";

import { formatDynTableCode } from "@/domain/dyntable/codes";
import type { DynTable, NewDynTable } from "@/domain/dyntable/types";
import type { Code, Id } from "@/domain/types";

import { codeSequences, dynTables } from "../schema";
import type { Db } from "./types";

// ───────────────────────────── 채번 ─────────────────────────────

/** 다음 순번 — 한 문장의 upsert 라 동시 호출에도 안전. 삭제된 순번은 재사용하지 않는다. */
export async function nextDynTableSeq(db: Db): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind: "dynTable", scope: "", next: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.kind, codeSequences.scope],
      set: { next: sql`${codeSequences.next} + 1` },
    })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

export async function allocateDynTableCode(db: Db): Promise<Code> {
  return formatDynTableCode(await nextDynTableSeq(db));
}

// ───────────────────────────── 매핑 ─────────────────────────────

type DynTableRow = typeof dynTables.$inferSelect;

function toDynTable(row: DynTableRow): DynTable {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    params: row.params ?? [],
    columnBasis: row.columnBasis,
    rowHeader: row.rowHeader,
    headers: row.headers,
    cell: row.cell,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.updatedBy ? { updatedBy: row.updatedBy } : {}),
  };
}

function toRow(def: NewDynTable) {
  return {
    label: def.label,
    params: def.params ?? [],
    columnBasis: def.columnBasis,
    rowHeader: def.rowHeader,
    headers: def.headers,
    cell: def.cell,
  };
}

// ───────────────────────────── CRUD ─────────────────────────────

/** 코드 순 전체 목록. */
export async function listDynTables(db: Db): Promise<DynTable[]> {
  const rows = await db.select().from(dynTables).orderBy(asc(dynTables.code));
  return rows.map(toDynTable);
}

export async function getDynTable(db: Db, code: Code): Promise<DynTable | undefined> {
  const [row] = await db.select().from(dynTables).where(eq(dynTables.code, code)).limit(1);
  return row ? toDynTable(row) : undefined;
}

export async function insertDynTable(db: Db, code: Code, def: NewDynTable, who: Id): Promise<DynTable> {
  const [row] = await db
    .insert(dynTables)
    .values({ code, ...toRow(def), createdBy: who, updatedBy: who })
    .returning();
  return toDynTable(row);
}

/** 기존 정의 덮어쓰기. 코드는 바뀌지 않는다. */
export async function updateDynTable(db: Db, code: Code, patch: NewDynTable, who: Id): Promise<DynTable> {
  const [row] = await db
    .update(dynTables)
    .set({ ...toRow(patch), updatedAt: new Date(), updatedBy: who })
    .where(eq(dynTables.code, code))
    .returning();
  if (!row) throw new Error(`저장 대상 동적표가 없습니다: ${code}`);
  return toDynTable(row);
}

export async function deleteDynTable(db: Db, code: Code): Promise<void> {
  await db.delete(dynTables).where(eq(dynTables.code, code));
}
