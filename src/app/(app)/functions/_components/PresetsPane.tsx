"use client";

/**
 * 프리셋 — 옵션 단 맨 아래 구획 (ADR-0084 결정 8 · 기능/함수조항 §4.3).
 *
 * 프리셋 = 인자 연결 · 옵션 선택의 **이름 붙은 조합**. 사용처는 넣기 목록의 프리셋 줄을 한 번 눌러 그 조합으로 넣는다.
 * 모양은 인자 · 옵션과 같다 — 맨 위 고정 **추가 줄**(이름 · ⊕ 「프리셋 추가」, 이름 칸 Enter 도 더한다) 아래 **프리셋마다 카드**
 * (맨 앞 ⊖ 「프리셋 삭제 · {이름}」 · 이름 · 옵션마다 선택 · 인자마다 연결). 조 참조 인자 줄은 없다 — 사용처가 넣을 때 연결한다(결정 3).
 * 기본 연결 있는 인자는 비우면 「기본 연결」. 기본 연결 없는 인자는 값을 대거나 「사용처가 채움(반복의 현재 원소)」을 고른다 — 그냥 비우면 저장 거부.
 * 사용처가 있는 프리셋을 빼면 카드 안에 확인 줄 「사용처 N곳이 직접 연결로 바뀝니다」(결정 7) — 저장 때 그 사용처를 직접 연결로 푼다.
 */
import { useId, useRef, useState } from "react";

import { IconButton, IconMinusCircle, IconPlusCircle } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";
import type { ParamDef } from "@/domain/clause";

import type { CtxDiscriminator } from "@/app/(app)/documents/[id]/_components/condition/types";

import type { ClauseEditOption, ClauseEditPreset } from "../edit-types";
import { bindingLabel, bindingOfValue, bindingOptions, bindingValue, type EnumChoice, type PlanFormChoice } from "./params";

const NOTE = "인자 연결 · 옵션 선택을 이름 붙여 둔 조합 — 사용처는 넣기 목록의 프리셋 줄을 눌러 그 조합으로 넣는다. 사용처는 프리셋 값을 덮어쓰지 않는다.";

/** 「사용처가 채움」 칸 값 — 기본 연결 없는 값 인자를 사용처가 반복의 현재 원소로 채운다 (2026-10-12 사용자 결정). */
export const FROM_USAGE = "usage";
export const FROM_USAGE_LABEL = "사용처가 채움(반복의 현재 원소)";

/** 프리셋 인자 칸의 값 — 연결 · 「사용처가 채움」 · 비움. */
export function presetArgValue(preset: ClauseEditPreset, name: string): string {
  if (preset.fromUsage.includes(name)) return FROM_USAGE;
  return bindingValue(preset.bindings[name]);
}

/** 프리셋 인자 칸 값 → 프리셋. */
export function withPresetArg(preset: ClauseEditPreset, param: ParamDef, value: string): ClauseEditPreset {
  const { [param.name]: _drop, ...bindings } = preset.bindings;
  void _drop;
  const fromUsage = preset.fromUsage.filter((n) => n !== param.name);
  if (value === FROM_USAGE) return { ...preset, bindings, fromUsage: [...fromUsage, param.name] };
  const b = bindingOfValue(value, param.type);
  return { ...preset, bindings: b ? { ...bindings, [param.name]: b } : bindings, fromUsage };
}

type Choices = { discriminators: readonly CtxDiscriminator[]; enums: readonly EnumChoice[]; forms: readonly PlanFormChoice[] };

function argLabel(preset: ClauseEditPreset, p: ParamDef, c: Choices): string {
  if (preset.fromUsage.includes(p.name)) return FROM_USAGE_LABEL;
  const b = preset.bindings[p.name];
  if (!b) return p.default ? `기본 연결 — ${bindingLabel(p.default, p.type, c.discriminators, c.enums, c.forms)}` : "비었음";
  return bindingLabel(b, p.type, c.discriminators, c.enums.filter((e) => "enumCode" in p.type && e.code === p.type.enumCode), c.forms);
}

export function PresetsPane({
  presets,
  editing,
  onChange,
  options,
  params,
  uses,
  newCode,
  discriminators,
  enums,
  forms,
}: {
  presets: readonly ClauseEditPreset[];
  editing: boolean;
  onChange: (next: ClauseEditPreset[]) => void;
  options: readonly ClauseEditOption[];
  params: readonly ParamDef[];
  /** 저장된 프리셋 코드 → 사용처 수 — 빼기 확인의 재료. */
  uses: ReadonlyMap<string, number>;
  newCode: () => string;
} & Choices) {
  const choices = { discriminators, enums, forms };
  const valueParams = params.filter((p) => p.type.kind !== "articleRef" && p.name.trim() !== "");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const patch = (code: string, next: ClauseEditPreset) => onChange(presets.map((p) => (p.code === code ? next : p)));
  const add = () => {
    const n = name.trim();
    const problem = n === "" ? "프리셋 이름을 적는다" : presets.some((p) => p.name.trim() === n) ? `프리셋 이름이 겹칩니다: ${n}` : null;
    if (problem) {
      setError(problem);
      nameRef.current?.focus();
      return;
    }
    onChange([...presets, { code: newCode(), name: n, options: {}, bindings: {}, fromUsage: [] }]);
    setName("");
    setError(null);
    nameRef.current?.focus();
  };
  const remove = (p: ClauseEditPreset) => {
    setConfirming(undefined);
    onChange(presets.filter((x) => x.code !== p.code));
  };
  return (
    <section className="ts-clause-presets" aria-label="프리셋">
      <h2 className="ts-clause-sec">
        프리셋
        <InfoTip text={NOTE} />
      </h2>
      {editing ? (
        <div className="ts-param-add">
          <div className="ts-param-grid">
            <input
              ref={nameRef}
              className="ts-field-direct"
              aria-label="새 프리셋 이름"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              placeholder="새 프리셋 이름 (예: 상해)"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <IconButton icon={<IconPlusCircle />} label="프리셋 추가" onClick={add} />
          </div>
          {error ? (
            <span id={errorId} className="ts-form-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
      {presets.length === 0 && !editing ? <p className="ts-muted">프리셋 없음 — 사용처가 넣을 때마다 연결 · 옵션을 고른다.</p> : null}
      {presets.length > 0 && (
        <ol className="ts-param-cards" aria-label="프리셋 목록">
          {presets.map((p, i) => {
            const label = p.name.trim() || `프리셋 ${i + 1}`;
            const used = uses.get(p.code) ?? 0;
            return (
              <li key={p.code} className={`ts-param-card ts-preset-card${editing ? " is-editing" : ""}`} aria-label={`프리셋 — ${label}`}>
                {editing ? (
                  <>
                    <IconButton icon={<IconMinusCircle />} danger label={`프리셋 삭제 · ${label}`} onClick={() => (used > 0 ? setConfirming(p.code) : remove(p))} />
                    <input className="ts-field-direct" aria-label={`프리셋 ${i + 1} 이름`} value={p.name} onChange={(e) => patch(p.code, { ...p, name: e.target.value })} />
                    {confirming === p.code ? (
                      <p className="ts-preset-confirm" role="alert">
                        사용처 {used}곳이 직접 연결로 바뀝니다 — 저장하면 그 자리에 이 프리셋 값이 그대로 남는다.{" "}
                        <button type="button" className="ts-linklike" onClick={() => remove(p)}>
                          빼기
                        </button>{" "}
                        <button type="button" className="ts-linklike" onClick={() => setConfirming(undefined)}>
                          취소
                        </button>
                      </p>
                    ) : null}
                    {options.map((o, oi) => (
                      <label key={o.code} className="ts-preset-row">
                        <span className="ts-option-caption">{o.label.trim() || `옵션 ${oi + 1}`}</span>
                        <select aria-label={`${label} — 옵션 ${o.label.trim() || oi + 1}`} value={p.options[o.code] ?? ""} onChange={(e) => patch(p.code, { ...p, options: { ...p.options, [o.code]: e.target.value } })}>
                          <option value="">— 미선택 —</option>
                          {o.values.map((v) => (
                            <option key={v.code} value={v.code}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    {valueParams.map((param) => (
                      <label key={param.name} className="ts-preset-row">
                        <span className="ts-option-caption">인자 {param.name}</span>
                        <select aria-label={`${label} — 인자 ${param.name}`} value={presetArgValue(p, param.name)} onChange={(e) => patch(p.code, withPresetArg(p, param, e.target.value))}>
                          <option value="">{param.default ? `기본 연결 — ${bindingLabel(param.default, param.type, discriminators, enums, forms)}` : "— 비었음 —"}</option>
                          {!param.default && <option value={FROM_USAGE}>{FROM_USAGE_LABEL}</option>}
                          {bindingOptions(param.type, discriminators, enums.filter((e) => "enumCode" in param.type && e.code === param.type.enumCode), forms, true).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </>
                ) : (
                  <>
                    <span className="ts-param-name">{label}</span>
                    <span className="ts-muted">{[...options.map((o) => `${o.label}: ${o.values.find((v) => v.code === p.options[o.code])?.label ?? "미선택"}`), ...valueParams.map((x) => `${x.name} ← ${argLabel(p, x, choices)}`)].join(" · ") || "값 없음"}</span>
                    {used > 0 ? <span className="ts-muted">사용처 {used}곳</span> : null}
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
