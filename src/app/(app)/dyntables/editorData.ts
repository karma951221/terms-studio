/**
 * 동적표 에디터 화면(`/dyntables/new` · `/dyntables/<code>`)이 서버에서 한 번 읽어 넘기는 재료 (서버 전용).
 *
 * 함수조항 에디터(`functions/editorData.ts`)의 부분집합 — 인자 표(타입 · 기본 연결 후보)와 템플릿 조건 · 슬롯 고르기의 문맥만.
 * 별표 · 박스 · 보통약관은 동적표 템플릿에 들어가지 않는다(기능/동적표 §3.3 — 글 · 슬롯 · 조건 · 값별 분기 · 조사만).
 */
import { buildConditionContext } from "@/app/(app)/documents/[id]/_components/condition/conditionContext";
import type { ConditionContext } from "@/app/(app)/documents/[id]/_components/condition/types";
import { planFormChoices, type EnumChoice, type PlanFormChoice } from "@/app/(app)/functions/_components/params";
import { getServices } from "@/lib/services";

export interface DynTableEditorData {
  /** 조건 · 슬롯 고르기 문맥 — 구분자는 인자 기본 연결 후보로만 쓰고, 템플릿은 인자(`arg.X`)와 표 슬롯만 읽는다. */
  condition: ConditionContext;
  enums: EnumChoice[];
  planForms: PlanFormChoice[];
}

export async function loadDynTableEditorData(): Promise<DynTableEditorData> {
  const services = getServices();
  const [discriminators, enums, attributes] = await Promise.all([services.catalog.list(), services.catalog.listEnums(), services.product.listAttributeKinds()]);
  return {
    condition: buildConditionContext({ discriminators, enums, attributes }),
    enums: enums.map((e) => ({
      code: e.code,
      label: e.label,
      values: [...e.values].sort((a, b) => a.order - b.order).map((v) => ({ code: v.code, label: v.label, ...(v.fields ? { fields: v.fields } : {}) })),
      fields: [...(e.fields ?? [])].sort((a, b) => a.order - b.order).map((f) => ({ key: f.key, label: f.label, type: f.type })),
    })),
    planForms: planFormChoices(),
  };
}
