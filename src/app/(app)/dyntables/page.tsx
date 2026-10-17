/** 동적표 조회 (L1) — 화면은 컬럼만 적고, 조립은 ListPage 가 한다 (기능/동적표 §4.1). */
import Link from "next/link";

import { ListPage, codeCol, dateCol, nameCol, userCol, type ListColumn } from "@/app/_components/ListPage";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import { includesQuery, paginate } from "@/app/_lib/list";
import type { DynTableSummary } from "@/domain/dyntable/types";
import { getServices } from "@/lib/services";

import { COLUMN_BASIS_LABEL } from "./_components/basis";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface SearchParams {
  error?: string;
  q?: string;
  page?: string;
}

export default async function DynTablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const [summaries, users] = await Promise.all([services.dynTable.summaries(), services.auth.listUsers()]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));

  const q = (sp.q ?? "").trim();
  const filtered = summaries.filter((t) => includesQuery(q, [t.code, t.label]));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<DynTableSummary>[] = [
    codeCol((t) => t.code),
    nameCol(NAME_LABEL.dynTable, (t) => t.label, (t) => `/dyntables/${t.code}`),
    { header: "열 기준", width: "sm", cell: (t) => COLUMN_BASIS_LABEL[t.columnBasis] },
    dateCol(FIELD_LABEL.updatedAt, (t) => t.updatedAt ?? new Date(0)),
    userCol(FIELD_LABEL.updatedBy, (t) => t.updatedBy ?? "", userName),
  ];

  return (
    <ListPage
      title={ENTITY_LABEL.dynTable}
      create={{ href: "/dyntables/new", label: newLabel(ENTITY_LABEL.dynTable) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.dynTable) }}
      columns={columns}
      rows={rows}
      rowKey={(t) => t.code}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/dyntables"
      query={{ q }}
      error={sp.error}
      empty={
        summaries.length === 0 ? (
          <div className="ts-empty">
            <p className="ts-empty-what">동적표는 담보약관에 들어가는 감액 지급금액 표 · (갱신) 표를 급부 · 감액 값으로 펼치는 정의다.</p>
            <p className="ts-empty-action">
              <Link href="/dyntables/new">새 동적표 만들기</Link>
            </p>
          </div>
        ) : (
          <p className="ts-empty-what">이 조건에 맞는 동적표가 없습니다.</p>
        )
      }
    />
  );
}
