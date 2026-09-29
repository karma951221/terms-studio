"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconDown, IconPlus, IconUp } from "@/app/_components/icons";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, REFERENCE_VIA_LABEL, addLabel } from "@/app/_lib/labels";
import type { EnumDef } from "@/domain/catalog";
import { formatCoordinate } from "@/domain/coordinate";
import type { RefEdge } from "@/domain/refs";
import type { ReactNode } from "react";

import { ENUMS_MENU, menuCrumb } from "@/app/_lib/menu";
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

/**
 * 열거값 추가의 재검사 목록 — 저장 뒤 「재검사 N건」 (ADR-0078 결정 4). 값을 나열해 비교하는 곳은 새 값을 조용히 놓치므로
 * 사람이 다시 본다. 저장은 이미 끝났고 막지 않는다. 좌표는 고치러 가는 링크 (사용처 목록과 같은 모양).
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

type EditorProps = { item: EnumDef; usage: ReactNode; usageCount: number; valueUsage: Record<string, number> };

function EnumEditorBody({ item, usage, usageCount, valueUsage, onSaved }: EditorProps & { onSaved: (recheck: RefEdge[]) => void }) {
  const values = [...item.values].sort((a, b) => a.order - b.order).map(({ code, label }) => ({ code, label }));
  const initial: EnumEditData = { label: item.label, description: item.description ?? "", values };
  return <EditShell initial={initial} title={item.label} code={item.code} extraActions={<UsageDialog count={usageCount}>{usage}</UsageDialog>} path={[menuCrumb(ENUMS_MENU)]} saveAction={(input, confirm) => saveEnumEditAction(item.code, { ...input, values: input.values.filter((value) => value.label.trim() || !value.code.startsWith("new:")) }, confirm)} onSaved={(outcome) => onSaved(outcome.recheck ?? [])} deleteAction={removeEnumEditAction.bind(null, item.code)} deleteLabel={`${item.label} 삭제`} deleteTooltip={`${ENTITY_LABEL.enum} ${item.label}(${item.code}) 삭제`} deleteSuccessHref="/enums">
    <div className="ts-l2-main">
      <Field name="label" label={NAME_LABEL.enum} />
      <ValuesEditor usage={valueUsage} />
    </div>
  </EditShell>;
}

/**
 * 상세 · 수정. 편집 본문은 값 코드 목록(`signature`)이 바뀌면 다시 마운트되지만(새로 발급된 코드로 다시 그림),
 * 재검사 목록은 그 바깥에 있어 저장 뒤 새로고침에도 남는다.
 */
export function EnumEditor(props: EditorProps) {
  const [recheck, setRecheck] = useState<RefEdge[]>([]);
  const signature = props.item.values.map((value) => value.code).join(":");
  return <>
    <EnumEditorBody key={`${props.item.code}:${signature}`} {...props} onSaved={setRecheck} />
    {recheck.length > 0 ? <RecheckList items={recheck} onClose={() => setRecheck([])} /> : null}
  </>;
}
