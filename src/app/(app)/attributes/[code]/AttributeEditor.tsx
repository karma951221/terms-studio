"use client";

import { useRef, type ReactNode } from "react";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { ADD_ROW_LABEL, ValueRowsTable } from "@/app/_components/ValueRowsTable";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, NAMING_FRAGMENT_TIP, newLabel } from "@/app/_lib/labels";
import { sortAttributeValues, type AttributeKind } from "@/domain/product";

import { removeAttributeEditAction, saveAttributeEditAction } from "../edit-actions";
import type { AttributeEditData, AttributeEditValue } from "../edit-types";

/**
 * 유효값 표 (기능/담보속성 §4 상세, 2026-09-28) — 코드 · 값 이름 · 상품담보명 표기. 편집은 값 행 표 문법(`ValueRowsTable`, 2026-10-01).
 *
 * - 코드 `1` · `2` … 가 곧 순서라 순서 칸 · 끌기 손잡이가 없다. 새 값은 표 끝에 붙고 저장할 때 다음 번호를 받는다.
 * - 편집 모드에서만 행 앞 ⊖ 「행 삭제 · {값 이름}」 · 마지막 행 아래 ⊕ 「행 추가 · 값」 — 누르면 빈 행이 생기고 그 값 이름 칸에 커서가 간다.
 * - 저장된 값 행도 ⊖ 로 초안에서 뺀다 — 서버 삭제 · 사용처 확인은 저장 때 한 번 (디자인원칙 §2 L2 · 점검 2026-09-27 D2).
 */
export function ValuesEditor() {
  const field = useEditField<AttributeEditValue[]>("values");
  const next = useRef(1);
  const editing = field.mode === "edit";
  const patch = (code: string, change: Partial<AttributeEditValue>) => field.setValue(field.value.map((value) => (value.code === code ? { ...value, ...change } : value)));
  const add = () => {
    const code = `new:${next.current++}`;
    field.setValue([...field.value, { code, label: "", fragment: "" }]);
  };
  const nameOf = (value: AttributeEditValue) => value.label.trim() || newLabel(FIELD_LABEL.value);
  return (
    <section className="ts-section">
      <h3 className="ts-section-title">{FIELD_LABEL.values}</h3>
      {field.value.length === 0 && !editing ? (
        <div className="ts-empty"><p className="ts-empty-what">유효값이 없으면 이 유형은 상품담보 조합에 쓰이지 못한다.</p></div>
      ) : (
        <ValueRowsTable
          className="ts-attr-values"
          rows={field.value}
          rowKey={(value) => value.code}
          rowName={nameOf}
          editing={editing}
          disabled={field.pending}
          addLabel={`${ADD_ROW_LABEL} · ${FIELD_LABEL.value}`}
          onAdd={add}
          onRemove={(value) => field.setValue(field.value.filter((item) => item.code !== value.code))}
          columns={[
            { key: "code", header: FIELD_LABEL.code, className: "col-code", cell: (value) => (isSaved(value) ? <code>{value.code}</code> : <span className="ts-muted">{newLabel(FIELD_LABEL.value)}</span>) },
            { key: "label", header: FIELD_LABEL.valueName, cell: (value) => (editing ? (
              <input
                className="ts-field-direct"
                value={value.label}
                aria-label={`${FIELD_LABEL.valueName}${isSaved(value) ? ` ${value.code}` : ""}`}
                placeholder={FIELD_LABEL.valueName}
                onChange={(event) => patch(value.code, { label: event.target.value })}
              />
            ) : value.label) },
            { key: "fragment", header: <>{FIELD_LABEL.namingFragment} <InfoTip text={NAMING_FRAGMENT_TIP} /></>, className: "col-fragment", cell: (value) => (editing ? (
              <input
                className="ts-field-direct"
                value={value.fragment}
                aria-label={`${FIELD_LABEL.namingFragment} — ${nameOf(value)}`}
                placeholder="비우면 붙지 않는다"
                onChange={(event) => patch(value.code, { fragment: event.target.value })}
              />
            ) : value.fragment || <span className="ts-muted">—</span>) },
          ]}
        />
      )}
    </section>
  );
}

const isSaved = (value: AttributeEditValue) => !value.code.startsWith("new:");

export function AttributeEditor({ item, usage, usageCount }: { item: AttributeKind; usage: ReactNode; usageCount: number }) {
  const initial: AttributeEditData = { label: item.label, values: sortAttributeValues(item.values).map(({ code, label, fragment }) => ({ code, label, fragment })) };
  return (
    <EditShell initial={initial} title={item.label} extraActions={<UsageDialog count={usageCount}>{usage}</UsageDialog>} path={[{ label: ENTITY_LABEL.attribute, href: "/attributes" }]} saveAction={saveAttributeEditAction.bind(null, item.code)} deleteAction={removeAttributeEditAction.bind(null, item.code)} deleteLabel={`${item.label} 삭제`} deleteTooltip={`${ENTITY_LABEL.attribute} ${item.label}(${item.code}) 삭제 — 값 ${item.values.length}개가 함께 사라진다`} deleteSuccessHref="/attributes">
      <div className="ts-l2-main">
        <div className="ts-form-row"><label>{FIELD_LABEL.code}</label><div className="ts-form-control"><span className="ts-field-static ts-mono">{item.code}</span></div></div>
        <Field name="label" label={NAME_LABEL.attribute} />
        <ValuesEditor />
      </div>
    </EditShell>
  );
}
