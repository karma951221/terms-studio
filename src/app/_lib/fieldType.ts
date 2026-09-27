/**
 * 타입 필드의 화면 모양 ↔ 도메인 `FieldType` 사이의 자잘한 변환.
 *
 * 화면은 「목록값」 하나에 **복수 체크박스**를 붙여 받지만, 도메인은 `enum` 과 `list<enum>`
 * 두 종류다 (2026-09-09). 선택지가 둘로 갈려 있으면 「선택형」과 「선택형(복수)」가
 * 나란히 서서 무엇이 다른지 이름만으로는 안 보인다.
 */
import type { FieldType, FieldTypeKind } from "@/domain/types";

/** 선택지(enum)를 골라야 하는 종류인가. */
export function isChoiceKind(kind: FieldTypeKind): boolean {
  return kind === "enum" || kind === "list<enum>";
}

/** 라디오 · 셀렉트에 보이는 값 — `list<enum>` 도 화면에서는 「목록값」 하나다. */
export function baseKind(kind: FieldTypeKind): FieldTypeKind {
  return kind === "list<enum>" ? "enum" : kind;
}

export function isMulti(kind: FieldTypeKind): boolean {
  return kind === "list<enum>";
}

/** 고른 종류 + 복수 여부 → 도메인 kind. */
export function resolveKind(base: FieldTypeKind, multi: boolean): FieldTypeKind {
  return base === "enum" && multi ? "list<enum>" : base;
}

/** 고른 종류 + 복수 여부 + 선택지 코드 → 도메인 FieldType. */
export function resolveType(base: FieldTypeKind, multi: boolean, enumCode: string): FieldType {
  const kind = resolveKind(base, multi);
  return isChoiceKind(kind) ? { kind: kind as "enum" | "list<enum>", enumCode } : ({ kind } as FieldType);
}
