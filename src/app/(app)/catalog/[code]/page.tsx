import Link from "next/link";

import { basicsCrumb } from "@/app/_components/BasicsTabs";
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { formatCoordinate } from "@/domain/coordinate";
import { MASTER } from "@/domain/master";
import { affectedProducts, dependentDiscriminators, describeKey, nodeKey, refStats, transitiveUsages, type EdgeVia } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { insertPanelData } from "../lib";
import { CatalogEditor } from "./CatalogEditor";

export const dynamic = "force-dynamic";

const VIA_LABEL = {
  when: "조건식", slot: "치환 슬롯", expression: "파생식", nodeQualifier: "노드 한정자", clauseRef: "공용조항 참조", optionSelect: "옵션 선택",
  override: "옵션 오버라이드", articleRef: "조 참조", link: "조연결", appendixRef: "별표 참조", generalDocument: "보통약관 연결",
  document: "담보약관", type: "타입", mount: "탑재", combination: "조합",
} as const satisfies Record<EdgeVia, string>;

export default async function CatalogDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def) return <div><Breadcrumb items={[basicsCrumb("discriminators"), { label: code }]} /><p className="ts-error-banner">찾을 수 없습니다.</p></div>;
  const [graph, enums, defs, inspection] = await Promise.all([
    services.refs.graph(),
    services.catalog.listEnums(),
    services.catalog.list(),
    // 저장된 정의를 그대로 검사 — 미지정일 때 「추론: …」과 읽기 모드의 경고 배지(별칭 · 깨진 사용처) 재료 (기능/구분자 §3.3).
    // 경고는 저장하지 않고 읽을 때 계산한다.
    services.catalog.inspect({ code, expression: def.expression, level: def.level, ...(def.resultType ? { resultType: def.resultType } : {}) }),
  ]);
  const inferred = inspection.inferred;
  // 넣기 패널 재료 — 마스터 필드 트리와 구분자 목록을 직렬화해 넘긴다 (기능/구분자 §4.3)
  const panel = insertPanelData(MASTER, defs);
  // 사용처는 두 묶음 — 이 구분자를 쓰는 문면(조건식 · 슬롯 · 공용조항 본문)과 이 구분자를 참조하는 다른 구분자 (기능/구분자 §4.4).
  // 문면은 참조하는 구분자를 거쳐 닿는 것까지 센다 (ADR-0049 §2 역인덱스 「구분자 → 구분자 → 문면 → 상품」).
  const usages = transitiveUsages(graph, code);
  const dependents = dependentDiscriminators(graph, code);
  const products = affectedProducts(graph, code);
  const totalRefs = refStats(graph).edges;
  const labelOf = (c: string) => graph.nodes.get(nodeKey({ kind: "discriminator", code: c }))?.label;
  const chain = (codes: readonly string[]) => codes.map((c) => { const l = labelOf(c); return l ? `${l}(${c})` : c; }).join(" → ");
  const usage = <div>
    <p className="ts-l2-side-title">조문 사용처 <span className="ts-count"><b>{usages.length}</b> / 전체 참조 {totalRefs}</span></p>
    {usages.length === 0 ? <div className="ts-empty"><p className="ts-empty-what">아무 조문도 이 구분자를 읽지 않는다.</p><p className="ts-empty-action"><Link href="/documents?kind=general">약관 템플릿에서 쓰러 가기 →</Link></p></div> : <table className="ts-table"><thead><tr><th className="col-fixed-md">형태</th><th className="col-flex">좌표</th></tr></thead><tbody>{usages.map(({ edge, via }, index) => { const href = coordinateHref(edge.at); const at = formatCoordinate(edge.at, { source: true }); return <tr key={index}><td>{VIA_LABEL[edge.via]}</td><td>{href ? <Link href={href}>{at}</Link> : at}{via.length > 0 ? <span className="ts-muted"> · {chain(via)} 을 거쳐</span> : null}</td></tr>; })}</tbody></table>}
    <p className="ts-l2-side-title">참조하는 구분자 <span className="ts-count"><b>{dependents.length}</b></span></p>
    {dependents.length === 0 ? <div className="ts-empty"><p className="ts-empty-what">이 구분자를 식에서 읽는 구분자가 없다.</p></div> : <table className="ts-table"><thead><tr><th className="col-fixed-md">코드</th><th className="col-flex">구분자명 · 경로</th></tr></thead><tbody>{dependents.map((dep) => <tr key={dep.code}><td className="ts-mono">{dep.code}</td><td><Link href={`/catalog/${dep.code}`}>{labelOf(dep.code) ?? dep.code}</Link>{dep.path.length > 1 ? <span className="ts-muted"> · {chain(dep.path.slice(0, -1))} 을 거쳐</span> : null}</td></tr>)}</tbody></table>}
    <p className="ts-l2-side-title">영향 받는 상품 <span className="ts-count"><b>{products.length}</b></span></p>
    {products.length === 0 ? <div className="ts-empty"><p className="ts-empty-what">이 구분자의 조문 사용처가 들어가는 상품이 없다.</p></div> : <table className="ts-table"><thead><tr><th className="col-fixed-md">상품</th><th className="col-flex">경유</th></tr></thead><tbody>{products.map((p) => { const last = p.through.at(-1); return <tr key={nodeKey(p.product)}><td>{p.product.kind === "product" ? <Link href={`/products/${p.product.id}/preview`}>{p.productName}</Link> : p.productName}</td><td className="ts-muted">{last ? describeKey(last, graph) : ""}</td></tr>; })}</tbody></table>}
  </div>;
  return <div><CatalogEditor def={def} enums={enums} inferred={inferred} warnings={inspection.warnings} panel={panel} usage={usage} usageCount={usages.length} /></div>;
}
