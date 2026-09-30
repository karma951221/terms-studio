"use client";

/**
 * 옵션 목록 — 본문 옆에 늘 보이는 단 (기능/함수조항 §4.3).
 *
 * 옵션은 본문 여러 곳이 가리키는 함수조항 전역의 자원이라 본문 옆에 늘 둔다(§6.2).
 * 옵션마다 **카드** 하나 — 머리 = 맨 앞 ⊖ 「옵션 삭제 · {이름}」 + 옵션명(제목), 몸 = 「선택지」 캡션 아래 번호 붙은 선택지 줄
 * (맨 앞 ⊖ 「선택지 삭제 · N」 + 문구 칸 하나) + 마지막 줄 아래 ⊕ 「선택지 추가」 — 값 행 표(디자인원칙 §2 L2)와 같은 자리.
 * **선택지 = 문구 하나** (2026-10-01) — 칸에 쓴 글이 곧 옵션 자리에 들어가는 문구이고, 선택지 이름(`label`, 사용처의 고르기 목록에 뜬다)은
 * 그 글에서 저절로 만든다(`optionValueLabel`). 새 옵션은 빈 선택지 둘을 품고 온다(옵션은 선택지 2개부터 성립).
 * 본문에 옵션 자리를 넣는 것은 툴바 「옵션 자리 ▾」다.
 */
import { useState, type ReactNode } from "react";

import { IconButton, IconMinusCircle, IconPlusCircle } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";

import type { ClauseEditOption, ClauseEditValue } from "../edit-types";

const NOTE = "사용처마다 골라 쓰는 문구 — 본문의 옵션 자리에 고른 선택지 문구가 들어간다. 본문에 넣기: 본문 문장에 커서를 두고 툴바 「옵션 자리 ▾」.";

/** 선택지 이름의 최대 길이 — 넘으면 말줄임(…). 사용처의 고르기 목록 · 툴팁 한 줄에 들어갈 만큼. */
export const OPTION_VALUE_LABEL_MAX = 30;

/**
 * 선택지 이름 = 문구에서 저절로 (2026-10-01, 기능/함수조항 §6.2) — 공백을 한 칸으로 모아 다듬은 글, 길면 말줄임.
 * 빈 문구도 선택지다(옵션 자리에 아무것도 넣지 않는다) — 이름은 「(빈 문구)」.
 */
export function optionValueLabel(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain === "") return "(빈 문구)";
  return plain.length > OPTION_VALUE_LABEL_MAX ? `${plain.slice(0, OPTION_VALUE_LABEL_MAX - 1)}…` : plain;
}

export function OptionsPane({
  options,
  editing,
  used,
  onChange,
  newCode,
  before,
}: {
  /** 단 맨 위에 먼저 둘 것 — 인자 표(ParamsPane). 옵션과 같은 「본문 옆 전역 자원」 단을 쓴다. */
  before?: ReactNode;
  options: readonly ClauseEditOption[];
  editing: boolean;
  /** 본문이 지금 쓰는 옵션 코드 — 쓰이는 옵션은 뺄 수 없다 (§3.2). */
  used: ReadonlySet<string>;
  onChange: (next: ClauseEditOption[]) => void;
  /** 새 옵션 · 선택지의 임시 코드 (`new:N`). */
  newCode: () => string;
}) {
  /** 방금 더한 칸 — 옵션이면 옵션명 칸, 선택지면 그 문구 칸에 커서를 둔다. */
  const [added, setAdded] = useState<string>();
  const patch = (code: string, change: Partial<ClauseEditOption>) => onChange(options.map((option) => (option.code === code ? { ...option, ...change } : option)));
  const setText = (option: ClauseEditOption, code: string, text: string) =>
    patch(option.code, {
      values: option.values.map((value) => (value.code === code ? { ...value, text, label: optionValueLabel(text) } : value)),
    });
  const blankValue = (): ClauseEditValue => ({
    code: newCode(),
    label: optionValueLabel(""),
    text: "",
  });

  const addOption = () => {
    const option: ClauseEditOption = {
      code: newCode(),
      label: "",
      values: [blankValue(), blankValue()],
    };
    setAdded(option.code);
    onChange([...options, option]);
  };
  const addValue = (option: ClauseEditOption) => {
    const value = blankValue();
    setAdded(value.code);
    patch(option.code, { values: [...option.values, value] });
  };

  return (
    <aside className="ts-clause-options" aria-label="인자 · 옵션">
      {before}
      <h2 className="ts-clause-sec">
        옵션
        <InfoTip text={NOTE} />
      </h2>
      {options.length === 0 && !editing ? <p className="ts-muted">옵션 없음 — 사용처가 고를 것이 없다.</p> : null}
      {options.map((option, oi) => {
        const inBody = used.has(option.code);
        const name = option.label.trim() || `옵션 ${oi + 1}`;
        return (
          <section key={option.code} className={`ts-option${editing ? " is-editing" : ""}`} aria-label={`옵션 — ${name}`}>
            <div className="ts-option-head">
              {editing ? (
                <>
                  <IconButton
                    icon={<IconMinusCircle />}
                    danger
                    label={inBody ? "본문이 쓰는 옵션은 뺄 수 없다 — 본문에서 옵션 자리를 먼저 지운다" : `옵션 삭제 · ${name}`}
                    disabled={inBody}
                    onClick={() => onChange(options.filter((item) => item.code !== option.code))}
                  />
                  <label className="ts-option-title-field">
                    <span className="ts-option-caption">옵션명</span>
                    <input
                      className="ts-field-direct ts-option-title"
                      value={option.label}
                      onChange={(event) => patch(option.code, { label: event.target.value })}
                      aria-label="옵션명"
                      placeholder="예: 소멸 사유"
                      autoFocus={added === option.code}
                    />
                  </label>
                </>
              ) : (
                <span className="ts-option-name">〔{option.label}〕</span>
              )}
            </div>
            <div className="ts-option-body">
              <span className="ts-option-caption" aria-hidden>
                선택지
              </span>
              {editing && option.values.length < 2 && <p className="ts-form-issues">선택지가 2개 이상이어야 옵션이 성립한다 — ⊕ 「선택지 추가」로 더한다.</p>}
              <ol className="ts-option-values" aria-label={`${name} — 선택지`}>
                {option.values.map((value, vi) => {
                  const n = vi + 1;
                  return (
                    <li key={value.code} className="ts-option-value">
                      {editing ? (
                        <IconButton
                          icon={<IconMinusCircle />}
                          danger
                          label={`선택지 삭제 · ${n}`}
                          onClick={() =>
                            patch(option.code, {
                              values: option.values.filter((item) => item.code !== value.code),
                            })
                          }
                        />
                      ) : null}
                      <span className="ts-option-num" aria-hidden>
                        {n}.
                      </span>
                      {editing ? (
                        <input
                          className="ts-field-direct ts-option-text"
                          value={value.text}
                          onChange={(event) => setText(option, value.code, event.target.value)}
                          aria-label={`${name} — 선택지 ${n}`}
                          placeholder="옵션 자리에 들어갈 문구"
                          autoFocus={added === value.code}
                        />
                      ) : (
                        <span className="ts-option-text ts-doc">{value.text || <span className="ts-muted">(빈 문구)</span>}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
              {editing ? (
                <div className="ts-option-value-add">
                  <IconButton icon={<IconPlusCircle />} label={`선택지 추가 · ${name}`} onClick={() => addValue(option)} />
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
      {editing ? (
        <button type="button" className="ts-cov-add-tile ts-option-add" onClick={addOption}>
          <IconPlusCircle /> 옵션 추가
        </button>
      ) : null}
    </aside>
  );
}
