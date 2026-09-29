/** 공용조항 조회 (L1) — 화면은 컬럼만 적고, 조립은 ListPage 가 한다. */
import Link from "next/link";

import { ListPage, codeCol, dateCol, nameCol, userCol, type ListColumn } from "@/app/_components/ListPage";
import type { ColumnFilterSpec } from "@/app/_components/ListFilters";
import { ENTITY_LABEL, FIELD_LABEL, MODE_LABEL, MODE_OPTIONS, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import { includesQuery, paginate } from "@/app/_lib/list";
import type { ClauseMode, ClauseSummary } from "@/domain/clause/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const MODES: readonly ClauseMode[] = ["inline", "block"];
const FILTERS = [
  { key: "mode", label: "유형", options: MODES.map((value) => ({ value, label: MODE_LABEL[value] })) },
] as const satisfies readonly ColumnFilterSpec[];

/** `+` 의 유형 메뉴 — 유형은 생성 때 정하고 그 뒤 바꾸지 않아서(기능/공용조항 §3.1) 누를 때 먼저 고른다 (§4.1). */
const CREATE_MENU = MODE_OPTIONS.map((o) => ({ label: o.label, hint: o.hint, href: `/functions/new?type=${o.value}` }));

interface SearchParams {
  error?: string;
  q?: string;
  mode?: string;
  page?: string;
}

export default async function ClausesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const [summaries, users] = await Promise.all([services.clause.summaries(), services.auth.listUsers()]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));

  const q = (sp.q ?? "").trim();
  const mode = sp.mode ?? "";
  const filtered = summaries.filter((c) => {
    if (!includesQuery(q, [c.code, c.label])) return false;
    if (mode && c.mode !== mode) return false;
    return true;
  });
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<ClauseSummary>[] = [
    codeCol((c) => c.code),
    nameCol(NAME_LABEL.clause, (c) => c.label, (c) => `/functions/${c.code}`),
    { filter: FILTERS[0], width: "sm", cell: (c) => MODE_LABEL[c.mode] },
    dateCol(FIELD_LABEL.updatedAt, (c) => c.updatedAt),
    userCol(FIELD_LABEL.updatedBy, (c) => c.updatedBy, userName),
  ];

  return (
    <ListPage
      title={ENTITY_LABEL.clause}
      create={{ label: newLabel(ENTITY_LABEL.clause), menu: CREATE_MENU }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.clause) }}
      filters={FILTERS}
      columns={columns}
      rows={rows}
      rowKey={(c) => c.code}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/functions"
      query={{ q, mode }}
      error={sp.error}
      empty={
        summaries.length === 0 ? (
          <div className="ts-empty">
            <p className="ts-empty-what">함수조항은 여러 약관 템플릿이 공통으로 참조해 쓰는 문구 템플릿이다.</p>
            <p className="ts-empty-example">예: 특별약관의 소멸, 준용규정</p>
            <p className="ts-empty-action">
              새 함수조항 만들기 —{" "}
              {CREATE_MENU.map((item, i) => (
                <span key={item.href}>
                  {i > 0 ? " · " : null}
                  <Link href={item.href} title={item.hint}>
                    {item.label}
                  </Link>
                </span>
              ))}
            </p>
          </div>
        ) : (
          <p className="ts-empty-what">이 조건에 맞는 함수조항이 없습니다.</p>
        )
      }
    />
  );
}
