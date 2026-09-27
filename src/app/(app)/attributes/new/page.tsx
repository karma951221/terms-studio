import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ENTITY_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";

import { createAttributeKindAction } from "../actions";

const FORM_ID = "create-attribute";

export default async function NewAttributePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.attributeType)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.attribute, href: "/attributes" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createAttributeKindAction} className="ts-create-form">
        <FormRow label={NAME_LABEL.attribute} htmlFor="attribute-name">
          <input id="attribute-name" name="label" required autoFocus />
        </FormRow>
      </form>
    </div>
  );
}
