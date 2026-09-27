/**
 * 공용 값 저장소 — 실체 × **마스터 필드**의 값 자리(ValueSlot).
 *
 * 근거: ADR-0004 (null 없음 · 미입력은 상태) · ADR-0002 (탑재 = 값 스냅샷) · ADR-0037 (입력 마스터).
 *
 * - **미입력 = 행 없음.** 행이 있으면 명시 입력된 값이다. null 값 행은 존재하지 않는다.
 * - 소유자(owner)는 5레벨 실체(product · plan · coverage · subCoverage · benefit)와
 *   스냅샷 실체(productCoverage 와 그 하위 productSubCoverage · productBenefit · productPlan).
 *   소유자 id 는 각 영역 테이블의 id 이지만 FK 는 걸지 않는다 (영역 결합 회피 — 삭제 연쇄는 서비스가 한다).
 * - 경로는 마스터 경로 그대로 한 칸에 담는다: `coverage_basic.claim_name` · `waiver.applies` (기능/마스터 §3.2 — `폼키.필드키`).
 *   2026-09-12 이전의 (discriminator_code, field_code) 두 칸을 `field_path` 하나로 합쳤다 —
 *   자리가 구분자가 아니라 마스터 필드의 것이 됐기 때문이다.
 * - 부착 테이블(entity_attachments)은 없다. 그 레벨 마스터 필드는 모든 노드에 항상 있다.
 * - 값은 jsonb (Value = string | number | boolean | string[]).
 */
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { Value } from "@/domain/types";

export const entityValues = pgTable(
  "entity_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** ValueOwnerKind */
    ownerKind: text("owner_kind").notNull(),
    ownerId: uuid("owner_id").notNull(),
    /** 마스터 필드 경로 — `폼키.필드키` (기능/마스터 §3.2). */
    fieldPath: text("field_path").notNull(),
    value: jsonb("value").$type<Value>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [uniqueIndex("entity_values_slot").on(t.ownerKind, t.ownerId, t.fieldPath)],
);
