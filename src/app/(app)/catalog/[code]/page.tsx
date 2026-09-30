import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { DISCRIMINATORS_MENU, menuCrumb } from "@/app/_lib/menu";
import { MASTER } from "@/domain/master";
import { getServices } from "@/lib/services";

import { insertPanelData } from "../lib";
import { CatalogEditor } from "./CatalogEditor";

export const dynamic = "force-dynamic";

export default async function CatalogDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const def = await services.catalog.get(code);
  if (!def) return <div><Breadcrumb items={[menuCrumb(DISCRIMINATORS_MENU), { label: code }]} /><p className="ts-error-banner">찾을 수 없습니다.</p></div>;
  const [enums, defs, inspection] = await Promise.all([
    services.catalog.listEnums(),
    services.catalog.list(),
    // 저장된 정의를 그대로 검사 — 미지정일 때 「추론: …」과 읽기 모드의 경고 배지(별칭 · 깨진 사용처) 재료 (기능/구분자 §3.3).
    // 경고는 저장하지 않고 읽을 때 계산한다.
    services.catalog.inspect({ code, expression: def.expression, level: def.level, ...(def.resultType ? { resultType: def.resultType } : {}) }),
  ]);
  const inferred = inspection.inferred;
  // 넣기 패널 재료 — 마스터 필드 트리와 구분자 목록을 직렬화해 넘긴다 (기능/구분자 §4.3)
  const panel = insertPanelData(MASTER, defs);
  // 사용처(쓰는 조문 · 참조하는 구분자 · 영향 받는 상품)는 이 화면에 두지 않는다 — 관계정보 메뉴 (디자인원칙 §11.2, 2026-10-01).
  return <div><CatalogEditor def={def} enums={enums} inferred={inferred} warnings={inspection.warnings} panel={panel} /></div>;
}
