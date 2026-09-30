/**
 * 참조 그래프(C1 refs) 전용 저장소 접근 — drizzle 쿼리만, 규칙 없음.
 *
 * enum 값 삭제 영향의 값 행 정밀 집계를 여기 둔다 (`repo/values.ts` 의 ImpactSource 는 enum 값 타깃을
 * 셀 수 없다 — 어느 마스터 자리가 그 enum 을 쓰는지 알아야 해서 refs 가 마스터에서 자리를 구해 넘긴다).
 * 값 삭제는 값 행을 지우지 않는다 — 코드가 남아 「없는 값」 오류가 된다 (ADR-0078 결정 5). 세는 수는 그 오류가 날 행 수다.
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
