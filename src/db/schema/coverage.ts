/**
 * 담보 스키마 — 담보 > 세부보장 > 급부 (도메인모델 §1 · 기능/담보 §3.1).
 *
 * - 실체는 뼈대만: id · 관계(FK) · 순서(order) · 이름. 그 외 입력값은 공용 값 저장소(entity_values)에
 *   owner_kind = coverage | subCoverage | benefit 로 산다. 부착 관계도 entity_attachments.
 * - 형제 간 이름 중복 금지는 UQ(부모, name). 담보명은 마스터 전역 유일 (D-P2-2).
 * - 담보코드 `COV000001` 은 시스템 채번(code_sequences kind `coverage`) · 불변 · 유일 (기능/담보 §3.1, 2026-09-27).
 * - 순서는 데이터 — order 0부터. 순서 변경은 트리 편집 액션이 전체를 다시 매긴다.
 * - 하위 삭제는 FK cascade. 값 행 연쇄 삭제는 서비스가 한다 (값 저장소에 FK 없음).
 * - 문면(담보약관 마스터)은 B3 document 영역 소유 — document_id 자리만 두고 FK 는 걸지 않는다.
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** 감사 컬럼 — 카탈로그와 같은 모양. */
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
};

export const coverages = pgTable("coverages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 담보코드 `COV000001` … — 시스템 채번 · 등록 후 불변 · 유일. 마이그레이션 0015 가 기존 행을 생성 순으로 채웠다. */
  code: text("code").notNull().unique(),
  /** 담보명 — 마스터 전역 유일. 뼈대 속성(스냅샷 비대상). */
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  /** 담보약관 마스터 문서 id (B3). 문면 없는 담보 허용 → nullable. */
  documentId: uuid("document_id"),
  /**
   * 담보분류 — 열거형 「담보분류」(E0009)의 값 코드 (ADR-0090 결정 1). 기본 특약 그룹의 재료. 필수지만 열은 null 을 받는다 — 옛 데이터 ·
   * 우회 저장은 미입력(조립 notEntered)이다. 열거형은 데이터라 FK 를 걸지 않는다 — 지운 값의 코드는 남아 「없는 값」이 된다(기능/열거형 §3.2).
   * 뼈대 속성이라 스냅샷 대상이 아니다.
   */
  category: text("category"),
  ...audit,
});

export const subCoverages = pgTable(
  "sub_coverages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coverageId: uuid("coverage_id")
      .notNull()
      .references(() => coverages.id, { onDelete: "cascade" }),
    /** 노드 키 `01` · `02` … — 담보 안 유일 · 불변 · 순서와 무관 (ADR-0087 결정 2). 0027 이 형제 순서로 채웠다. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** 형제 순서 (0부터) — 문면 수록·반복 순회 순서. */
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("sub_coverages_sibling_name").on(t.coverageId, t.name), uniqueIndex("sub_coverages_sibling_key").on(t.coverageId, t.key)],
);

export const benefits = pgTable(
  "benefits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subCoverageId: uuid("sub_coverage_id")
      .notNull()
      .references(() => subCoverages.id, { onDelete: "cascade" }),
    /** 노드 키 `1` · `2` … — 세부보장 안 유일 · 불변 (ADR-0087 결정 2). */
    key: text("key").notNull(),
    name: text("name").notNull(),
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("benefits_sibling_name").on(t.subCoverageId, t.name), uniqueIndex("benefits_sibling_key").on(t.subCoverageId, t.key)],
);
