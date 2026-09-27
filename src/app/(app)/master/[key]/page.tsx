/**
 * 마스터 상세 — `/master/{key}` (2026-09-27 두 칸의 오른쪽 패널을 별도 상세 화면으로 옮겼다).
 *
 * `key` 에 「.」이 있으면 필드 경로(폼키.필드키) → 필드 상세, 없으면 폼키 → 폼 상세.
 * 제목 줄은 경로다 — 폼 `폼 › {폼}` · 필드 `폼 › {폼} › {필드}` (첫 마디 「폼」 → 조회, 폼 마디 → 폼 상세). 돌아가는 길은 경로 하나.
 * 읽기 전용 — 편집 버튼이 없다 (마스터는 코드에 살고 배포로만 바뀐다). 필드 상세의 값 노드 페이저는 `?page=`.
 * 코드에 없는 키(배포로 사라진 코드의 북마크 등)는 경로 + 「찾을 수 없습니다」.
 */
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { FORMS_MENU, menuCrumb } from "@/app/_lib/menu";
import { findForm, findMasterField } from "@/domain/master";
import { getServices } from "@/lib/services";

import { FieldDetail } from "../FieldDetail";
import { FormDetail } from "../FormDetail";
import { formHref, type EnumLabels } from "../lib";

export const dynamic = "force-dynamic";

const ROOT = menuCrumb(FORMS_MENU);

/** `?page=` — 양의 정수만, 아니면 1. 마지막 페이지로 죄는 것은 총수를 아는 서비스(`valueNodes`)가 한다. */
function pageNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** 세그먼트가 인코딩된 채 오는 경우에 대비 — 잘못된 `%` 는 원문 그대로. */
function decoded(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function MasterDetailPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ key: raw }, sp] = await Promise.all([params, searchParams]);
  const key = decoded(raw);
  const services = getServices();

  if (key.includes(".")) {
    const field = findMasterField(key);
    if (!field) return <NotFound label={key} />;
    const enums = await services.catalog.listEnums();
    return (
      <div>
        <Breadcrumb items={[ROOT, { label: field.form.label, href: formHref(field.form.key) }, { label: field.field.label }]} />
        <FieldDetail field={field} page={pageNumber(sp.page)} master={services.master} enums={enums} />
      </div>
    );
  }

  const form = findForm(key);
  if (!form) return <NotFound label={key} />;
  const [enums, nodeCount] = await Promise.all([services.catalog.listEnums(), services.master.formNodeCount(form)]);
  const enumLabels: EnumLabels = new Map(enums.map((e) => [e.code, e.label] as const));
  return (
    <div>
      <Breadcrumb items={[ROOT, { label: form.label }]} />
      <FormDetail form={form} nodeCount={nodeCount} enumLabels={enumLabels} />
    </div>
  );
}

function NotFound({ label }: { label: string }) {
  return (
    <div>
      <Breadcrumb items={[ROOT, { label }]} />
      <p className="ts-error-banner">찾을 수 없습니다.</p>
    </div>
  );
}
