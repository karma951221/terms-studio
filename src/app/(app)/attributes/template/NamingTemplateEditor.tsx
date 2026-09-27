"use client";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL } from "@/app/_lib/labels";
import type { AttributeKind } from "@/domain/product";
import { displayNamingTemplate, missingTemplateKinds } from "@/domain/product";

import { saveNamingTemplateEditAction } from "../edit-actions";
import type { NamingTemplateEditData } from "../edit-types";

function TemplatePreview({ kinds }: { kinds: AttributeKind[] }) {
  const template = useEditField<string>("template");
  const missing = missingTemplateKinds(kinds, template.value);
  return (
    <>
      <div className="ts-form-row"><label>{FIELD_LABEL.currentName}</label><div className="ts-form-control"><span className="ts-field-static">{displayNamingTemplate(template.value, kinds)}</span></div></div>
      <div className="ts-form-row"><label>{FIELD_LABEL.availableTokens}</label><div className="ts-form-control ts-mono">[{NAME_LABEL.coverage}]{kinds.map((kind) => ` [${kind.code}](${kind.label})`).join("")}</div></div>
      {missing.length > 0 ? <div className="ts-form-row"><label>{FIELD_LABEL.missingTypes}</label><div className="ts-form-control"><span className="ts-badge missing">{missing.map((kind) => kind.label).join(", ")}</span></div></div> : null}
    </>
  );
}

export function NamingTemplateEditor({ template, kinds }: { template: string; kinds: AttributeKind[] }) {
  const initial: NamingTemplateEditData = { template };
  return (
    <EditShell initial={initial} title={ENTITY_LABEL.namingTemplate} path={[{ label: ENTITY_LABEL.attribute, href: "/attributes" }]} saveAction={saveNamingTemplateEditAction}>
      <div className="ts-l2-main">
        <Field name="template" label={FIELD_LABEL.template} className="ts-mono" />
        <TemplatePreview kinds={kinds} />
      </div>
    </EditShell>
  );
}
