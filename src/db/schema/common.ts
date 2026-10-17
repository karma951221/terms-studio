/**
 * 공용 스키마 — 함수조항 정의 · 동적표 정의.
 *
 * 근거: docs/기능/함수조항/함수조항.md (§3.1 · §3.2 · §3.7) · ADR-0076.
 *
 * - 함수조항 1건 = 행 1건. 본문(노드 배열)·옵션 정의는 jsonb — 문면 마스터의 「문서 1건 = 트리 JSON 1건」
 *   (ADR-0012) 과 같은 결이고, 옵션·선택지 코드는 정의 안에서 유일하므로 별도 테이블이 필요 없다.
 * - 요구 구분자(required_*)는 저장 시 계산해 함께 둔다 — 구분자는 본문이 읽는 인자의 기본 연결, 담보속성은 직접 읽기 (ADR-0076 · 기능/함수조항 §3.3). 선언이 아니라 캐시.
 *   사용처 재검사·관계정보 뷰가 식을 다시 파싱하지 않고 읽는다.
 * - 코드는 code_sequences (kind `clause` · `clauseOption` · `clauseOptionValue` · `clausePreset`) 로 채번한다.
 * - 별표 마스터는 document 스키마(B3) 에 둔다.
 * - 사용처(참조) 역인덱스는 refs 영역(C1) 몫 — 여기에는 없다.
 *
 * 표준 Postgres 만 쓴다 (PGlite 전용 기능 금지).
 */
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { LocalDef } from "@/domain/clause/locals";
import type { ParamDef } from "@/domain/clause/params";
import type { PresetDef } from "@/domain/clause/presets";
import type { ClauseBody, ClauseMode, OptionDef } from "@/domain/clause/types";
import type { Inline } from "@/domain/clause/nodes";
import type { ColumnBasis, DynTableHeaders } from "@/domain/dyntable/types";
import type { Code } from "@/domain/types";

export const clauses = pgTable("clauses", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 자동 채번 코드 `C0001` … (불변). */
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  /** 유형 = 출력 모양 "inline" | "block" | "item" | "subitem" — 박스는 함수조항이 아니라 정적 마스터(boxes 테이블) */
  mode: text("mode").$type<ClauseMode>().notNull(),
  /** 본문 — inline 이면 Inline[], block 이면 Block[] (nodes.ts). */
  body: jsonb("body").$type<ClauseBody>().notNull(),
  /** 옵션 정의 목록 (OptionDef[]). */
  options: jsonb("options").$type<OptionDef[]>().notNull(),
  /** 인자 선언 목록 (ParamDef[] — 이름 · 타입 · 기본 연결, 최종 결정 2). 빈 목록 = 인자 0개. */
  params: jsonb("params").$type<ParamDef[]>().notNull().default([]),
  /** 내부 변수 목록 (LocalDef[] — 이름 · 식, 최종 결정 2). 빈 목록 = 내부 변수 0개. */
  locals: jsonb("locals").$type<LocalDef[]>().notNull().default([]),
  /** 프리셋 — 인자 연결 · 옵션 선택의 이름 붙은 조합 (ADR-0084). */
  presets: jsonb("presets").$type<PresetDef[]>().notNull().default([]),
  /** 요구 구분자 코드 (식에서 자동 추출). */
  requiredDiscriminators: jsonb("required_discriminators").$type<Code[]>().notNull(),
  /** 요구 담보속성 종류 코드. */
  requiredAttributes: jsonb("required_attributes").$type<Code[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** users.id — FK 없음. */
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
});

/**
 * 동적표 정의 — 기능/동적표 §3.1 (감액 지급금액 표).
 *
 * - 동적표 1건 = 행 1건. 함수조항과 같은 뼈대(코드 · 이름 · 인자)에 본문 대신 **표 규칙**(행 기준은 급부명 고정 · 열 기준 · 구분 칸 머리글 · 열 머리글 템플릿 네 벌 · 셀 템플릿).
 * - 템플릿은 인라인 노드 배열(jsonb) — 함수조항 본문과 같은 결. 인자는 값 인자만(저장 검사가 거부).
 * - 코드는 code_sequences (kind `dynTable`, scope "") 로 채번한다 — `DT000001` … (불변 · 유일).
 * - 사용처(담보약관의 `dynTableRef`) 역인덱스는 refs 영역 몫 — 여기에는 없다.
 */
export const dynTables = pgTable("dyn_tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** 자동 채번 코드 `DT000001` … (불변). */
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  /** 인자 선언 목록 (ParamDef[] — 값 인자만). 빈 목록 = 인자 0개. */
  params: jsonb("params").$type<ParamDef[]>().notNull().default([]),
  /** 열 기준 — "reduction"(감액 구간) | "none"(열 하나). */
  columnBasis: text("column_basis").$type<ColumnBasis>().notNull(),
  /** 구분 칸 머리글 — 기본 「구 분」. */
  rowHeader: text("row_header").notNull(),
  /** 열 머리글 템플릿 네 벌 { first, middle, last, single } — 각각 Inline[]. */
  headers: jsonb("headers").$type<DynTableHeaders>().notNull(),
  /** 셀 템플릿 (Inline[]). */
  cell: jsonb("cell").$type<Inline[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** users.id — FK 없음. */
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
});
