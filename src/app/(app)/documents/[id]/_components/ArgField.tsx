/**
 * 함수조항 인자 연결 칸(조 참조 인자 밖) — 연결 고르기 + (문자 · 숫자 · 날짜면) 「상수 직접 입력」 (기능/함수조항 §4.4).
 * 후보에 없는 지금 연결은 고를 수 없는 「(지금 연결 — 고칠 것)」 줄로 보이고, 고른 채 두면 그대로 지킨다 —
 * 고를 수 없는 줄은 폼에 안 실려 숨은 `argkeep:<이름>` 으로 넘긴다. 칸 → 연결은 `scalarBindingOf` 하나로 읽는다.
 */
import type { ReactNode } from "react";

import { bindingOfValue, bindingValue, constBindingOfText, constInputOf, constTextOf } from "@/app/(app)/functions/_components/params";
import type { Binding, ParamDef } from "@/domain/clause";

export type BindingChoice = { value: string; label: string; group: string };

/** 연결 칸 후보 → `<option>` — 묶음(group)이 이어지는 동안 `<optgroup>` 하나(배열 순서 = 화면 순서). 키 경로 후보는 노드마다 묶음이다. */
export function groupedOptions(options: readonly BindingChoice[]): ReactNode {
  const runs: { group: string; items: BindingChoice[] }[] = [];
  for (const o of options) {
    const last = runs.at(-1);
    if (last && last.group === o.group) last.items.push(o);
    else runs.push({ group: o.group, items: [o] });
  }
  return runs.map((r) => (
    <optgroup key={`${r.group}-${r.items[0].value}`} label={r.group}>
      {r.items.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </optgroup>
  ));
}

/** 인자 칸 하나 — `defaultLabel` = 빈 값 줄(기본 연결 · 연결 안 함), `stale` = `staleBindingOption` 결과. */
export function ScalarArgField({ param, seed, defaultLabel, options, stale }: { param: ParamDef; seed: Binding | undefined; defaultLabel: string; options: readonly BindingChoice[]; stale: { value: string; label: string } | undefined }) {
  const direct = constInputOf(param.type);
  const constText = constTextOf(seed, param.type);
  return (
    <div className="ts-form-row">
      <label htmlFor={`pop-arg-${param.name}`}>인자 {param.name}</label>
      <select id={`pop-arg-${param.name}`} name={`arg:${param.name}`} defaultValue={constText !== "" ? "" : bindingValue(seed)}>
        <option value="">{defaultLabel}</option>
        {stale && (
          <option value={stale.value} disabled>
            {stale.label}
          </option>
        )}
        {groupedOptions(options)}
      </select>
      {stale && <input type="hidden" name={`argkeep:${param.name}`} value={stale.value} />}
      {direct && (
        <input
          className="ts-arg-const"
          name={`argc:${param.name}`}
          aria-label={`인자 ${param.name} 상수 직접 입력`}
          inputMode={direct.inputMode}
          placeholder={`상수 직접 입력 — ${direct.placeholder}`}
          defaultValue={constText}
        />
      )}
    </div>
  );
}

/**
 * 폼 → 인자 연결 — 상수 직접 입력이 차 있으면 그것(모양 오류는 `bindingInputProblem` 이 먼저 막는다), 아니면 고른 줄,
 * 고를 수 없는 「(지금 연결 — 고칠 것)」 줄을 고른 채면 칸 값이 폼에 없어 `argkeep` — 지금 연결 그대로. 빈 값(기본 연결) = undefined.
 */
export function scalarBindingOf(fd: FormData, param: ParamDef): Binding | undefined {
  const direct = constBindingOfText(String(fd.get(`argc:${param.name}`) ?? ""), param.type).binding;
  if (direct) return direct;
  const value = fd.get(`arg:${param.name}`) ?? fd.get(`argkeep:${param.name}`);
  return value !== null ? bindingOfValue(String(value), param.type) : undefined;
}
