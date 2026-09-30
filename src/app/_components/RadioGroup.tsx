"use client";

/**
 * 라디오 2지선다 + 고른 값의 뜻풀이.
 *
 * 옵션 이름(「항상 노출」·「선택 노출」)만 늘어놓으면 둘이 뭐가 다른지 화면에 없다 — 고른 옵션의
 * hint 를 바로 아래 붙여 준다. 툴팁으로 숨기지 않는 이유는, 이건 고를 때 읽어야 하는 설명이라서다.
 *
 * 제어형(EditShell 의 Field)과 비제어형(서버 액션에 formData 로 실려 가는 생성 폼)을 같이 받는다.
 * 어느 쪽이든 `name`·`value` 를 단 진짜 input 이라 폼 제출에 그대로 실린다.
 */
import { useState } from "react";

export interface RadioOption {
  value: string | boolean;
  label: string;
  hint?: string;
}

export function RadioGroup({
  name,
  label,
  options,
  value,
  defaultValue,
  onChange,
  disabled,
}: {
  name: string;
  /** radiogroup 의 접근성 이름 — 보이는 라벨은 바깥(ts-form-row)이 그린다. */
  label: string;
  options: readonly RadioOption[];
  /** 제어형 — 바깥이 값을 쥘 때. */
  value?: string | boolean;
  /** 비제어형 초기값. */
  defaultValue?: string | boolean;
  onChange?: (value: string | boolean) => void;
  /** 고를 수 없는 자리 — 값은 보이되 조작은 막는다 (함수조항 유형처럼 등록 뒤 안 바뀌는 값). */
  disabled?: boolean;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value !== undefined ? value : inner;
  const hint = options.find((option) => option.value === current)?.hint;

  return (
    <div className="ts-radio-group">
      <div className="ts-form-radios" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label key={String(option.value)} className="ts-form-radio">
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={current === option.value}
              disabled={disabled}
              onChange={() => {
                setInner(option.value);
                onChange?.(option.value);
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
      {hint ? <p className="ts-form-hint">{hint}</p> : null}
    </div>
  );
}
