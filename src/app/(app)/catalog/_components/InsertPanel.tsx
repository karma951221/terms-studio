"use client";

/**
 * 넣기 패널 — 생성 · 수정 화면 오른쪽에 **상시** (기능/구분자 §4.3).
 *
 * 탭 셋:
 * - 마스터 필드: 폼별 트리. 현재 레벨보다 **상위** 폼은 흐리게(부를 수 없다), 같은 레벨은 경로 그대로,
 *   **하위** 레벨은 타입에 맞는 집계로 감싸 넣는다 (참거짓 `any(경로)` · 숫자 `sum(경로)` · 그 밖 `exist(경로)`) —
 *   커서가 이미 집계 괄호 안이면 경로만 (`referenceToken` · `insideAggregate`).
 * - 구분자: 같은 · 하위 레벨만, 자기(`selfCode`) 제외. 하위는 같은 규칙으로 감싼다.
 * - 연산: 집계 · and/or/not · 비교. 집계는 괄호 안에 커서.
 * **더블클릭**(또는 Enter)으로 연산은 `onInsert(text, caret)`, 참조는 `onInsertRef(item)` — 커서 문맥(집계 안인지)은
 * 식 입력을 아는 쪽(`useExpressionInsert`)이 보므로 참조는 재료만 넘긴다.
 * 재료(`InsertPanelData`)는 서버가 만들어 넘긴다 — 클라이언트는 마스터 트리를 모른다.
 */
import { useState } from "react";

import { LEVEL_LABEL, TYPE_LABEL } from "@/app/_lib/labels";
import type { AttachLevel, Code } from "@/domain/types";
import { levelDepth } from "@/domain/master";

import { OPERATOR_TOKENS, referenceToken, type InsertPanelData, type PanelDiscriminator, type PanelField, type PanelForm, type PanelRef } from "../lib";

type Tab = "master" | "discriminator" | "operator";

const TABS: readonly { key: Tab; label: string }[] = [
  { key: "master", label: "마스터 필드" },
  { key: "discriminator", label: "구분자" },
  { key: "operator", label: "연산" },
];

const UPPER_TITLE = "상위 레벨은 참조할 수 없다";

/** 더블클릭 · Enter 로 넣는 참조 항목 한 줄. 부를 수 없는 항목(상위 레벨)은 disabled. title 의 토큰은 집계 밖 기준 미리보기다. */
function Item({ item, level, label, detail, onInsertRef }: { item: PanelRef; level: AttachLevel; label: string; detail?: string; onInsertRef: (item: PanelRef) => void }) {
  const preview = referenceToken(item.path, item.level, level, item.typeKind);
  const disabled = preview === undefined;
  return (
    <li>
      <button
        type="button"
        className="ts-insert-item"
        disabled={disabled}
        title={disabled ? UPPER_TITLE : `더블클릭으로 넣기: ${preview}`}
        onDoubleClick={() => !disabled && onInsertRef(item)}
        onKeyDown={(event) => { if (event.key === "Enter" && !disabled) { event.preventDefault(); onInsertRef(item); } }}
      >
        <span>{label}</span>
        {detail ? <span className="ts-insert-detail ts-mono">{detail}</span> : null}
      </button>
    </li>
  );
}

function MasterTab({ forms, level, onInsertRef }: { forms: readonly PanelForm[]; level: AttachLevel; onInsertRef: (item: PanelRef) => void }) {
  const here = levelDepth(level);
  return (
    <ul className="ts-insert-tree">
      {forms.map((form) => {
        const upper = levelDepth(form.level) < here;
        return (
          <li key={form.key} className={upper ? "ts-insert-upper" : undefined} title={upper ? UPPER_TITLE : undefined}>
            <p className="ts-insert-form">{LEVEL_LABEL[form.level]} · {form.label}</p>
            <ul className="ts-insert-list">
              {form.fields.map((field: PanelField) => (
                <Item key={field.path} item={{ path: field.path, level: form.level, typeKind: field.typeKind }} level={level} label={field.label} detail={`${field.path} · ${TYPE_LABEL[field.typeKind]}`} onInsertRef={onInsertRef} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function DiscriminatorTab({ discriminators, level, selfCode, onInsertRef }: { discriminators: readonly PanelDiscriminator[]; level: AttachLevel; selfCode?: Code; onInsertRef: (item: PanelRef) => void }) {
  const here = levelDepth(level);
  // 같은 · 하위 레벨만, 자기 제외 — 상위는 아예 부를 수 없고 자기 참조는 오류라 목록에서 뺀다
  const visible = discriminators.filter((d) => d.code !== selfCode && levelDepth(d.level) >= here);
  if (visible.length === 0) return <p className="ts-form-hint">이 레벨에서 부를 수 있는 구분자가 없다.</p>;
  return (
    <ul className="ts-insert-list">
      {visible.map((d) => (
        <Item key={d.code} item={{ path: d.code, level: d.level, ...(d.typeKind ? { typeKind: d.typeKind } : {}) }} level={level} label={`${d.label} (${d.code})`} detail={`${LEVEL_LABEL[d.level]}${d.typeKind ? ` · ${TYPE_LABEL[d.typeKind]}` : ""}`} onInsertRef={onInsertRef} />
      ))}
    </ul>
  );
}

function OperatorTab({ onInsert }: { onInsert: (text: string, caret?: number) => void }) {
  return (
    <ul className="ts-insert-list ts-insert-operators">
      {OPERATOR_TOKENS.map((op) => (
        <li key={op.label}>
          <button
            type="button"
            className="ts-insert-item"
            title={`${op.hint} — 더블클릭으로 넣기`}
            onDoubleClick={() => onInsert(op.text, op.caret)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onInsert(op.text, op.caret); } }}
          >
            <span className="ts-mono">{op.label}</span>
            <span className="ts-insert-detail">{op.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function InsertPanel({ data, level, selfCode, onInsert, onInsertRef }: { data: InsertPanelData; level: AttachLevel; selfCode?: Code; onInsert: (text: string, caret?: number) => void; onInsertRef: (item: PanelRef) => void }) {
  const [tab, setTab] = useState<Tab>("master");
  return (
    <div className="ts-insert-panel">
      <p className="ts-l2-side-title">넣기 <span className="ts-count">더블클릭으로 커서 자리에</span></p>
      <div className="ts-basic-tabs" role="tablist" aria-label="넣기">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" id={`insert-tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`insert-panel-${t.key}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`insert-panel-${tab}`} aria-labelledby={`insert-tab-${tab}`} className="ts-insert-body">
        {tab === "master" ? <MasterTab forms={data.forms} level={level} onInsertRef={onInsertRef} /> : null}
        {tab === "discriminator" ? <DiscriminatorTab discriminators={data.discriminators} level={level} selfCode={selfCode} onInsertRef={onInsertRef} /> : null}
        {tab === "operator" ? <OperatorTab onInsert={onInsert} /> : null}
      </div>
    </div>
  );
}
