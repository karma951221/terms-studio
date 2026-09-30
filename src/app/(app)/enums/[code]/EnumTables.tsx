"use client";

import { useRef } from "react";

import { useEditField } from "@/app/_components/EditShell";
import { ADD_ROW_LABEL, ValueRowsTable, moveItem, type ValueRowsColumn } from "@/app/_components/ValueRowsTable";
import { FIELD_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import { ENUM_FIELD_TYPES, type EnumFieldType, type EnumFieldValue } from "@/domain/catalog";

import type { EnumEditField, EnumEditValue } from "../edit-types";

const isNew = (key: string) => key.startsWith("new:");

const NEW_FIELD = "새 필드";
const NEW_VALUE = "새 값";

/** 읽기 칸 — 참거짓은 예 · 아니오, 빈 칸(미입력)은 「—」. */
function cellText(value: EnumFieldValue | undefined): string {
  if (value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return value;
}

/**
 * 필드 정의 표 (ADR-0078 결정 2) — 순서 · 필드 이름 · 타입. 편집이면 이름 · 타입을 고치고, 값 행 표 문법(행 앞 ⊖ · 끌기 손잡이 · 마지막 행 아래 ⊕,
 * `ValueRowsTable`)으로 더하고 빼고 옮긴다. 필드를 빼거나 타입을 바꾸면 값 표의 그 열 입력도 초안에서 같이 비운다 — 저장 때 관리자 확인(서버).
 */
export function FieldsEditor() {
  const fields = useEditField<EnumEditField[] | undefined>("fields");
  const values = useEditField<EnumEditValue[]>("values");
  const next = useRef(1);
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
    <p className="ts-l2-side-title">{FIELD_LABEL.field}</p>
    {list.length === 0 && !edit ? <p className="ts-muted">필드가 없다 — 값마다 딸린 사실(표시명 등)을 두려면 편집에서 필드를 더한다.</p> : <ValueRowsTable
      rows={list}
      rowKey={(field) => field.key}
      rowName={(field) => field.label || NEW_FIELD}
      editing={edit}
      order
      disabled={fields.pending}
      addLabel={`${ADD_ROW_LABEL} · ${FIELD_LABEL.field}`}
      onAdd={add}
      onRemove={(field) => remove(field.key)}
      onMove={(from, to) => fields.update((current) => moveItem(current ?? [], from, to))}
      columns={[
        { key: "label", header: FIELD_LABEL.fieldName, className: "col-flex", cell: (field, index) => edit
          ? <input value={field.label} aria-label={`${FIELD_LABEL.fieldName} ${field.label}`} onChange={(event) => change(field.key, { label: event.target.value })} className="ts-field-direct" placeholder={index === 0 ? "예: 약관표시명" : undefined} />
          : <span className="ts-field-locked">{field.label}</span> },
        { key: "type", header: FIELD_LABEL.valueType, className: "col-fixed-md", cell: (field) => edit
          ? <select value={field.type} aria-label={`${field.label || NEW_FIELD} ${FIELD_LABEL.valueType}`} onChange={(event) => retype(field.key, event.target.value as EnumFieldType)} className="ts-field-direct">{ENUM_FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}</select>
          : TYPE_LABEL[field.type] },
      ]}
    />}
  </section>;
}

/** 값 × 필드 한 칸 (편집) — 문자열은 입력칸, 참거짓은 미입력 · 예 · 아니오. */
function FieldCell({ value, field, onChange, disabled }: { value: EnumEditValue; field: EnumEditField; onChange: (next: EnumFieldValue | undefined) => void; disabled: boolean }) {
  const current = value.fields?.[field.key];
  const label = `${value.label || NEW_VALUE} ${field.label}`;
  if (field.type === "boolean") {
    return <select value={current === undefined ? "" : String(current)} aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")} className="ts-field-direct">
      <option value="">미입력</option><option value="true">예</option><option value="false">아니오</option>
    </select>;
  }
  return <input value={typeof current === "string" ? current : ""} aria-label={label} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="ts-field-direct" />;
}

/**
 * 값 표 — 순서 · 값 이름 · 필드 열(필드마다 하나). 편집은 값 행 표 문법(`ValueRowsTable` — 행 앞 ⊖ · 끌기 손잡이 · 마지막 행 아래 ⊕).
 * 저장된 값 행도 ⊖ 로 초안에서 뺀다 — 서버 삭제는 저장 때, 영향 확인도 그때 한 번 (디자인원칙 §2 L2 표 · 점검 2026-09-27 D2).
 * 빈 채로 남은 새 행은 저장 때 버린다. 빼는 값의 영향은 저장 확인이 말한다 — 사용 수 열은 두지 않는다(사용처는 관계정보 메뉴, 2026-10-01).
 * 입력률 카운트는 두지 않는다 (화면 편집 원칙) — 빈 칸은 「—」로 보일 뿐이다.
 */
export function ValuesEditor() {
  const field = useEditField<EnumEditValue[]>("values");
  const fieldDefs = useEditField<EnumEditField[] | undefined>("fields").value ?? [];
  const next = useRef(1);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const edit = field.mode === "edit";
  const add = () => {
    const code = `new:${next.current++}`;
    field.update((current) => [...current, { code, label: "" }]);
  };
  const setCell = (code: string, key: string, cell: EnumFieldValue | undefined) =>
    field.update((current) => current.map((item) => {
      if (item.code !== code) return item;
      const fields = { ...item.fields };
      if (cell === undefined || cell === "") delete fields[key];
      else fields[key] = cell;
      return { ...item, fields };
    }));
  const columns: ValueRowsColumn<EnumEditValue>[] = [
    { key: "label", header: FIELD_LABEL.valueName, className: "col-flex", cell: (value, index) => !edit
      ? <span className="ts-field-locked">{value.label}</span>
      : <input value={value.label} aria-label={`${FIELD_LABEL.valueName}${isNew(value.code) ? "" : ` ${value.code}`}`} ref={(el) => { if (el) inputs.current.set(value.code, el); else inputs.current.delete(value.code); }} onChange={(event) => field.update((current) => current.map((item) => item.code === value.code ? { ...item, label: event.target.value } : item))} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); if (index === field.value.length - 1) add(); else inputs.current.get(field.value[index + 1]!.code)?.focus(); }} className="ts-field-direct" /> },
    ...fieldDefs.map((def): ValueRowsColumn<EnumEditValue> => ({ key: `f:${def.key}`, header: def.label || NEW_FIELD, className: "col-fixed-md", cell: (value) => edit ? <FieldCell value={value} field={def} disabled={field.pending} onChange={(cell) => setCell(value.code, def.key, cell)} /> : cellText(value.fields?.[def.key]) })),
  ];
  return <ValueRowsTable
    rows={field.value}
    rowKey={(value) => value.code}
    rowName={(value) => value.label || NEW_VALUE}
    editing={edit}
    order
    disabled={field.pending}
    addLabel={`${ADD_ROW_LABEL} · ${FIELD_LABEL.value}`}
    onAdd={add}
    onRemove={(value) => field.update((current) => current.filter((item) => item.code !== value.code))}
    onMove={(from, to) => field.update((current) => moveItem(current, from, to))}
    columns={columns}
  />;
}
