"use client";

import { EditShell, useEditField } from "@/app/_components/EditShell";
import { FormRow } from "@/app/_components/FormRow";
import { ACTION_LABEL, ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";
import { ENUMS_MENU, menuCrumb } from "@/app/_lib/menu";

import { createEnumEditAction } from "../edit-actions";
import type { EnumEditData } from "../edit-types";
import { duplicateValueCodes, FieldsEditor, ValuesEditor } from "../[code]/EnumTables";

/** 이름 칸 — 목록 검색어가 넘어왔고 아직 그대로면 「제안」 배지. */
function NameRow({ suggested }: { suggested: string }) {
  const name = useEditField<string>("label");
  return <FormRow label={NAME_LABEL.enum} htmlFor="enum-label">
    <input id="enum-label" value={name.value} onChange={(event) => name.setValue(event.target.value)} autoFocus className="ts-field-direct" />
    {suggested && name.value === suggested ? <span className="ts-badge proposed">{FIELD_LABEL.suggested}</span> : null}
  </FormRow>;
}

/**
 * 열거형변수 생성 (기능/열거형 §4.2) — 이름 · 필드 · 값(값별 필드 칸)을 「생성」 한 번에. 상세 편집기의 필드 표 · 값 표(`EnumTables`)를 편집 모드로 그대로 쓴다.
 * 빈 새 행은 제출 때 버린다(디자인원칙 §2 L2) — 값 하나만 적어도 생성된다. 이름이 비었거나 값 이름이 겹치면 「생성」이 잠긴다(서버도 거부).
 * 처음부터 값 빈 행 둘 — 「여러 개 넣는 자리」로 읽힌다.
 */
export function EnumCreator({ suggested }: { suggested: string }) {
  const initial: EnumEditData = { label: suggested, description: "", fields: [], values: [{ code: "new:1", label: "" }, { code: "new:2", label: "" }] };
  return <EditShell
    initial={initial}
    title={newLabel(ENTITY_LABEL.enum)}
    path={[menuCrumb(ENUMS_MENU)]}
    initialMode="edit"
    createLabel={ACTION_LABEL.create}
    saveAction={(input) => createEnumEditAction(input)}
    saveDisabled={(data) => !data.label.trim() || duplicateValueCodes(data.values).size > 0}
  >
    <div className="ts-l2-main">
      <NameRow suggested={suggested} />
      <FieldsEditor />
      <ValuesEditor />
    </div>
  </EditShell>;
}
