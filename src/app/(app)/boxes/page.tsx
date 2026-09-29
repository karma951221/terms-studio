/**
 * 박스 조회 (L1) — 정적 마스터 › 박스 (기능/박스 §4.1). 별표 목록과 같은 모양이다 — 화면은 컬럼만 적고 조립은 ListPage.
 * 목록의 일은 찾아서 들어가는 것이다 — 고치기 · 삭제는 상세(L2)에서.
 */
import { EmptyState } from "@/app/_components/EmptyState";
import { ListPage, codeCol, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { formatDate, includesQuery, paginate } from "@/app/_lib/list";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import type { Box } from "@/domain/document";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface SearchParams {
  error?: string;
  q?: string;
  page?: string;
}

export default async function BoxesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const [list, audits, users] = await Promise.all([services.document.listBoxes(), services.document.boxAudits(), services.auth.listUsers()]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));

  const q = (sp.q ?? "").trim();
  const filtered = list.filter((x) => includesQuery(q, [x.code, x.name, x.title]));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<Box>[] = [
    codeCol((x) => x.code),
    nameCol(NAME_LABEL.box, (x) => x.name, (x) => `/boxes/${encodeURIComponent(x.code)}`),
    { header: FIELD_LABEL.title, width: "flex", cell: (x) => x.title || <span className="ts-muted">없음</span> },
    { header: "줄 수", width: "sm", mono: true, cell: (x) => x.lines.length },
    { header: FIELD_LABEL.updatedAt, width: "md", mono: true, cell: (x) => { const audit = audits.get(x.code); return audit ? formatDate(audit.updatedAt) : "—"; } },
    { header: FIELD_LABEL.updatedBy, width: "md", cell: (x) => { const by = audits.get(x.code)?.updatedBy; return (by && userName.get(by)) ?? "—"; } },
  ];

  return (
    <ListPage
      title={ENTITY_LABEL.box}
      create={{ href: "/boxes/new", label: newLabel(ENTITY_LABEL.box) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.box) }}
      columns={columns}
      rows={rows}
      rowKey={(x) => x.code}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/boxes"
      query={{ q }}
      error={sp.error}
      empty={
        list.length === 0 ? (
          <EmptyState what="박스는 놓인 자리에 내용이 그대로 들어가는 고정 글이다." example="【용어풀이】 보험연도" actionHref="/boxes/new" actionLabel="새 박스 만들기" />
        ) : (
          <p className="ts-empty-what">이 조건에 맞는 박스가 없습니다.</p>
        )
      }
    />
  );
}
