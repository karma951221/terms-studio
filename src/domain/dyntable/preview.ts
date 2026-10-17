/**
 * 동적표 미리보기 (순수) — 기능/동적표 §4.2 「미리보기」. 표본 급부(급부명 · 지급률 · 감액 구간 · 세부보장명)와 인자 값으로 정의를 펼쳐 글 표로 만든다.
 *
 * - 인자 값은 상수 연결로 — `expandDynTable` 이 `arg.X` 슬롯 · 조건을 리터럴로 바꿔 쓴다. 값을 주지 않은 인자는 연결되지 않은 채(argUnbound) 남고
 *   그 슬롯은 「〔arg.X〕」 로 드러난다(막지 않는다 — 미리보기는 저장과 무관).
 * - 남은 인라인(글 · 조건 · 값별 분기 · 조사)은 작은 평가 문맥으로 푼다 — `count(builtin.subCoverage.name)` 은 표본의 세부보장명 개수(서로 다른 이름 수).
 *   그 밖의 참조는 미결로 보고 그 가지를 거짓으로 둔다(사유는 `issues`).
 * - 조립(Walker)과 같은 펼침 규칙을 쓰되 화면 글만 돌려준다 — 노드 id · 좌표는 싣지 않는다.
 *
 * DB·React import 금지 (순수층).
 */
import type { EnumDef } from "../catalog";
import type { ConstFormatter } from "../clause/bind";
import type { Inline } from "../clause/nodes";
import type { Binding, Bindings, ParamDef } from "../clause/params";
import { chooseParticle } from "../document/particles";
import { evaluate, parse, type EvalContext } from "../expression";
import { entered, type Code, type Value } from "../types";
import { expandDynTable } from "./expand";
import { DYN_TABLE_SLOT_LABEL, isDynTableSlotRef, type DynBenefit, type DynTable, type NewDynTable } from "./types";

export interface DynTableSample {
  /** 표본 급부 — 트리 순(세부보장 순 → 급부 순)으로 준다. */
  benefits: DynBenefit[];
}

/** 인자 이름 → 시험 값. undefined · 없음 = 연결하지 않음. */
export type DynTableArgValues = Record<string, Value | undefined>;

export interface DynTablePreview {
  /** `[구분 칸 머리글, 열1 머리글 .. 열N 머리글]`. */
  header: string[];
  /** 행마다 `[급부명, 셀1 .. 셀N]`. */
  rows: string[][];
  /** 펼침 · 평가 문제(연결 안 된 인자 · 미입력 지급률 · 묶기 충돌 · 평가 불가 조건) — 중복 없이. */
  issues: string[];
}

/** 인자 값 → 상수 연결. 스칼라만(목록값은 상수 연결이 없다 — 그대로 미연결). */
function constBindings(params: readonly ParamDef[], values: DynTableArgValues): Bindings {
  const out: Bindings = {};
  for (const p of params) {
    const v = values[p.name];
    if (v === undefined || Array.isArray(v)) continue;
    if (typeof v === "string" && v === "") continue;
    const b: Binding = { kind: "const", value: v };
    out[p.name] = b;
  }
  return out;
}

/** 상수 글 — 열거값은 값 이름, 참거짓은 예 · 아니오, 나머지는 그대로. */
function formatterOf(enums: ReadonlyMap<Code, EnumDef> | undefined): ConstFormatter {
  return (value, param) => {
    if (typeof value === "boolean") return value ? "예" : "아니오";
    if (param.type.kind === "enum" && typeof value === "string") {
      const def = enums?.get(param.type.enumCode);
      return def?.values.find((v) => v.code === value)?.label ?? value;
    }
    return String(value);
  };
}

/** 표본의 담보 문맥 — 세부보장마다 문맥 하나(`builtin.subCoverage.name` 만 안다). */
function sampleContext(benefits: readonly DynBenefit[]): EvalContext {
  const names = [...new Set(benefits.map((b) => b.subCoverageName))];
  const child = (name: string): EvalContext => ({
    lookup: (ref) => (ref.kind === "builtin" && ref.level === "subCoverage" && ref.prop === "name" ? { kind: "slot", slot: entered(name) } : { kind: "undetermined" }),
    attribute: () => ({ kind: "undetermined" }),
    children: () => undefined,
  });
  return {
    lookup: () => ({ kind: "undetermined" }),
    attribute: () => ({ kind: "undetermined" }),
    children: (ref) => (ref.kind === "builtin" && ref.level === "subCoverage" ? names.map(child) : undefined),
  };
}

export function previewDynTable(def: NewDynTable | DynTable, sample: DynTableSample, argValues: DynTableArgValues, enums?: ReadonlyMap<Code, EnumDef>): DynTablePreview {
  const issues: string[] = [];
  const note = (m: string) => {
    if (!issues.includes(m)) issues.push(m);
  };
  const table: DynTable = { id: "preview", code: "preview", ...def };
  const bindings = constBindings(def.params, argValues);
  const expanded = expandDynTable(table, { benefits: sample.benefits }, bindings, { formatConst: formatterOf(enums), refId: "preview" });
  for (const i of expanded.issues) note(i.message.replace(/^동적표 preview — /, "").replace(/^동적표 preview 의 /, ""));

  const ctx = sampleContext(sample.benefits);
  const evalSrc = (src: string): Value | undefined => {
    const parsed = parse(src);
    if (!parsed.ok) {
      note(`식을 읽을 수 없습니다: ${src}`);
      return undefined;
    }
    const r = evaluate(parsed.value, ctx);
    if (r.kind === "value") return r.value;
    if (r.kind === "error") note(r.issue.message);
    else note(`${r.reason} 을(를) 미리보기 문맥에서 정할 수 없다 — 그 조건은 거짓으로 본다`);
    return undefined;
  };

  const render = (list: readonly Inline[], before = ""): string => list.reduce((acc, n) => acc + one(n, before + acc), "");
  const one = (n: Inline, before: string): string => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "slot": {
        if (isDynTableSlotRef(n.ref)) return `{${DYN_TABLE_SLOT_LABEL[n.ref]}}`; // 펼침이 글로 바꿨어야 한다 — 남았으면 드러낸다
        note(`${n.ref} 을(를) 미리보기 문맥에서 정할 수 없다 — 인자 값을 준다`);
        return `〔${n.ref}〕`;
      }
      case "inlineCond": {
        for (const br of n.branches) {
          if (br.when === undefined) return render(br.children, before);
          if (evalSrc(br.when) === true) return render(br.children, before);
        }
        return "";
      }
      case "inlineSwitch": {
        const v = evalSrc(n.on);
        if (typeof v !== "string") return "";
        const hit = n.cases.find((k) => k.values?.includes(v));
        if (!hit) {
          note(`값별 분기에 칸이 없는 값: ${v}`);
          return "";
        }
        return hit.empty ? "" : render(hit.children, before);
      }
      case "particle": {
        const { text, resolved } = chooseParticle(n.preset, before);
        if (!resolved) note(`조사 — 앞 글자로 받침을 판정할 수 없어 「${text}」로 병기했습니다`);
        return text;
      }
      default:
        return "";
    }
  };

  return {
    header: expanded.header.map((cell) => render(cell)),
    rows: expanded.rows.map((row) => row.cells.map((cell) => render(cell))),
    issues,
  };
}
