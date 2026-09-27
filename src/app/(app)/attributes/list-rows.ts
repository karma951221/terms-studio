import { includesQuery } from "@/app/_lib/list";
import type { AttributeKind, AttributeValue } from "@/domain/product";

/** 목록 한 행 — 유형 + 그 유형의 값 하나 (값이 없는 유형이면 `value` 없음). */
export interface AttributeValueRow {
  kind: AttributeKind;
  value?: AttributeValue;
}

/** 유형 순 · 유형 안에서는 코드 순(= 값 순서) — 저장소가 이미 그 순서로 준다. */
export function attributeValueRows(kinds: readonly AttributeKind[]): AttributeValueRow[] {
  return kinds.flatMap((kind) => (kind.values.length === 0 ? [{ kind }] : kind.values.map((value) => ({ kind, value }))));
}

export function matchesAttributeRow(q: string, row: AttributeValueRow): boolean {
  return includesQuery(q, [row.kind.code, row.kind.label, row.value?.label ?? "", row.value?.fragment ?? ""]);
}
