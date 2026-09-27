
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { UsageList } from "@/app/_components/UsageList";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { refStats, usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { AttributeEditor } from "./AttributeEditor";

export const dynamic = "force-dynamic";

export default async function AttributeDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const [item, graph] = await Promise.all([services.product.getAttributeKind(code), services.refs.graph()]);
  if (!item) return <div><Breadcrumb items={[{ label: ENTITY_LABEL.attribute, href: "/attributes" }, { label: code }]} /><p className="ts-error-banner">찾을 수 없습니다.</p></div>;

  const usages = usagesOf(graph, { kind: "attribute", code });
  const valueUsage = Object.fromEntries(item.values.map((value) => [value.code, usagesOf(graph, { kind: "attributeValue", code, valueCode: value.code }).length]));
  const usage = <UsageList usages={usages} totalRefs={refStats(graph).edges} empty="아무 상품담보 · 식도 이 담보속성을 쓰지 않는다." />;
  const signature = item.values.map((value) => value.code).join(":");
  return <AttributeEditor key={`${code}:${signature}`} item={item} usage={usage} usageCount={usages.length} valueUsage={valueUsage} />;
}
