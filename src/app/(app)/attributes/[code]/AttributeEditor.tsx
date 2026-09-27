"use client";

import { useRef, useState, type ReactNode } from "react";

import { ConfirmActionButton } from "@/app/_components/ConfirmActionButton";
import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconDown, IconUp } from "@/app/_components/icons";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { ACTION_LABEL, ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, addLabel, newLabel } from "@/app/_lib/labels";
import type { AttributeKind } from "@/domain/product";

import { removeAttributeEditAction, removeAttributeValueEditAction, saveAttributeEditAction } from "../edit-actions";
import type { AttributeEditData, AttributeEditValue } from "../edit-types";

function NewValueComposer({ add }: { add: (value: AttributeEditValue) => void }) {
  const [label, setLabel] = useState("");
  const [fragment, setFragment] = useState("");
  const next = useRef(1);
  const commit = () => {
    if (!label.trim()) return;
    add({ code: `new:${next.current++}`, label: label.trim(), fragment });
    setLabel("");
    setFragment("");
  };
  return (
    <div className="ts-add-row">
      <label htmlFor="new-attribute-value">{addLabel(FIELD_LABEL.value)}</label>
      <input id="new-attribute-value" value={label} placeholder={FIELD_LABEL.valueName} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); } }} />
      <input value={fragment} placeholder={FIELD_LABEL.namingFragment} onChange={(event) => setFragment(event.target.value)} className="ts-mono" />
      <button type="button" disabled={!label.trim()} onClick={commit}>{ACTION_LABEL.add}</button>
    </div>
  );
}

function ValuesEditor({ code, usage }: { code: string; usage: Record<string, number> }) {
  const field = useEditField<AttributeEditValue[]>("values");
  const move = (index: number, delta: number) => {
    const values = [...field.value];
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    [values[index], values[target]] = [values[target]!, values[index]!];
    field.setValue(values);
  };
  const patch = (code: string, change: Partial<AttributeEditValue>) => field.setValue(field.value.map((value) => value.code === code ? { ...value, ...change } : value));
  return (
    <section className="ts-section">
      <h3 className="ts-section-title">{FIELD_LABEL.values} <span className="ts-count">{field.value.length}</span></h3>
      {field.value.length === 0 ? <div className="ts-empty"><p className="ts-empty-what">유효값이 없으면 이 유형은 상품담보 조합에 쓰이지 못한다.</p></div> : (
        <table className="ts-table">
          <thead><tr><th className="col-num">{FIELD_LABEL.order}</th><th className="col-code">{FIELD_LABEL.code}</th><th className="col-flex">{FIELD_LABEL.valueName}</th><th>{FIELD_LABEL.namingFragment}</th><th className="col-num">{FIELD_LABEL.usageCount}</th>{field.mode === "edit" ? <th className="col-act">{FIELD_LABEL.actions}</th> : null}</tr></thead>
          <tbody>{field.value.map((value, index) => {
            const saved = !value.code.startsWith("new:");
            return <tr key={value.code}>
              <td className="col-num">{index + 1}</td>
              <td className="col-code"><code>{saved ? value.code : newLabel(FIELD_LABEL.value)}</code></td>
              <td>{field.mode === "read" ? <span className="ts-field-locked">{value.label}</span> : <input value={value.label} onChange={(event) => patch(value.code, { label: event.target.value })} />}</td>
              <td>{field.mode === "read" ? <span className="ts-field-locked ts-mono">{value.fragment || "없음"}</span> : <input value={value.fragment} onChange={(event) => patch(value.code, { fragment: event.target.value })} className="ts-mono" />}</td>
              <td className="col-num">{saved ? usage[value.code] || "—" : "—"}</td>
              {field.mode === "edit" ? <td className="col-act"><span className="ts-row-actions"><IconButton icon={<IconUp />} label={`${value.label} 위로`} disabled={field.pending || index === 0} onClick={() => move(index, -1)} /><IconButton icon={<IconDown />} label={`${value.label} 아래로`} disabled={field.pending || index === field.value.length - 1} onClick={() => move(index, 1)} />{saved ? <ConfirmActionButton label={`${value.label}(${value.code}) 삭제`} action={removeAttributeValueEditAction.bind(null, code, value.code)} /> : <IconButton icon={<IconClose />} label={`${value.label || newLabel(FIELD_LABEL.value)} 추가 취소`} onClick={() => field.setValue(field.value.filter((item) => item.code !== value.code))} />}</span></td> : null}
            </tr>;
          })}</tbody>
        </table>
      )}
      {field.mode === "edit" ? <NewValueComposer add={(value) => field.setValue([...field.value, value])} /> : null}
    </section>
  );
}

export function AttributeEditor({ item, usage, usageCount, valueUsage }: { item: AttributeKind; usage: ReactNode; usageCount: number; valueUsage: Record<string, number> }) {
  const initial: AttributeEditData = { label: item.label, values: [...item.values].sort((a, b) => a.order - b.order).map(({ code, label, fragment }) => ({ code, label, fragment })) };
  return (
    <EditShell initial={initial} title={item.label} extraActions={<UsageDialog count={usageCount}>{usage}</UsageDialog>} path={[{ label: ENTITY_LABEL.attribute, href: "/attributes" }]} saveAction={saveAttributeEditAction.bind(null, item.code)} deleteAction={removeAttributeEditAction.bind(null, item.code)} deleteLabel={`${item.label} 삭제`} deleteTooltip={`${ENTITY_LABEL.attribute} ${item.label}(${item.code}) 삭제 — 값 ${item.values.length}개가 함께 사라진다`} deleteSuccessHref="/attributes">
      <div className="ts-l2-main">
        <div className="ts-form-row"><label>{FIELD_LABEL.code}</label><div className="ts-form-control"><span className="ts-field-static ts-mono">{item.code}</span></div></div>
        <Field name="label" label={NAME_LABEL.attribute} />
        <ValuesEditor code={item.code} usage={valueUsage} />
      </div>
    </EditShell>
  );
}
