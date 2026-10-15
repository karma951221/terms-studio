/**
 * 함수조항 단독 시험 (순수) — 기능/함수조항 §3.7 「함수조항 화면에서 시험한다」 (2026-10-15 사용자 결정: 오른쪽 단 「시험」 탭).
 *
 * 인자마다 시험 값을 넣고 옵션을 골라 그 자리에서 펼친 출력을 본다. 상품 · 사용처 없이 — 시험 문맥을 만들어 조립과 같은 길을 탄다:
 * `applyBindings`(인자 → 시험 구분자 · 내부 변수 평가) → `resolveOptions` → `expandClause` → 조건 · 값별 분기 · 슬롯을 시험 값으로 평가.
 * - 값 인자는 시험 전용 구분자 코드(`TRIAL1` …)로 연결하고 평가 문맥이 그 값을 돌려준다(목록 · 열거값 · 상수 모두 한 길).
 * - 세목 선택지 목록 인자는 **가상 원소 하나**(그 세목 폼 필드 값 — 예: 납입면제 「종 하나 + 사유 다중 체크」) — 반복의 현재 종처럼 댄다.
 * - 조 참조(사용처 · 보통약관 · 이 함수조항)는 번호 대신 자리표시. 별표 · 박스도 이름 자리표시.
 * - 시험 값은 저장하지 않는다(화면 상태). 문제(칸 없는 값 · 미입력 · 담보속성)는 막지 않고 `issues` 줄로 돌려준다.
 */
import type { EnumDef } from "../catalog/types";
import { paragraphLabel, itemLabel, subitemLabel } from "../document/numbering";
import { chooseParticle, particlePreset } from "../document/particles";
import { evaluate, parse, type EvalContext, type ExprType, type LookupResult } from "../expression";
import { formsOfLevel, fieldsOfForm } from "../master";
import { entered, NOT_ENTERED } from "../types";
import type { Code, Value } from "../types";
import { applyBindings, plainConst } from "./bind";
import type { LocalEnv } from "./locals";
import type { Block, Inline, ItemBodyNode, SubitemBodyNode } from "./nodes";
import type { Bindings, ParamDef } from "./params";
import { expandClause, resolveOptions } from "./reference";
import type { Clause, ClauseBody, OptionSelection } from "./types";

export interface TrialInput {
  /** 값 인자 이름 → 시험 값(참거짓 · 문자 · 숫자 · 날짜 `YYYY-MM-DD` · 열거값 코드 · 열거값 코드 목록). 없으면 미입력. */
  values: Record<string, Value | undefined>;
  /** 세목 선택지 목록 인자 이름 → 가상 원소 하나의 필드 값(필드 키 → 값). */
  plans?: Record<string, Record<string, Value>>;
  options: OptionSelection;
}

export interface TrialDeps {
  enums: ReadonlyMap<Code, EnumDef>;
  boxName?: (code: Code) => string | undefined;
  appendixName?: (code: Code) => string | undefined;
}

export interface TrialLine {
  kind: "inline" | "paragraph" | "item" | "subitem" | "bullet" | "box";
  label: string;
  text: string;
}

export interface TrialOutcome {
  lines: TrialLine[];
  issues: string[];
}

const TRIAL_LOOP = "trial:";
const PARAM_TARGET = "trial-param:";

/** 처음 시험 값 — 참거짓 아니오 · 열거값 첫 값 · 목록 비움 · 문자 빈 글 · 숫자 0 · 날짜 오늘이 아닌 빈 칸(미입력) · 가상 원소(참거짓 예 · 목록 비움) · 옵션 첫 선택지. */
export function trialDefaults(clause: Clause, enums: ReadonlyMap<Code, EnumDef>): Required<TrialInput> {
  const values: Record<string, Value | undefined> = {};
  const plans: Record<string, Record<string, Value>> = {};
  for (const p of clause.params ?? []) {
    switch (p.type.kind) {
      case "boolean":
        values[p.name] = false;
        break;
      case "string":
        values[p.name] = "";
        break;
      case "number":
        values[p.name] = 0;
        break;
      case "enum": {
        const first = enums.get(p.type.enumCode)?.values[0]?.code;
        if (first !== undefined) values[p.name] = first;
        break;
      }
      case "list<enum>":
        values[p.name] = [];
        break;
      case "planOptions": {
        const form = formsOfLevel("plan").find((f) => f.key === (p.type as { form: Code }).form);
        const fields: Record<string, Value> = {};
        for (const x of form ? fieldsOfForm(form) : []) {
          if (x.field.type.kind === "boolean") fields[x.field.key] = true;
          else if (x.field.type.kind === "list<enum>") fields[x.field.key] = [];
        }
        plans[p.name] = fields;
        break;
      }
      default:
        break; // 날짜 — 빈 칸(미입력), 조 참조 — 값이 없다
    }
  }
  const options: OptionSelection = {};
  for (const o of clause.options) if (o.values[0]) options[o.code] = o.values[0].code;
  return { values, plans, options };
}

function enumLabel(enums: ReadonlyMap<Code, EnumDef>, type: ExprType | ParamDef["type"], code: string): string {
  return "enumCode" in type ? (enums.get(type.enumCode)?.values.find((v) => v.code === code)?.label ?? code) : code;
}

/** 값 → 글 — 조립 값 표기(숫자 천 단위 · 참거짓 예/아니오 · 열거값 표시명, 목록은 「 · 」). */
function valueText(v: Value, type: ExprType | ParamDef["type"] | undefined, enums: ReadonlyMap<Code, EnumDef>): string {
  if (Array.isArray(v)) return v.map((x) => valueText(x as Value, type, enums)).join(" · ");
  if (typeof v === "string" && type && "enumCode" in type) return enumLabel(enums, type, v);
  return plainConst(v as string | number | boolean);
}

export function runTrial(clause: Clause, input: TrialInput, deps: TrialDeps): TrialOutcome {
  const issues: string[] = [];
  const note = (m: string) => {
    if (!issues.includes(m)) issues.push(m);
  };
  const params = clause.params ?? [];
  const codeOf = new Map<string, string>();
  const typeOfCode = new Map<string, ParamDef["type"]>();
  const bindings: Bindings = {};
  const refBindings: Bindings = {};
  params.forEach((p, i) => {
    if (p.type.kind === "articleRef") {
      refBindings[p.name] = { kind: "articleRef", targets: [{ articleId: `${PARAM_TARGET}${p.name}` }], scope: "self" };
      return;
    }
    if (p.type.kind === "planOptions") {
      bindings[p.name] = { kind: "current", loop: `${TRIAL_LOOP}${p.name}` };
      return;
    }
    const code = `TRIAL${i + 1}`;
    codeOf.set(p.name, code);
    typeOfCode.set(code, p.type);
    bindings[p.name] = { kind: "discriminator", code };
  });

  const nameOfCode = new Map([...codeOf].map(([n, c]) => [c, n] as const));
  const ctx: EvalContext = {
    lookup: (ref): LookupResult => {
      if (ref.kind === "discriminator" && nameOfCode.has(ref.code)) {
        const v = input.values[nameOfCode.get(ref.code)!];
        return { kind: "slot", slot: v === undefined || (typeof v === "string" && v === "" && typeOfCode.get(ref.code)?.kind === "date") ? NOT_ENTERED : entered(v) };
      }
      return { kind: "missing", issue: "brokenRef" };
    },
    attribute: () => ({ kind: "undetermined" }),
    children: () => undefined,
  };
  /** 가상 원소 하나 — 그 세목 폼 필드 값, 세목 이름은 「시험 종」. */
  const planContext = (name: string, form: Code): EvalContext => ({
    lookup: (ref): LookupResult => {
      if (ref.kind === "master" && ref.form === form) {
        const v = input.plans?.[name]?.[ref.field];
        return { kind: "slot", slot: v === undefined ? NOT_ENTERED : entered(v) };
      }
      if (ref.kind === "builtin" && ref.level === "plan") return { kind: "slot", slot: entered("시험 종") };
      return ctx.lookup(ref);
    },
    attribute: () => ({ kind: "undetermined" }),
    children: () => undefined,
  });
  const env: LocalEnv = {
    ctx,
    enums: deps.enums,
    text: (v, type) => valueText(v, type, deps.enums),
    current: (loop) => {
      if (!loop.startsWith(TRIAL_LOOP)) return undefined;
      const name = loop.slice(TRIAL_LOOP.length);
      const p = params.find((x) => x.name === name);
      return p?.type.kind === "planOptions" ? { kind: "options", form: p.type.form, contexts: [planContext(name, p.type.form)] } : undefined;
    },
  };

  const bound = applyBindings(clause, bindings, (v) => plainConst(v), {}, env);
  if (!bound.ok) {
    for (const i of bound.rejection.reason === "invalid" ? bound.rejection.issues : []) note(i.message);
    if (issues.length === 0) note("시험 값으로 펼 수 없습니다");
    return { lines: [], issues };
  }
  const { selection, issues: optionIssues } = resolveOptions(bound.value, input.options);
  if (optionIssues.length > 0) return { lines: [], issues: optionIssues.map((i) => i.message) };
  const expanded = expandClause(bound.value, selection, "trial", refBindings);
  if (!expanded.ok) return { lines: [], issues: expanded.rejection.reason === "invalid" ? expanded.rejection.issues.map((i) => i.message) : ["펼 수 없습니다"] };

  // ── 평가 ──
  const evalSrc = (src: string): Value | undefined => {
    const parsed = parse(src);
    if (!parsed.ok) {
      note(`식을 읽을 수 없습니다: ${src}`);
      return undefined;
    }
    const r = evaluate(parsed.value, ctx);
    if (r.kind === "value") return r.value;
    if (r.kind === "error") note(r.issue.message.replace(/TRIAL\d+/g, (c) => `arg.${nameOfCode.get(c) ?? c}`));
    else note(r.reason.startsWith("attr.") ? `담보속성(${r.reason})은 시험에서 정하지 않는다 — 그 조건은 거짓으로 본다` : `${r.reason} 을(를) 시험 문맥에서 정할 수 없다`);
    return undefined;
  };
  /** 가지 고르기 — 참인 첫 가지(없으면 else). */
  const pickBranch = <C>(branches: readonly { when?: string; children: C[] }[]): C[] => {
    for (const br of branches) {
      if (br.when === undefined) return br.children;
      if (evalSrc(br.when) === true) return br.children;
    }
    return [];
  };
  /** 칸 고르기 — 대상 값이 든 칸, 없으면 문제 줄. */
  const pickCase = <C>(on: string, cases: readonly { values?: Code[]; empty?: true; children: C[] }[]): C[] => {
    const v = evalSrc(on);
    if (typeof v !== "string") return [];
    const hit = cases.find((k) => k.values?.includes(v));
    if (!hit) {
      note(`값별 분기에 칸이 없는 값: ${v}`);
      return [];
    }
    return hit.empty ? [] : hit.children;
  };

  /** 인라인 목록 → 글. 조사 칩은 앞서 찍힌 글(`before` — 감싼 문장 안 조건 앞의 글까지)로 고른다 (기능/문면 §3.11). */
  const inlineText = (list: readonly Inline[], before = ""): string => list.reduce((acc, n) => acc + inline(n, before + acc), "");
  const inline = (n: Inline, before: string): string => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "slot": {
        const v = evalSrc(n.ref);
        if (v === undefined) return `〔${n.ref.replace(/TRIAL\d+/g, (c) => `arg.${nameOfCode.get(c) ?? c}`)}〕`;
        return valueText(v, typeOfCode.get(n.ref.trim()), deps.enums);
      }
      case "inlineCond":
        return inlineText(pickBranch(n.branches), before);
      case "inlineSwitch":
        return inlineText(pickCase(n.on, n.cases), before);
      case "articleRef": {
        const target = n.targets[0]?.articleId ?? "";
        if (target.startsWith(PARAM_TARGET)) return `⟨${target.slice(PARAM_TARGET.length)}⟩`;
        return n.scope === "clause" ? "〔이 함수조항 제○항〕" : "〔보통약관 제○조〕";
      }
      case "appendixRef":
        return `〔별표 ${deps.appendixName?.(n.appendixCode) ?? n.appendixCode}〕`;
      case "optionSlot":
        return ""; // 펼치기가 이미 선택지 문구로 바꿨다
      case "particle": {
        const { text, resolved } = chooseParticle(n.preset, before);
        if (!resolved) note(`조사 「${particlePreset(n.preset).label}」 — 앞 글자로 받침을 판정할 수 없어 「${text}」로 병기했습니다`);
        return text;
      }
    }
  };

  const lines: TrialLine[] = [];
  const box = (code: Code) => lines.push({ kind: "box", label: "", text: `〔박스 ${deps.boxName?.(code) ?? code}〕` });
  const bullets = (children: readonly { children: Inline[] }[]) => {
    for (const b of children) lines.push({ kind: "bullet", label: "-", text: inlineText(b.children) });
  };
  type SubitemLike = SubitemBodyNode;
  const subitems = (list: readonly SubitemLike[], n = { v: 0 }) => {
    for (const s of list) {
      if (s.kind === "condBlock") subitems(pickBranch(s.branches), n);
      else if (s.kind === "switchBlock") subitems(pickCase(s.on, s.cases), n);
      else lines.push({ kind: "subitem", label: subitemLabel(++n.v), text: inlineText(s.children) });
    }
  };
  const items = (list: readonly ItemBodyNode[], n = { v: 0 }) => {
    for (const it of list) {
      if (it.kind === "condBlock") items(pickBranch(it.branches), n);
      else if (it.kind === "switchBlock") items(pickCase(it.on, it.cases), n);
      else if (it.kind === "bulletList") bullets(it.children);
      else if (it.kind === "boxRef") box(it.boxCode);
      else {
        lines.push({ kind: "item", label: itemLabel(++n.v), text: inlineText(it.children) });
        if (it.subitems) subitems(it.subitems);
      }
    }
  };
  const blocks = (list: readonly Block[], n = { v: 0 }) => {
    for (const b of list) {
      if (b.kind === "condBlock") blocks(pickBranch(b.branches), n);
      else if (b.kind === "switchBlock") blocks(pickCase(b.on, b.cases), n);
      else if (b.kind === "bulletList") bullets(b.children);
      else if (b.kind === "boxRef") box(b.boxCode);
      else {
        if (b.restart) n.v = 0;
        lines.push({ kind: "paragraph", label: paragraphLabel(++n.v), text: inlineText(b.children) });
        if (b.items) items(b.items);
      }
    }
  };

  const body: ClauseBody = expanded.value;
  if (clause.mode === "inline") lines.push({ kind: "inline", label: "", text: inlineText(body as Inline[]) });
  else if (clause.mode === "block") blocks(body as Block[]);
  else if (clause.mode === "item") items(body as ItemBodyNode[]);
  else subitems(body as SubitemBodyNode[]);
  return { lines, issues };
}
