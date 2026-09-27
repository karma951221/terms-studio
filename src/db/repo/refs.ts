/**
 * 참조 그래프(C1 refs) 전용 저장소 접근 — drizzle 쿼리만, 규칙 없음.
 *
 * enum 값 삭제의 값 행 정밀 집계·삭제를 여기 둔다 (`repo/values.ts` 의 ImpactSource 는 enum 값 타깃을
 * 셀 수 없다 — 어느 마스터 자리가 그 enum 을 쓰는지 알아야 해서 refs 가 마스터에서 자리를 구해 넘긴다).
 */
import { and, inArray, sql } from "drizzle-orm";

import type { Code } from "@/domain/types";

import { entityValues } from "../schema";
import type { Db } from "./types";

/** enum 을 타입으로 쓰는 마스터 값 자리 하나. `list` 면 배열 원소로 든다. */
export interface EnumSlot {
  /** 마스터 필드 경로 (`waiver.reasons`). */
  path: string;
  list: boolean;
}

function inSlots(slots: readonly EnumSlot[]) {
  return inArray(
    entityValues.fieldPath,
    slots.map((s) => s.path),
  );
}

/** jsonb `?` : 문자열 값이면 그 문자열과 같은지, 배열이면 원소로 있는지 — scalar · list<enum> 을 한 식으로 본다. */
function hasValue(valueCode: Code) {
  return sql`${entityValues.value} ? ${valueCode}`;
}

/** 그 enum 값을 고른 값 행 수 (주어진 자리들 안에서). */
export async function countEnumValueRows(db: Db, slots: readonly EnumSlot[], valueCode: Code): Promise<number> {
  if (slots.length === 0) return 0;
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(entityValues).where(and(inSlots(slots), hasValue(valueCode)));
  return row?.n ?? 0;
}

/**
 * 그 enum 값을 고른 값 행 연쇄 삭제 — scalar 자리는 행 삭제, list<enum> 자리는 배열에서 원소 제거
 * (원소를 뺀 행이 빈 배열이 되면 행 삭제 — 「미입력」으로 되돌린다).
 * 원래부터 빈 배열이던 행(명시적 「(선택 없음)」)은 그 값을 담은 적이 없으니 건드리지 않는다 (점검 M17 · ADR-0004).
 */
export async function purgeEnumValueRows(db: Db, slots: readonly EnumSlot[], valueCode: Code): Promise<void> {
  const scalar = slots.filter((s) => !s.list);
  const list = slots.filter((s) => s.list);
  if (scalar.length > 0) await db.delete(entityValues).where(and(inSlots(scalar), hasValue(valueCode)));
  if (list.length > 0) {
    const touched = await db
      .update(entityValues)
      .set({ value: sql`${entityValues.value} - ${valueCode}`, updatedAt: sql`now()` })
      .where(and(inSlots(list), hasValue(valueCode)))
      .returning({ id: entityValues.id });
    if (touched.length === 0) return;
    await db.delete(entityValues).where(
      and(
        inArray(
          entityValues.id,
          touched.map((r) => r.id),
        ),
        sql`${entityValues.value} = '[]'::jsonb`,
      ),
    );
  }
}
