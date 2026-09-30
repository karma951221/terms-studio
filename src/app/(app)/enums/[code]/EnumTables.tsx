"use client";

import { useRef } from "react";

import { useEditField } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconDown, IconPlus, IconUp } from "@/app/_components/icons";
import { FIELD_LABEL, TYPE_LABEL, addLabel } from "@/app/_lib/labels";
import { ENUM_FIELD_TYPES, type EnumFieldType, type EnumFieldValue } from "@/domain/catalog";

import type { EnumEditField, EnumEditValue } from "../edit-types";

const isNew = (key: string) => key.startsWith("new:");

function swap<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const out = [...items];
  [out[index], out[target]] = [out[target]!, out[index]!];
  return out;
}

/** 읽기 칸 — 참거짓은 예 · 아니오, 빈 칸(미입력)은 「—」. */
function cellText(value: EnumFieldValue | undefined): string {
  if (value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return value;
}

/**
 * 필드 정의 표 (ADR-0078 결정 2) — 순서 · 필드 이름 · 타입. 편집이면 이름 · 타입을 고치고, 위 · 아래 · ✕, 머리 「+」 로 빈 행.
 * 필드를 빼거나 타입을 바꾸면 값 표의 그 열 입력도 초안에서 같이 비운다 — 저장 때 관리자 확인(서버).
 */
export function FieldsEditor() {
  const fields = useEditField<EnumEditField[] | undefined>("fields");
  const values = useEditField<EnumEditValue[]>("values");
  const next = useRef(1);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const list = fields.value ?? [];
  const edit = fields.mode === "edit";

  const clearColumn = (key: string) =>
    values.update((current) => current.map((value) => {
      if (!value.fields || !(key in value.fields)) return value;
      const rest = { ...value.fields };
      delete rest[key];
      return { ...value, fields: rest };
    }));
  const add = () => {
    let key = `new:${next.current++}`;
    while (list.some((field) => field.key === key)) key = `new:${next.current++}`;
    fields.update((current) => [...(current ?? []), { key, label: "", type: "string" }]);
    requestAnimationFrame(() => inputs.current.get(key)?.focus());
  };
  const change = (key: string, patch: Partial<EnumEditField>) => fields.update((current) => (current ?? []).map((field) => (field.key === key ? { ...field, ...patch } : field)));
  const retype = (key: string, type: EnumFieldType) => {
    change(key, { type });
    clearColumn(key);
  };
  const remove = (key: string) => {
    fields.update((current) => (current ?? []).filter((field) => field.key !== key));
    clearColumn(key);
  };

  return <section className="ts-enum-fields" aria-label={FIELD_LABEL.field}>
    <div className="ts-values-head"><span className="ts-l2-side-title">{FIELD_LABEL.field}</span>{edit ? <IconButton icon={<IconPlus />} label={addLabel(FIELD_LABEL.field)} disabled={fields.pending} onClick={add} /> : null}</div>
    {list.length === 0 && !edit ? <p className="ts-muted">필드가 없다 — 값마다 딸린 사실(표시명 등)을 두려면 편집에서 필드를 더한다.</p> : null}
    {list.length > 0 ? <table className="ts-table"><thead><tr><th className="col-num">{FIELD_LABEL.order}</th><th className="col-flex">{FIELD_LABEL.fieldName}</th><th className="col-fixed-md">{FIELD_LABEL.valueType}</th>{edit ? <th className="col-act">{FIELD_LABEL.actions}</th> : null}</tr></thead>
      <tbody>{list.map((field, index) => <tr key={field.key}>
        <td className="col-num">{index + 1}</td>
        <td className="col-flex">{edit
          ? <input value={field.label} aria-label={`${FIELD_LABEL.fieldName} ${field.label}`} ref={(el) => { if (el) inputs.current.set(field.key, el); else inputs.current.delete(field.key); }} onChange={(event) => change(field.key, { label: event.target.value })} className="ts-field-direct" placeholder={index === 0 ? "예: 약관표시명" : undefined} />
          : <span className="ts-field-locked">{field.label}</span>}</td>
        <td className="col-fixed-md">{edit
          ? <select value={field.type} aria-label={`${field.label || "새 필드"} ${FIELD_LABEL.valueType}`} onChange={(event) => retype(field.key, event.target.value as EnumFieldType)} className="ts-field-direct">{ENUM_FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}</select>
          : TYPE_LABEL[field.type]}</td>
        {edit ? <td className="col-act"><span className="ts-row-actions">
          <IconButton icon={<IconUp />} label={`${field.label || "새 필드"} 위로`} disabled={fields.pending || index === 0} onClick={() => fields.update((current) => swap(current ?? [], index, -1))} />
          <IconButton icon={<IconDown />} label={`${field.label || "새 필드"} 아래로`} disabled={fields.pending || index === list.length - 1} onClick={() => fields.update((current) => swap(current ?? [], index, 1))} />
          <IconButton icon={<IconClose />} label={isNew(field.key) ? `${field.label || "새 필드"} 추가 취소` : `${field.label}(${field.key}) 빼기 — 저장할 때 삭제`} disabled={fields.pending} onClick={() => remove(field.key)} />
        </span></td> : null}
      </tr>)}</tbody>
    </table> : null}
  </section>;
}

/** 값 × 필드 한 칸 (편집) — 문자열은 입력칸, 참거짓은 미입력 · 예 · 아니오. */
function FieldCell({ value, field, onChange, disabled }: { value: EnumEditValue; field: EnumEditField; onChange: (next: EnumFieldValue | undefined) => void; disabled: boolean }) {
  const current = value.fields?.[field.key];
  const label = `${value.label || "새 값"} ${field.label}`;
  if (field.type === "boolean") {
    return <select value={current === undefined ? "" : String(current)} aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")} className="ts-field-direct">
      <option value="">미입력</option><option value="true">예</option><option value="false">아니오</option>
    </select>;
  }
  return <input value={typeof current === "string" ? current : ""} aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="ts-field-direct" />;
}

/**
 * 값 표 — 순서 · 값 이름 · 필드 열(필드마다 하나) · 사용 수 · 조작. 저장된 값 행도 ✕ 로 초안에서 뺀다 — 서버 삭제는 저장 때,
 * 영향 확인도 그때 한 번 (디자인원칙 §2 L2 표 · 점검 2026-09-27 D2). 「+」 는 빈 행을 표에 바로 넣는다 — 빈 채로 남은 새 행은 저장 때 버린다.
 * 입력률 카운트는 두지 않는다 (화면 편집 원칙) — 빈 칸은 「—」로 보일 뿐이다.
 */
export function ValuesEditor({ usage }: { usage: Record<string, number> }) {
  const field = useEditField<EnumEditValue[]>("values");
  const fieldDefs = useEditField<EnumEditField[] | undefined>("fields").value ?? [];
  const next = useRef(1);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const edit = field.mode === "edit";
  const add = () => {
    const code = `new:${next.current++}`;
    field.update((current) => [...current, { code, label: "" }]);
    requestAnimationFrame(() => inputs.current.get(code)?.focus());
  };
  const setCell = (code: string, key: string, cell: EnumFieldValue | undefined) =>
    field.update((current) => current.map((item) => {
      if (item.code !== code) return item;
      const fields = { ...item.fields };
      if (cell === undefined || cell === "") delete fields[key];
      else fields[key] = cell;
      return { ...item, fields };
    }));
  return <>
    {edit ? <div className="ts-values-head"><span className="ts-count">{field.value.length}</span><IconButton icon={<IconPlus />} label={addLabel(FIELD_LABEL.value)} disabled={field.pending} onClick={add} /></div> : null}
    <table className="ts-table"><thead><tr><th className="col-num">{FIELD_LABEL.order}</th><th className="col-flex">{FIELD_LABEL.valueName}</th>{fieldDefs.map((def) => <th key={def.key} className="col-fixed-md">{def.label || "새 필드"}</th>)}<th className="col-num">{FIELD_LABEL.usageCount}</th>{edit ? <th className="col-act">{FIELD_LABEL.actions}</th> : null}</tr></thead>
      <tbody>{field.value.map((value, index) => {
        const saved = !isNew(value.code);
        return <tr key={value.code}>
          <td className="col-num">{index + 1}</td>
          <td className="col-flex">{!edit ? <span className="ts-field-locked">{value.label}</span> : <input value={value.label} ref={(el) => { if (el) inputs.current.set(value.code, el); else inputs.current.delete(value.code); }} onChange={(event) => field.update((current) => current.map((item) => item.code === value.code ? { ...item, label: event.target.value } : item))} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); if (index === field.value.length - 1) add(); else inputs.current.get(field.value[index + 1]!.code)?.focus(); }} className="ts-field-direct" />}</td>
          {fieldDefs.map((def) => <td key={def.key} className="col-fixed-md">{edit ? <FieldCell value={value} field={def} disabled={field.pending} onChange={(cell) => setCell(value.code, def.key, cell)} /> : cellText(value.fields?.[def.key])}</td>)}
          <td className="col-num">{saved ? usage[value.code] || "—" : "—"}</td>
          {edit ? <td className="col-act"><span className="ts-row-actions"><IconButton icon={<IconUp />} label={`${value.label} 위로`} disabled={field.pending || index === 0} onClick={() => field.update((current) => swap(current, index, -1))} /><IconButton icon={<IconDown />} label={`${value.label} 아래로`} disabled={field.pending || index === field.value.length - 1} onClick={() => field.update((current) => swap(current, index, 1))} /><IconButton icon={<IconClose />} label={saved ? `${value.label}(${value.code}) 빼기 — 저장할 때 삭제` : `${value.label || "새 값"} 추가 취소`} disabled={field.pending} onClick={() => field.update((current) => current.filter((item) => item.code !== value.code))} /></span></td> : null}
        </tr>;
      })}</tbody>
    </table>
  </>;
}
