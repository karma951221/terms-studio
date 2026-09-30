/**
 * 조건부 필드 판정 — `MasterField.visibleWhen` · `singleWhen` (기능/마스터 §3.4).
 * 읽개는 같은 폼 안 필드 키로 값 자리를 준다 — 화면(초안)과 서비스(최종 상태)가 같은 판정을 쓴다.
 */
import type { MasterField, FormFieldReader, FieldCondition } from "./types";

function holds(condition: FieldCondition, read: FormFieldReader): boolean {
  const slot = read(condition.field);
  return slot?.entered === true && slot.value === condition.equals;
}

/** 이 필드의 자리가 지금 있나 — 조건이 없으면 늘 있다. */
export function isFieldShown(field: MasterField, read: FormFieldReader): boolean {
  return field.visibleWhen === undefined || holds(field.visibleWhen, read);
}

/** list<enum> 필드를 지금 하나만 고르나 — `singleWhen` 조건이 맞을 때. */
export function isFieldSingle(field: MasterField, read: FormFieldReader): boolean {
  return field.singleWhen !== undefined && holds(field.singleWhen, read);
}
