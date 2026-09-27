import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";
import { ENUMS_CRUMB } from "../../MasterTabs";
import { createTypeEnumAction } from "../actions";
import { EnumValuesInput } from "../EnumValuesInput";

const FORM_ID = "create-enum";

export default async function NewEnumPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string }> }) {
  const sp = await searchParams;
  const suggested = (sp.q ?? "").trim();
  return <div>
    <CreateHead title={newLabel(ENTITY_LABEL.enum)} formId={FORM_ID} path={[{ label: ENUMS_CRUMB.label, href: ENUMS_CRUMB.href }]} banner={<ErrorBanner message={sp.error} />} />
    <form id={FORM_ID} action={createTypeEnumAction} className="ts-create-form">
      <FormRow label={NAME_LABEL.enum} htmlFor="enum-label"><input id="enum-label" name="label" defaultValue={suggested} required autoFocus />{suggested ? <span className="ts-badge proposed">{FIELD_LABEL.suggested}</span> : null}</FormRow>
      <FormRow label={FIELD_LABEL.values}><EnumValuesInput /></FormRow>
    </form>
  </div>;
}
