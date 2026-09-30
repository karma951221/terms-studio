"use client";

/**
 * 값별 분기(switch, 최종 결정 5) 칸 머리의 조작 — 값 칩(× 빼기) · `+ 값`(칸 없는 값만) · 「문구 없음」(본문이 있으면 잠김) · 빈 칸 안내.
 * 블록 분기의 칸 머리(DocBody)와 문장 안 분기 팝업(Popups)이 같이 쓴다. 명령은 `setCase` 하나 — 값은 대상 열거형 순서로 넣는다.
 */
import { SWITCH_WORD } from "@/app/_lib/labels";
import type { EditOp } from "@/domain/document";

import { sortValues, switchValueLabel, unassignedValues, type SwitchSubject } from "./switchCases";

interface CaseLike {
  id: string;
  values?: string[];
  empty?: true;
  children: readonly unknown[];
}

/** 값 표시 — 대상 열거형에 없는 코드는 「없는 값 V09」. */
export function caseValueLabel(subject: SwitchSubject | undefined, code: string): string {
  const known = subject ? subject.values.some((v) => v.code === code) : true;
  return known ? switchValueLabel(subject, code) : `없는 값 ${code}`;
}

export function CaseControls({ subject, branch, branches, apply }: { subject: SwitchSubject | undefined; branch: CaseLike; branches: readonly CaseLike[]; apply: (ops: readonly EditOp[]) => boolean }) {
  const values = branch.values ?? [];
  const known = new Set((subject?.values ?? []).map((v) => v.code));
  const set = (next: readonly string[], empty = branch.empty === true) => apply([{ type: "setCase", branchId: branch.id, values: sortValues(subject, next), empty }]);
  const free = unassignedValues(subject, branches);
  const hasBody = branch.children.length > 0;
  return (
    <>
      {values.map((v) => (
        <span key={v} className={`ts-switch-chip${subject && !known.has(v) ? " is-missing" : ""}`}>
          {caseValueLabel(subject, v)}
          <button type="button" className="ts-switch-chip-x" aria-label={`값 ${caseValueLabel(subject, v)} 빼기`} onClick={() => set(values.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      {values.length === 0 && <span className="ts-cond-issue">값 없음 — 값을 고른다</span>}
      {free.length > 0 && (
        <select aria-label="칸에 값 더하기" value="" onChange={(e) => e.target.value && set([...values, e.target.value])}>
          <option value="">+ 값</option>
          {free.map((v) => (
            <option key={v.code} value={v.code}>
              {v.label}
            </option>
          ))}
        </select>
      )}
      <label className="ts-switch-empty" title={hasBody && !branch.empty ? "본문을 지운 뒤 켠다 — 「문구 없음」 칸은 본문이 없다" : "이 칸은 아무것도 내지 않는다"}>
        <input type="checkbox" checked={branch.empty === true} disabled={hasBody && !branch.empty} onChange={(e) => set(values, e.target.checked)} /> {SWITCH_WORD.empty}
      </label>
      {!branch.empty && !hasBody && <span className="ts-cond-issue">칸이 비었다 — 본문을 쓰거나 「{SWITCH_WORD.empty}」</span>}
    </>
  );
}
