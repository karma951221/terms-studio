/**
 * 공용조항 상세 (L2) — 세 단 에디터(약관 에디터 · 인스펙터 · 옵션 목록), 읽기로 시작 → 편집 → 저장 한 번 (기능/공용조항 §4.3).
 * 서버는 정의와 에디터 재료(조건 문맥 · 슬롯 후보 · 별표 · 보통약관)를 한 번 읽어 넘긴다. 사용처 · 재검사 목록은 관계정보(§4.4).
 */
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { getServices } from "@/lib/services";

import { ClauseAuthoring } from "../_components/ClauseAuthoring";
import { loadClauseEditorData } from "../editorData";
import { valueText } from "../lib";

export const dynamic = "force-dynamic";

export default async function ClauseDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clause = await getServices().clause.get(code);
  if (!clause) {
    return (
      <div style={{ padding: 20 }}>
        <Breadcrumb items={[{ label: ENTITY_LABEL.clause, href: "/clauses" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const data = await loadClauseEditorData();
  return (
    <ClauseAuthoring
      // 저장 뒤 새로 받은 정의로 화면을 다시 짓는다 — 편집본은 편집을 시작할 때 원본에서 만든다
      key={clause.code}
      code={clause.code}
      label={clause.label}
      mode={clause.mode}
      body={clause.body}
      options={clause.options.map((option) => ({
        code: option.code,
        label: option.label,
        values: option.values.map((value) => ({ code: value.code, label: value.label, text: valueText(value.body) })),
      }))}
      required={clause.required}
      data={data}
    />
  );
}
