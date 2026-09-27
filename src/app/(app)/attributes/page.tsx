/**
 * 담보속성 조회 (L1) — **한 행 = 유효값 하나** (기능/담보속성 §4, 2026-09-28). 유형은 행마다 적고, 값이 없는 유형은 값 칸이 빈 한 행.
 * 목록은 고르는 자리 — 값 편집은 유형 상세에서 한다.
 */
import Link from "next/link";

import { EmptyState } from "@/app/_components/EmptyState";
import { InfoTip } from "@/app/_components/InfoTip";
import { ListPage, type ListColumn } from "@/app/_components/ListPage";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, NAMING_FRAGMENT_TIP, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import { formatDate, paginate } from "@/app/_lib/list";
import { getServices } from "@/lib/services";

import { attributeValueRows, matchesAttributeRow, type AttributeValueRow } from "./list-rows";
import { attributeAudits } from "./ui-data";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AttributesPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const services = getServices();
  const [items, audits, users] = await Promise.all([services.product.listAttributeKinds(), attributeAudits(), services.auth.listUsers()]);
  const userName = new Map(users.map((user) => [user.id, user.name] as const));
  const q = (sp.q ?? "").trim();
  const filtered = attributeValueRows(items).filter((row) => matchesAttributeRow(q, row));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<AttributeValueRow>[] = [
    { header: FIELD_LABEL.attributeCode, width: "code", cell: (row) => <code>{row.kind.code}</code> },
    { header: NAME_LABEL.attribute, width: "md", cell: (row) => <Link href={`/attributes/${row.kind.code}`}>{row.kind.label}</Link> },
    { header: FIELD_LABEL.valueCode, width: "sm", mono: true, cell: (row) => row.value?.code ?? "—" },
    { header: FIELD_LABEL.valueName, width: "flex", cell: (row) => row.value?.label ?? <span className="ts-muted">값 없음</span> },
    {
      header: <>{FIELD_LABEL.namingFragment} <InfoTip text={NAMING_FRAGMENT_TIP} /></>,
      width: "md",
      cell: (row) => (row.value ? row.value.fragment || <span className="ts-muted">—</span> : "—"),
    },
    { header: FIELD_LABEL.updatedAt, width: "md", mono: true, cell: (row) => { const audit = audits.get(row.kind.code); return audit ? formatDate(audit.updatedAt) : "—"; } },
    { header: FIELD_LABEL.updatedBy, width: "md", cell: (row) => { const by = audits.get(row.kind.code)?.updatedBy; return (by && userName.get(by)) ?? "—"; } },
  ];

  return (
    <ListPage
      title={FIELD_LABEL.type}
      heading="sub"
      create={{ href: "/attributes/new", label: newLabel(ENTITY_LABEL.attributeType) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.attribute, FIELD_LABEL.value) }}
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.kind.code}:${row.value?.code ?? ""}`}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/attributes"
      query={{ q }}
      error={sp.error}
      empty={items.length === 0 ? (
        <EmptyState what="담보속성은 상품담보 이름과 조합을 가르는 값의 정의다." example="갱신유형: 갱신형 · 비갱신형" actionHref="/attributes/new" actionLabel={newLabel(ENTITY_LABEL.attributeType)} />
      ) : <p className="ts-empty-what">이 조건에 맞는 담보속성이 없습니다.</p>}
    />
  );
}
