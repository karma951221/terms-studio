/**
 * 공용조항 저장소 — drizzle 쿼리만. 규칙 없음 (규칙은 src/domain/clause, 조립은 src/services/clause).
 *
 * 도메인 객체(Clause) ↔ 행 매핑. 본문·옵션은 jsonb 그대로.
 * 채번은 카탈로그와 같은 code_sequences 테이블을 쓰되 kind 를 달리한다 (`clause` · `clauseOption` · `clauseOptionValue`).
 */
import { asc, eq, sql } from "drizzle-orm";

import type { ClauseCodeKind, ClauseNextSeq } from "@/domain/clause/codes";
import type { Block, Inline, ItemBodyNode, SubitemBodyNode } from "@/domain/clause/nodes";
import { withClauseCodes } from "@/domain/clause/pcode";
import type { Clause } from "@/domain/clause/types";
import type { Code, Id } from "@/domain/types";

import { clauses, codeSequences } from "../schema";
import type { Db } from "./types";

// ───────────────────────────── 채번 ─────────────────────────────

const SEQ_KIND: Record<ClauseCodeKind, string> = {
  clause: "clause",
  option: "clauseOption",
  optionValue: "clauseOptionValue",
};

/** (kind, scope) 의 다음 순번 — 한 문장의 upsert 라 동시 호출에도 안전. 삭제된 순번은 재사용하지 않는다. */
export async function nextClauseSeq(db: Db, kind: ClauseCodeKind, scope: string): Promise<number> {
  const [row] = await db
    .insert(codeSequences)
    .values({ kind: SEQ_KIND[kind], scope, next: 2 })
    .onConflictDoUpdate({
      target: [codeSequences.kind, codeSequences.scope],
      set: { next: sql`${codeSequences.next} + 1` },
    })
    .returning({ next: codeSequences.next });
  return row.next - 1;
}

export function clauseSeqSource(db: Db): ClauseNextSeq {
  return (kind, scope) => nextClauseSeq(db, kind, scope);
}

// ───────────────────────────── 매핑 ─────────────────────────────

type ClauseRow = typeof clauses.$inferSelect;

function toClause(row: ClauseRow): Clause {
  const base = {
    code: row.code,
    label: row.label,
    options: row.options,
    // 인자 0개는 키를 싣지 않는다 — 도메인이 만든 정의와 같은 모양(빈 목록 = 키 없음)
    ...(row.params && row.params.length > 0 ? { params: row.params } : {}),
    ...(row.locals && row.locals.length > 0 ? { locals: row.locals } : {}),
    required: { discriminators: row.requiredDiscriminators, attributes: row.requiredAttributes },
  };
  switch (row.mode) {
    case "inline":
      return { ...base, mode: "inline", body: row.body as Inline[] };
    case "item":
      return { ...base, mode: "item", body: withClauseCodes(row.body as ItemBodyNode[]) };
    case "subitem":
      return { ...base, mode: "subitem", body: withClauseCodes(row.body as SubitemBodyNode[]) };
    default:
      // P코드 없는 옛 행은 읽을 때 채운다 — 「이 함수조항」 참조가 코드로 가리킨다 (ADR-0072 결정 10, 저장이 같은 규칙으로 채운다)
      return { ...base, mode: "block", body: withClauseCodes(row.body as Block[]) };
  }
}

function toRow(def: Clause) {
  return {
    code: def.code,
    label: def.label,
    mode: def.mode,
    body: def.body,
    options: def.options,
    params: def.params ?? [],
    locals: def.locals ?? [],
    requiredDiscriminators: def.required.discriminators,
    requiredAttributes: def.required.attributes,
  };
}

// ───────────────────────────── CRUD ─────────────────────────────

export async function findClauseRow(db: Db, code: Code): Promise<ClauseRow | undefined> {
  const [row] = await db.select().from(clauses).where(eq(clauses.code, code)).limit(1);
  return row;
}

export async function loadClause(db: Db, code: Code): Promise<Clause | undefined> {
  const row = await findClauseRow(db, code);
  return row ? toClause(row) : undefined;
}

/** 코드 순 전체 목록. */
export async function listClauses(db: Db): Promise<Clause[]> {
  const rows = await db.select().from(clauses).orderBy(asc(clauses.code));
  return rows.map(toClause);
}

export async function insertClause(db: Db, def: Clause, who: Id): Promise<void> {
  await db.insert(clauses).values({ ...toRow(def), createdBy: who, updatedBy: who });
}

/** 기존 정의 덮어쓰기. 코드는 바뀌지 않는다. */
export async function saveClause(db: Db, def: Clause, who: Id): Promise<void> {
  const rows = await db
    .update(clauses)
    .set({ ...toRow(def), updatedAt: new Date(), updatedBy: who })
    .where(eq(clauses.code, def.code))
    .returning({ id: clauses.id });
  if (rows.length === 0) throw new Error(`저장 대상 함수조항이 없습니다: ${def.code}`);
}

export async function deleteClause(db: Db, code: Code): Promise<void> {
  await db.delete(clauses).where(eq(clauses.code, code));
}

/** 감사 정보 (who · when). */
export async function clauseAudit(db: Db, code: Code) {
  const row = await findClauseRow(db, code);
  if (!row) return undefined;
  return { createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy };
}

/** 목록 한 판에 쓸 감사 정보 — code → (언제 · 누가). 코드마다 따로 묻지 않는다. */
export async function clauseAudits(db: Db): Promise<Map<Code, { updatedAt: Date; updatedBy: Id | null }>> {
  const rows = await db.select({ code: clauses.code, updatedAt: clauses.updatedAt, updatedBy: clauses.updatedBy }).from(clauses);
  return new Map(rows.map((row) => [row.code, { updatedAt: row.updatedAt, updatedBy: row.updatedBy }] as const));
}
