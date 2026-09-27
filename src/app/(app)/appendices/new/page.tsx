/** 새 별표 (생성) — 다른 생성 화면과 같은 폼 패턴. 코드는 받지 않는다 (시스템 채번). */
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { NoteField } from "@/app/_components/NoteField";
import { ENTITY_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";

import { createAppendixAction } from "../actions";

export const dynamic = "force-dynamic";

const FORM_ID = "create-appendix";

export default async function NewAppendixPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.appendix)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.appendix, href: "/appendices" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createAppendixAction} className="ts-create-form">
        <FormRow label={NAME_LABEL.appendix} htmlFor="appx-name">
          <input id="appx-name" type="text" name="name" required autoFocus placeholder="예: 장해분류표" />
        </FormRow>
        <NoteField id="appx-desc" placeholder="예: 지급률 산정에 쓰는 장해 분류" />
      </form>
      <p className="ts-form-hint">코드는 시스템이 AX000001 부터 붙이고, 등록 뒤에는 바뀌지 않는다.</p>
    </div>
  );
}
