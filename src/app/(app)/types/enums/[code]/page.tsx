
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { UsageList } from "@/app/_components/UsageList";
import { FIELD_LABEL } from "@/app/_lib/labels";
import { refStats, usagesOf } from "@/domain/refs";
import { getServices } from "@/lib/services";

import { EnumEditor } from "./EnumEditor";

export const dynamic = "force-dynamic";

export default async function EnumDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const [item, graph] = await Promise.all([services.catalog.getEnum(code), services.refs.graph()]);
  if (!item) return <div><Breadcrumb items={[{ label: FIELD_LABEL.type, href: "/types/enums" }, { label: code }]} /><p className="ts-error-banner">찾을 수 없습니다.</p></div>;
  const usages = usagesOf(graph, { kind: "enum", enumCode: code }, { via: ["type"] });
  const valueUsage = Object.fromEntries(item.values.map((value) => [value.code, usagesOf(graph, { kind: "enumValue", enumCode: code, valueCode: value.code }).length]));
  const signature = item.values.map((value) => value.code).join(":");
  const usage = <UsageList usages={usages} totalRefs={refStats(graph).edges} empty="아무 구분자 · 필드도 이 열거형변수를 타입으로 쓰지 않는다." />;
  return <div><EnumEditor key={`${code}:${signature}`} item={item} usage={usage} usageCount={usages.length} valueUsage={valueUsage} /></div>;
}
