"use client";

/**
 * 켜기/끄기 토글 + 켜진 상태의 이름 + 지금 상태의 뜻풀이.
 *
 * 「항상 노출 / 선택 노출」 처럼 값이 둘뿐이고 한쪽이 기본인 필드는 라디오 둘보다 스위치 하나가
 * 맞다 (2026-09-12 폼 QA) — 「항상 노출할지」 한 가지를 묻는 것이지 둘 중 고르는 것이 아니다.
 *
 * 제어형(EditShell 의 Field)과 비제어형(생성 폼 → formData) 둘 다 받는다. 진짜 checkbox 라
 * 폼 제출에는 켜졌을 때만 `name=on` 으로 실린다 (`bool(formData, name)` 이 그대로 읽는다).
 */
import { useState } from "react";

export function Toggle({
  name,
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  hintOn,
  hintOff,
}: {
  name: string;
  /** 켜진 상태의 이름 — 「항상 노출」. */
  label: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  hintOn?: string;
  hintOff?: string;
}) {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const current = checked !== undefined ? checked : inner;
  const hint = current ? hintOn : hintOff;
  return (
    <div className="ts-radio-group">
      <label className="ts-toggle">
        <input
          type="checkbox"
          role="switch"
          data-slot="switch-native"
          name={name}
          checked={current}
          disabled={disabled}
          aria-checked={current}
          className="relative h-[18px] w-8 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-muted outline-none transition-colors duration-150 before:absolute before:top-[2px] before:left-[2px] before:size-3 before:rounded-full before:bg-card before:transition-transform before:duration-150 checked:border-mark checked:bg-mark checked:before:translate-x-[14px] focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60"
          onChange={(event) => {
            setInner(event.target.checked);
            onChange?.(event.target.checked);
          }}
        />
        <span className="ts-toggle-label">{label}</span>
      </label>
      {hint ? <p className="ts-form-hint">{hint}</p> : null}
    </div>
  );
}
