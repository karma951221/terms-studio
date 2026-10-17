/**
 * 동적표 상세 (L2) — 읽기로 시작 → `편집` → 저장 한 번 (기능/동적표 §4.2).
 * 서버는 정의와 에디터 재료(인자 타입 · 기본 연결 후보 · 조건 문맥)를 한 번 읽어 넘긴다. 사용처는 관계정보.
 */
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { DynTableAuthoring } from "../_components/DynTableAuthoring";
import { loadDynTableEditorData } from "../editorData";

export const dynamic = "force-dynamic";

export default async function DynTableDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const table = await getServices().dynTable.get(code);
  if (!table) {
    return (
      <div style={{ padding: 20 }}>
        <Breadcrumb items={[{ label: ENTITY_LABEL.dynTable, href: "/dyntables" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const data = await loadDynTableEditorData();
  return (
    <DynTableAuthoring
      // 저장 뒤 새로 받은 정의로 화면을 다시 짓는다 — 편집본은 편집을 시작할 때 원본에서 만든다
      key={`${table.code}:${table.updatedAt?.getTime() ?? 0}`}
      code={table.code}
      table={{ label: table.label, params: table.params, columnBasis: table.columnBasis, rowHeader: table.rowHeader, headers: table.headers, cell: table.cell }}
      data={data}
    />
  );
}
