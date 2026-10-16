/**
 * 4단계 — 슬롯 치환. 값 참조 슬롯을 문자열로 바꾼다 (ResolvedDoc → SubstitutedDoc).
 *
 * ⚠ 값 포맷 규칙은 **임시**다 (도메인모델 §7 미결 · 기능/문면 §3.4):
 *   string · date 그대로 · number `toLocaleString('ko-KR')` · boolean 예/아니오 · enum 표시명 ·
 *   list<enum> 「, 」연결 · const 정의값(string). 파생은 값의 런타임 타입으로 같은 규칙.
 * 미입력·미부착·깨진 참조·미결은 오류 마커 (ADR-0004 — 조용한 빈칸 없음).
 */

import type { Discriminator, EnumDef } from "../catalog/types";
import { discriminatorResultType } from "../catalog/expression";
import { missingValueMessage, slotType } from "../catalog/values";
import { evaluate, parse, refPath, type ValueRef } from "../expression";
import { findMasterField, type MasterTree } from "../master";
import { inlineRepeatSeparator, type Code, type Coordinate, type FieldType, type Issue, type Value } from "../types";
import type { AssemblyContext } from "./context";
import type { ErrorNode, LoopTag, RArticle, RBulletList, RInline, RInlineRepeat, RItem, RParagraph, ResolvedDoc, RStatic, RSubitem, SInline, SubstitutedDoc } from "./types";
import { mapArticles } from "./walk";
import { chooseParticle, particlePreset } from "../document/particles";
import { titleKindMessage } from "../document/title";

export interface SubstituteEnv {
  catalog: ReadonlyMap<Code, Discriminator>;
  enums: ReadonlyMap<Code, EnumDef>;
  /** 값 자리를 정하는 마스터 트리. 기본은 MVP 정본. */
  master?: MasterTree;
}

export interface SubstituteOutcome {
  doc: SubstitutedDoc;
  issues: Issue[];
}

// ───────────────────────────── 포맷 (임시 규칙) ─────────────────────────────

export type Formatted = { ok: true; text: string } | { ok: false; issue: Issue };

function enumLabel(enums: ReadonlyMap<Code, EnumDef>, enumCode: Code, valueCode: Value, at: Coordinate): Formatted {
  const def = enums.get(enumCode);
  if (!def) return { ok: false, issue: { kind: "brokenRef", message: `enum ${enumCode} 이(가) 없습니다`, at } };
  const v = def.values.find((x) => x.code === valueCode);
  if (!v) return { ok: false, issue: { kind: "brokenRef", message: missingValueMessage(def, [String(valueCode)]), at } };
  return { ok: true, text: v.label };
}

/** 값 → 문자열. `type` 을 모르면(파생) 런타임 타입으로. table 은 조건식 전용 — 문면 치환에는 닿지 않아야 한다. */
export function formatValue(value: Value, type: FieldType | undefined, enums: ReadonlyMap<Code, EnumDef>, at: Coordinate): Formatted {
  if (type?.kind === "table") {
    return { ok: false, issue: { kind: "unsupported", message: "표 값은 조문에 넣을 수 없습니다", at } };
  }
  if (type?.kind === "enum" && typeof value === "string") return enumLabel(enums, type.enumCode, value, at);
  if (type?.kind === "list<enum>" && Array.isArray(value)) {
    const labels: string[] = [];
    // list<enum> 이 확인됐으니 요소는 enum 값 코드(string)다 — table 이 아니다.
    for (const code of value as string[]) {
      const r = enumLabel(enums, type.enumCode, code, at);
      if (!r.ok) return r;
      labels.push(r.text);
    }
    return { ok: true, text: labels.join(", ") };
  }
  if (Array.isArray(value)) return { ok: true, text: value.join(", ") };
  if (typeof value === "number") return { ok: true, text: value.toLocaleString("ko-KR") };
  if (typeof value === "boolean") return { ok: true, text: value ? "예" : "아니오" };
  return { ok: true, text: value };
}

/**
 * 참조의 값 자리 타입 — 마스터 필드는 마스터에서, 내장 경로는 string,
 * 구분자는 **식에서 추론한다** (ADR-0037 — 정의에 결과 타입 표기가 없다).
 * enum 결과를 표시명으로 찍으려면 어떤 열거형변수인지 알아야 하므로 여기서 추론이 필요하다.
 */
function typeOf(env: SubstituteEnv, ref: ValueRef): FieldType | undefined {
  if (ref.kind === "builtin") return { kind: "string" };
  if (ref.kind === "discriminator") {
    const def = env.catalog.get(ref.code);
    return def ? discriminatorResultType(def, env.master, env.catalog) : undefined;
  }
  const field = findMasterField(refPath(ref), env.master);
  return field ? slotType(field.level, field.path, env.master) : undefined;
}

// ───────────────────────────── 치환 ─────────────────────────────

class Substituter {
  readonly issues: Issue[] = [];
  constructor(
    private readonly ctx: AssemblyContext,
    private readonly env: SubstituteEnv,
  ) {}

  error(id: string, issue: Issue): ErrorNode {
    this.issues.push(issue);
    return { kind: "error", id, issue };
  }

  slot(n: RInline & { kind: "slot" }): SInline {
    const at = { ...n.at, refPath: n.ref };
    const parsed = parse(n.ref, at);
    if (!parsed.ok) {
      const issue: Issue = parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? parsed.rejection.issues[0] : { kind: "syntax", message: "슬롯 참조를 읽을 수 없습니다", at };
      return this.error(n.id, issue);
    }
    if (parsed.value.kind !== "ref" || parsed.value.ref.kind === "attr" || parsed.value.ref.kind === "param" || parsed.value.ref.kind === "local") {
      return this.error(n.id, { kind: "typeMismatch", message: "슬롯은 값 참조 경로 하나여야 합니다 (식 · 담보속성 · 연결 안 된 인자 불가)", at });
    }
    // 반복 표 행 안의 슬롯은 행 노드 문맥에서 (한정자 없는 참조 = 행 노드의 자기-또는-조상 — ADR-0070)
    // 블록 반복 안(세목 선택지 원천)의 슬롯은 그 종을 커서로 세운 문맥에서 (ADR-0077 — 종형명 · 세목 레벨 구분자)
    const base = n.row ? this.ctx.rows?.rowContext(n.row) : n.plan !== undefined ? this.ctx.plans?.context(n.plan) : this.ctx.eval;
    if (!base) return this.error(n.id, { kind: "brokenRef", message: n.row ? "반복 표 행 노드의 문맥을 만들 수 없습니다" : "반복의 현재 종 문맥을 만들 수 없습니다", at });
    const r = evaluate(parsed.value, { ...base, coordinate: n.at });
    if (r.kind === "error") return this.error(n.id, r.issue);
    if (r.kind === "undetermined") return this.error(n.id, this.ctx.explainUndetermined(r.reason, n.at));
    const f = formatValue(r.value, typeOf(this.env, parsed.value.ref), this.env.enums, at);
    if (!f.ok) return this.error(n.id, f.issue);
    return { kind: "text", id: n.id, text: f.text };
  }

  inlines(list: readonly RInline[]): SInline[] {
    return list.flatMap((n) => (n.kind === "slot" ? [this.slot(n)] : n.kind === "inlineRepeat" ? this.repeatInline(n) : [n]));
  }

  /**
   * 인라인 반복 묶음 → 인라인 (문면 §3.12, 2026-10-17 사용자 결정) — 원소마다 슬롯을 글로 바꾼 뒤 **같은 글은 첫 번째만** 남기고(순서 유지)
   * 남은 개수로 쉼표 · 마지막 앞 연결어를 잇는다. 오류가 든 원소는 거르지 않는다. 조 제목도 이 길이라 조 머리 · 참조 라벨 · 목차에 같이 선다.
   */
  repeatInline(n: RInlineRepeat): SInline[] {
    const seen = new Set<string>();
    const kept = n.elements.map((e) => this.inlines(e)).filter((e) => {
      const key = foldedKey(e);
      if (key === undefined) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return kept.flatMap((e, i) => (i === 0 ? e : [{ kind: "text" as const, id: `${n.id}~sep${i}`, text: inlineRepeatSeparator(n.connector ?? ",", i, kept.length) }, ...e]));
  }

  subitem(n: RSubitem<RInline>): RSubitem<SInline> {
    return { ...n, children: this.inlines(n.children) };
  }

  item(n: RItem<RInline>): RItem<SInline> {
    return {
      kind: "item",
      id: n.id,
      ...keyedOf(n),
      children: this.inlines(n.children),
      ...(n.subitems ? { subitems: n.subitems.map((s) => (s.kind === "error" ? s : s.kind === "bulletList" ? this.bullets(s) : this.subitem(s))) } : {}),
    };
  }

  bullets(n: RBulletList<RInline>): RBulletList<SInline> {
    return { ...n, items: n.items.map((b) => ({ id: b.id, children: this.inlines(b.children) })) };
  }

  /** 표 셀 · 박스 줄 · 글머리 목록 항목 안의 슬롯도 치환한다. */
  static(n: RStatic<RInline>): RStatic<SInline> {
    if (n.kind === "box") return { ...n, lines: n.lines.map((line) => this.inlines(line)) };
    if (n.kind === "bulletList") return this.bullets(n);
    return { ...n, rows: n.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => this.inlines(cell)) })) };
  }

  paragraph(n: RParagraph<RInline>): RParagraph<SInline> {
    return {
      kind: "paragraph",
      id: n.id,
      ...keyedOf(n),
      ...(n.restart ? { restart: true as const } : {}),
      children: this.inlines(n.children),
      ...(n.items ? { items: n.items.map((it) => (it.kind === "item" ? this.item(it) : it.kind === "error" ? it : this.static(it))) } : {}),
      ...(n.excludeFromComparison ? { excludeFromComparison: true } : {}),
    };
  }

  article(n: RArticle<RInline>): RArticle<SInline> {
    const { heading, ...rest } = n;
    return {
      ...rest,
      ...(heading ? { title: this.title(this.inlines(heading)) } : {}),
      children: n.children.map((p) => (p.kind === "paragraph" ? this.paragraph(p) : p.kind === "error" ? p : this.static(p))),
    };
  }

  /**
   * 치환한 제목 인라인 → 글 (ADR-0088). 조사는 렌더와 같은 앞 글 규칙(판정 불가면 병기 + 경고). 오류 마커는 그 자리를 비운다 —
   * 원인은 이미 오류로 쌓였다. 제목에 설 수 없는 참조(저장 검사가 막는 꼴)는 구조 오류.
   */
  title(list: readonly SInline[]): string {
    let out = "";
    let afterError = false;
    for (const n of list) {
      const wasError = afterError;
      afterError = n.kind === "error";
      if (n.kind === "text") out += n.text;
      else if (n.kind === "particle") {
        // 바로 앞이 오류면 판정할 글이 없다 — 렌더의 조사 규칙과 같다
        const chosen = chooseParticle(n.preset, wasError ? "" : out);
        if (!chosen.resolved) this.issues.push({ kind: "particleUnresolved", severity: "warning", message: `조사 「${particlePreset(n.preset).label}」 — 앞 글자로 받침을 판정할 수 없어 「${chosen.text}」로 병기했습니다`, at: n.at });
        out += chosen.text;
      } else if (n.kind === "articleRef" || n.kind === "appendixRef") {
        this.issues.push({ kind: "structure", message: titleKindMessage(n.kind), at: n.at });
      }
    }
    return out;
  }
}

export function substituteSlots(doc: ResolvedDoc, ctx: AssemblyContext, env: SubstituteEnv): SubstituteOutcome {
  const s = new Substituter(ctx, env);
  return { doc: mapArticles(doc, (a) => s.article(a)), issues: s.issues };
}

/**
 * 원소의 접힌 글 열쇠 — 글은 글 그대로, 조 참조 · 별표 참조 · 조사는 렌더가 정하는 글이라 대상 · 프리셋으로 대신한다
 * (같은 대상 · 같은 앞 글이면 같은 글). 오류가 들었으면 `undefined` — 거르지 않는다.
 */
function foldedKey(list: readonly SInline[]): string | undefined {
  let key = "";
  for (const n of list) {
    if (n.kind === "error") return undefined;
    if (n.kind === "text") key += n.text;
    else if (n.kind === "particle") key += `\u0000p:${n.preset}\u0000`;
    else if (n.kind === "appendixRef") key += `\u0000b:${n.appendixCode}\u0000`;
    else key += `\u0000a:${JSON.stringify([n.targets, n.within ?? null, n.connector ?? null, n.scope])}\u0000`;
  }
  return key;
}

/** 참조 열쇠 · 반복 원소 표지 · 블록 묶음 (`Keyed`) — 단계를 건너도 그대로 싣는다. */
function keyedOf(n: { key?: string; loops?: LoopTag[]; groups?: string[] }): { key?: string; loops?: LoopTag[]; groups?: string[] } {
  return { ...(n.key !== undefined ? { key: n.key } : {}), ...(n.loops ? { loops: n.loops } : {}), ...(n.groups ? { groups: n.groups } : {}) };
}
