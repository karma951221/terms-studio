/** 새 박스 (생성) — 다른 생성 화면과 같은 폼 패턴 (기능/박스 §4.2). 코드는 받지 않는다 (시스템 채번). */
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";

import { createBoxAction } from "../actions";

export const dynamic = "force-dynamic";

const FORM_ID = "create-box";

export default async function NewBoxPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.box)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.box, href: "/boxes" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createBoxAction} className="ts-create-form">
        <FormRow label={NAME_LABEL.box} htmlFor="box-name">
          <input id="box-name" type="text" name="name" required autoFocus placeholder="예: 【용어풀이】 보험연도" />
        </FormRow>
        <FormRow label={FIELD_LABEL.title} htmlFor="box-title">
          <input id="box-title" type="text" name="title" placeholder="예: 보험연도 (비워도 된다)" />
        </FormRow>
        <FormRow label="줄" htmlFor="box-lines">
          <textarea id="box-lines" name="lines" rows={8} required placeholder={"한 줄이 박스의 한 줄이다\n예: 보험연도란 계약일부터 1년 단위로 …"} />
        </FormRow>
      </form>
      <p className="ts-form-hint">코드는 시스템이 BX000001 부터 붙이고, 등록 뒤에는 바뀌지 않는다. 박스 안에는 조 참조 · 슬롯을 두지 않는다 — 고정 글이다.</p>
    </div>
  );
}
