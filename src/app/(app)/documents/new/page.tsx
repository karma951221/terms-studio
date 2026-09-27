/**
 * 새 보통약관 템플릿 (생성) — 다른 생성 화면과 같은 폼 패턴.
 *
 * 담보약관 템플릿은 여기서 만들지 않는다 — 담보 하나가 소유하는 문서라 담보 상세에서 생긴다.
 */
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL, FIELD_LABEL, newLabel } from "@/app/_lib/labels";

import { createGeneralAction } from "../actions";
import { docListHref } from "../lib";

export const dynamic = "force-dynamic";

const FORM_ID = "create-general";

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.generalTemplate)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.generalTemplate, href: docListHref("general") }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createGeneralAction} className="ts-create-form">
        <FormRow label={FIELD_LABEL.title} htmlFor="doc-title">
          <input id="doc-title" type="text" name="title" required autoFocus placeholder="예: 상해보험 표준약관" />
        </FormRow>
      </form>
    </div>
  );
}
