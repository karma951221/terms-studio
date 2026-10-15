import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { getServices } from "@/lib/services";

import { ENUMS_MENU, menuCrumb } from "@/app/_lib/menu";
import { EnumEditor } from "./EnumEditor";

export const dynamic = "force-dynamic";

export default async function EnumDetailPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ value?: string }> }) {
  const { code } = await params;
  const { value } = await searchParams;
  const item = await getServices().catalog.getEnum(code);
  if (!item) return <div><Breadcrumb items={[menuCrumb(ENUMS_MENU), { label: code }]} /><p className="ts-error-banner">찾을 수 없습니다.</p></div>;
  return <div><EnumEditor key={code} item={item} highlight={value} /></div>;
}
