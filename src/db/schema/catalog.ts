/**
 * 카탈로그 스키마 — 구분자 정의 · enum · enum 값 · 코드 채번 시퀀스.
 *
 * 근거: docs/기능/구분자/구분자.md · ADR-0004 · ADR-0005 · ADR-0037.
 *
 * - 코드(`code`)는 시스템 자동 채번 · 불변 · 참조의 정본. id(uuid) 는 저장소용.
 * - **구분자는 식 하나다** (ADR-0037) — 종류 · 타입 · 기본값 · const 값 · 구조체 필드 · 부착이 없다.
 *   값 행도 없다: 값 자리는 「노드 × 마스터 필드」이고 마스터는 코드에 산다 (`src/domain/master`).
 * - 타임스탬프·created_by/updated_by 자리(who)를 남긴다. FK 는 걸지 않는다 (영역 결합 회피).
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { DiscriminatorResultType } from "@/domain/catalog/types";

/** 감사 컬럼 — 모든 카탈로그 테이블 공통. */
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** 만든 사람 (users.id). FK 없음. */
  createdBy: uuid("created_by"),
  /** 마지막으로 고친 사람 (users.id). FK 없음. */
  updatedBy: uuid("updated_by"),
};

/** 구분자 정의 — 식 하나 (ADR-0037). */
export const discriminators = pgTable("discriminators", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 자동 채번 코드 `D0001` … (불변). 문면이 참조하는 이름이다. */
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  /** AttachLevel — 식이 평가되는 자리 = 집계의 뿌리 (기능/구분자 §3.2). 채번 뒤 불변. */
  level: text("level").notNull(),
  description: text("description").notNull().default(""),
  /** 식 원문 — 파싱은 expression 모듈. 데이터로 저장한다 (기능/구분자 §3.1). */
  expression: text("expression").notNull(),
  /** 명시 결과 타입 (기능/구분자 §3.1). null = 미지정(과도기) — 추론 타입만 쓴다. */
  resultType: jsonb("result_type").$type<DiscriminatorResultType>(),
  ...audit,
});

/** enum 정의. 코드 `E0001` … (D-P1-7 — enum 정의도 코드+표시명). */
export const enums = pgTable("enums", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  ...audit,
});

/** enum 값. 코드는 enum 안에서 유일 (`V01` …). */
export const enumValues = pgTable(
  "enum_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enumId: uuid("enum_id")
      .notNull()
      .references(() => enums.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    label: text("label").notNull(),
    /** 선택지 표시 순서 (D-P1-8). */
    order: integer("order").notNull(),
    ...audit,
  },
  (t) => [uniqueIndex("enum_values_owner_code").on(t.enumId, t.code)],
);

/**
 * 코드 채번 시퀀스. (kind, scope) 마다 다음 순번을 갖는다.
 * - kind: "discriminator" | "enum" | "clause" | "appendix" 는 scope "" (전역)
 * - kind: "enumValue" 는 scope = enum 코드
 * 삭제된 코드의 순번은 재사용하지 않는다 — 순번은 오르기만 한다.
 */
export const codeSequences = pgTable(
  "code_sequences",
  {
    kind: text("kind").notNull(),
    scope: text("scope").notNull(),
    /** 다음에 줄 순번 (1부터). */
    next: integer("next").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.kind, t.scope] })],
);
