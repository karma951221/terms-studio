"use client";

/**
 * 접어 둔 주석 칸 — 아이콘 버튼 하나로 서 있다가, 누르면 그 자리에 칸이 열린다.
 *
 * 설명은 「없어도 만들어지는」 값이다. 빈 칸으로 늘 펴 두면 생성 폼이 필드마다 결정을 시키고
 * (§9.1), 안 채운 칸이 남아 화면이 미완성처럼 읽힌다. 그래서 기본은 접힘이고,
 * 이미 값이 있으면(수정 진입) 펴진 채로 시작한다.
 *
 * 접힌 동안에도 `name` 인풋을 내보내지 않는다 — 서버 액션은 빈 문자열과 미제출을 같게 다룬다.
 */
import { useState } from "react";

import { FIELD_LABEL } from "@/app/_lib/labels";
import { FormRow } from "./FormRow";
import { IconButton, IconNote } from "./icons";

export function NoteField({
  id,
  name = "description",
  label = FIELD_LABEL.note,
  tooltip = `${FIELD_LABEL.note} — 이게 무엇인지 한 줄 남긴다 (안 써도 된다)`,
  placeholder,
  defaultValue = "",
}: {
  id: string;
  name?: string;
  label?: string;
  tooltip?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  const [open, setOpen] = useState(defaultValue !== "");

  if (!open) {
    return (
      <FormRow label={label}>
        <IconButton icon={<IconNote />} label={tooltip} onClick={() => setOpen(true)} />
      </FormRow>
    );
  }
  return (
    <FormRow label={label} htmlFor={id}>
      <textarea id={id} name={name} rows={2} autoFocus defaultValue={defaultValue} placeholder={placeholder} />
    </FormRow>
  );
}
