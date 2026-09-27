"use client";

/**
 * 옵션 목록 단 — 늘 보이는 셋째 단 (기능/공용조항 §4.3).
 *
 * 옵션은 본문 여러 곳이 가리키는 공용조항 전역의 자원이라, 선택을 옮길 때마다 숨었다 나타나는 인스펙터가 아니라 여기 늘 둔다(§6.2).
 * 옵션명 · 선택지 이름 · 선택지 문구(평문)를 한 자리에서 고치고, 옵션 · 선택지를 더하고 뺀다. 본문에 옵션 자리를 넣는 것은
 * 가운데 에디터의 오른쪽 클릭 › 「옵션 자리 — 옵션명」이다(넣는 자리와 고르는 자리를 붙인다).
 */
import { useRef } from "react";

import { IconButton, IconClose, IconPlus } from "@/app/_components/icons";

import type { ClauseEditOption, ClauseEditValue } from "../edit-types";

/**
 * 이름 하나를 받아 더하는 칸 — Enter 로도, 버튼으로도 더한다.
 * 조합 중의 Enter 는 한글 조합을 확정하는 키라(`isComposing`) 제출로 쓰지 않는다 — 눈에 보이는 + 를 함께 둔다.
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
  const patch = (code: string, change: Partial<ClauseEditOption>) => onChange(options.map((option) => (option.code === code ? { ...option, ...change } : option)));
  const patchValue = (option: ClauseEditOption, code: string, change: Partial<ClauseEditValue>) =>
    patch(option.code, { values: option.values.map((value) => (value.code === code ? { ...value, ...change } : value)) });

  return (
    <aside className="ts-l3-side ts-clause-options" aria-label="옵션 목록">
      <p className="ts-l2-side-title">옵션</p>
      {options.length === 0 ? (
        <p className="ts-muted">옵션 없음 — 사용처가 고를 것이 없다.</p>
      ) : (
        options.map((option) => {
          const inBody = used.has(option.code);
          return (
            <div key={option.code} className="ts-option">
              <div className="ts-option-head">
                {editing ? (
                  <>
                    <input className="ts-field-direct" value={option.label} onChange={(event) => patch(option.code, { label: event.target.value })} aria-label="옵션명" placeholder="옵션명" />
                    <IconButton
                      icon={<IconClose />}
                      label={inBody ? "본문이 쓰는 옵션은 뺄 수 없다 — 본문에서 옵션 자리를 먼저 지운다" : `${option.label || "이름 없는 옵션"} 빼기`}
                      disabled={inBody}
                      onClick={() => onChange(options.filter((item) => item.code !== option.code))}
                    />
                  </>
                ) : (
                  <span className="ts-option-name">〔{option.label}〕</span>
                )}
              </div>
              {option.values.length < 2 && <p className="ts-form-issues">선택지가 2개 이상이어야 옵션이 성립한다 — 지금 {option.values.length}개.</p>}
              <ul className="ts-option-values">
                {option.values.map((value) => (
                  <li key={value.code} className="ts-option-value">
                    {editing ? (
                      <>
                        <input className="ts-field-direct" value={value.label} onChange={(event) => patchValue(option, value.code, { label: event.target.value })} aria-label="선택지 이름" placeholder="선택지 이름" />
                        <IconButton icon={<IconClose />} label={`${value.label || "이름 없는 선택지"} 빼기`} onClick={() => patch(option.code, { values: option.values.filter((item) => item.code !== value.code) })} />
                        <input
                          className="ts-field-direct ts-option-text"
                          value={value.text}
                          onChange={(event) => patchValue(option, value.code, { text: event.target.value })}
                          aria-label={`${value.label || "선택지"} 문구`}
                          placeholder="선택지 문구 — 옵션 자리에 들어갈 글"
                        />
                      </>
                    ) : (
                      <>
                        <span>{value.label}</span>
                        <span className="ts-option-text ts-doc">{value.text || <span className="ts-muted">(빈 문구)</span>}</span>
                      </>
                    )}
                  </li>
                ))}
                {editing ? (
                  <li>
                    <AddInput
                      label={`${option.label || "옵션"} 선택지 추가`}
                      placeholder="선택지 추가"
                      onAdd={(label) => patch(option.code, { values: [...option.values, { code: newCode(), label, text: "" }] })}
                    />
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })
      )}
      {editing ? (
        <>
          <div className="ts-add-row">
            <AddInput label="옵션 추가" placeholder="옵션 추가" onAdd={(label) => onChange([...options, { code: newCode(), label, values: [] }])} />
          </div>
          <p className="ts-muted">본문에 넣기 — 가운데 문장을 오른쪽 클릭 › 「옵션 자리 — 옵션명」.</p>
        </>
      ) : null}
    </aside>
  );
}
