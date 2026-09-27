import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { structureDraftOf } from "@/domain/coverage";
import type { MountImpact } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { StructureEditor } from "./StructureEditor";

export const dynamic = "force-dynamic";

/**
 * 「구조 편집」 명령 화면 (ADR-0052 결정 2) — 탑재된 담보의 세부보장 · 급부 구조를, 영향(탑재 상품담보)을 먼저 보이고 고친다.
 * 영향 블록의 탑재 목록은 빈 계획의 `previewStructurePlan` — 지금 탑재 상황(상품 · 상품담보 · 스냅샷 값 행 전체). 삭제의 소실분은 저장 직전
 * confirm 대화상자가 보여준다. 미탑재(0건) 담보도 열리지만 그 담보는 상세 화면에서 고치는 것이 경로다 (안내 문장).
 */
export default async function CoverageStructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  const services = getServices();
  const tree = await services.coverage.get(id);
  if (!tree) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }, { label: id, href: `/coverages/${id}` }, { label: "구조 편집" }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const preview = await services.coverage.previewStructurePlan(actor, id, structureDraftOf(tree));
  const mounts: MountImpact[] = preview.ok ? preview.value.mounts ?? [] : [];
  // 이름 · 구조가 바뀌면 초안을 새 진실로 다시 세운다 (상세 화면과 같은 패턴).
  const signature = tree.subCoverages.map((sub) => `${sub.id}=${sub.name}:${sub.benefits.map((b) => `${b.id}=${b.name}`).join(",")}`).join("|");
  return (
    <StructureEditor
      key={signature}
      id={tree.id}
      name={tree.name}
      documentId={tree.documentId}
      initial={{ structure: structureDraftOf(tree) }}
      mounts={mounts}
    />
  );
}
