import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { CreateHead } from "@/app/_components/FormRow";
import { NoteField } from "@/app/_components/NoteField";
import { ENTITY_LABEL, newLabel } from "@/app/_lib/labels";

import { createCoverageAction } from "../actions";
import { NameFollow } from "./NameFollow";

export const dynamic = "force-dynamic";

const FORM_ID = "create-coverage";

export default async function NewCoveragePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.coverage)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createCoverageAction} className="ts-create-form">
        <NameFollow />
        <NoteField id="cov-desc" />
        <p className="ts-muted">세부보장 1 · 급부 1 이 함께 생성됩니다 (최소 구조).</p>
      </form>
    </div>
  );
}
