/**
 * 새 약관 템플릿 (생성) — 다른 생성 화면과 같은 폼 패턴. 종류는 목록과 같은 쿼리(`?kind=`)로 가른다.
 *
 * - 보통약관(`kind` 없음 · general): 제목 한 칸.
 * - 담보약관(`?kind=coverage`): **아직 템플릿이 없는 담보**를 고른다 + 제목(비우면 「{담보명} 특별약관」).
 *   담보 하나가 템플릿 한 벌을 소유한다 — 담보 상세의 「만들기」 띠가 빠진 뒤(2026-09-27) 담보약관 템플릿 목록의 `+` 가 유일한 입구다.
 *   `?coverage=<id>` 로 오면 그 담보를 미리 고른다.
 */
import Link from "next/link";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL, FIELD_LABEL, newLabel } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { createGeneralAction, createSpecialAction } from "../actions";
import { coveragesWithoutTemplate, docListHref } from "../lib";

export const dynamic = "force-dynamic";

const FORM_ID = "create-general";
const SPECIAL_FORM_ID = "create-special";

export default async function NewDocumentPage({ searchParams }: { searchParams: Promise<{ error?: string; kind?: string; coverage?: string }> }) {
  const { error, kind, coverage } = await searchParams;
  if (kind === "coverage") return newSpecial(error, coverage);
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

/** 담보약관 템플릿 생성 — 서버에서 한 번 그리는 조각 (async 컴포넌트로 두지 않는다: 페이지가 바로 JSX 를 돌려준다). */
async function newSpecial(error: string | undefined, preselect: string | undefined) {
  const services = getServices();
  const [coverages, specials] = await Promise.all([services.coverage.listSummaries(), services.document.list("special")]);
  const candidates = coveragesWithoutTemplate(coverages, specials);
  const title = newLabel(ENTITY_LABEL.coverageTemplate);
  const path = [{ label: ENTITY_LABEL.coverageTemplate, href: docListHref("coverage") }];

  if (candidates.length === 0) {
    return (
      <div>
        <div className="ts-edit-head">
          <Breadcrumb items={[...path, { label: title }]} />
        </div>
        <ErrorBanner message={error} />
        <p className="ts-empty-what">
          담보약관 템플릿이 없는 담보가 없다 — 담보마다 이미 한 벌씩 있다. 새 담보를 먼저 만든다: <Link href="/coverages/new">새 담보</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <CreateHead title={title} formId={SPECIAL_FORM_ID} path={path} banner={<ErrorBanner message={error} />} />
      <form id={SPECIAL_FORM_ID} action={createSpecialAction} className="ts-create-form">
        <FormRow label={ENTITY_LABEL.coverage} htmlFor="doc-coverage">
          <select id="doc-coverage" name="coverageId" required defaultValue={candidates.some((c) => c.id === preselect) ? preselect : ""}>
            <option value="" disabled>
              담보를 고르세요
            </option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
          <p className="ts-form-hint">아직 담보약관 템플릿이 없는 담보만 고를 수 있다 — 담보 하나가 한 벌을 소유한다</p>
        </FormRow>
        <FormRow label={FIELD_LABEL.title} htmlFor="doc-title">
          <input id="doc-title" type="text" name="title" placeholder="비우면 「{담보명} 특별약관」" />
        </FormRow>
      </form>
    </div>
  );
}
