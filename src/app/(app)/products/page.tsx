/**
 * 상품 조회 (L1) — 조립은 ListPage 가 한다.
 *
 * 상품 마스터에는 코드가 없다(src/domain/product/types.ts Product — id·name·generalDocumentId 뿐) —
 * 1열을 상품명으로 하고 나머지 고정 컬럼을 뒤에 둔다. 최종수정·수정자도 스키마에 없어 아직 못 낸다.
 */
import { EmptyState } from "@/app/_components/EmptyState";
import { ListPage, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { includesQuery, paginate } from "@/app/_lib/list";
import { ENTITY_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";
import type { Product } from "@/domain/product/types";
import { getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const products = await getServices().product.listProducts();

  const q = (sp.q ?? "").trim();
  const filtered = products.filter((p) => includesQuery(q, [p.name]));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);

  const columns: readonly ListColumn<Product>[] = [
    nameCol(NAME_LABEL.product, (p) => p.name, (p) => `/products/${p.id}`),
    {
      header: "보통약관",
      width: "md",
      cell: (p) => (p.generalDocumentId ? "지정됨" : <span className="ts-muted">미지정</span>),
    },
  ];

  return (
    <ListPage
      title={ENTITY_LABEL.product}
      create={{ href: "/products/new", label: newLabel(ENTITY_LABEL.product) }}
      search={{ placeholder: NAME_LABEL.product }}
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/products"
      query={{ q }}
      error={sp.error}
      empty={
        products.length === 0 ? (
          <EmptyState
            what="상품은 약관 책자 1권의 단위다 — 담보를 탑재하고 조문을 조립한다."
            example="알파Plus(축약)"
            actionHref="/products/new"
            actionLabel="새 상품 만들기"
          />
        ) : (
          <p className="ts-empty-what">이 조건에 맞는 상품이 없습니다.</p>
        )
      }
    />
  );
}
