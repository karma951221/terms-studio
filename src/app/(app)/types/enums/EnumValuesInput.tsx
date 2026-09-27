"use client";

import { useEffect, useRef, useState } from "react";

import { IconButton, IconClose, IconDown, IconPlus, IconUp } from "@/app/_components/icons";
import { FIELD_LABEL, addLabel } from "@/app/_lib/labels";
import { enumValueLabelKey } from "@/domain/catalog";

/**
 * 새 열거형변수의 값 표 (생성 화면 · 폼 상세의 인라인 생성 다이얼로그) — 순서 · 값 이름 · 위/아래/빼기.
 *
 * 현행 약관시스템의 「Enum 변수 추가」 화면을 준용한다 (2026-09-12): 따로 입력칸이 없고 머리의 「+」 가
 * 빈 행을 표에 바로 넣는다 — 값을 표 안에서 적는다. 처음부터 빈 행 둘이 서 있어 「여러 개 넣는 자리」 로 읽힌다.
 * 빈 행은 `required` 로, 중복은 `setCustomValidity` 로 막아 헤더의 「생성」 이 브라우저 검증에 걸리게 한다.
 * 서버 액션에는 순서대로 `values` 입력으로 넘긴다.
 */
export function EnumValuesInput({ initial = ["", ""] }: { initial?: string[] }) {
  const [values, setValues] = useState(() => initial.map((label, index) => ({ key: index, label })));
  const next = useRef(initial.length);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const duplicates = duplicateKeys(values);

  useEffect(() => {
    for (const value of values) inputs.current.get(value.key)?.setCustomValidity(duplicates.has(value.key) ? "중복된 값입니다." : "");
  }, [values, duplicates]);

  const add = () => {
    const key = next.current++;
    setValues((prev) => [...prev, { key, label: "" }]);
    requestAnimationFrame(() => inputs.current.get(key)?.focus());
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    const moved = [...values];
    [moved[index], moved[target]] = [moved[target]!, moved[index]!];
    setValues(moved);
  };
  return <div className="ts-values-input">
    <div className="ts-values-head"><span className="ts-count">{values.length}</span><IconButton icon={<IconPlus />} label={addLabel(FIELD_LABEL.value)} onClick={add} /></div>
    <table className="ts-table"><thead><tr><th className="col-num">{FIELD_LABEL.order}</th><th className="col-flex">{FIELD_LABEL.valueName}</th><th className="col-act">{FIELD_LABEL.actions}</th></tr></thead>
      <tbody>{values.length === 0 ? <tr><td colSpan={3} className="ts-empty-cell">값을 추가하세요.</td></tr> : values.map((value, index) => <tr key={value.key} className={duplicates.has(value.key) ? "is-error" : undefined}>
        <td className="col-num">{index + 1}</td>
        <td className="col-flex">
          <input name="values" value={value.label} required ref={(el) => { if (el) inputs.current.set(value.key, el); else inputs.current.delete(value.key); }} aria-label={`${index + 1}번 ${FIELD_LABEL.valueName}`} placeholder={index === 0 ? "예: 일반심사" : undefined} onChange={(event) => setValues(values.map((item) => item.key === value.key ? { ...item, label: event.target.value } : item))} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); if (index === values.length - 1) add(); else inputs.current.get(values[index + 1]!.key)?.focus(); }} className="ts-field-direct" />
          {duplicates.has(value.key) ? <p className="ts-form-error">중복된 값입니다.</p> : null}
        </td>
        <td className="col-act"><span className="ts-row-actions">
          <IconButton icon={<IconUp />} label={`${value.label || "값"} 위로`} disabled={index === 0} onClick={() => move(index, -1)} />
          <IconButton icon={<IconDown />} label={`${value.label || "값"} 아래로`} disabled={index === values.length - 1} onClick={() => move(index, 1)} />
          <IconButton icon={<IconClose />} label={`${value.label || "값"} 빼기`} onClick={() => setValues(values.filter((item) => item.key !== value.key))} />
        </span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

/** 같은 이름이 둘 이상인 행의 key — 동일성은 서버와 같은 `enumValueLabelKey` (공백 · 대소문자 무시). */
export function duplicateKeys(values: readonly { key: number; label: string }[]): Set<number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const norm = enumValueLabelKey(value.label);
    if (norm) counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  return new Set(values.filter((value) => (counts.get(enumValueLabelKey(value.label)) ?? 0) > 1).map((value) => value.key));
}
