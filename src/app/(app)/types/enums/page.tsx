/** 선택지 조회 (L1) — 「유형」 화면 = 열거형변수 목록. 하위 탭이 하나뿐이라 탭 없이 제목만 선다. 조립은 ListPage 가 한다. */
import { EmptyState } from "@/app/_components/EmptyState";
import type { ColumnFilterSpec } from "@/app/_components/ListFilters";
import { ListPage, codeCol, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { formatDate, includesQuery, paginate } from "@/app/_lib/list";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import type { EnumDef } from "@/domain/catalog";
import { usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const FILTERS = [{ key: "usage", label: "사용처", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }] }] as const satisfies readonly ColumnFilterSpec[];

interface Row {
  item: EnumDef;
  usageCount: number;
}

const VALUE_PREVIEW = 5;

/** 값은 칩으로 앞 5개만, 나머지는 「+N」 — 목록은 훑는 자리다. 전체는 title 로. (현행 약관시스템 조회 화면과 같은 모양, 2026-09-12) */
function ValueChips({ item }: { item: EnumDef }) {
  const values = [...item.values].sort((a, b) => a.order - b.order);
  if (values.length === 0) return <span className="ts-muted">—</span>;
  const rest = values.length - VALUE_PREVIEW;
  return <span className="ts-chips" title={values.map((value) => value.label).join(", ")}>
    {values.slice(0, VALUE_PREVIEW).map((value) => <span key={value.code} className="ts-chip">{value.label}</span>)}
    {rest > 0 ? <span className="ts-chip-more">+{rest}</span> : null}
  </span>;
}

export default async function EnumListPage({ searchParams }: { searchParams: Promise<{ error?: string; q?: string; usage?: string; page?: string }> }) {
  const sp = await searchParams;
  const services = getServices();
  const [enums, graph, audits, users] = await Promise.all([services.catalog.listEnums(), services.refs.graph(), services.catalog.enumAudits(), services.auth.listUsers()]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));
  const q = (sp.q ?? "").trim();
  const usage = sp.usage ?? "";
  const withUsage: Row[] = enums.map((item) => ({
    item,
    usageCount: usagesOf(graph, { kind: "enum", enumCode: item.code }, { via: ["type"] }).length,
  }));
  const filtered = withUsage.filter(({ item, usageCount }) => {
    if (!includesQuery(q, [item.code, item.label, ...item.values.map((value) => value.label)])) return false;
    if (usage === "yes" && usageCount === 0) return false;
    if (usage === "no" && usageCount > 0) return false;
    return true;
  });
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<Row>[] = [
    codeCol((r) => r.item.code),
    nameCol(NAME_LABEL.enum, (r) => r.item.label, (r) => `/types/enums/${r.item.code}`),
    { header: FIELD_LABEL.values, width: "values", cell: (r) => <ValueChips item={r.item} /> },
    { filter: FILTERS[0], width: "sm", cell: (r) => r.usageCount || "—" },
    { header: FIELD_LABEL.updatedAt, width: "md", mono: true, cell: (r) => { const audit = audits.get(r.item.code); return audit ? formatDate(audit.updatedAt) : "—"; } },
    { header: FIELD_LABEL.updatedBy, width: "md", cell: (r) => { const by = audits.get(r.item.code)?.updatedBy; return (by && userName.get(by)) ?? "—"; } },
  ];

  return (
    <ListPage
      title={FIELD_LABEL.type}
      create={{ href: q ? `/types/enums/new?q=${encodeURIComponent(q)}` : "/types/enums/new", label: newLabel(ENTITY_LABEL.enum) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.enum, FIELD_LABEL.value) }}
      filters={FILTERS}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.item.code}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/types/enums"
      query={{ q, usage }}
      error={sp.error}
      empty={enums.length === 0 ? <EmptyState what="열거형변수는 목록값 타입이 고르는 값의 정의다." example="심사유형: 일반심사 · 간편심사" actionHref="/types/enums/new" actionLabel={newLabel(ENTITY_LABEL.enum)} /> : <p className="ts-empty-what">이 조건에 맞는 열거형변수가 없습니다.</p>}
    />
  );
}
