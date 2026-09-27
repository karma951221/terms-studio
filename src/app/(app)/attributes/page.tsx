/** 담보속성 조회 (L1) — 목록은 고르는 자리, 값 편집은 상세에서 한다. */
import { EmptyState } from "@/app/_components/EmptyState";
import { ListPage, codeCol, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import { formatDate, includesQuery, paginate } from "@/app/_lib/list";
import type { AttributeKind } from "@/domain/product";
import { getServices } from "@/lib/services";

import { attributeAudits } from "./ui-data";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function valuePreview(item: AttributeKind): string {
  const values = [...item.values].sort((a, b) => a.order - b.order);
  const shown = values.slice(0, 5).map((value) => value.label).join(" · ");
  const rest = values.length - 5;
  return `${shown || "—"}${rest > 0 ? ` … 외 ${rest}` : ""}`;
}

export default async function AttributesPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const services = getServices();
  const [items, audits, users] = await Promise.all([services.product.listAttributeKinds(), attributeAudits(), services.auth.listUsers()]);
  const userName = new Map(users.map((user) => [user.id, user.name] as const));
  const q = (sp.q ?? "").trim();
  const filtered = items.filter((item) => includesQuery(q, [item.code, item.label, ...item.values.map((value) => value.label)]));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<AttributeKind>[] = [
    codeCol((item) => item.code),
    nameCol(NAME_LABEL.attribute, (item) => item.label, (item) => `/attributes/${item.code}`),
    { header: FIELD_LABEL.values, width: "values", cell: valuePreview },
    { header: FIELD_LABEL.count, width: "num", cell: (item) => item.values.length },
    { header: FIELD_LABEL.updatedAt, width: "md", mono: true, cell: (item) => { const audit = audits.get(item.code); return audit ? formatDate(audit.updatedAt) : "—"; } },
    { header: FIELD_LABEL.updatedBy, width: "md", cell: (item) => { const by = audits.get(item.code)?.updatedBy; return (by && userName.get(by)) ?? "—"; } },
  ];

  return (
    <ListPage
      title={FIELD_LABEL.type}
      heading="sub"
      create={{ href: "/attributes/new", label: newLabel(ENTITY_LABEL.attributeType) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.attribute, FIELD_LABEL.value) }}
      columns={columns}
      rows={rows}
      rowKey={(item) => item.code}
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
