"use client";

import { EditShell, Field } from "@/app/_components/EditShell";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL } from "@/app/_lib/labels";
import type { Appendix } from "@/domain/document";

import { removeAppendixEditAction, saveAppendixEditAction } from "../edit-actions";
import type { AppendixEditData } from "../edit-types";

export function AppendixEditor({ appendix }: { appendix: Appendix }) {
  const data: AppendixEditData = { name: appendix.name, description: appendix.description };
  return (
    <EditShell
      initial={data}
      title={appendix.name}
      path={[{ label: ENTITY_LABEL.appendix, href: "/appendices" }]}
      saveAction={saveAppendixEditAction.bind(null, appendix.code)}
      deleteAction={removeAppendixEditAction.bind(null, appendix.code)}
      deleteLabel={`${appendix.name} 삭제`}
      deleteTooltip={`별표 ${appendix.name}(${appendix.code}) 삭제 — 조문이 참조 중이면 그 참조가 깨진다`}
      deleteSuccessHref="/appendices"
    >
      <div className="ts-l2-main">
        {/* 코드는 시스템이 채번하고 등록 뒤에는 바뀌지 않는다 — 읽기 전용 (기능/별표 §3.1). */}
        <div className="ts-form-row">
          <label>{FIELD_LABEL.code}</label>
          <div className="ts-form-control">
            <span className="ts-field-static ts-mono">{appendix.code}</span>
          </div>
        </div>
        <Field name="name" label={NAME_LABEL.appendix} />
        <Field name="description" label={FIELD_LABEL.note} type="textarea" />
      </div>
    </EditShell>
  );
}
