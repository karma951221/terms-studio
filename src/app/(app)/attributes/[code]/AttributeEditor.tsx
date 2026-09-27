"use client";

import { useRef, useState, type ReactNode } from "react";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { IconButton, IconMinusCircle, IconPlus } from "@/app/_components/icons";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, NAMING_FRAGMENT_TIP, addLabel, newLabel } from "@/app/_lib/labels";
import { sortAttributeValues, type AttributeKind } from "@/domain/product";

import { removeAttributeEditAction, saveAttributeEditAction } from "../edit-actions";
import type { AttributeEditData, AttributeEditValue } from "../edit-types";

/**
 * 유효값 표 (기능/담보속성 §4 상세, 2026-09-28) — 코드 · 값 이름 · 상품담보명 표기.
 *
 * - 코드 `1` · `2` … 가 곧 순서라 순서 칸 · ↑↓ 가 없다. 새 값은 표 끝에 붙고 저장할 때 다음 번호를 받는다.
 * - 편집 모드에서만 표 끝 「+ 값 추가」 줄 — 누르면 빈 행이 생기고 그 값 이름 칸에 커서가 간다.
 * - 저장된 값 행도 ⊖ 로 초안에서 뺀다 — 서버 삭제 · 사용처 확인은 저장 때 한 번 (디자인원칙 §2 L2 · 점검 2026-09-27 D2).
 */
export function ValuesEditor() {
  const field = useEditField<AttributeEditValue[]>("values");
  const next = useRef(1);
  const [added, setAdded] = useState<string | undefined>(undefined);
  const editing = field.mode === "edit";
  const patch = (code: string, change: Partial<AttributeEditValue>) => field.setValue(field.value.map((value) => (value.code === code ? { ...value, ...change } : value)));
  const add = () => {
    const code = `new:${next.current++}`;
    field.setValue([...field.value, { code, label: "", fragment: "" }]);
    setAdded(code);
  };
  const columns = editing ? 4 : 3;
  return (
    <section className="ts-section">
      <h3 className="ts-section-title">{FIELD_LABEL.values} <span className="ts-count">{field.value.length}</span></h3>
      {field.value.length === 0 && !editing ? (
        <div className="ts-empty"><p className="ts-empty-what">유효값이 없으면 이 유형은 상품담보 조합에 쓰이지 못한다.</p></div>
      ) : (
        <table className="ts-table ts-attr-values">
          <thead>
            <tr>
              <th className="col-code">{FIELD_LABEL.code}</th>
              <th className="col-flex">{FIELD_LABEL.valueName}</th>
              <th className="col-fragment">{FIELD_LABEL.namingFragment} <InfoTip text={NAMING_FRAGMENT_TIP} /></th>
              {editing ? <th className="col-act"><span className="sr-only">{FIELD_LABEL.actions}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {field.value.map((value) => {
              const saved = !value.code.startsWith("new:");
              const name = value.label.trim() || newLabel(FIELD_LABEL.value);
              return (
                <tr key={value.code}>
                  <td className="col-code">{saved ? <code>{value.code}</code> : <span className="ts-muted">{newLabel(FIELD_LABEL.value)}</span>}</td>
                  <td>
                    {editing ? (
                      <input
                        className="ts-field-direct"
                        value={value.label}
                        aria-label={`${FIELD_LABEL.valueName}${saved ? ` ${value.code}` : ""}`}
                        placeholder={FIELD_LABEL.valueName}
                        autoFocus={added === value.code}
                        onChange={(event) => patch(value.code, { label: event.target.value })}
                      />
                    ) : (
                      value.label
                    )}
                  </td>
                  <td className="col-fragment">
                    {editing ? (
                      <input
                        className="ts-field-direct"
                        value={value.fragment}
                        aria-label={`${FIELD_LABEL.namingFragment} — ${name}`}
                        placeholder="비우면 붙지 않는다"
                        onChange={(event) => patch(value.code, { fragment: event.target.value })}
                      />
                    ) : (
                      value.fragment || <span className="ts-muted">—</span>
                    )}
                  </td>
                  {editing ? (
                    <td className="col-act">
                      <IconButton
                        icon={<IconMinusCircle />}
                        danger
                        label={saved ? `${name}(${value.code}) 빼기 — 저장할 때 삭제` : `${name} 추가 취소`}
                        disabled={field.pending}
                        onClick={() => field.setValue(field.value.filter((item) => item.code !== value.code))}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          {editing ? (
            <tfoot>
              <tr className="ts-table-add">
                <td colSpan={columns}>
                  <button type="button" className="ts-linklike ts-cov-add" disabled={field.pending} onClick={add}>
                    <IconPlus /> {addLabel(FIELD_LABEL.value)}
                  </button>
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      )}
    </section>
  );
}

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
