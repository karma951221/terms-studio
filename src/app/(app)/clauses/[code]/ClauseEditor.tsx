"use client";

/**
 * 공용조항 상세 (L2) — 보러 오는 것은 **이름 · 기재내용 · 옵션** 셋뿐이다.
 *
 * 그래서 화면을 둘로만 가른다 — 왼쪽이 본문, 오른쪽이 옵션. 사용처 · 재검사는 관계정보(`/relations?kind=clause&code=…`)가 맡는다.
 *
 * 읽기 모드의 본문은 **문서 세계(명조)로 읽힌다** (§1.1 · 리뷰 #65). 편집 모드에서만 노드 트리가
 * 드러난다 — 원시 JSON 은 1급 표면이 아니라 구조 편집기(ADR-0012)가 붙기 전까지의 통로다.
 */
import { useRef, useState, type ReactNode } from "react";

import { EditShell, Field, useEditField } from "@/app/_components/EditShell";
import { IconButton, IconChevron, IconClose, IconPlus } from "@/app/_components/icons";
import { RadioGroup } from "@/app/_components/RadioGroup";
import { ENTITY_LABEL, MODE_OPTIONS, NAME_LABEL } from "@/app/_lib/labels";
import type { Clause, ClauseBody } from "@/domain/clause";

import { BodyEditor } from "./BodyEditor";
import { removeClauseEditAction, saveClauseEditAction } from "../edit-actions";
import type { ClauseEditData, ClauseEditOption } from "../edit-types";

function initialData(clause: Clause): ClauseEditData {
  return {
    label: clause.label,
    body: clause.body,
    options: clause.options.map((option) => ({
      code: option.code,
      label: option.label,
      values: option.values.map((value) => ({ code: value.code, label: value.label })),
    })),
  };
}

/**
 * 기본 정보 — 접으면 이름만 남는다.
 *
 * 코드도 유형도 등록 뒤에는 안 바뀐다. 늘 펼쳐 두면 정작 보러 온 기재내용과 옵션을 아래로 민다.
 * 그래서 접힌 것이 기본이고, 접힌 줄에는 **가장 자주 쓰는 값 하나(이름)** 만 남긴다.
 * 이름을 고치는 중이면 접히지 않는다 — 고치던 칸이 사라지면 안 된다.
 */
function BasicsPane({ clause }: { clause: Clause }) {
  const label = useEditField<string>("label");
  const [open, setOpen] = useState(false);
  const editing = label.mode === "edit";
  const shown = open || editing;

  return (
    <section className="ts-basics">
      <button type="button" className="ts-basics-head" onClick={() => setOpen(!open)} aria-expanded={shown}>
        <IconChevron className={shown ? "is-open" : ""} />
        <span className="ts-basics-name">{label.value}</span>
        {shown ? null : <span className="ts-muted ts-mono">{clause.code}</span>}
      </button>
      {shown ? (
        <div className="ts-basics-body">
          {/* 코드와 유형은 등록 뒤 안 바뀐다 — 값은 보이되 고치는 자리로는 서지 않는다 (§1.2). */}
          <div className="ts-form-row">
            <label>코드</label>
            <div className="ts-form-control">
              <span className="ts-field-locked ts-mono">{clause.code}</span>
            </div>
          </div>
          <Field name="label" label={NAME_LABEL.clause} />
          <div className="ts-form-row">
            <label>유형</label>
            <div className="ts-form-control">
              <RadioGroup name="mode" label="유형" options={MODE_OPTIONS} value={clause.mode} disabled />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 이름 하나를 받아 더하는 칸 — Enter 로도, 버튼으로도 더한다.
 *
 * Enter 만 두면 한글에서 첫 타건이 사라진다. 조합 중의 Enter 는 조합을 확정하는 키라
 * 제출로 쓸 수 없고(`isComposing`), 그래서 사용자는 Enter 를 두 번 눌러야 한다.
 * 눈에 보이는 버튼을 함께 두면 그 규칙을 몰라도 더할 수 있다.
 */
function AddInput({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (label: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    const input = ref.current;
    const text = input?.value.trim();
    if (!input || !text) return;
    onAdd(text);
    input.value = "";
    input.focus();
  };
  return (
    <span className="ts-add-input">
      <input
        ref={ref}
        placeholder={placeholder}
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          commit();
        }}
      />
      <IconButton icon={<IconPlus />} label={label} onClick={commit} />
    </span>
  );
}

/** 왼쪽 단 — 읽을 때는 조판된 문면, 고칠 때는 구조 에디터. */
function BodyPane({ rendered }: { rendered: ReactNode }) {
  const field = useEditField<ClauseBody>("body");
  const options = useEditField<ClauseEditOption[]>("options");
  return (
    <section className="ts-clause-body">
      <h2 className="ts-section-title">기재내용</h2>
      {field.mode === "read" ? (
        rendered
      ) : (
        <BodyEditor
          body={field.value}
          options={options.value.map((option) => ({ code: option.code, label: option.label, valueCount: option.values.length }))}
          onChange={field.setValue}
        />
      )}
    </section>
  );
}

/** 오른쪽 단 — 옵션과 그 선택지. 사용처가 문면에서 고르는 것이 이것이다. */
function OptionsPane() {
  const field = useEditField<ClauseEditOption[]>("options");
  const next = useRef(1);
  const options = field.value;
  const valueCount = options.reduce((n, option) => n + option.values.length, 0);

  const setOptions = (update: ClauseEditOption[]) => field.setValue(update);
  const patch = (code: string, change: Partial<ClauseEditOption>) =>
    setOptions(options.map((option) => (option.code === code ? { ...option, ...change } : option)));

  return (
    <section className="ts-clause-options">
      <h2 className="ts-section-title">
        옵션 <span className="ts-count"><b>{options.length}</b> · 선택지 {valueCount}</span>
      </h2>

      {options.length === 0 ? (
        <p className="ts-muted">옵션 없음 — 사용처가 고를 것이 없다.</p>
      ) : (
        options.map((option) => (
          <div key={option.code} className="ts-option">
            <div className="ts-option-head">
              {field.mode === "read" ? (
                <span className="ts-option-name">{option.label}</span>
              ) : (
                <>
                  <input
                    className="ts-field-direct"
                    value={option.label}
                    onChange={(event) => patch(option.code, { label: event.target.value })}
                    aria-label="옵션명"
                  />
                  <IconButton
                    icon={<IconClose />}
                    label={`${option.label || "이름 없는 옵션"} 빼기`}
                    onClick={() => setOptions(options.filter((item) => item.code !== option.code))}
                  />
                </>
              )}
            </div>
            <ul className="ts-option-values">
              {option.values.map((value) => (
                <li key={value.code}>
                  {field.mode === "read" ? (
                    <span>{value.label}</span>
                  ) : (
                    <>
                      <input
                        className="ts-field-direct"
                        value={value.label}
                        onChange={(event) =>
                          patch(option.code, {
                            values: option.values.map((item) => (item.code === value.code ? { ...item, label: event.target.value } : item)),
                          })
                        }
                        aria-label="선택지"
                      />
                      <IconButton
                        icon={<IconClose />}
                        label={`${value.label || "이름 없는 선택지"} 빼기`}
                        onClick={() => patch(option.code, { values: option.values.filter((item) => item.code !== value.code) })}
                      />
                    </>
                  )}
                </li>
              ))}
              {field.mode === "edit" ? (
                <li>
                  <AddInput
                    label={`${option.label} 선택지 추가`}
                    placeholder="선택지 추가"
                    onAdd={(label) => patch(option.code, { values: [...option.values, { code: `new:${next.current++}`, label }] })}
                  />
                </li>
              ) : null}
            </ul>
          </div>
        ))
      )}

      {field.mode === "edit" ? (
        <div className="ts-add-row">
          <AddInput
            label="옵션 추가"
            placeholder="옵션 추가"
            onAdd={(label) => setOptions([...options, { code: `new:${next.current++}`, label, values: [] }])}
          />
        </div>
      ) : null}
    </section>
  );
}

export function ClauseEditor({
  clause,
  rendered,
}: {
  clause: Clause;
  /** 조판된 본문 — 서버에서 그려 넘긴다 (문서 세계는 앱 스킨을 입지 않는다). */
  rendered: ReactNode;
}) {
  return (
    <EditShell
      initial={initialData(clause)}
      title={clause.label}
      path={[{ label: ENTITY_LABEL.clause, href: "/clauses" }]}
      saveAction={saveClauseEditAction.bind(null, clause.code)}
      deleteAction={removeClauseEditAction.bind(null, clause.code)}
      deleteLabel={`${clause.label} 삭제`}
      deleteTooltip={`공용조항 ${clause.label}(${clause.code}) 삭제`}
      deleteSuccessHref="/clauses"
    >
      <BasicsPane clause={clause} />
      <div className="ts-clause-split">
        <BodyPane rendered={rendered} />
        <OptionsPane />
      </div>
    </EditShell>
  );
}
