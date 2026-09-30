import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { AttributeEditor } from "./AttributeEditor";

export const dynamic = "force-dynamic";

export default async function AttributeDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const item = await getServices().product.getAttributeKind(code);
  if (!item) return <div><Breadcrumb items={[{ label: ENTITY_LABEL.attribute, href: "/attributes" }, { label: code }]} /><p className="ts-error-banner">찾을 수 없습니다.</p></div>;

  const signature = item.values.map((value) => value.code).join(":");
  return <AttributeEditor key={`${code}:${signature}`} item={item} />;
}
