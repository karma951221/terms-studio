/**
 * 별표 상세 (L2) — 코드(불변) · 이름 · 설명. 사용처는 관계정보 메뉴에서 본다 (2026-10-01).
 *
 * 별표는 필드가 셋뿐이라 오래도록 상세 없이 목록에서 바로 고쳤다. 그러다 목록이 저 혼자
 * 입력칸 표가 되어 다른 마스터 목록과 다르게 보였다 — 2026-09-09, 고치는 자리를 여기로 옮겼다.
 */
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { AppendixEditor } from "./AppendixEditor";

export const dynamic = "force-dynamic";

export default async function AppendixDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const appendix = await services.document.getAppendix(code);
  if (!appendix) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.appendix, href: "/appendices" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  return <div><AppendixEditor appendix={appendix} /></div>;
}
