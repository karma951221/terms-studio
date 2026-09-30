"use client";

/**
 * 인자 — 본문 옆 단, 옵션 목록 위 (최종 결정 2 · 기능/함수조항 §4.3).
 *
 * 인자 = 본문이 `arg.<이름>` 으로 읽는 입력 선언(이름 · 타입 · 기본 연결). 본문의 조건 · 슬롯 고르기 맨 앞 「인자」 묶음에 곧바로 선다.
 * 기본 연결은 넣는 자리에서 저절로 걸리는 연결이다 — 비우면 넣는 자리마다 연결해야 한다(연결 누락 = 문서 저장 오류).
 *
 * 모양 (2026-10-01 사용자 결정) — 맨 위에 고정된 **추가 줄**(이름 · 타입 · 기본 연결 · ⊕ 「인자 추가」, 이름 칸 Enter 도 더한다),
 * 그 아래 인자마다 **카드**(맨 앞 ⊖ 「인자 삭제 · {이름}」 · 이름 · 타입 · 기본 연결)가 선언 순서대로 쌓인다 — 많으면 카드 목록만 스크롤한다.
 * 더하기 전에 이름을 검사한다(비었음 · 겹침 · 예약어 · 모양 — 저장 검사 ① 문구). 빼기는 초안에서만 — 확인은 저장 검사가 한다(지금과 같다).
 */
import { useId, useRef, useState } from "react";

import { IconButton, IconMinusCircle, IconPlusCircle } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";
import type { ParamDef } from "@/domain/clause";

import type { CtxDiscriminator } from "@/app/(app)/documents/[id]/_components/condition/types";

import { bindingLabel, bindingOfValue, bindingOptions, bindingValue, newParamNameError, SCALAR_TYPES, typeLabel, typeOfValue, typeValue, type EnumChoice, type PlanFormChoice } from "./params";

const NOTE = "본문이 읽는 입력 — 조건 · 슬롯은 구분자 대신 인자를 고른다. 넣는 자리에서 인자마다 구분자 · 상수를 댄다(기본 연결은 저절로).";

type Choices = { discriminators: readonly CtxDiscriminator[]; enums: readonly EnumChoice[]; forms: readonly PlanFormChoice[] };

/** 타입을 바꾸면 기본 연결은 맞지 않는다 — 비운다. */
function withType(p: ParamDef, value: string): ParamDef {
  const { default: _dropped, ...rest } = p;
  void _dropped;
  return { ...rest, type: typeOfValue(value) };
}

function withBinding(p: ParamDef, value: string): ParamDef {
  const b = bindingOfValue(value, p.type);
  const { default: _dropped, ...rest } = p;
  void _dropped;
  return b ? { ...rest, default: b } : rest;
}

function TypeSelect({ label, param, onChange, enums, forms }: { label: string; param: ParamDef; onChange: (next: ParamDef) => void } & Pick<Choices, "enums" | "forms">) {
  return (
    <select aria-label={label} value={typeValue(param.type)} onChange={(e) => onChange(withType(param, e.target.value))}>
      {SCALAR_TYPES.map((t) => (
        <option key={t.value} value={t.value}>
          {t.label}
        </option>
      ))}
      {enums.map((e) => (
        <option key={`e-${e.code}`} value={`enum:${e.code}`}>
          열거형 — {e.label}
        </option>
      ))}
      {enums.map((e) => (
        <option key={`l-${e.code}`} value={`list<enum>:${e.code}`}>
          열거형 목록 — {e.label}
        </option>
      ))}
      {forms.map((f) => (
        <option key={`f-${f.key}`} value={`planOptions:${f.key}`}>
          세목 선택지 목록 — {f.label}
        </option>
      ))}
    </select>
  );
}

function BindingSelect({ label, param, onChange, discriminators, enums, forms }: { label: string; param: ParamDef; onChange: (next: ParamDef) => void } & Choices) {
  return (
    <select aria-label={label} value={bindingValue(param.default)} onChange={(e) => onChange(withBinding(param, e.target.value))}>
      <option value="">없음 — 넣는 자리에서 연결</option>
      {bindingOptions(param.type, discriminators, enums, forms, false).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const EMPTY: ParamDef = { name: "", type: { kind: "boolean" } };

export function ParamsPane({
  params,
  editing,
  onChange,
  discriminators,
  enums,
  forms,
}: {
  params: readonly ParamDef[];
  editing: boolean;
  onChange: (next: ParamDef[]) => void;
  discriminators: readonly CtxDiscriminator[];
  enums: readonly EnumChoice[];
  forms: readonly PlanFormChoice[];
}) {
  const choices = { discriminators, enums, forms };
  const [draft, setDraft] = useState<ParamDef>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const patch = (i: number, next: ParamDef) => onChange(params.map((p, idx) => (idx === i ? next : p)));
  const add = () => {
    const problem = newParamNameError(params, draft.name);
    if (problem) {
      setError(problem);
      nameRef.current?.focus();
      return;
    }
    onChange([...params, { ...draft, name: draft.name.trim() }]);
    setDraft(EMPTY);
    setError(null);
    nameRef.current?.focus();
  };
  return (
    <section className="ts-clause-params" aria-label="인자">
      <h2 className="ts-clause-sec">
        인자
        <InfoTip text={NOTE} />
      </h2>
      {editing ? (
        <div className="ts-param-add">
          <div className="ts-param-grid">
            <input
              ref={nameRef}
              className="ts-field-direct"
              aria-label="새 인자 이름"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              placeholder="새 인자 이름 (예: 갱신형)"
              value={draft.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <TypeSelect label="새 인자 타입" param={draft} onChange={setDraft} enums={enums} forms={forms} />
            <BindingSelect label="새 인자 기본 연결" param={draft} onChange={setDraft} {...choices} />
            <IconButton icon={<IconPlusCircle />} label="인자 추가" onClick={add} />
          </div>
          {error ? (
            <span id={errorId} className="ts-form-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
      {params.length === 0 && !editing ? <p className="ts-muted">인자 없음 — 고정 문장이다.</p> : null}
      {params.length > 0 && (
        <ol className="ts-param-cards" aria-label="인자 목록">
          {params.map((p, i) => {
            const n = i + 1;
            return (
              <li key={i} className={`ts-param-card${editing ? " is-editing" : ""}`}>
                {editing ? (
                  <>
                    <IconButton icon={<IconMinusCircle />} danger label={`인자 삭제 · ${p.name || `인자 ${n}`}`} onClick={() => onChange(params.filter((_x, idx) => idx !== i))} />
                    <input className="ts-field-direct" aria-label={`인자 ${n} 이름`} placeholder="예: 갱신형" value={p.name} onChange={(e) => patch(i, { ...p, name: e.target.value })} />
                    <TypeSelect label={`인자 ${n} 타입`} param={p} onChange={(next) => patch(i, next)} enums={enums} forms={forms} />
                    <BindingSelect label={`인자 ${n} 기본 연결`} param={p} onChange={(next) => patch(i, next)} {...choices} />
                  </>
                ) : (
                  <>
                    <span className="ts-mono ts-param-name">{p.name}</span>
                    <span>{typeLabel(p.type, enums, forms)}</span>
                    <span className="ts-muted">{bindingLabel(p.default, p.type, discriminators, enums, forms)}</span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
