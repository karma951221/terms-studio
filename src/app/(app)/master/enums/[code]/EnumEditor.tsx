"use client";

import { useRef } from "react";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconDown, IconPlus, IconUp } from "@/app/_components/icons";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, addLabel } from "@/app/_lib/labels";
import type { EnumDef } from "@/domain/catalog";
import type { ReactNode } from "react";

import { ENUMS_CRUMB } from "../../MasterTabs";
import { removeEnumEditAction, saveEnumEditAction } from "../edit-actions";
import type { EnumEditData, EnumEditValue } from "../edit-types";

function ValuesEditor({ usage }: { usage: Record<string, number> }) {
  const field = useEditField<EnumEditValue[]>("values");
  const next = useRef(1);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  // 저장된 값 행도 ✕ 로 초안에서 뺀다 — 서버 삭제는 저장 때, 영향 확인도 그때 한 번 (디자인원칙 §2 L2 표 · 점검 2026-09-27 D2).
  // 「+」 는 빈 행을 표에 바로 넣는다 — 생성 화면(EnumValuesInput)과 같은 규칙. 빈 채로 남은 새 행은 저장 때 버린다 (EnumEditor.saveAction).
  const add = () => {
    const code = `new:${next.current++}`;
    field.setValue([...field.value, { code, label: "" }]);
    requestAnimationFrame(() => inputs.current.get(code)?.focus());
  };
  const move = (index: number, delta: number) => {
    const values = [...field.value];
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    [values[index], values[target]] = [values[target]!, values[index]!];
    field.setValue(values);
  };
  return <>
    {field.mode === "edit" ? <div className="ts-values-head"><span className="ts-count">{field.value.length}</span><IconButton icon={<IconPlus />} label={addLabel(FIELD_LABEL.value)} disabled={field.pending} onClick={add} /></div> : null}
    <table className="ts-table"><thead><tr><th className="col-num">{FIELD_LABEL.order}</th><th className="col-flex">{FIELD_LABEL.valueName}</th><th className="col-num">{FIELD_LABEL.usageCount}</th>{field.mode === "edit" ? <th className="col-act">{FIELD_LABEL.actions}</th> : null}</tr></thead>
      <tbody>{field.value.map((value, index) => {
        const saved = !value.code.startsWith("new:");
        return <tr key={value.code}><td className="col-num">{index + 1}</td><td className="col-flex">{field.mode === "read" ? <span className="ts-field-locked">{value.label}</span> : <input value={value.label} ref={(el) => { if (el) inputs.current.set(value.code, el); else inputs.current.delete(value.code); }} onChange={(event) => field.setValue(field.value.map((item) => item.code === value.code ? { ...item, label: event.target.value } : item))} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); if (index === field.value.length - 1) add(); else inputs.current.get(field.value[index + 1]!.code)?.focus(); }} className="ts-field-direct" />}</td><td className="col-num">{saved ? usage[value.code] || "—" : "—"}</td>{field.mode === "edit" ? <td className="col-act"><span className="ts-row-actions"><IconButton icon={<IconUp />} label={`${value.label} 위로`} disabled={field.pending || index === 0} onClick={() => move(index, -1)} /><IconButton icon={<IconDown />} label={`${value.label} 아래로`} disabled={field.pending || index === field.value.length - 1} onClick={() => move(index, 1)} /><IconButton icon={<IconClose />} label={saved ? `${value.label}(${value.code}) 빼기 — 저장할 때 삭제` : `${value.label || "새 값"} 추가 취소`} disabled={field.pending} onClick={() => field.setValue(field.value.filter((item) => item.code !== value.code))} /></span></td> : null}</tr>;
      })}</tbody>
    </table>
  </>;
}

export function EnumEditor({ item, usage, usageCount, valueUsage }: { item: EnumDef; usage: ReactNode; usageCount: number; valueUsage: Record<string, number> }) {
  const values = [...item.values].sort((a, b) => a.order - b.order).map(({ code, label }) => ({ code, label }));
  const initial: EnumEditData = { label: item.label, description: item.description ?? "", values };
  return <EditShell initial={initial} title={item.label} code={item.code} extraActions={<UsageDialog count={usageCount}>{usage}</UsageDialog>} path={[{ label: ENUMS_CRUMB.label, href: ENUMS_CRUMB.href }]} saveAction={(input, confirm) => saveEnumEditAction(item.code, { ...input, values: input.values.filter((value) => value.label.trim() || !value.code.startsWith("new:")) }, confirm)} deleteAction={removeEnumEditAction.bind(null, item.code)} deleteLabel={`${item.label} 삭제`} deleteTooltip={`${ENTITY_LABEL.enum} ${item.label}(${item.code}) 삭제`} deleteSuccessHref="/master/enums">
    <div className="ts-l2-main">
      <Field name="label" label={NAME_LABEL.enum} />
      <ValuesEditor usage={valueUsage} />
    </div>
  </EditShell>;
}
