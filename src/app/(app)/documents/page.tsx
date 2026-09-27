/**
 * 약관 템플릿 조회 (L1) — 한 화면에 한 종류. 보통약관 템플릿과 담보약관 템플릿(특별약관)은 만드는 자리가 달라
 * 한 표로 합치지 않고, 사이드바 항목도 둘이다. 종류는 쿼리(`?kind=general|coverage`)로 가른다 —
 * 라우트는 `/documents` 하나라 상세·생성 링크가 깨지지 않는다. `kind` 가 없으면 보통약관으로 보낸다.
 *
 * 담보약관 템플릿에는 `+` 가 없다 — 담보 하나가 소유하는 문서라 담보 상세에서 생긴다.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState } from "@/app/_components/EmptyState";
import { ListPage, dateCol, nameCol, userCol, type ListColumn } from "@/app/_components/ListPage";
import { ENTITY_LABEL, newLabel } from "@/app/_lib/labels";
import { includesQuery, paginate } from "@/app/_lib/list";
import type { DocumentSummary } from "@/db/repo/document";
import { getServices } from "@/lib/services";

import type { DocListKind } from "./lib";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; error?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  if (sp.kind !== "general" && sp.kind !== "coverage") {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "kind" && v) q.set(k, v);
    q.set("kind", "general");
    redirect(`/documents?${q.toString()}`);
  }
  const kind: DocListKind = sp.kind;
  const services = getServices();
  const [docs, users] = await Promise.all([services.document.list(kind === "general" ? "general" : "special"), services.auth.listUsers()]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));

  const q = (sp.q ?? "").trim();
  const slice = paginate(docs.filter((d) => includesQuery(q, [d.title])), sp.page, PAGE_SIZE);

  const audit: readonly ListColumn<DocumentSummary>[] = [
    dateCol("최종수정", (d) => d.updatedAt),
    userCol("수정자", (d) => d.updatedBy ?? "", userName),
  ];

  const columns: readonly ListColumn<DocumentSummary>[] =
    kind === "general"
      ? [nameCol("제목", (d) => d.title, (d) => `/documents/${d.id}`), ...audit]
      : [
          nameCol("제목", (d) => d.title, (d) => `/documents/${d.id}`),
          { header: "담보", width: "md", cell: (d) => (d.ownerId ? <Link href={`/coverages/${d.ownerId}`}>담보 열기</Link> : "—") },
          {
            header: "대응 보통약관",
            width: "md",
            cell: (d) => (d.generalDocumentId ? <Link href={`/documents/${d.generalDocumentId}`}>있음</Link> : <span className="ts-muted">없음</span>),
          },
          ...audit,
        ];

  const title = kind === "general" ? ENTITY_LABEL.generalTemplate : ENTITY_LABEL.coverageTemplate;

  return (
    <ListPage
      title={title}
      {...(kind === "general" ? { create: { href: "/documents/new", label: newLabel(ENTITY_LABEL.generalTemplate) } } : {})}
      search={{ placeholder: "제목" }}
      columns={columns}
      rows={slice.rows}
      rowKey={(d) => d.id}
      total={slice.total}
      page={slice.page}
      pageSize={PAGE_SIZE}
      basePath="/documents"
      query={{ kind, q }}
      error={sp.error}
      empty={
        docs.length > 0 ? (
          <p className="ts-empty-what">이 조건에 맞는 {title}이 없습니다.</p>
        ) : kind === "general" ? (
          <EmptyState
            what="보통약관 템플릿은 여러 벌 존재하며 상품이 그중 하나를 선택해 쓰는 문서다."
            example="상해보험 표준약관"
            actionHref="/documents/new"
            actionLabel={`${newLabel(ENTITY_LABEL.generalTemplate)} 만들기`}
          />
        ) : (
          <EmptyState
            what="담보약관 템플릿은 담보 하나가 소유하는 특별약관 문서다 — 여기서 직접 만들지 않는다."
            example="일반상해사망 특별약관"
            actionHref="/coverages"
            actionLabel="담보약관 템플릿은 담보 상세 화면에서 생성하세요 — 담보 목록으로"
          />
        )
      }
    />
  );
}
