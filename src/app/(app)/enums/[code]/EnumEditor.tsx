"use client";

import Link from "next/link";
import { useState } from "react";

import { EditShell, Field } from "@/app/_components/EditShell";
import { IconButton, IconClose } from "@/app/_components/icons";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { ENTITY_LABEL, NAME_LABEL, REFERENCE_VIA_LABEL } from "@/app/_lib/labels";
import type { EnumDef } from "@/domain/catalog";
import { formatCoordinate } from "@/domain/coordinate";
import type { RefEdge } from "@/domain/refs";

import { ENUMS_MENU, menuCrumb } from "@/app/_lib/menu";
import { removeEnumEditAction, saveEnumEditAction } from "../edit-actions";
import type { EnumEditData } from "../edit-types";
import { FieldsEditor, ValuesEditor } from "./EnumTables";

/**
 * 열거값 추가의 재검사 목록 — 저장 뒤 「재검사 N건」 (ADR-0078 결정 4). 값을 나열해 비교하는 곳은 새 값을 조용히 놓치므로
 * 사람이 다시 본다. 저장은 이미 끝났고 막지 않는다. 좌표는 고치러 가는 링크.
 */
function RecheckList({ items, onClose }: { items: readonly RefEdge[]; onClose: () => void }) {
  return <section className="ts-recheck" role="status" aria-label="재검사 목록">
    <p className="ts-l2-side-title">재검사 <span className="ts-count"><b>{items.length}</b>건</span> — 새 값을 이 식들이 놓치지 않는지 확인한다<IconButton icon={<IconClose />} label="재검사 목록 닫기" onClick={onClose} /></p>
    <table className="ts-table"><thead><tr><th className="col-fixed-md">형태</th><th className="col-flex">좌표</th></tr></thead>
      <tbody>{items.map((item, index) => {
        const href = coordinateHref(item.at);
        const coordinate = formatCoordinate(item.at, { source: true });
        return <tr key={index}><td>{REFERENCE_VIA_LABEL[item.via]}</td><td>{href ? <Link href={href}>{coordinate}</Link> : coordinate}</td></tr>;
      })}</tbody>
    </table>
  </section>;
}

type EditorProps = { item: EnumDef };

function EnumEditorBody({ item, onSaved }: EditorProps & { onSaved: (recheck: RefEdge[]) => void }) {
  const values = [...item.values].sort((a, b) => a.order - b.order).map(({ code, label, fields }) => ({ code, label, fields: { ...fields } }));
  const fields = [...(item.fields ?? [])].sort((a, b) => a.order - b.order).map(({ key, label, type }) => ({ key, label, type }));
  const initial: EnumEditData = { label: item.label, description: item.description ?? "", fields, values };
  return <EditShell initial={initial} title={item.label} code={item.code} path={[menuCrumb(ENUMS_MENU)]} saveAction={(input, confirm) => saveEnumEditAction(item.code, { ...input, values: input.values.filter((value) => value.label.trim() || !value.code.startsWith("new:")) }, confirm)} onSaved={(outcome) => onSaved(outcome.recheck ?? [])} deleteAction={removeEnumEditAction.bind(null, item.code)} deleteLabel={`${item.label} 삭제`} deleteTooltip={`${ENTITY_LABEL.enum} ${item.label}(${item.code}) 삭제`} deleteSuccessHref="/enums">
    <div className="ts-l2-main">
      <Field name="label" label={NAME_LABEL.enum} />
      <FieldsEditor />
      <ValuesEditor />
    </div>
  </EditShell>;
}

/**
 * 상세 · 수정. 편집 본문은 값 · 필드 코드 목록(`signature`)이 바뀌면 다시 마운트되지만(새로 발급된 코드로 다시 그림),
 * 재검사 목록은 그 바깥에 있어 저장 뒤 새로고침에도 남는다.
 */
export function EnumEditor(props: EditorProps) {
  const [recheck, setRecheck] = useState<RefEdge[]>([]);
  // 새로 발급된 값 · 필드 코드로 다시 그린다 — 필드 코드도 서명에 넣는다
  const signature = [...props.item.values.map((value) => value.code), ...(props.item.fields ?? []).map((field) => field.key)].join(":");
  return <>
    <EnumEditorBody key={`${props.item.code}:${signature}`} {...props} onSaved={setRecheck} />
    {recheck.length > 0 ? <RecheckList items={recheck} onClose={() => setRecheck([])} /> : null}
  </>;
}
