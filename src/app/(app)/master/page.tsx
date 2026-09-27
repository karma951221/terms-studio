/**
 * 마스터 (L1 조회) — 모델링이 받는 **입력 항목의 정본**을 본다 (기능/마스터 §4.1).
 *
 * 2026-09-27 두 칸(표 + 오른쪽 상세)에서 다른 엔터티와 같은 **L1 목록 + 상세 화면**으로 바꿨다.
 * 여기는 필드 표만 전폭으로 선다 (폼 › 필드를 코드 순서 그대로 평탄화 · 검색 `?q=` · 페이저 `?page=`).
 * 메뉴 「기본정보」 그룹의 항목 「폼」이다. 제목은 메뉴 이름 「폼」, `+` 는 없다(만들 폼이 없다).
 * 상세는 `/master/[key]` — 폼 상세 `/master/{폼키}` · 필드 상세 `/master/{폼키.필드키}`.
 * **편집 조작이 없다.** 폼 · 필드 · 레벨은 코드에 살고 배포로만 바뀐다.
 * 옛 주소 `?field=` · `?form=` (북마크 · 옛 링크)는 새 상세 경로로 돌려보낸다.
 */
import { redirect } from "next/navigation";

import { InfoTip } from "@/app/_components/InfoTip";
import { LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import { paginate } from "@/app/_lib/list";
import { FORMS_MENU } from "@/app/_lib/menu";
import { allMasterFields, MASTER } from "@/domain/master";
import { getServices } from "@/lib/services";

import { filterRows, type MasterRow } from "./filterRows";
import { fieldHref, formHref, type EnumLabels } from "./lib";
import { MASTER_PAGE_SIZE, MasterTable } from "./MasterTable";

export const dynamic = "force-dynamic";

function masterRows(enumLabels: EnumLabels): MasterRow[] {
  return MASTER.flatMap((form) =>
    form.fields.map((field) => {
      const type = field.type;
      const enumCode = type.kind === "enum" || type.kind === "list<enum>" ? type.enumCode : undefined;
      return {
        path: `${form.key}.${field.key}`,
        label: field.label,
        formKey: form.key,
        formLabel: form.label,
        level: form.level,
        levelLabel: LEVEL_LABEL[form.level],
        typeLabel: TYPE_LABEL[type.kind],
        ...(enumCode ? { enumCode, enumLabel: enumLabels.get(enumCode) ?? enumCode } : {}),
      };
    }),
  );
}

export default async function MasterPage({ searchParams }: { searchParams: Promise<{ form?: string; field?: string; page?: string; q?: string }> }) {
  const sp = await searchParams;
  // 옛 주소 — 필드가 폼보다 먼저 (둘 다 오면 필드). 옛 `?field=&page=` 의 page 는 값 노드 페이저였다.
  if (sp.field) redirect(fieldHref(sp.field, Number(sp.page) || undefined));
  if (sp.form) redirect(formHref(sp.form));

  const enums = await getServices().catalog.listEnums();
  const enumLabels: EnumLabels = new Map(enums.map((e) => [e.code, e.label] as const));
  const q = (sp.q ?? "").trim();
  const { rows, total, page } = paginate(filterRows(masterRows(enumLabels), q), sp.page, MASTER_PAGE_SIZE);

  return (
    <div>
      <div className="ts-page-head">
        <h1 className="ts-h1">{FORMS_MENU.label}</h1>
        <InfoTip text="코드에 고정된 입력 항목이다 — 여기서 고치지 않고, 더하거나 바꾸는 것은 배포다. 폼 하나 = 모델링 화면의 카드 하나. 필드 코드(폼키.필드키)가 식 참조 · 값 좌표 · 오류 메시지에 그대로 쓰인다." />
      </div>
      <MasterTable rows={rows} total={total} page={page} defined={allMasterFields().length > 0} q={q} />
    </div>
  );
}
