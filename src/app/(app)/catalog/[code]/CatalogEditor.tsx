"use client";

/**
 * 구분자 상세 — 코드(정적) · 구분자명 · 레벨(정적) · 식 · 결과 타입 · 주석 + 사용처.
 *
 * 2026-09-12 — 구분자가 식 하나가 되면서 유형 · 타입 · 노출 · 상수값 · 구조체 필드 표가 사라졌다 (ADR-0037).
 * 레벨은 정적이다 — 식의 참조 규칙(같은 레벨 · 하위는 집계 안)이 레벨에 매여 있어 바꾸면 사용처의 의미가 조용히 달라진다.
 * 2026-09-17 — 선택인 「결과 타입」이 붙었다 (기능/구분자 §3.1). 읽기 모드는 명시 타입을, 미지정이면 「미지정 (추론: …)」을 보인다.
 * 2026-09-17 — 편집 모드 헤더에 「검사」(저장 전 검사 · 오류/경고 두 등급), 읽기 모드 제목 옆에 경고 배지 (기능/구분자 §3.3).
 * 2026-09-17 — 편집 모드 오른쪽에 넣기 패널(마스터 필드 · 구분자 · 연산), 식 입력은 커서 자리 삽입 (기능/구분자 §4.3).
 */
import { useCallback, useEffect, useState } from "react";

import { basicsCrumb } from "@/app/_components/BasicsTabs";
import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { UsageDialog } from "@/app/_components/UsageDialog";
import { ENTITY_LABEL, FIELD_LABEL, LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import type { Discriminator, EnumDef } from "@/domain/catalog";
import type { ExprType } from "@/domain/expression";
import type { AttachLevel, Code, Issue } from "@/domain/types";
import type { InspectInput } from "@/services/catalog";

import { ExpressionInput, useExpressionInsert } from "../_components/ExpressionField";
import { InsertPanel } from "../_components/InsertPanel";
import { InspectButton, InspectionResult, type InspectionState } from "../_components/InspectionPanel";
import { removeDiscriminatorEditAction, saveDiscriminatorEditAction } from "../edit-actions";
import type { CatalogEditData } from "../edit-types";
import { inferredLabel, inspectInputFrom, RESULT_TYPE_HINT, RESULT_TYPE_OPTIONS, resultTypeFromForm, resultTypeLabel, resultTypeToForm, warningBadges, type InsertPanelData } from "../lib";

const LEVEL_INFO = "식이 평가되는 자리. 같은 레벨 입력 항목은 그대로, 하위 레벨은 집계 안에서만 부른다 — 채번 뒤에는 못 고친다";
const EXPR_INFO = "입력 항목(`폼.필드`)과 다른 구분자를 부른다 — 같은 레벨은 그대로, 하위 레벨은 집계 안에서";

/** 편집 중인 값 → 「검사」 입력. 식 · 결과 타입 세 필드를 EditShell 문맥에서 읽는다 (레벨 · 코드는 불변). */
function useInspectInput(code: Code, level: AttachLevel): InspectInput {
  const expression = useEditField<string>("expression");
  const kind = useEditField<string>("resultTypeKind");
  const multi = useEditField<boolean>("resultTypeMulti");
  const enumCode = useEditField<string>("resultTypeEnum");
  return inspectInputFrom(code, level, { expression: expression.value, resultTypeKind: kind.value, resultTypeMulti: multi.value, resultTypeEnum: enumCode.value });
}

function EditInspectButton({ code, level, onResult }: { code: Code; level: AttachLevel; onResult: (state: InspectionState) => void }) {
  const input = useInspectInput(code, level);
  const { pending } = useEditField("expression");
  return <InspectButton input={input} onResult={onResult} disabled={pending} />;
}

/**
 * 본문 — 왼쪽 필드, 편집 모드에서는 오른쪽에 넣기 패널 (기능/구분자 §4.3 상시 패널). 읽기 모드는 필드만.
 * 식 입력은 커서 자리 삽입이 되는 `ExpressionInput` — 패널의 더블클릭이 `insert` 로 들어온다.
 */
function EditorBody({ def, enums, inferred, panel, inspection, onClear }: { def: Discriminator; enums: readonly EnumDef[]; inferred: ExprType | undefined; panel: InsertPanelData; inspection: InspectionState | undefined; onClear: () => void }) {
  const expression = useEditField<string>("expression");
  const { ref, insert, insertReference } = useExpressionInsert(expression.value ?? "", expression.setValue);
  const editing = expression.mode === "edit";
  const fields = (
    <div className="ts-l2-main">
      <div className="ts-form-row">
        <label>코드</label>
        <div className="ts-form-control">
          <span className="ts-field-static ts-mono">{def.code}</span>
        </div>
      </div>
      <Field name="label" label="구분자명" />
      <div className="ts-form-row">
        <label>
          레벨 <InfoTip text={LEVEL_INFO} />
        </label>
        <div className="ts-form-control">
          <span className="ts-field-static">{LEVEL_LABEL[def.level]}</span>
        </div>
      </div>
      <div className="ts-form-row">
        <label>식 <InfoTip text={EXPR_INFO} /></label>
        <div className="ts-form-control">
          {editing ? <ExpressionInput inputRef={ref} value={expression.value ?? ""} onChange={expression.setValue} className="ts-field-direct" /> : <span className="ts-field-locked ts-mono">{expression.value || "없음"}</span>}
        </div>
      </div>
      <ResultTypeFields enums={enums} inferred={inferred} />
      <Field name="description" label="주석" />
      <EditInspectionResult code={def.code} level={def.level} enums={enums} inspection={inspection} onClear={onClear} />
    </div>
  );
  if (!editing) return fields;
  return (
    <div className="ts-l2-split">
      {fields}
      <aside className="ts-l2-side">
        <InsertPanel data={panel} level={def.level} selfCode={def.code} onInsert={insert} onInsertRef={(item) => insertReference(item, def.level)} />
      </aside>
    </div>
  );
}

/** 편집 모드에서만 보인다. 읽기 모드로 돌아가면(저장 · 취소) 결과를 지운다 — 다음 편집은 새 검사로 시작한다. */
function EditInspectionResult({ code, level, enums, inspection, onClear }: { code: Code; level: AttachLevel; enums: readonly EnumDef[]; inspection: InspectionState | undefined; onClear: () => void }) {
  const input = useInspectInput(code, level);
  const { mode } = useEditField("expression");
  useEffect(() => {
    if (mode === "read") onClear();
  }, [mode, onClear]);
  if (mode === "read") return null;
  return <InspectionResult inspection={inspection} input={input} enums={enums} />;
}

/**
 * 결과 타입 세 필드 — 종류 · (목록값일 때만) 복수 · 열거형변수.
 * 읽기 모드는 종류 한 줄에 합쳐 보이고(`목록값(복수) · 해약환급금유형`), 복수·열거형변수 줄은 숨긴다.
 */
function ResultTypeFields({ enums, inferred }: { enums: readonly EnumDef[]; inferred: ExprType | undefined }) {
  const kind = useEditField<string>("resultTypeKind");
  const multi = useEditField<boolean>("resultTypeMulti");
  const enumCode = useEditField<string>("resultTypeEnum");
  const enumLabel = (code: string) => enums.find((e) => e.code === code)?.label;
  const readValue = () => {
    const explicit = resultTypeFromForm(kind.value, multi.value, enumCode.value);
    return explicit ? resultTypeLabel(explicit, enumLabel) : `미지정 (추론: ${inferredLabel(inferred, enumLabel)})`;
  };
  const enumOptions = [{ value: "", label: "선택" }, ...enums.map((e) => ({ value: e.code, label: e.label }))];
  return (
    <>
      <Field name="resultTypeKind" label={FIELD_LABEL.resultType} type="select" options={RESULT_TYPE_OPTIONS} readValue={readValue} info={RESULT_TYPE_HINT} />
      {kind.mode === "edit" && kind.value === "enum" ? (
        <>
          <Field name="resultTypeMulti" label="복수" type="toggle" toggle={{ label: "복수", hintOn: `여러 값을 한꺼번에 담는다 (${TYPE_LABEL["list<enum>"]}).`, hintOff: `값 하나를 담는다 (${TYPE_LABEL.enum}).` }} />
          <Field name="resultTypeEnum" label={ENTITY_LABEL.enum} type="select" options={enumOptions} />
        </>
      ) : null}
    </>
  );
}

export function CatalogEditor({
  def,
  enums,
  inferred,
  warnings,
  panel,
  usage,
  usageCount,
}: {
  def: Discriminator;
  /** 결과 타입이 목록값일 때 고를 열거형변수 · 읽기 표시명. */
  enums: readonly EnumDef[];
  /** 서버가 식에서 추론한 타입 — 식 오류면 undefined (미지정일 때 괄호 안에 보인다). */
  inferred: ExprType | undefined;
  /** 저장된 정의에 남은 경고 (별칭 · 깨진 사용처) — 읽기 모드 제목 옆 배지 (기능/구분자 §3.3). 저장하지 않고 읽을 때 계산한다. */
  warnings: readonly Issue[];
  /** 넣기 패널 재료 — 마스터 필드 트리 · 구분자 목록 (서버가 직렬화). */
  panel: InsertPanelData;
  usage: React.ReactNode;
  /** 문면 사용처 총수 — 직접 + 참조하는 구분자를 거친 것 (ADR-0049 §2). */
  usageCount: number;
}) {
  const [inspection, setInspection] = useState<InspectionState>();
  const clearInspection = useCallback(() => setInspection(undefined), []);
  const badges = warningBadges(warnings);
  const form = resultTypeToForm(def.resultType);
  const data: CatalogEditData = {
    label: def.label,
    description: def.description,
    expression: def.expression,
    resultTypeKind: form.kind,
    resultTypeMulti: form.multi,
    resultTypeEnum: form.enumCode,
  };
  return (
    <EditShell
      initial={data}
      title={def.label}
      extraActions={<UsageDialog count={usageCount}>{usage}</UsageDialog>}
      editActions={<EditInspectButton code={def.code} level={def.level} onResult={setInspection} />}
      readBadges={badges.map((b) => <span key={b.label} className="ts-badge warning" title={b.title}>{b.label}</span>)}
      path={[basicsCrumb("discriminators")]}
      saveAction={saveDiscriminatorEditAction.bind(null, def.code)}
      deleteAction={removeDiscriminatorEditAction.bind(null, def.code)}
      deleteLabel={`${def.label} 삭제`}
      deleteTooltip={`구분자 ${def.label}(${def.code}) 삭제 — 이 구분자에 닿는 조문 ${usageCount}곳(참조하는 구분자를 거친 것 포함)이 영향받는다`}
      deleteSuccessHref="/catalog"
    >
      <EditorBody def={def} enums={enums} inferred={inferred} panel={panel} inspection={inspection} onClear={clearInspection} />
    </EditShell>
  );
}
