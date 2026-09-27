/** 새 공용조항 (생성) — 다른 생성 화면과 같은 폼 패턴. */
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";

import { createClauseAction } from "../actions";
import { ModeBody } from "./ModeBody";

export const dynamic = "force-dynamic";

const FORM_ID = "create-clause";

export default async function NewClausePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.clause)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.clause, href: "/clauses" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createClauseAction} className="ts-create-form">
        <FormRow label={NAME_LABEL.clause} htmlFor="clause-label">
          <input id="clause-label" type="text" name="label" required autoFocus />
        </FormRow>
        <ModeBody />
      </form>
    </div>
  );
}
