/**
 * 별표 조회 (L1) — 화면은 컬럼만 적고, 조립은 ListPage 가 한다.
 *
 * 함수조항 · 구분자 목록과 같은 모양이다 — 코드 · 이름(상세로) · 설명 · 최종수정 · 수정자.
 * 최종수정 · 수정자는 `Appendix` 에 없다 — 저장소의 감사 정보(`appendixAudits`)로 따로 받는다
 * (구분자 목록이 `catalog.audits()` 를 받는 것과 같은 방식).
 * 이름 · 설명 고치기와 삭제는 상세(L2)로 갔다. 목록의 일은 **찾아서 들어가는 것**이다
 * (2026-09-09: 행마다 입력칸과 저장 버튼이 서 있던 편집형 목록을 접었다).
 */
import { EmptyState } from "@/app/_components/EmptyState";
import { ListPage, codeCol, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { formatDate, includesQuery, paginate } from "@/app/_lib/list";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import type { Appendix } from "@/domain/document";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface SearchParams {
  error?: string;
  q?: string;
  page?: string;
}

export default async function AppendicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  const [list, audits, users] = await Promise.all([
    services.document.listAppendices(),
    services.document.appendixAudits(),
    services.auth.listUsers(),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));

  const q = (sp.q ?? "").trim();
  const filtered = list.filter((a) => includesQuery(q, [a.code, a.name]));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<Appendix>[] = [
    codeCol((a) => a.code),
    nameCol(NAME_LABEL.appendix, (a) => a.name, (a) => `/appendices/${encodeURIComponent(a.code)}`),
    { header: FIELD_LABEL.note, width: "flex", cell: (a) => a.description || <span className="ts-muted">없음</span> },
    { header: FIELD_LABEL.updatedAt, width: "md", mono: true, cell: (a) => { const audit = audits.get(a.code); return audit ? formatDate(audit.updatedAt) : "—"; } },
    { header: FIELD_LABEL.updatedBy, width: "md", cell: (a) => { const by = audits.get(a.code)?.updatedBy; return (by && userName.get(by)) ?? "—"; } },
  ];

  return (
    <ListPage
      title={ENTITY_LABEL.appendix}
      create={{ href: "/appendices/new", label: newLabel(ENTITY_LABEL.appendix) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.appendix) }}
      columns={columns}
      rows={rows}
      rowKey={(a) => a.code}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/appendices"
      query={{ q }}
      error={sp.error}
      empty={
        list.length === 0 ? (
          <EmptyState
            what="별표는 책자가 참조한 표·서식을 모아 마지막에 수록하는 독립 마스터다."
            example="장해분류표"
            actionHref="/appendices/new"
            actionLabel="새 별표 만들기"
          />
        ) : (
          <p className="ts-empty-what">이 조건에 맞는 별표가 없습니다.</p>
        )
      }
    />
  );
}
