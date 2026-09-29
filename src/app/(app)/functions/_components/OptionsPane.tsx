"use client";

/**
 * 옵션 목록 — 본문 옆에 늘 보이는 단 (기능/함수조항 §4.3).
 *
 * 옵션은 본문 여러 곳이 가리키는 공용조항 전역의 자원이라 본문 옆에 늘 둔다(§6.2).
 * 옵션명 · 선택지 이름 · 선택지 문구(평문)를 한 자리에서 고치고, 더하기는 `+`, 빼기는 ⊖ — 앱의 다른 구조 편집과 같은 문법.
 * 새 옵션은 빈 선택지 둘을 품고 온다(옵션은 선택지 2개부터 성립). 본문에 옵션 자리를 넣는 것은 툴바 「옵션 자리 ▾」다.
 */
import { useState } from "react";

import { IconButton, IconMinusCircle, IconPlus } from "@/app/_components/icons";

import type { ClauseEditOption, ClauseEditValue } from "../edit-types";

export function OptionsPane({
  options,
  editing,
  used,
  onChange,
  newCode,
}: {
  options: readonly ClauseEditOption[];
  editing: boolean;
  /** 본문이 지금 쓰는 옵션 코드 — 쓰이는 옵션은 뺄 수 없다 (§3.2). */
  used: ReadonlySet<string>;
  onChange: (next: ClauseEditOption[]) => void;
  /** 새 옵션 · 선택지의 임시 코드 (`new:N`). */
  newCode: () => string;
}) {
  /** 방금 더한 칸 — 그 이름 칸에 커서를 둔다. */
  const [added, setAdded] = useState<string>();
  const patch = (code: string, change: Partial<ClauseEditOption>) => onChange(options.map((option) => (option.code === code ? { ...option, ...change } : option)));
  const patchValue = (option: ClauseEditOption, code: string, change: Partial<ClauseEditValue>) =>
    patch(option.code, {
      values: option.values.map((value) => (value.code === code ? { ...value, ...change } : value)),
    });
  const blankValue = (): ClauseEditValue => ({
    code: newCode(),
    label: "",
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
    <aside className="ts-clause-options" aria-label="옵션">
      <h2 className="ts-clause-sec">옵션</h2>
      <p className="ts-muted ts-clause-sec-note">사용처마다 골라 쓰는 문구 — 본문의 옵션 자리에 고른 선택지 문구가 들어간다.</p>
      {options.length === 0 && !editing ? <p className="ts-muted">옵션 없음 — 사용처가 고를 것이 없다.</p> : null}
      {options.map((option, oi) => {
        const inBody = used.has(option.code);
        const name = option.label.trim() || `옵션 ${oi + 1}`;
        return (
          <section key={option.code} className="ts-option" aria-label={`옵션 — ${name}`}>
            <div className="ts-option-head">
              {editing ? (
                <>
                  <input
                    className="ts-field-direct"
                    value={option.label}
                    onChange={(event) => patch(option.code, { label: event.target.value })}
                    aria-label="옵션명"
                    placeholder="옵션명 — 예: 소멸 사유"
                    autoFocus={added === option.code}
                  />
                  <IconButton
                    icon={<IconMinusCircle />}
                    danger
                    label={inBody ? "본문이 쓰는 옵션은 뺄 수 없다 — 본문에서 옵션 자리를 먼저 지운다" : `${name} 빼기`}
                    disabled={inBody}
                    onClick={() => onChange(options.filter((item) => item.code !== option.code))}
                  />
                </>
              ) : (
                <span className="ts-option-name">〔{option.label}〕</span>
              )}
            </div>
            {editing && option.values.length < 2 && <p className="ts-form-issues">선택지가 2개 이상이어야 옵션이 성립한다 — 「+ 선택지」로 더한다.</p>}
            <ol className="ts-option-values">
              {option.values.map((value, vi) => {
                const valueName = value.label.trim() || `선택지 ${vi + 1}`;
                return (
                  <li key={value.code} className="ts-option-value">
                    <div className="ts-option-value-grid">
                      {editing ? (
                        <>
                          <input
                            className="ts-field-direct"
                            value={value.label}
                            onChange={(event) =>
                              patchValue(option, value.code, {
                                label: event.target.value,
                              })
                            }
                            aria-label={`${name} — 선택지 ${vi + 1} 이름`}
                            placeholder={`선택지 ${vi + 1} 이름 — 예: 사망`}
                            autoFocus={added === value.code}
                          />
                          <IconButton
                            icon={<IconMinusCircle />}
                            danger
                            label={`${valueName} 빼기`}
                            onClick={() =>
                              patch(option.code, {
                                values: option.values.filter((item) => item.code !== value.code),
                              })
                            }
                          />
                          <input
                            className="ts-field-direct ts-option-text"
                            value={value.text}
                            onChange={(event) =>
                              patchValue(option, value.code, {
                                text: event.target.value,
                              })
                            }
                            aria-label={`${name} — 선택지 ${vi + 1} 문구`}
                            placeholder="이 선택지를 고르면 옵션 자리에 들어갈 문구"
                          />
                        </>
                      ) : (
                        <>
                          <span className="ts-option-value-name">{value.label}</span>
                          <span className="ts-option-text ts-doc">{value.text || <span className="ts-muted">(빈 문구)</span>}</span>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {editing ? (
              <button type="button" className="ts-linklike ts-cov-add" aria-label={`${name}에 선택지 추가`} onClick={() => addValue(option)}>
                <IconPlus /> 선택지
              </button>
            ) : null}
          </section>
        );
      })}
      {editing ? (
        <>
          <button type="button" className="ts-cov-add-tile ts-option-add" onClick={addOption}>
            <IconPlus /> 옵션 추가
          </button>
          {options.length > 0 ? <p className="ts-muted ts-clause-sec-note">본문에 넣기 — 본문 문장에 커서를 두고 툴바 「옵션 자리 ▾」.</p> : null}
        </>
      ) : null}
    </aside>
  );
}
