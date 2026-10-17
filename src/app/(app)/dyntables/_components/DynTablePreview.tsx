"use client";

/**
 * 동적표 미리보기 (기능/동적표 §4.2) — 표본 급부 몇 줄(세부보장명 · 급부명 · 지급률 · 감액 구간 · 이후 지급률) + 인자 값으로 지금 보이는 정의를 펼친다(`previewDynTable`).
 * 표본 · 인자 값은 화면 상태다 — 저장하지 않고, 읽기 · 편집 어느 때나 쓴다. 표본이 없으면 「표본 급부를 더하면 표가 펼쳐진다」.
 * 감액 구간은 「12:50, 36:80」 — 끝 개월:지급률 을 쉼표로. 모양이 틀린 줄은 사유를 보이고 그 줄을 빼고 펼친다.
 */
import { useMemo, useState } from "react";

import { IconButton, IconMinusCircle, IconPlusCircle } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";
import { FIELD_LABEL } from "@/app/_lib/labels";
import type { EnumDef } from "@/domain/catalog";
import type { ParamDef } from "@/domain/clause";
import { previewDynTable, type DynTableArgValues } from "@/domain/dyntable/preview";
import type { DynBenefit, NewDynTable } from "@/domain/dyntable/types";
import type { Value } from "@/domain/types";

const NOTE = "표본 급부와 인자 값으로 지금 정의를 펼쳐 본다 — 저장하지 않는다. 감액 구간은 「끝 개월:지급률」을 쉼표로 (예: 12:50, 36:80).";

interface SampleRow {
  sub: string;
  name: string;
  rate: string;
  reduction: string;
  after: string;
}

const EMPTY_ROW: SampleRow = { sub: "", name: "", rate: "100", reduction: "", after: "100" };

/** 표본 줄 → 급부. 모양이 틀리면 사유. */
export function benefitOfRow(row: SampleRow, i: number): { benefit?: DynBenefit; problem?: string } {
  const name = row.name.trim();
  if (name === "") return { problem: `표본 ${i + 1} — 급부명을 적는다` };
  const sub = row.sub.trim() || name;
  const rateText = row.rate.trim();
  const rate = rateText === "" ? undefined : Number(rateText);
  if (rate !== undefined && !Number.isFinite(rate)) return { problem: `표본 ${i + 1} — 지급률은 숫자다` };
  const periods: { end: number; rate: number }[] = [];
  for (const piece of row.reduction.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*:\s*(\d+(?:\.\d+)?)$/.exec(piece);
    if (!m) return { problem: `표본 ${i + 1} — 감액 구간은 「끝 개월:지급률」이다: ${piece}` };
    periods.push({ end: Number(m[1]), rate: Number(m[2]) });
  }
  const after = row.after.trim() === "" ? 100 : Number(row.after);
  if (!Number.isFinite(after)) return { problem: `표본 ${i + 1} — 이후 지급률은 숫자다` };
  return {
    benefit: {
      subCoverageKey: sub,
      subCoverageName: sub,
      key: `${i + 1}`,
      name,
      ...(rate !== undefined ? { payRate: rate } : {}),
      ...(periods.length > 0 ? { reduction: { periods, afterRate: after } } : {}),
    },
  };
}

function ArgValueField({ id, param, value, enums, onChange }: { id: string; param: ParamDef; value: Value | undefined; enums: ReadonlyMap<string, EnumDef>; onChange: (next: Value | undefined) => void }) {
  const t = param.type;
  switch (t.kind) {
    case "boolean":
      return (
        <label className="ts-trial-check">
          <input type="checkbox" aria-label={`인자 ${param.name} 값`} checked={value === true} onChange={(e) => onChange(e.target.checked)} /> 예
        </label>
      );
    case "enum": {
      const def = enums.get(t.enumCode);
      return (
        <select id={id} aria-label={`인자 ${param.name} 값`} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}>
          <option value="">— 비움 —</option>
          {(def?.values ?? []).map((v) => (
            <option key={v.code} value={v.code}>
              {v.label}
            </option>
          ))}
        </select>
      );
    }
    case "number":
      return <input id={id} aria-label={`인자 ${param.name} 값`} inputMode="decimal" value={typeof value === "number" ? String(value) : ""} onChange={(e) => onChange(e.target.value.trim() === "" || !Number.isFinite(Number(e.target.value)) ? undefined : Number(e.target.value))} />;
    case "string":
    case "date":
      return <input id={id} aria-label={`인자 ${param.name} 값`} placeholder={t.kind === "date" ? "YYYY-MM-DD" : undefined} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <span className="ts-muted">이 타입은 미리보기에서 값을 주지 않는다</span>;
  }
}

export function DynTablePreview({ table, enums }: { table: NewDynTable; enums: ReadonlyMap<string, EnumDef> }) {
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [values, setValues] = useState<DynTableArgValues>({});
  const patch = (i: number, next: Partial<SampleRow>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...next } : r)));

  const out = useMemo(() => {
    const problems: string[] = [];
    const benefits: DynBenefit[] = [];
    rows.forEach((r, i) => {
      const b = benefitOfRow(r, i);
      if (b.problem) problems.push(b.problem);
      else if (b.benefit) benefits.push(b.benefit);
    });
    const preview = previewDynTable(table, { benefits }, values, enums);
    return { ...preview, issues: [...problems, ...preview.issues], empty: benefits.length === 0 };
  }, [rows, values, table, enums]);
  const params = table.params.filter((p) => p.name.trim() !== "");

  return (
    <section className="ts-clause-trial ts-dyn-preview" aria-label="미리보기">
      <h2 className="ts-clause-sec">
        미리보기
        <InfoTip text={NOTE} />
      </h2>
      <div className="ts-trial-inputs">
        {params.map((p, i) => (
          <div key={p.name} className="ts-form-row">
            <label htmlFor={`dyn-arg-${i}`}>인자 {p.name}</label>
            <ArgValueField id={`dyn-arg-${i}`} param={p} value={values[p.name]} enums={enums} onChange={(next) => setValues({ ...values, [p.name]: next })} />
          </div>
        ))}
      </div>
      <table className="ts-table ts-dyn-sample" aria-label="표본 급부">
        <thead>
          <tr>
            <th>{FIELD_LABEL.subCoverageName}</th>
            <th>{FIELD_LABEL.benefitName}</th>
            <th className="col-num">지급률</th>
            <th>감액 구간</th>
            <th className="col-num">이후 지급률</th>
            <th className="col-act">
              <IconButton icon={<IconPlusCircle />} label="표본 급부 추가" onClick={() => setRows([...rows, EMPTY_ROW])} />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input aria-label={`표본 ${i + 1} 세부보장명`} placeholder="(급부명과 같음)" value={r.sub} onChange={(e) => patch(i, { sub: e.target.value })} />
              </td>
              <td>
                <input aria-label={`표본 ${i + 1} 급부명`} placeholder="예: 질병80%이상후유장해" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
              </td>
              <td className="col-num">
                <input aria-label={`표본 ${i + 1} 지급률`} inputMode="decimal" value={r.rate} onChange={(e) => patch(i, { rate: e.target.value })} />
              </td>
              <td>
                <input aria-label={`표본 ${i + 1} 감액 구간`} placeholder="12:50, 36:80" value={r.reduction} onChange={(e) => patch(i, { reduction: e.target.value })} />
              </td>
              <td className="col-num">
                <input aria-label={`표본 ${i + 1} 이후 지급률`} inputMode="decimal" value={r.after} onChange={(e) => patch(i, { after: e.target.value })} />
              </td>
              <td className="col-act">
                <IconButton icon={<IconMinusCircle />} danger label={`표본 ${i + 1} 삭제`} onClick={() => setRows(rows.filter((_r, idx) => idx !== i))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ts-trial-out" aria-label="펼친 표">
        {out.empty ? (
          <p className="ts-muted">표본 급부를 더하면 표가 펼쳐진다</p>
        ) : (
          <table className="ts-table ts-dyn-expanded">
            <thead>
              <tr>
                {out.header.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {out.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {out.issues.length > 0 && (
          <ul className="ts-clause-warnings" aria-label="미리보기 문제">
            {out.issues.map((m) => (
              <li key={m} className="ts-warn">
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
