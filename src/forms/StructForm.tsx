"use client";

/**
 * StructForm — 폼 모델(FormModel)을 받아 6 타입을 타입별 입력 컴포넌트 매핑 하나로 그린다.
 * 폼별 코드가 없다 (인수기준 「폼 렌더러 (P1)」).
 *
 * 화면 규칙 —
 * - **2열 그리드**: 라벨은 좌측 120px 고정 열, 값은 우측 (디자인원칙 §2 L2). 라벨을 값 위에 두지 않는다.
 * - **출처 문법 (§1.2)**: 직접값은 실선 테두리, 파생은 ƒ + 옅은 바탕 + 식, const 는 자물쇠 + 마스터 라벨,
 *   손댄 스냅샷은 입력칸 오른쪽 끝에 되돌리기 버튼 (마스터 값은 tooltip 으로만). 색은 쓰지 않는다.
 * - **프리필은 보이는 제안 (ADR-0004 · 리뷰 #3)**: 기본값이 처음부터 칸에 들어가 있고 「미입력」 +
 *   「제안값 · 저장해야 확정」 배지가 함께 선다. 저장해야 명시 값이 된다. 폼마다 「비우기」 하나.
 *   읽기 모드(`readOnly`)에는 「미입력」 배지를 달지 않는다 — 빈 칸은 빈 칸으로 보인다 (2026-09-27).
 * - **폼 하나가 카드 하나 (기능/마스터 §3.5)**: 카드 목록 = 마스터의 폼 목록. 카드 제목은 폼 표시명뿐 — 설명은 옆 ⓘ(InfoTip).
 *   `showCodes`(관리자)면 필드 라벨 옆 작은 ⓘ 링크가 tooltip 으로 `폼키.필드키` 를 보이고 마스터 화면으로 이어진다.
 *   `highlightPath` 면 그 행을 강조하고 스크롤한다.
 * - **선택 폼(감액 · 면책, `optional`)은 더하기 전엔 자리가 없다 (ADR-0065 §4 · 2026-09-27)**: 닫힌 선택 폼은 읽기 모드에서
 *   아무것도 그리지 않고, 편집 모드에서는 폼 맨 아래 한 줄 「⊕ 감액 · ⊕ 면책」 으로만 선다. 연 폼은 제목 옆 ⊖ 로 닫는다(값을 지운다).
 *
 * 상호작용 로직은 전부 `formReducer`(순수)에 있다. 여기는 이벤트 → 액션 변환과 마크업뿐.
 */
import { useEffect, useId, useReducer, useRef, useState, type FormEvent, type ReactNode } from "react";

import { InfoTip } from "@/app/_components/InfoTip";
import { IconButton, IconInfo, IconMinusCircle, IconPlusCircle, IconRevert } from "@/app/_components/icons";
import { EXEMPTION_MONTHS } from "@/domain/coverage";
import { formatPeriod } from "@/domain/master";
import type { Issue } from "@/domain/types";

import type { InputProps } from "./inputTypes";
import {
  formatValue,
  formReducer,
  initFormState,
  isFieldHidden,
  toSubmission,
  type Draft,
  type FieldState,
  type FieldView,
  type FormModel,
  type FormState,
  type Submission,
} from "./model";
import { TableInput } from "./TableInput";

export type { InputProps } from "./inputTypes";

export interface StructFormProps {
  model: FormModel;
  /** 제출 — issues 가 없을 때만 불린다. `embedded` 면 안 쓴다. */
  onSubmit?: (submission: Submission) => void | Promise<void>;
  /**
   * 바깥 편집 흐름(EditShell)에 얹혀 쓰는 모드 — 자기 저장 버튼을 내리고 초안을 `onChange` 로 올려보낸다.
   * 「저장 하나가 화면의 변경을 다 담는다」(디자인원칙 §2 L2)를 값 폼에도 적용하기 위한 자리.
   */
  embedded?: boolean;
  /**
   * `embedded` 일 때 초안이 바뀔 때마다. 바깥이 모아서 한 번에 저장한다.
   * 둘째 인자는 편집 상태 그대로 — 바깥이 보관했다가 `initialState` 로 되돌려주면 인스턴스가 새로 떠도 초안이 남는다.
   */
  onChange?: (submission: Submission, state: FormState) => void;
  /**
   * 이 인스턴스가 처음 뜰 때의 편집 상태 — 인스턴스를 새로 띄우면서 보관한 초안을 복원하는 자리 (점검 H4 때 담보 값 탭이 썼다 · 지금은 테스트가 초안 상태를 주입하는 데 쓴다).
   * 초안이 만들어진 뒤 저장값이 바뀌었으면(모델 지문이 다르면) 버리고 새 저장값에서 시작한다. 이후 바뀌어도 다시 읽지 않는다.
   */
  initialState?: FormState;
  /** `embedded` 읽기 모드 — 입력칸을 잠근다. */
  readOnly?: boolean;
  /** 제출 버튼 문구. 기본 「저장」. */
  submitLabel?: string;
  /** 서버 액션 진행 중 등 — 제출 버튼 비활성. */
  pending?: boolean;
  /** 폼 바깥에서 온 오류(서버 거부 등)를 필드 아래·폼 아래에 함께 보여준다. */
  issues?: Issue[];
  /** 관리자 — 필드 라벨 옆에 작은 ⓘ 링크. tooltip 이 `폼키.필드키` 이고 마스터 화면의 그 필드로 이어진다. */
  showCodes?: boolean;
  /** 이 경로의 행을 강조하고 마운트 시 화면 가운데로 스크롤한다 (마스터 → 사용처에서 건너왔을 때). */
  highlightPath?: string;
}

// ───────────────────────────── 타입별 입력 ─────────────────────────────

function textDraft(field: FieldState): string {
  return Array.isArray(field.draft) ? field.draft.join(",") : field.draft;
}

function StringInput({ id, field, onEdit, className, name }: InputProps) {
  return (
    <input
      id={id}
      type="text"
      className={className}
      aria-labelledby={`${id}-label`}
      name={name ?? field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function NumberInput({ id, field, onEdit, className, name }: InputProps) {
  return (
    <input
      id={id}
      type="number"
      step="any"
      className={className}
      aria-labelledby={`${id}-label`}
      name={name ?? field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function DateInput({ id, field, onEdit, className, name }: InputProps) {
  return (
    <input
      id={id}
      type="date"
      className={className}
      aria-labelledby={`${id}-label`}
      name={name ?? field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    />
  );
}

function BooleanInput({ id, field, onEdit, name }: InputProps) {
  const draft = textDraft(field);
  return (
    <span className="ts-form-radios" role="radiogroup" aria-labelledby={`${id}-label`}>
      {(["true", "false"] as const).map((v) => (
        <label key={v} className="ts-form-radio">
          <input
            type="radio"
            name={name ?? field.view.path}
            value={v}
            checked={draft === v}
            onChange={() => onEdit(v)}
          />
          {v === "true" ? "예" : "아니오"}
        </label>
      ))}
    </span>
  );
}

function EnumInput({ id, field, onEdit, className, name }: InputProps) {
  return (
    <select
      id={id}
      className={className}
      aria-labelledby={`${id}-label`}
      name={name ?? field.view.path}
      value={textDraft(field)}
      onChange={(e) => onEdit(e.target.value)}
    >
      <option value="">— 선택 —</option>
      {(field.view.enumOptions ?? []).map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function ListEnumInput({ id, field, onEdit, name }: InputProps) {
  // list<enum> 전용 입력이라 draft 는 항상 코드 배열이다 (table 의 TableDraft 와는 INPUT_BY_KIND 매핑이 갈라 준다).
  const selected = (Array.isArray(field.draft) ? field.draft : []) as string[];
  const toggle = (code: string, on: boolean) => {
    // 선택지 순서를 유지한 채 켜고 끈다
    const order = (field.view.enumOptions ?? []).map((o) => o.code);
    const next = new Set(selected);
    if (on) next.add(code);
    else next.delete(code);
    onEdit(order.filter((c) => next.has(c)));
  };
  return (
    <span className="ts-form-checks" role="group" aria-labelledby={`${id}-label`}>
      {(field.view.enumOptions ?? []).map((o) => (
        <label key={o.code} className="ts-form-check">
          <input
            type="checkbox"
            name={name ?? field.view.path}
            value={o.code}
            checked={selected.includes(o.code)}
            onChange={(e) => toggle(o.code, e.target.checked)}
          />
          {o.label}
        </label>
      ))}
    </span>
  );
}

/** 타입 → 입력 컴포넌트. 이 표 하나로 모든 폼이 그려진다. */
const INPUT_BY_KIND: Record<FieldState["view"]["type"]["kind"], (p: InputProps) => ReactNode> = {
  string: StringInput,
  number: NumberInput,
  boolean: BooleanInput,
  date: DateInput,
  enum: EnumInput,
  "list<enum>": ListEnumInput,
  table: TableInput,
};

/**
 * 필드 하나의 입력 부품 — 타입별 매핑을 폼 바깥(표의 셀 등)에서도 같은 모양으로 쓰기 위한 출구.
 * 상태 전이는 여전히 `formReducer` 가 한다; 여기는 `FieldState` → 입력 마크업뿐이다.
 */
export function FieldInput(props: InputProps) {
  const Input = INPUT_BY_KIND[props.field.view.type.kind];
  return <Input {...props} />;
}

// ───────────────────────────── 출처 표시 (§1.2) ─────────────────────────────

/** 읽기 전용 값 표시 문자열 — 표시명으로 (ADR-0005). */
function displayOf(view: FieldView, value: FieldView["value"]): string {
  return formatValue({ ...view, state: "entered", value }) ?? "";
}

// ───────────────────────────── 필드 행 ─────────────────────────────

interface FieldRowProps {
  idBase: string;
  field: FieldState;
  externalIssues: Issue[];
  onEdit: (draft: Draft) => void;
  onRevert: () => void;
  /** 라벨 옆 코드 ⓘ 링크. */
  showCode?: boolean;
  /** 읽기 모드 — 입력칸을 잠그고(inert) 「미입력」 배지를 달지 않는다. */
  readOnly?: boolean;
  /** 강조 행 — 클래스 + 마운트 시 스크롤. */
  highlighted?: boolean;
}

function FieldRow({ idBase, field, externalIssues, onEdit, onRevert, showCode, readOnly, highlighted }: FieldRowProps) {
  const { view } = field;
  const [askRevert, setAskRevert] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  // 강조 행은 화면 가운데로 — 마스터 사용처에서 건너온 사람이 그 자리를 바로 본다
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView?.({ block: "center" });
  }, [highlighted]);
  const id = `${idBase}-${view.path.replace(".", "-")}`;
  const Input = INPUT_BY_KIND[view.type.kind];
  const notEntered = view.state !== "entered";
  const masterText = displayOf(view, view.masterValue);
  const revertTip = `마스터 값으로 되돌리기 · 마스터: ${view.masterLabel ?? ""} = ${masterText}`;
  // 면책 기간(개월) 입력 — 숫자 옆에 「n년 n개월」 해석을 곁들인다 (ADR-0065 §1).
  const monthsHint = view.path === EXEMPTION_MONTHS && typeof field.value === "number" ? formatPeriod(field.value) : undefined;

  const control =
    view.source === "snapshot" ? (
      <span className="ts-field-snapshot">
        <Input id={id} field={field} onEdit={onEdit} className="ts-field-direct" />
        <IconButton
          className="ts-revert"
          label={revertTip}
          icon={<IconRevert />}
          onClick={() => setAskRevert(true)}
        />
      </span>
    ) : (
      <Input id={id} field={field} onEdit={onEdit} className="ts-field-direct" />
    );

  const rowClass = `ts-form-row${field.entered ? "" : " is-not-entered"}${highlighted ? " ts-field-highlight" : ""}`;

  return (
    <div ref={rowRef} className={rowClass} data-path={view.path} data-source={view.source}>
      <span className="ts-form-label-cell">
        <label id={`${id}-label`} htmlFor={id} className="ts-form-label">
          {view.label}
        </label>
        {showCode && (
          // 코드 링크는 라벨의 형제다 — 입력의 접근성 이름에 코드가 섞이지 않게. 코드는 tooltip 으로만 (라벨이 두 번 보이지 않게)
          <a className="ts-field-code" href={`/master/${view.path}`} title={view.path} aria-label={view.path}>
            <IconInfo />
          </a>
        )}
      </span>
      {/* 읽기 모드는 입력만 잠근다 — 라벨 옆 ⓘ 의 tooltip · 링크는 살아 있어야 한다 */}
      <div className="ts-form-control" inert={readOnly}>
        {control}
        {monthsHint && <span className="ts-muted">{monthsHint}</span>}
        {notEntered && !readOnly && <span className="ts-badge missing">미입력</span>}
        {field.proposed && <span className="ts-badge proposed">제안값 · 저장해야 확정</span>}
        {field.error !== undefined && (
          <span className="ts-form-error" role="alert">
            {field.error}
          </span>
        )}
        {externalIssues.map((issue, i) => (
          <span key={i} className="ts-form-error" role="alert">
            {issue.message}
          </span>
        ))}
      </div>
      {askRevert && (
        // 되돌리기는 사람이 쓴 값을 지운다 → 확인을 거친다 (§1.2 · §1.5). 버튼은 텍스트다 (§1.6 예외 ②)
        <div className="ts-form-full">
          <section className="ts-confirm">
            <p className="ts-confirm-title">{view.label} 을(를) 마스터 값으로 되돌린다</p>
            <ul className="ts-confirm-loss">
              <li>지금 칸에 있는 「{textDraft(field) === "" ? "빈 값" : displayOf(view, field.value)}」 이(가) 사라진다</li>
              <li>
                마스터 {view.masterLabel} 의 값 「{masterText}」 이(가) 들어온다 — 저장해야 확정된다
              </li>
            </ul>
            <div className="ts-confirm-actions">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onRevert();
                  setAskRevert(false);
                }}
              >
                마스터 값으로 되돌리기
              </button>
              <button type="button" onClick={() => setAskRevert(false)}>
                취소
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── 폼 ─────────────────────────────

/** 저장소 기준 값 상태의 지문 — 서버가 새 모델을 내려보내면(저장 직후) 편집 상태를 그것에 맞춘다. */
function savedSignature(model: FormModel): string {
  return JSON.stringify(model.fields.map((f) => [f.path, f.state, f.value ?? null]));
}

export function StructForm({
  model,
  onSubmit,
  submitLabel = "저장",
  pending,
  issues = [],
  embedded,
  onChange,
  readOnly,
  showCodes,
  highlightPath,
  initialState,
}: StructFormProps) {
  const [state, dispatch] = useReducer(formReducer, initialState, (restored) => restored ?? initFormState(model));
  const [submitIssues, setSubmitIssues] = useState<Issue[]>([]);
  // 복원한 초안은 그것을 만든 모델의 지문으로 시작한다 — 지금 모델과 다르면 아래에서 바로 새 저장값으로 다시 세운다.
  const [signature, setSignature] = useState(() => savedSignature(initialState?.model ?? model));
  const idBase = useId();

  // 저장이 끝나 서버 값이 바뀌면 초안을 새 진실로 다시 세운다 (배지·카운트가 옛 상태로 남지 않게).
  // 렌더 중 상태 조정 — React 의 「props 가 바뀌면 상태를 맞추기」 패턴.
  const nextSignature = savedSignature(model);
  if (signature !== nextSignature) {
    setSignature(nextSignature);
    dispatch({ type: "reset", model });
  }
  const live = state;

  // embedded: 초안이 바뀔 때마다 바깥(EditShell)으로 올린다. 저장은 바깥이 한 번에 한다.
  // 읽기 모드에서는 올리지 않는다 — 안 고쳤는데 「변경됨」으로 잡히면 안 된다.
  useEffect(() => {
    if (embedded && onChange && !readOnly) onChange(toSubmission(live), live);
    // onChange 는 매 렌더 새 함수일 수 있어 의존성에서 뺀다 — 초안(live)이 바뀔 때만 올린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, live]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submission = toSubmission(live);
    if (submission.issues.length > 0) {
      setSubmitIssues(submission.issues);
      return;
    }
    setSubmitIssues([]);
    void onSubmit?.(submission);
  };

  const allIssues = [...submitIssues, ...issues];
  const issuesAt = (path: string) => allIssues.filter((i) => i.at.refPath === path);
  const unplaced = allIssues.filter((i) => !i.at.refPath || !live.fields[i.at.refPath]);
  // 선택 폼은 열렸을 때만 카드로 선다 — 닫힌 것은 편집 모드에서 폼 아래 「⊕ {폼}」 한 줄로만.
  const shownCards = model.cards.filter((card) => !card.optional || live.open[card.key]);
  const closedCards = model.cards.filter((card) => card.optional && !live.open[card.key]);

  return (
    <form className={readOnly ? "ts-form ts-form-read" : "ts-form"} data-level={model.level} onSubmit={handleSubmit}>
      <h2 className="ts-form-title">{model.label}</h2>
      {model.cards.length === 0 && <p className="ts-form-empty">입력할 값 자리가 없습니다.</p>}
      {shownCards.map((card) => (
        // 폼 하나 = 카드 하나 (기능/마스터 §3.5). fieldset 의 aria-label 이 카드의 접근성 이름이다
        <fieldset key={card.key} className="ts-form-card" aria-label={card.label}>
          <legend className="ts-form-card-title">
            {card.label}
            {card.description && <InfoTip text={card.description} />}
            {card.optional && !readOnly && (
              // 연 선택 폼 — ⊖ 는 그 자리를 지운다(값도). 다시 더하려면 폼 아래 「⊕ {폼}」 (ADR-0065 §4)
              <IconButton
                className="ts-form-card-remove"
                danger
                icon={<IconMinusCircle />}
                label={`${card.label} 없음으로 — 값을 지운다`}
                onClick={() => dispatch({ type: "closeForm", form: card.key })}
              />
            )}
          </legend>
          {card.fields.map((view) =>
            // 기본 숨김 — 기본값 그대로면 칸 대신 작은 링크 하나. 읽기 모드는 아무것도 안 보인다.
            // 오류가 걸렸거나 강조로 건너온 자리는 숨기지 않는다 (기능/담보 §3.4).
            isFieldHidden(live, view.path) && issuesAt(view.path).length === 0 && highlightPath !== view.path ? (
              !readOnly && (
                <p key={view.path} className="ts-form-reveal-row" data-path={view.path}>
                  <button type="button" className="ts-linklike ts-form-reveal" onClick={() => dispatch({ type: "reveal", path: view.path })}>
                    {view.label} 바꾸기
                  </button>
                </p>
              )
            ) : (
              <FieldRow
                key={view.path}
                idBase={idBase}
                field={live.fields[view.path]}
                externalIssues={issuesAt(view.path)}
                onEdit={(draft) => dispatch({ type: "edit", path: view.path, draft })}
                onRevert={() => dispatch({ type: "revertToMaster", path: view.path })}
                showCode={showCodes}
                readOnly={readOnly}
                highlighted={highlightPath === view.path}
              />
            ),
          )}
        </fieldset>
      ))}
      {!readOnly && closedCards.length > 0 && (
        // 닫힌 선택 폼 — 자리 대신 폼 맨 아래 한 줄의 작은 더하기 버튼 (ADR-0065 §4)
        <p className="ts-form-optional-add">
          {closedCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className="ts-form-optional-btn"
              title={`${card.label} 추가`}
              onClick={() => dispatch({ type: "openForm", form: card.key })}
            >
              <IconPlusCircle /> {card.label}
            </button>
          ))}
        </p>
      )}
      {unplaced.length > 0 && (
        <ul className="ts-form-issues" role="alert">
          {unplaced.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
      {model.fields.length > 0 && !embedded && (
        <div className="ts-form-actions">
          <button type="submit" className="primary" disabled={pending}>
            {submitLabel}
          </button>
          <button
            type="button"
            className="ts-form-clear"
            onClick={() => dispatch({ type: "clearAll" })}
            title={`${model.label} 의 입력칸을 모두 비운다 (제안값도 걷어낸다)`}
            disabled={pending}
          >
            비우기
          </button>
        </div>
      )}
    </form>
  );
}
