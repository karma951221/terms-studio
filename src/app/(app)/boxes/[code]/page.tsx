/**
 * 박스 상세 (L2) — 코드(불변) · 이름 · 제목 · 줄 (기능/박스 §4.3). 사용처는 관계정보 메뉴에서 본다 (2026-10-01).
 */
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { BoxEditor } from "./BoxEditor";

export const dynamic = "force-dynamic";

export default async function BoxDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const box = await services.document.getBox(code);
  if (!box) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.box, href: "/boxes" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  return <div><BoxEditor box={box} /></div>;
}
