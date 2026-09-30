"use client";

import { useEffect, useRef, useState } from "react";

import { ADD_ROW_LABEL, ValueRowsTable, moveItem } from "@/app/_components/ValueRowsTable";
import { FIELD_LABEL } from "@/app/_lib/labels";
import { enumValueLabelKey } from "@/domain/catalog";

/**
 * 새 열거형변수의 값 표 (생성 화면 · 폼 상세의 인라인 생성 다이얼로그) — 순서 · 값 이름, 값 행 표 문법(`ValueRowsTable` —
 * 행 앞 ⊖ · 끌기 손잡이 · 마지막 행 아래 ⊕ 「행 추가」, 2026-10-01).
 *
 * 현행 약관시스템의 「Enum 변수 추가」 화면을 준용한다 (2026-09-12): 따로 입력칸이 없고 ⊕ 가
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
  };
  return <div className="ts-values-input">
    <ValueRowsTable
      rows={values}
      rowKey={(value) => String(value.key)}
      rowName={(value) => value.label || "새 값"}
      editing
      order
      addLabel={`${ADD_ROW_LABEL} · ${FIELD_LABEL.value}`}
      onAdd={add}
      onRemove={(value) => setValues((prev) => prev.filter((item) => item.key !== value.key))}
      onMove={(from, to) => setValues((prev) => moveItem(prev, from, to))}
      rowClassName={(value) => (duplicates.has(value.key) ? "is-error" : undefined)}
      empty="값을 추가하세요."
      columns={[{ key: "label", header: FIELD_LABEL.valueName, className: "col-flex", cell: (value, index) => <>
        <input name="values" value={value.label} required ref={(el) => { if (el) inputs.current.set(value.key, el); else inputs.current.delete(value.key); }} aria-label={`${index + 1}번 ${FIELD_LABEL.valueName}`} placeholder={index === 0 ? "예: 일반심사" : undefined} onChange={(event) => setValues(values.map((item) => item.key === value.key ? { ...item, label: event.target.value } : item))} onKeyDown={(event) => { if (event.key !== "Enter" || event.nativeEvent.isComposing) return; event.preventDefault(); if (index === values.length - 1) add(); else inputs.current.get(values[index + 1]!.key)?.focus(); }} className="ts-field-direct" />
        {duplicates.has(value.key) ? <p className="ts-form-error">중복된 값입니다.</p> : null}
      </> }]}
    />
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
