/**
 * 새 동적표 — 이 화면 자체가 상세와 같은 에디터, 처음부터 편집 중이다 (기능/동적표 §4.2).
 * 저장하는 순간 저장 검사(§3.6)를 통과해야 만들어진다 — 실패면 아무것도 만들지 않고 그 칸 아래 사유.
 */
import { DEFAULT_ROW_HEADER, defaultCellTemplate, defaultSingleHeader } from "@/domain/dyntable/types";

import { DynTableAuthoring } from "../_components/DynTableAuthoring";
import { loadDynTableEditorData } from "../editorData";

export const dynamic = "force-dynamic";

export default async function NewDynTablePage() {
  const data = await loadDynTableEditorData();
  return (
    <DynTableAuthoring
      table={{ label: "", params: [], columnBasis: "reduction", rowHeader: DEFAULT_ROW_HEADER, headers: { first: [], middle: [], last: [], single: defaultSingleHeader() }, cell: defaultCellTemplate() }}
      data={data}
    />
  );
}
