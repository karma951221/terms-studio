"use client";

import { BoxView } from "@/app/_components/BoxView";
import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL } from "@/app/_lib/labels";
import { boxLinesFromText, boxLinesText, type Box } from "@/domain/document/box";

import { removeBoxEditAction, saveBoxEditAction } from "../edit-actions";
import type { BoxEditData } from "../edit-types";

/** 줄 칸 — 읽기면 박스 그대로(미리보기), 편집이면 여러 줄 글(한 줄 = 박스의 한 줄). */
function LinesField({ code }: { code: string }) {
  const name = useEditField<string>("name");
  const title = useEditField<string>("title");
  const lines = useEditField<string>("lines");
  if (lines.mode === "read") {
    return (
      <div className="ts-form-row">
        <label>줄</label>
        <div className="ts-form-control">
          <BoxView code={code} box={{ code, name: name.value, title: title.value, lines: boxLinesFromText(lines.value) }} link={false} />
        </div>
      </div>
    );
  }
  return (
    <div className="ts-form-row">
      <label htmlFor="box-lines-edit">줄</label>
      <div className="ts-form-control">
        <textarea id="box-lines-edit" aria-label="줄" value={lines.value} onChange={(event) => lines.setValue(event.target.value)} rows={10} className="ts-field-direct" />
      </div>
    </div>
  );
}

export function BoxEditor({ box, usage, usageCount }: { box: Box; usage: React.ReactNode; usageCount: number }) {
  const data: BoxEditData = { name: box.name, title: box.title, lines: boxLinesText(box.lines) };
  return (
    <EditShell
      initial={data}
      title={box.name}
      extraActions={<UsageDialog count={usageCount}>{usage}</UsageDialog>}
      path={[{ label: ENTITY_LABEL.box, href: "/boxes" }]}
      saveAction={saveBoxEditAction.bind(null, box.code)}
      deleteAction={removeBoxEditAction.bind(null, box.code)}
      deleteLabel={`${box.name} 삭제`}
      deleteTooltip={`박스 ${box.name}(${box.code}) 삭제 — 템플릿 · 공용조항이 놓고 있으면 그 참조가 깨진다`}
      deleteSuccessHref="/boxes"
    >
      <div className="ts-l2-main">
        {/* 코드는 시스템이 채번하고 등록 뒤에는 바뀌지 않는다 — 읽기 전용 (기능/박스 §3.1). */}
        <div className="ts-form-row">
          <label>{FIELD_LABEL.code}</label>
          <div className="ts-form-control">
            <span className="ts-field-static ts-mono">{box.code}</span>
          </div>
        </div>
        <Field name="name" label={NAME_LABEL.box} />
        <Field name="title" label={FIELD_LABEL.title} />
        <LinesField code={box.code} />
      </div>
    </EditShell>
  );
}
