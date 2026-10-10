/**
 * 문면 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/document, 조립은 src/services/document).
 *
 * 문서 행 ↔ `DocumentRecord`, 별표 행 ↔ `Appendix`, 박스 행 ↔ `Box` 매핑을 여기서 한다.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import type { Appendix } from "@/domain/document/appendix";
import type { Box } from "@/domain/document/box";
import type { DocumentNode } from "@/domain/document/nodes";
import { withCodes } from "@/domain/document/pcode";
import type { Code, Id } from "@/domain/types";

import { appendices, boxes, codeSequences, documents } from "../schema";
import type { Db } from "./types";

export type DocumentKind = "special" | "general";

/** 문서 메타 — 종류 · 소유 · 제목 · updated. */
export interface DocumentSummary {
  id: Id;
  kind: DocumentKind;
  /** special 의 담보 id. */
  ownerId?: Id;
  title: string;
  /** special 이 지정한 대응 보통약관 (D-P4-5). */
  generalDocumentId?: Id;
  /** 판 번호 (ADR-0074) — 새 문서 1, 문서 행을 바꾸는 저장마다 +1. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy?: Id;
}

export interface DocumentRecord extends DocumentSummary {
  tree: DocumentNode;
}

export interface NewDocumentRow {
  kind: DocumentKind;
  ownerId?: Id;
  title: string;
  generalDocumentId?: Id;
  tree: DocumentNode;
}

type Row = typeof documents.$inferSelect;

function toSummary(r: Row): DocumentSummary {
  return {
    id: r.id,
    kind: r.kind as DocumentKind,
    ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    title: r.title,
    ...(r.generalDocumentId ? { generalDocumentId: r.generalDocumentId } : {}),
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(r.updatedBy ? { updatedBy: r.updatedBy } : {}),
  };
}

function toRecord(r: Row): DocumentRecord {
  // P코드 없는 옛 트리는 읽을 때 채운다 — 편집기의 참조 대상이 코드다 (ADR-0072 결정 10, 저장이 같은 규칙으로 채운다)
  return { ...toSummary(r), tree: withCodes(r.tree) };
}

// ───────────────────────────── 문서 ─────────────────────────────

export async function insertDocument(db: Db, input: NewDocumentRow, who: Id): Promise<DocumentRecord> {
  const [row] = await db
    .insert(documents)
    .values({
      kind: input.kind,
      ownerId: input.ownerId ?? null,
      title: input.title,
      generalDocumentId: input.generalDocumentId ?? null,
      tree: input.tree,
      createdBy: who,
      updatedBy: who,
    })
    .returning();
  return toRecord(row);
}

export async function loadDocument(db: Db, id: Id): Promise<DocumentRecord | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return row ? toRecord(row) : undefined;
}

/** 담보의 문면 (담보 1 : 문서 1). */
export async function findByOwner(db: Db, ownerId: Id): Promise<DocumentRecord | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.ownerId, ownerId)).limit(1);
  return row ? toRecord(row) : undefined;
}

/** 메타 목록 — 종류 · 제목순. */
export async function listDocuments(db: Db, kind?: DocumentKind): Promise<DocumentSummary[]> {
  const q = db
    .select({
      id: documents.id,
      kind: documents.kind,
      ownerId: documents.ownerId,
      title: documents.title,
      generalDocumentId: documents.generalDocumentId,
      version: documents.version,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      updatedBy: documents.updatedBy,
    })
    .from(documents)
    .orderBy(asc(documents.kind), asc(documents.title));
  const rows = kind ? await q.where(eq(documents.kind, kind)) : await q;
  return rows.map((r) => toSummary({ ...r, tree: null as unknown as DocumentNode, createdBy: null }));
}

/** 트리 포함 전체 (사용처 스캔용). */
export async function listDocumentRecords(db: Db): Promise<DocumentRecord[]> {
  const rows = await db.select().from(documents).orderBy(asc(documents.kind), asc(documents.title));
  return rows.map(toRecord);
}

export interface DocumentPatch {
  title?: string;
  tree?: DocumentNode;
  /** null = 해제. */
  generalDocumentId?: Id | null;
}

function patchSet(patch: DocumentPatch, who: Id) {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.tree !== undefined ? { tree: patch.tree } : {}),
    ...(patch.generalDocumentId !== undefined ? { generalDocumentId: patch.generalDocumentId } : {}),
    // 판 번호 — 문서 행을 바꾸는 모든 저장이 올린다 (ADR-0074). 제목 · 대응 보통약관 · 시드 적재도 원본을 바꾸는 경로다.
    version: sql`${documents.version} + 1`,
    updatedAt: new Date(),
    updatedBy: who,
  };
}

export async function saveDocument(db: Db, id: Id, patch: DocumentPatch, who: Id): Promise<void> {
  const [row] = await db.update(documents).set(patchSet(patch, who)).where(eq(documents.id, id)).returning({ id: documents.id });
  if (!row) throw new Error(`저장 대상 문서가 없습니다: ${id}`);
}

/**
 * 판이 `expectedVersion` 일 때만 저장하고 판을 올린다 — 조건부 UPDATE 한 문장이라 사이에 끼어든 저장을 놓치지 않는다 (ADR-0074 결정 4).
 * 판이 다르면(또는 문서가 없으면) 아무것도 바꾸지 않고 false.
 */
export async function saveDocumentAt(db: Db, id: Id, expectedVersion: number, patch: DocumentPatch, who: Id): Promise<boolean> {
  const rows = await db
    .update(documents)
    .set(patchSet(patch, who))
    .where(and(eq(documents.id, id), eq(documents.version, expectedVersion)))
    .returning({ id: documents.id });
  return rows.length > 0;
}

export async function deleteDocument(db: Db, id: Id): Promise<void> {
  await db.delete(documents).where(eq(documents.id, id));
}

// ───────────────────────────── 별표 ─────────────────────────────

/**
 * 별표 순번 — 카탈로그 · 함수조항과 같은 code_sequences 를 쓰되 kind 는 `appendix` (scope 전역 "").
 * 한 문장의 upsert 라 동시 호출에도 안전하고, 삭제된 순번은 재사용하지 않는다.
 */
export async function nextAppendixSeq(db: Db): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind: "appendix", scope: "", next: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.kind, codeSequences.scope],
      set: { next: sql`${codeSequences.next} + 1` },
    })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

type AppendixRow = typeof appendices.$inferSelect;

function toAppendix(r: AppendixRow): Appendix {
  return { code: r.code, name: r.name };
}

export async function insertAppendix(db: Db, a: Appendix, who: Id): Promise<void> {
  await db.insert(appendices).values({ code: a.code, name: a.name, createdBy: who, updatedBy: who });
}

export async function loadAppendix(db: Db, code: Code): Promise<Appendix | undefined> {
  const [row] = await db.select().from(appendices).where(eq(appendices.code, code)).limit(1);
  return row ? toAppendix(row) : undefined;
}

/** 코드순. */
export async function listAppendices(db: Db): Promise<Appendix[]> {
  const rows = await db.select().from(appendices).orderBy(asc(appendices.code));
  return rows.map(toAppendix);
}

export async function saveAppendix(db: Db, a: Appendix, who: Id): Promise<void> {
  const [row] = await db
    .update(appendices)
    .set({ name: a.name, updatedAt: new Date(), updatedBy: who })
    .where(eq(appendices.code, a.code))
    .returning({ id: appendices.id });
  if (!row) throw new Error(`저장 대상 별표가 없습니다: ${a.code}`);
}

export async function deleteAppendix(db: Db, code: Code): Promise<void> {
  await db.delete(appendices).where(eq(appendices.code, code));
}

/** 목록이 「최종수정 · 수정자」를 내려면 필요한 감사 정보 — 코드로 찾는다 (구분자 목록과 같은 모양). */
export async function appendixAudits(db: Db): Promise<Map<Code, { updatedAt: Date; updatedBy: Id | null }>> {
  const rows = await db
    .select({ code: appendices.code, updatedAt: appendices.updatedAt, updatedBy: appendices.updatedBy })
    .from(appendices);
  return new Map(rows.map((row) => [row.code, { updatedAt: row.updatedAt, updatedBy: row.updatedBy }] as const));
}

// ───────────────────────────── 박스 (정적 마스터) ─────────────────────────────

/** 박스 순번 — code_sequences kind `box` (scope 전역 ""). 별표와 같은 한 문장 upsert. */
export async function nextBoxSeq(db: Db): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind: "box", scope: "", next: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.kind, codeSequences.scope],
      set: { next: sql`${codeSequences.next} + 1` },
    })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

type BoxRow = typeof boxes.$inferSelect;

function toBox(r: BoxRow): Box {
  return { code: r.code, name: r.name, title: r.title, lines: r.lines };
}

export async function insertBox(db: Db, x: Box, who: Id): Promise<void> {
  await db.insert(boxes).values({ code: x.code, name: x.name, title: x.title, lines: x.lines, createdBy: who, updatedBy: who });
}

export async function loadBox(db: Db, code: Code): Promise<Box | undefined> {
  const [row] = await db.select().from(boxes).where(eq(boxes.code, code)).limit(1);
  return row ? toBox(row) : undefined;
}

/** 코드순. */
export async function listBoxes(db: Db): Promise<Box[]> {
  const rows = await db.select().from(boxes).orderBy(asc(boxes.code));
  return rows.map(toBox);
}

export async function saveBox(db: Db, x: Box, who: Id): Promise<void> {
  const [row] = await db
    .update(boxes)
    .set({ name: x.name, title: x.title, lines: x.lines, updatedAt: new Date(), updatedBy: who })
    .where(eq(boxes.code, x.code))
    .returning({ id: boxes.id });
  if (!row) throw new Error(`저장 대상 박스가 없습니다: ${x.code}`);
}

export async function deleteBox(db: Db, code: Code): Promise<void> {
  await db.delete(boxes).where(eq(boxes.code, code));
}

export async function boxAudits(db: Db): Promise<Map<Code, { updatedAt: Date; updatedBy: Id | null }>> {
  const rows = await db.select({ code: boxes.code, updatedAt: boxes.updatedAt, updatedBy: boxes.updatedBy }).from(boxes);
  return new Map(rows.map((row) => [row.code, { updatedAt: row.updatedAt, updatedBy: row.updatedBy }] as const));
}
