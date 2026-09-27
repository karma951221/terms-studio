/**
 * 담보 조회 (L1) — 조립은 ListPage 가 한다.
 *
 * 디자인원칙 §2 L1 「담보 조회의 컬럼」은 코드·담보명·담보분류·상태·최종수정 5컬럼을 정했다.
 * 담보코드(`COV000001`, 시스템 채번 — 기능/담보 §3.1)는 2026-09-27 에 생겨 1열에 선다. 검색은 코드 · 담보명 둘 다 본다.
 * 담보분류(담보 레벨 enum 구분자) · 상태(미사용/적용/확정)는 아직 도메인에 없다 — 도메인에 없는 값을 화면이 지어내지 않는다.
 */
import { EmptyState } from "@/app/_components/EmptyState";
import { ListPage, codeCol, dateCol, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { includesQuery, paginate } from "@/app/_lib/list";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import type { CoverageSummary } from "@/db/repo/coverage";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CoveragesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const summaries = await getServices().coverage.listSummaries();

  const q = (sp.q ?? "").trim();
  const filtered = summaries.filter((c) => includesQuery(q, [c.code, c.name]));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<CoverageSummary>[] = [
    codeCol((c) => c.code),
    nameCol(NAME_LABEL.coverage, (c) => c.name, (c) => `/coverages/${c.id}`),
    dateCol(FIELD_LABEL.updatedAt, (c) => c.updatedAt),
  ];

  return (
    <ListPage
      title={ENTITY_LABEL.coverage}
      create={{ href: "/coverages/new", label: newLabel(ENTITY_LABEL.coverage) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.coverage) }}
      columns={columns}
      rows={rows}
      rowKey={(c) => c.id}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/coverages"
      query={{ q }}
      error={sp.error}
      empty={
        summaries.length === 0 ? (
          <EmptyState
            what="담보는 재사용되는 보장 단위의 마스터다 — 담보약관 템플릿 1벌과 세부보장 트리를 소유한다."
            example="일반상해사망보장, 수술비"
            actionHref="/coverages/new"
            actionLabel="새 담보 만들기"
          />
        ) : (
          <p className="ts-empty-what">이 조건에 맞는 담보가 없습니다.</p>
        )
      }
    />
  );
}
