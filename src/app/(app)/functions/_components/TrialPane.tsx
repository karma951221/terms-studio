"use client";

/**
 * 「시험」 탭 — 오른쪽 단 (기능/함수조항 §3.7 「함수조항 화면에서 시험한다」 · §4.3, 2026-10-15 사용자 결정).
 *
 * 인자마다 시험 값 칸(참거짓 · 문자 · 숫자 · 날짜 · 열거값 · 열거형 목록 · 세목 선택지 목록은 가상 원소 하나 — 예: 「종 하나 + 사유 다중 체크」)과
 * 옵션 선택을 두고, 지금 본문(편집 중이면 편집본)을 시험 문맥으로 펼친 출력을 바로 보인다(`runTrial`). 조 참조는 번호 대신 자리표시.
 * 시험 값은 저장하지 않는 화면 상태다 — 읽기 · 편집 어느 때나 쓴다.
 */
import { useMemo, useState } from "react";

import { InfoTip } from "@/app/_components/InfoTip";
import type { EnumDef } from "@/domain/catalog";
import { runTrial, trialDefaults, type Clause, type ParamDef } from "@/domain/clause";
import { fieldsOfForm, formsOfLevel } from "@/domain/master";
import type { Value } from "@/domain/types";

const NOTE = "인자에 값을 넣고 옵션을 골라 출력을 바로 본다 — 저장하지 않는다. 조 참조는 번호 대신 자리표시(⟨인자 이름⟩ · 〔보통약관 제○조〕)로 보인다.";

type FieldKind = { kind: string; enumCode?: string };

/** 값 칸 하나 — 타입마다. */
function ValueField({ id, label, type, value, enums, onChange }: { id: string; label: string; type: FieldKind; value: Value | undefined; enums: ReadonlyMap<string, EnumDef>; onChange: (next: Value | undefined) => void }) {
  switch (type.kind) {
    case "boolean":
      return (
        <label className="ts-trial-check">
          <input type="checkbox" aria-label={label} checked={value === true} onChange={(e) => onChange(e.target.checked)} /> 예
        </label>
      );
    case "enum": {
      const def = enums.get(type.enumCode ?? "");
      return (
        <select id={id} aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}>
          <option value="">— 비움 —</option>
          {(def?.values ?? []).map((v) => (
            <option key={v.code} value={v.code}>
              {v.label}
            </option>
          ))}
        </select>
      );
    }
    case "list<enum>": {
      const def = enums.get(type.enumCode ?? "");
      const picked = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span className="ts-trial-checks" role="group" aria-label={label}>
          {(def?.values ?? []).map((v) => (
            <label key={v.code} className="ts-trial-check">
              <input
                type="checkbox"
                checked={picked.includes(v.code)}
                onChange={(e) => onChange(e.target.checked ? (def!.values.map((x) => x.code).filter((c) => c === v.code || picked.includes(c)) as Value) : (picked.filter((c) => c !== v.code) as Value))}
              />{" "}
              {v.label}
            </label>
          ))}
        </span>
      );
    }
    case "number":
      return <input id={id} aria-label={label} inputMode="decimal" value={typeof value === "number" ? String(value) : ""} onChange={(e) => onChange(e.target.value.trim() === "" || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))} />;
    default:
      return <input id={id} aria-label={label} placeholder={type.kind === "date" ? "YYYY-MM-DD" : undefined} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function TrialPane({ clause, enums, problem, boxName, appendixName }: { clause: Clause; enums: ReadonlyMap<string, EnumDef>; problem?: string; boxName?: (code: string) => string | undefined; appendixName?: (code: string) => string | undefined }) {
  const defaults = useMemo(() => trialDefaults(clause, enums), [clause, enums]);
  const [values, setValues] = useState<Record<string, Value | undefined>>({});
  const [plans, setPlans] = useState<Record<string, Record<string, Value>>>({});
  const [options, setOptions] = useState<Record<string, string>>({});
  // 고친 칸만 들고, 나머지는 지금 정의의 처음 값 — 인자 · 옵션을 더하거나 빼도 칸이 따라온다
  const input = useMemo(
    () => ({
      values: { ...defaults.values, ...values },
      plans: Object.fromEntries(Object.entries(defaults.plans).map(([k, v]) => [k, { ...v, ...plans[k] }])),
      options: { ...defaults.options, ...options },
    }),
    [defaults, values, plans, options],
  );
  const out = useMemo(() => (problem ? undefined : runTrial(clause, input, { enums, ...(boxName ? { boxName } : {}), ...(appendixName ? { appendixName } : {}) })), [clause, input, enums, problem, boxName, appendixName]);
  const params = clause.params ?? [];
  const planFields = (p: ParamDef) => {
    const form = p.type.kind === "planOptions" ? formsOfLevel("plan").find((f) => f.key === (p.type as { form: string }).form) : undefined;
    return form ? { label: form.label, fields: fieldsOfForm(form).map((x) => x.field) } : undefined;
  };

  return (
    <section className="ts-clause-trial" aria-label="시험">
      <h2 className="ts-clause-sec">
        시험
        <InfoTip text={NOTE} />
      </h2>
      {params.length === 0 && clause.options.length === 0 ? <p className="ts-muted">인자 · 옵션이 없다 — 늘 같은 출력이다.</p> : null}
      <div className="ts-trial-inputs">
        {params.map((p, i) => {
          const id = `trial-arg-${i}`;
          if (p.type.kind === "articleRef")
            return (
              <div key={p.name} className="ts-form-row">
                <span className="ts-form-label">인자 {p.name}</span>
                <span className="ts-muted">조 참조 — 출력에 ⟨{p.name}⟩ 자리표시</span>
              </div>
            );
          if (p.type.kind === "planOptions") {
            const plan = planFields(p);
            return (
              <fieldset key={p.name} className="ts-form-row ts-trial-plan" aria-label={`인자 ${p.name}`}>
                <legend className="ts-form-label">인자 {p.name}</legend>
                <div>
                  <p className="ts-muted ts-trial-plan-note">{plan ? `${plan.label} 선택지 하나(시험 종)` : "세목 폼을 찾을 수 없다"}</p>
                  {(plan?.fields ?? []).map((f) => (
                    <div key={f.key} className="ts-trial-plan-field">
                      <span className="ts-option-caption">{f.label}</span>
                      <ValueField
                        id={`${id}-${f.key}`}
                        label={`인자 ${p.name} — ${f.label}`}
                        type={f.type as FieldKind}
                        value={input.plans[p.name]?.[f.key]}
                        enums={enums}
                        onChange={(next) => setPlans({ ...plans, [p.name]: Object.fromEntries(Object.entries({ ...plans[p.name], [f.key]: next }).filter(([, v]) => v !== undefined)) as Record<string, Value> })}
                      />
                    </div>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <div key={p.name} className="ts-form-row">
              <label htmlFor={id}>인자 {p.name}</label>
              <ValueField id={id} label={`인자 ${p.name} 시험 값`} type={p.type as FieldKind} value={input.values[p.name]} enums={enums} onChange={(next) => setValues({ ...values, [p.name]: next })} />
            </div>
          );
        })}
        {clause.options.map((o) => (
          <div key={o.code} className="ts-form-row">
            <label htmlFor={`trial-opt-${o.code}`}>{o.label || o.code}</label>
            <select id={`trial-opt-${o.code}`} value={input.options[o.code] ?? ""} onChange={(e) => setOptions({ ...options, [o.code]: e.target.value })}>
              {o.values.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="ts-trial-out" aria-label="시험 출력">
        {problem ? (
          <p className="ts-warn">{problem}</p>
        ) : out && out.lines.length === 0 && out.issues.length === 0 ? (
          <p className="ts-muted">출력이 없다 — 이 값이면 쓰는 곳에 아무것도 나오지 않는다.</p>
        ) : (
          <>
            <div className="ts-doc ts-trial-doc">
              {out?.lines.map((l, i) => (
                <p key={i} className={`ts-trial-line is-${l.kind}`}>
                  {l.label ? <span className="ts-trial-label">{l.label}</span> : null}
                  {l.text}
                </p>
              ))}
            </div>
            {out && out.issues.length > 0 ? (
              <ul className="ts-clause-warnings" aria-label="시험 문제">
                {out.issues.map((m) => (
                  <li key={m} className="ts-warn">
                    {m}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
