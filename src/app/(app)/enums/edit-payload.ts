import type { EnumFieldRevision, EnumFieldValue, NewEnum } from "@/domain/catalog";

import type { EnumEditData, EnumEditField } from "./edit-types";

const isNew = (key: string) => key.startsWith("new:");

export interface EnumEditPayload {
  /** 남는 필드 행 (빈 채로 남은 새 행을 뺀 것) — 저장이 바뀐 필드를 가릴 때 쓴다. 필드 표가 없으면 undefined. */
  fieldRows?: EnumEditField[];
  /** 서비스에 넘길 필드 — 저장된 필드는 `key`, 새 필드는 `ref`(`new:N`). */
  fields?: EnumFieldRevision[];
  /** 서비스에 넘길 값 — 저장된 값은 `code`, 새 값은 코드 없음. 칸은 남는 필드 키(새 필드는 ref)만. */
  values: { code?: string; label: string; fields?: Record<string, EnumFieldValue> }[];
}

/**
 * 편집 초안 → 서비스 입력 (상세 저장 · 생성이 같이 쓴다, 디자인원칙 §2 L2).
 * **빈 채로 남은 새 행은 버린다** — 새 필드 행 · 새 값 행 모두. 저장된 행은 이름을 비워도 남겨 서버 검사가 말하게 한다.
 * 뺀 필드의 칸은 값에서 걷는다. 새 필드는 ref(`new:N`)로 — 같은 저장의 값 칸이 같은 키로 가리킨다.
 */
export function enumEditPayload(input: EnumEditData): EnumEditPayload {
  const fieldRows = input.fields?.filter((field) => field.label.trim() || !isNew(field.key));
  const fields = fieldRows?.map((field): EnumFieldRevision => (isNew(field.key) ? { ref: field.key, label: field.label, type: field.type } : { key: field.key, label: field.label, type: field.type }));
  const live = new Set(fieldRows?.map((field) => field.key));
  const values = input.values
    .filter((value) => value.label.trim() || !isNew(value.code))
    .map((value) => {
      const cells = fields && value.fields ? Object.fromEntries(Object.entries(value.fields).filter(([key]) => live.has(key))) : value.fields;
      return { ...(isNew(value.code) ? {} : { code: value.code }), label: value.label, ...(cells ? { fields: cells } : {}) };
    });
  return { ...(fieldRows ? { fieldRows, fields } : {}), values };
}

/** 생성 화면의 초안 → `NewEnum` — 행이 모두 새 행이라 필드는 ref, 값은 코드 없이. 빈 새 행은 버린다. */
export function newEnumPayload(input: EnumEditData): NewEnum {
  const { fields, values } = enumEditPayload(input);
  return {
    label: input.label.trim(),
    ...(input.description ? { description: input.description } : {}),
    ...(fields?.length ? { fields: fields.map((field) => ({ ref: field.ref ?? field.key ?? "", label: field.label, type: field.type })) } : {}),
    values: values.map(({ label, fields: cells }) => ({ label, ...(cells && Object.keys(cells).length > 0 ? { fields: cells } : {}) })),
  };
}
