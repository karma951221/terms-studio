import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { NoteField } from "@/app/_components/NoteField";
import { ENTITY_LABEL, newLabel } from "@/app/_lib/labels";
import { COVERAGE_CATEGORY_ENUM } from "@/domain/coverage";
import { getServices } from "@/lib/services";

import { createCoverageAction } from "../actions";
import { NameFollow } from "./NameFollow";

export const dynamic = "force-dynamic";

const FORM_ID = "create-coverage";

export default async function NewCoveragePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // 담보분류 (ADR-0090 · 기능/담보 §4 생성) — 필수. 열거형 「담보분류」의 값을 순서대로
  const categories = (await getServices().catalog.getEnum(COVERAGE_CATEGORY_ENUM))?.values ?? [];
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.coverage)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createCoverageAction} className="ts-create-form">
        <NameFollow />
        <FormRow label="담보분류" htmlFor="cov-category">
          <select id="cov-category" name="category" required defaultValue="" className="ts-field-direct" title="기본 특약 그룹 — 상품에서 다른 그룹에 넣을 수 있다">
            <option value="" disabled>
              — 고르세요 —
            </option>
            {categories.map((v) => (
              <option key={v.code} value={v.code}>
                {v.label}
              </option>
            ))}
          </select>
        </FormRow>
        <NoteField id="cov-desc" />
        <p className="ts-muted">세부보장 1 · 급부 1 이 함께 생성됩니다 (최소 구조).</p>
      </form>
    </div>
  );
}
