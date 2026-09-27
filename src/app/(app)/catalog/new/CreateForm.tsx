"use client";

/**
 * 새 구분자 — 폼 하나.
 *
 * 2026-09-12 — 구분자가 식 하나가 되면서 유형 선택·타입 선택·노출·상수값 칸이 사라졌다 (ADR-0037).
 * 남는 칸은 구분자명 · 레벨 · 식 · 주석 넷이다.
 * 2026-09-17 — 선택인 「결과 타입」 칸이 붙었다 (기능/구분자 §3.1). 미지정이면 식에서 추론한 타입을 쓴다.
 *   입력 모양은 마스터 필드 타입과 같다 — 종류 셀렉트 + 목록값일 때만 복수 토글 · 열거형변수 셀렉트.
 *
 * 2026-09-17 — 헤더에 「검사」 (저장 전 검사 · 오류/경고 두 등급, 기능/구분자 §3.3). 결과는 폼 아래 「검사 결과」 블록.
 * 2026-09-17 — 오른쪽에 넣기 패널(마스터 필드 · 구분자 · 연산) 상시, 식 입력은 커서 자리 삽입 (기능/구분자 §4.3).
 *
 * 제출 버튼은 헤더 우측에 산다 (화면 하단에 조작을 두지 않는다 — §2 L2).
 */
import { useState, type ReactNode } from "react";

import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { NoteField } from "@/app/_components/NoteField";
import { RadioGroup } from "@/app/_components/RadioGroup";
import { Toggle } from "@/app/_components/Toggle";
import { ENTITY_LABEL, FIELD_LABEL, LEVEL_OPTIONS, NAME_LABEL, newLabel, TYPE_LABEL } from "@/app/_lib/labels";
import { DISCRIMINATORS_MENU, menuCrumb } from "@/app/_lib/menu";
import type { EnumDef } from "@/domain/catalog/types";
import type { AttachLevel } from "@/domain/types";

import { ExpressionInput, useExpressionInsert } from "../_components/ExpressionField";
import { InsertPanel } from "../_components/InsertPanel";
import { InspectButton, InspectionResult, type InspectionState } from "../_components/InspectionPanel";
import { inspectInputFrom, RESULT_TYPE_HINT, RESULT_TYPE_OPTIONS, type InsertPanelData } from "../lib";

const FORM_ID = "create-discriminator";

export function CreateForm({
  action,
  banner,
  initialLevel,
  enums,
  panel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** 오류 배너 등 헤더 바로 아래에 들어갈 것. */
  banner?: ReactNode;
  initialLevel: AttachLevel;
  /** 결과 타입이 목록값일 때 고를 열거형변수. */
  enums: readonly EnumDef[];
  /** 넣기 패널 재료 — 마스터 필드 트리 · 구분자 목록 (서버가 직렬화). */
  panel: InsertPanelData;
}) {
  const [level, setLevel] = useState<AttachLevel>(initialLevel);
  // 식 · 결과 타입은 제어형 — 「검사」가 지금 값을 읽어야 한다 (제출은 여전히 name 으로 formData 에 실린다).
  const [expression, setExpression] = useState("");
  const [resultTypeKind, setResultTypeKind] = useState("");
  const [resultTypeMulti, setResultTypeMulti] = useState(false);
  const [resultTypeEnum, setResultTypeEnum] = useState("");
  const [inspection, setInspection] = useState<InspectionState>();
  const { ref: expressionRef, insert, insertReference } = useExpressionInsert(expression, setExpression);
  // 생성은 아직 코드가 없다 — 자기 참조 · 순환 · 사용처 판정은 수정에서만 (기능/구분자 §3.3)
  const inspectInput = inspectInputFrom(undefined, level, { expression, resultTypeKind, resultTypeMulti, resultTypeEnum });

  return (
    <div>
      <CreateHead
        title={newLabel(ENTITY_LABEL.discriminator)}
        formId={FORM_ID}
        path={[menuCrumb(DISCRIMINATORS_MENU)]}
        banner={banner}
        actions={<InspectButton input={inspectInput} onResult={setInspection} />}
      />

      <div className="ts-l2-split">
        <div className="ts-l2-main">
          <form id={FORM_ID} action={action} className="ts-create-form">
            <FormRow label={NAME_LABEL.discriminator} htmlFor="new-label">
              <input id="new-label" type="text" name="label" required autoFocus />
            </FormRow>

            {/* 레벨은 채번 뒤 못 고친다 — 식의 참조 규칙이 레벨에 매여 있다 (ADR-0037). */}
            <FormRow label={FIELD_LABEL.level}>
              <RadioGroup name="level" label={FIELD_LABEL.level} options={LEVEL_OPTIONS} value={level} onChange={(value) => setLevel(value as AttachLevel)} />
              <p className="ts-form-hint">식이 평가되는 자리다. 채번 뒤에는 고칠 수 없다.</p>
            </FormRow>

            <FormRow label={FIELD_LABEL.expression} htmlFor="new-expr">
              <ExpressionInput inputRef={expressionRef} id="new-expr" name="expression" required placeholder="예: coverage_basic.claim_name · any(pay.exempt)" value={expression} onChange={setExpression} />
              <p className="ts-form-hint">입력 항목과 다른 구분자를 부른다 — 같은 레벨은 그대로, 하위 레벨은 집계 안에서.</p>
            </FormRow>

            {/* 결과 타입은 선택 — 고르면 저장 시 식의 추론 타입과 대조돼 거부될 수 있다 (기능/구분자 §3.1). */}
            <FormRow label={FIELD_LABEL.resultType} htmlFor="new-result-type">
              <select id="new-result-type" name="resultTypeKind" value={resultTypeKind} onChange={(event) => setResultTypeKind(event.target.value)}>
                {RESULT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {resultTypeKind === "enum" ? (
                <>
                  <Toggle
                    name="resultTypeMulti"
                    label="복수"
                    checked={resultTypeMulti}
                    onChange={setResultTypeMulti}
                    hintOn={`여러 값을 한꺼번에 담는다 (${TYPE_LABEL["list<enum>"]}).`}
                    hintOff={`값 하나를 담는다 (${TYPE_LABEL.enum}).`}
                  />
                  <select name="resultTypeEnum" value={resultTypeEnum} onChange={(event) => setResultTypeEnum(event.target.value)} aria-label={ENTITY_LABEL.enum}>
                    <option value="">선택</option>
                    {enums.map((e) => <option key={e.code} value={e.code}>{e.label}</option>)}
                  </select>
                </>
              ) : null}
              <p className="ts-form-hint">{RESULT_TYPE_HINT}</p>
            </FormRow>

            <NoteField id="new-note" name="description" />
          </form>
          <InspectionResult inspection={inspection} input={inspectInput} enums={enums} />
        </div>
        {/* 넣기 패널은 폼 밖 — 항목 버튼이 제출에 섞이지 않는다. 더블클릭이 식 입력의 커서 자리에 넣는다 */}
        <aside className="ts-l2-side">
          <InsertPanel data={panel} level={level} onInsert={insert} onInsertRef={(item) => insertReference(item, level)} />
        </aside>
      </div>
    </div>
  );
}
