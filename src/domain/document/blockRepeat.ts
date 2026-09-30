/**
 * 블록 반복 (순수) — 최종 결정 10 · 11 · 23 · [[기능/문면/결정/ADR-0077-블록반복-세목선택지-열거목록-반복참조]] · 기능/문면 §3.7.
 *
 * 반복 블록(`forBlock`)은 조 자리 · 항의 호 목록 자리에 서서 본문을 원천의 원소마다 복제한다. 원천은 셋이다.
 *
 * | 원천 | 원소 | 납입면제의 쓰임 |
 * |---|---|---|
 * | `planOptions` 세목 선택지 | 세목 범위 안 한 세목 폼의 선택지 중 거름(그 폼 필드만 읽는 참거짓 식)이 참인 것 | 「납입면제종마다」 = waiver · 적용여부 = 예 |
 * | `listOfCurrent` 바깥 현재 원소의 목록 | 바깥 반복의 현재 종이 가진 목록값(복수) — 열거형 순서 | 「사유마다」 |
 * | `union` 목록값의 합집합 | 거른 선택지들의 목록값 합집합(같은 값 한 번 · 열거형 순서) ∩ 열거값 필드 거름 | 정의 조 = 사유 합집합 ∩ 정의조대상 = 예 |
 *
 * - **한 단계 중첩** — 반복 안에 반복 하나. 안쪽 원천은 바깥 현재 원소의 목록뿐이고, 목록 원천은 안쪽에서만 선다.
 * - **현재 원소만 읽는다** — 서수 · 개수 조건 없음. 현재 원소를 함수조항에 넘기는 것은 인자 연결 `{ kind: "current", loop }`(params.ts).
 *   종 원소 → 세목 선택지 목록 인자(종 하나짜리 목록), 열거값 원소 → enum 인자. 문면의 조건 · 슬롯은 반복 안에서 **그 종의 세목 커서**로 평가된다
 *   (예: `builtin.plan.name` = 종형명 · 세목 레벨 구분자).
 * - **복제 id · 코드 합성** (`cloneForElement`) — 복제본의 노드 · 가지 id 와 항 · 호 · 목 · 함수조항 참조의 P코드 끝에 `@원소`를 붙인다
 *   (원소 = 종이면 세목 선택지 id, 열거값이면 값 코드). 중첩이면 바깥 → 안쪽 순서로 두 번(`P0100@종@V01`), 함수조항 펼치기의 `/` 는 그 **뒤**다
 *   (`참조id@종@V01/안쪽id` · 열쇠 `P0300@종@V01/P0100`). 조 참조의 대상 코드 · 연결의 반복 id 는 바꾸지 않는다 — 원 id 는 `templateIdOf`(첫 `@` 앞).
 *   반복으로 생긴 노드를 가리키는 참조(반복 블록 · 값 한정)는 이 열쇠 위에서 P12 가 푼다.
 * - 원소 0 이면 블록을 펼치지 않는다. 펼친 뒤 항이 0 인 조는 빈 조 빼기가 조째 뺀다(결정 15).
 *
 * DB · React import 금지.
 */

import { enumFieldValue } from "../catalog/fields";
import type { EnumDef } from "../catalog/types";
import type { Clause } from "../clause/types";
import { checkPlanOptionFilter, type LoopElementType } from "../clause/params";
import { parse, refPath, type Expr, type ExprType, type Ref, type TypeResolver } from "../expression";
import { findMasterField, formsOfLevel, MASTER, type MasterTree } from "../master";
import type { Code, Coordinate, Id, Issue } from "../types";
import { coordinateOf, indexTree, type DocumentNode, type ForBlockNode, type NodeEntry, type TreeIndex } from "./nodes";
import { clauseCodeEntries, withClauseCodes } from "../clause/pcode";
import { missingValueMessage } from "../catalog/values";
import { CODED_KINDS, nodesOfTarget, refKey } from "./pcode";

// ───────────────────────────── 모델 ─────────────────────────────

/** 세목 선택지 원천 — 세목 폼 + 거름(그 폼 필드만 읽는 참거짓 식, 비면 선택지 전부). 인자의 원천 연결과 같은 모양(§7-2). */
export interface PlanOptionsRepeatSource {
  kind: "planOptions";
  form: Code;
  filter?: string;
}

/** 바깥 반복의 현재 원소(종)가 가진 목록값(복수) — `field` 는 바깥 원천 폼의 필드 키. */
export interface ListOfCurrentRepeatSource {
  kind: "listOfCurrent";
  loop: Id;
  field: Code;
}

/** 거른 세목 선택지들의 목록값 합집합(같은 값 한 번) ∩ 열거값 필드 거름(`where` — 필드 키 = 값). */
export interface UnionRepeatSource {
  kind: "union";
  form: Code;
  filter?: string;
  field: Code;
  where?: { field: Code; value: string | boolean };
}

export type RepeatSource = PlanOptionsRepeatSource | ListOfCurrentRepeatSource | UnionRepeatSource;

/** 반복 깊이 한도 — 반복 안 반복 하나 (ADR-0077 결정 4). */
export const REPEAT_MAX_DEPTH = 2;

export function isRepeatSource(x: unknown): x is RepeatSource {
  if (typeof x !== "object" || x === null) return false;
  const k = (x as { kind?: unknown }).kind;
  return k === "planOptions" || k === "listOfCurrent" || k === "union";
}

export interface RepeatEnv {
  master?: MasterTree;
  /** 열거형 정의 — 합집합 거름 필드 · 교차 검사 · 이름. 없으면 그 검사는 건너뛴다. */
  enumOf?: (code: Code) => EnumDef | undefined;
}

function listFieldEnum(form: Code, field: Code, master: MasterTree): Code | undefined {
  const f = findMasterField(`${form}.${field}`, master);
  const t = f?.field.type;
  return f && f.level === "plan" && t?.kind === "list<enum>" ? t.enumCode : undefined;
}

/**
 * 원천의 원소 타입 — 세목 선택지면 종(세목 선택지 목록<폼>), 목록 · 합집합이면 열거값(그 필드의 열거형).
 * 목록 원천은 바깥 원천(`outer`)의 폼 필드를 읽는다. 풀 수 없으면 undefined(원천 검사가 오류를 낸다).
 */
export function loopElementType(source: RepeatSource, outer: RepeatSource | undefined, master: MasterTree = MASTER): LoopElementType | undefined {
  switch (source.kind) {
    case "planOptions":
      return { kind: "planOptions", form: source.form };
    case "listOfCurrent": {
      if (outer?.kind !== "planOptions") return undefined;
      const enumCode = listFieldEnum(outer.form, source.field, master);
      return enumCode ? { kind: "enum", enumCode } : undefined;
    }
    case "union": {
      const enumCode = listFieldEnum(source.form, source.field, master);
      return enumCode ? { kind: "enum", enumCode } : undefined;
    }
  }
}

/** 노드(색인 항목)를 감싼 반복 블록들 — 바깥 → 안쪽, 자기 자신 제외. */
export function enclosingLoops(ix: TreeIndex, e: Pick<NodeEntry, "path" | "node">): ForBlockNode[] {
  const out: ForBlockNode[] = [];
  for (const id of e.path) {
    if (id === e.node.id) continue;
    const n = ix.nodes.get(id)?.node;
    if (n?.kind === "forBlock") out.push(n);
  }
  return out;
}

/** 자리를 감싼 반복 블록 id → 현재 원소 타입 — 인자 연결 검사(`BindingEnv.loops`)의 재료. */
export function loopTypesAt(ix: TreeIndex, e: Pick<NodeEntry, "path" | "node">, master: MasterTree = MASTER): Map<Id, LoopElementType> {
  const out = new Map<Id, LoopElementType>();
  const loops = enclosingLoops(ix, e);
  loops.forEach((f, i) => {
    if (!isRepeatSource(f.source)) return;
    const t = loopElementType(f.source, i > 0 && isRepeatSource(loops[i - 1].source) ? loops[i - 1].source : undefined, master);
    if (t) out.set(f.id, t);
  });
  return out;
}

// ───────────────────────────── 원천 검사 ─────────────────────────────

/**
 * 반복 블록 원천 검사 (저장) — `outers` = 이 블록을 감싼 반복들(바깥 → 안쪽).
 * 원천 없음 · 세목 폼 아님 · 거름(그 폼 필드만 · 참거짓) · 안쪽 원천은 바로 바깥 반복의 현재 원소의 목록뿐 · 목록 필드는 목록값(복수) · 합집합 거름 필드.
 */
export function checkRepeatSource(node: ForBlockNode, outers: readonly ForBlockNode[], env: RepeatEnv, at: Coordinate): Issue[] {
  const master = env.master ?? MASTER;
  const source: unknown = node.source;
  const fail = (kind: Issue["kind"], message: string, refPath?: string): Issue[] => [{ kind, message, at: { ...at, ...(refPath !== undefined ? { refPath } : {}) } }];
  if (!isRepeatSource(source)) return fail("structure", "반복 블록의 원천을 고른다 — 세목 선택지 · 바깥 반복의 현재 원소의 목록 · 목록값의 합집합");
  const outer = outers.at(-1);
  if (outer && source.kind !== "listOfCurrent") {
    return fail("structure", "안쪽 반복의 원천은 바깥 반복의 현재 원소의 목록뿐입니다 — 「현재 종의 사유마다」처럼 고른다 (ADR-0077 결정 4)");
  }
  const planForm = (form: Code) => formsOfLevel("plan", master).find((f) => f.key === form);
  switch (source.kind) {
    case "planOptions":
    case "union": {
      if (!planForm(source.form)) return fail("typeMismatch", `반복 원천 폼 ${source.form} 은(는) 세목 폼이 아닙니다`, source.form);
      const filterIssues = checkPlanOptionFilter(source, master, at, "반복 원천");
      if (filterIssues.length > 0) return filterIssues;
      if (source.kind === "planOptions") return [];
      const enumCode = listFieldEnum(source.form, source.field, master);
      if (!enumCode) return fail("typeMismatch", `합집합 원천 필드 ${source.form}.${source.field} 은(는) 목록값(복수) 필드가 아닙니다`, `${source.form}.${source.field}`);
      if (source.where) {
        const def = env.enumOf?.(enumCode);
        if (def && !(def.fields ?? []).some((f) => f.key === source.where!.field)) {
          return fail("brokenRef", `합집합 거름 필드 ${source.where.field} 이(가) 열거형 ${enumCode} 에 없습니다`, source.where.field);
        }
      }
      return [];
    }
    case "listOfCurrent": {
      if (!outer || outer.id !== source.loop) return fail("structure", "현재 원소의 목록 원천은 바로 바깥 반복의 현재 원소만 읽습니다 — 바깥 반복 블록 안에 둔다");
      if (!isRepeatSource(outer.source) || outer.source.kind !== "planOptions") return fail("structure", "현재 원소의 목록 원천은 바깥 반복이 세목 선택지(종)일 때만 섭니다");
      if (!listFieldEnum(outer.source.form, source.field, master)) {
        return fail("typeMismatch", `현재 원소의 목록 필드 ${outer.source.form}.${source.field} 은(는) 목록값(복수) 필드가 아닙니다`, `${outer.source.form}.${source.field}`);
      }
      return [];
    }
  }
}

// ───────────────────────────── 이름 ─────────────────────────────

/**
 * 반복의 화면 이름 — 「납입면제종마다」(세목 폼 이름 + 종마다 — 「형」은 무저해지 축과 겹친다, 결정 11) · 「납입면제사유마다」(목록 필드 이름) ·
 * 「납입면제사유 합집합(정의조대상 = 예)마다」. 노드의 `alias` 가 있으면 화면은 그것을 쓴다.
 */
export function repeatLabel(source: RepeatSource | unknown, ctx: { outer?: RepeatSource; master?: MasterTree; enumOf?: (code: Code) => EnumDef | undefined } = {}): string {
  const master = ctx.master ?? MASTER;
  if (!isRepeatSource(source)) return "반복 (원천 없음)";
  const formLabel = (form: Code) => formsOfLevel("plan", master).find((f) => f.key === form)?.label ?? form;
  const fieldLabel = (form: Code, field: Code) => findMasterField(`${form}.${field}`, master)?.field.label ?? field;
  switch (source.kind) {
    case "planOptions":
      return `${formLabel(source.form)}종마다`;
    case "listOfCurrent":
      return `${ctx.outer?.kind === "planOptions" ? fieldLabel(ctx.outer.form, source.field) : source.field}마다`;
    case "union": {
      const base = `${fieldLabel(source.form, source.field)} 합집합`;
      if (!source.where) return `${base}마다`;
      const enumCode = listFieldEnum(source.form, source.field, master);
      const def = enumCode ? ctx.enumOf?.(enumCode) : undefined;
      const name = def?.fields?.find((f) => f.key === source.where!.field)?.label ?? source.where.field;
      const value = source.where.value === true ? "예" : source.where.value === false ? "아니오" : source.where.value;
      return `${base}(${name} = ${value})마다`;
    }
  }
}

// ───────────────────────────── 복제 ─────────────────────────────

const CLONE_SEP = "@";

/**
 * 원소 하나의 복제본 — 노드 · 가지 id(`id` 가 있는 모든 객체)와 코드 가진 노드(항 · 호 · 목 · 함수조항 참조)의 P코드 끝에 `@원소`.
 * 조 참조의 대상(`targets` — id 없는 객체) · 인자 연결(`bindings`)은 손대지 않는다. 원본은 바꾸지 않는다.
 */
export function cloneForElement<T>(nodes: readonly T[], elementId: string): T[] {
  const suffix = `${CLONE_SEP}${elementId}`;
  const coded = CODED_KINDS as readonly string[];
  const walk = (x: unknown, key?: string): unknown => {
    if (Array.isArray(x)) return x.map((v) => walk(v));
    if (typeof x !== "object" || x === null) return x;
    if (key === "bindings" || key === "targets" || key === "options" || key === "source") return structuredClone(x);
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = walk(v, k);
    if (typeof o.id === "string") out.id = `${o.id}${suffix}`;
    if (typeof o.code === "string" && typeof o.kind === "string" && coded.includes(o.kind)) out.code = `${o.code}${suffix}`;
    return out;
  };
  return nodes.map((n) => walk(n) as T);
}

// ───────────────────────────── 반복 안 대상 ─────────────────────────────

/**
 * 여러 번호가 될 수 있는 참조 대상 열쇠(`조id#코드`) — 대상이 하나여도 연결어가 필요하다(결정 14 확장 · ADR-0077 결정 7).
 * - 반복 블록 안의 항 · 호 · 목 · 함수조항 참조 · 반복 블록(펼치면 원소마다 생긴다), 반복 블록 자신(펼친 것 전부).
 * - 함수조항 블록 참조(펼친 것 전부 — 항 · 호 · 목 유형은 여러 개를 낼 수 있다).
 * - 펼친 함수조항 안 노드(`조id#참조코드/…`)는 그 참조가 반복 안일 때만 — 열쇠 `조id#참조코드/*` 로 싣는다(`multiTarget`).
 */
export function repeatedKeys(ix: TreeIndex): Set<string> {
  const out = new Set<string>();
  for (const e of ix.nodes.values()) {
    if (e.articleId === undefined) continue;
    const kind = e.node.kind;
    const code = (e.node as { code?: Code }).code;
    if (code === undefined) continue;
    const key = refKey({ articleId: e.articleId, code });
    if (kind === "forBlock" || kind === "clauseBlockRef") out.add(key);
    if (e.inFor && (kind === "paragraph" || kind === "item" || kind === "subitem")) out.add(key);
    if (e.inFor && kind === "clauseBlockRef") out.add(`${key}/*`);
  }
  return out;
}


/** 참조 대상 검사 재료 — 함수조항 본문(안쪽 코드) · 열거형(값 한정의 값) · 마스터(반복 원소 타입). */
export interface RefTargetEnv {
  clauseOf?: (code: Code) => Clause | undefined;
  enumOf?: (code: Code) => EnumDef | undefined;
  master?: MasterTree;
}

/** 함수조항 본문이 내놓는 참조 대상 코드(항 · 호 · 목) — 코드 없는 자리는 저장 · 펼치기 채번과 같은 규칙으로 채운 뒤. */
export function clauseInnerCodes(clause: Clause): Set<Code> {
  const out = new Set<Code>();
  for (const e of clauseCodeEntries(withClauseCodes(clause.body)).entries) if (e.code !== undefined) out.add(e.code);
  return out;
}

/**
 * 대상이 선 열거값 반복의 열거형 — 대상(안쪽 코드면 그 참조 노드)을 감싼 반복 + (대상이 반복 블록이면) 자신 중 원소가 열거값인 것(안쪽 것).
 * 없으면 값 한정을 걸 수 없는 대상이다 (ADR-0077 결정 7).
 */
export function valueLoopEnum(ix: TreeIndex, t: { articleId: Id; code?: Code }, master: MasterTree = MASTER): Code | undefined {
  if (t.code === undefined) return undefined;
  let enumCode: Code | undefined;
  for (const id of nodesOfTarget(ix, { articleId: t.articleId, code: t.code })) {
    const h = ix.nodes.get(id);
    if (!h) continue;
    const types = loopTypesAt(ix, h, master);
    if (h.node.kind === "forBlock" && isRepeatSource(h.node.source)) {
      const outer = enclosingLoops(ix, h).at(-1);
      const own = loopElementType(h.node.source, outer && isRepeatSource(outer.source) ? outer.source : undefined, master);
      if (own) types.set(h.node.id, own);
    }
    for (const lt of types.values()) if (lt.kind === "enum") enumCode = lt.enumCode;
  }
  return enumCode;
}

/**
 * 이 문서 안 참조 대상 하나의 검사 (ADR-0077 결정 6 · 7) — 존재는 호출부(`referenceKeys`)가 본다.
 * - 안쪽 코드: 대상 코드가 함수조항 블록 참조여야 하고, 그 함수조항 본문에 그 코드가 있어야 한다.
 * - 값 한정: 대상(안쪽 코드면 그 참조 노드)이 원소가 열거값인 반복 안(또는 그 반복 블록)이어야 한다. 해당 값들 = 비지 않은 그 열거형의 값,
 *   현재 값 = 참조 자리를 감싼 열거값 반복.
 */
export function refTargetIssues(t: { articleId: Id; code?: Code; innerCode?: Code; restrict?: unknown }, refEntry: Pick<NodeEntry, "path" | "node">, ix: TreeIndex, env: RefTargetEnv): { kind: Issue["kind"]; message: string }[] {
  const out: { kind: Issue["kind"]; message: string }[] = [];
  const master = env.master ?? MASTER;
  const heads = t.code === undefined ? [] : nodesOfTarget(ix, { articleId: t.articleId, code: t.code }).map((id) => ix.nodes.get(id)!).filter(Boolean);
  if (t.innerCode !== undefined && heads.length > 0) {
    const head = heads[0].node;
    if (head.kind !== "clauseBlockRef") out.push({ kind: "structure", message: `안쪽 코드 ${t.innerCode} 는 함수조항 블록 참조를 가리킬 때만 쓴다 — ${t.code} 는 함수조항 참조가 아닙니다` });
    else {
      const clause = env.clauseOf?.(head.clauseCode);
      if (clause && !clauseInnerCodes(clause).has(t.innerCode)) out.push({ kind: "brokenRef", message: `함수조항 ${head.clauseCode} 본문에 참조 대상 ${t.innerCode} 가 없습니다` });
    }
  }
  if (t.restrict === undefined) return out;
  const r = t.restrict as { values?: unknown; current?: unknown };
  const enumCode = valueLoopEnum(ix, t, master);
  if (heads.length > 0 && enumCode === undefined) {
    out.push({ kind: "structure", message: "값 한정은 원소가 열거값(사유)인 반복으로 생긴 노드에만 건다 — 이 대상은 그런 반복 안이 아닙니다" });
    return out;
  }
  if (Array.isArray(r.values)) {
    const values = r.values.filter((v): v is string => typeof v === "string");
    if (values.length === 0) out.push({ kind: "structure", message: "값 한정의 값을 하나 이상 고른다" });
    const def = enumCode ? env.enumOf?.(enumCode) : undefined;
    const missing = def ? values.filter((v) => !def.values.some((x) => x.code === v)) : [];
    if (def && missing.length > 0) out.push({ kind: "brokenRef", message: missingValueMessage(def, missing) });
  } else if (typeof r.current === "string") {
    const types = loopTypesAt(ix, refEntry, master);
    const lt = types.get(r.current);
    if (!lt) out.push({ kind: "structure", message: `값 한정 「현재 값」의 반복이 이 참조를 감싸지 않습니다 — 그 반복 블록 안에서만 쓴다` });
    else if (lt.kind !== "enum") out.push({ kind: "structure", message: "값 한정 「현재 값」은 원소가 열거값(사유)인 반복에만 쓴다 — 종 반복은 안 된다" });
    else if (enumCode !== undefined && lt.enumCode !== enumCode) out.push({ kind: "typeMismatch", message: `값 한정 「현재 값」의 열거형(${lt.enumCode})이 대상 반복의 열거형(${enumCode})과 다릅니다` });
  } else out.push({ kind: "structure", message: "값 한정은 값들 또는 현재 값 중 하나다" });
  return out;
}

// ───────────────────────────── 경고 · 교차 검사 ─────────────────────────────

/** 반복 원소가 될 수 있는 열거형 — 세목 폼의 목록값(복수) 필드의 열거형(MVP: 납입면제사유). */
export function repeatElementEnums(master: MasterTree = MASTER): Set<Code> {
  const out = new Set<Code>();
  for (const form of formsOfLevel("plan", master)) for (const f of form.fields) if (f.type.kind === "list<enum>") out.add(f.type.enumCode);
  return out;
}

function literalCompares(e: Expr): { ref: Ref; value: string }[] {
  switch (e.kind) {
    case "compare": {
      const pair = (a: Expr, b: Expr) => (a.kind === "ref" && b.kind === "literal" && b.literal.type === "string" ? [{ ref: a.ref, value: String(b.literal.value) }] : []);
      return [...pair(e.left, e.right), ...pair(e.right, e.left)];
    }
    case "and":
    case "or":
      return [...literalCompares(e.left), ...literalCompares(e.right)];
    case "not":
      return literalCompares(e.operand);
    default:
      return [];
  }
}

/**
 * 템플릿은 사유 값으로 분기하지 않는다 (결정 10 · ADR-0077 결정 1) — 문면 조건식이 반복 원소 열거형의 값 코드와 비교하면 **경고**(저장은 된다).
 * 사유별 문장은 함수조항 안(값별 분기)에서 나눈다.
 */
export function valueBranchWarnings(doc: DocumentNode, resolve: TypeResolver, master: MasterTree = MASTER, base: Coordinate = {}): Issue[] {
  const enums = repeatElementEnums(master);
  if (enums.size === 0) return [];
  const ix = indexTree(doc, base);
  const out: Issue[] = [];
  for (const be of ix.branches.values()) {
    const when = be.branch.when;
    if (when === undefined) continue;
    const parsed = parse(when);
    if (!parsed.ok) continue;
    const hit = literalCompares(parsed.value).find(({ ref }) => {
      const t: ExprType | undefined = ref.kind === "discriminator" || ref.kind === "master" ? resolve(ref) : undefined;
      return t !== undefined && (t.kind === "enum" || t.kind === "list<enum>") && enums.has(t.enumCode);
    });
    if (!hit) continue;
    const path = refPath(hit.ref);
    out.push({
      kind: "structure",
      severity: "warning",
      message: `템플릿은 사유 값으로 분기하지 않습니다 — ${path} = '${hit.value}' 는 반복 원소 열거형의 값으로 가릅니다. 사유별 문장은 함수조항 안(값별 분기)에서 나눈다 (결정 10)`,
      at: { ...coordinateOf(ix, be, base), refPath: path },
    });
  }
  return out;
}

type SwitchLike = { kind: string; on: string; cases: { values: Code[]; empty?: true; children: unknown[] }[] };

function switchesOn(body: readonly unknown[], on: string): SwitchLike[] {
  const out: SwitchLike[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x !== "object" || x === null) return;
    const o = x as Record<string, unknown>;
    if ((o.kind === "switchBlock" || o.kind === "inlineSwitch") && typeof o.on === "string" && o.on.replace(/\s/g, "") === on) out.push(o as unknown as SwitchLike);
    for (const k of ["children", "items", "subitems", "branches", "cases"]) if (k in o) walk(o[k]);
  };
  walk(body);
  return out;
}

/**
 * 정의 조 교차 검사 (결정 23 · ADR-0077 결정 10 · C15) — 합집합 원천에 열거값 필드 거름(정의조대상 = 예)을 건 반복 안에서, 현재 원소를 받은 함수조항의
 * 그 인자 값별 분기를 필드와 맞댄다: 거름 값인(예) 값의 칸이 「문구 없음」이면 **오류**, 거름 값이 아닌(아니오) 값의 칸에 문장이 있으면 **경고**.
 * 미입력 필드는 보지 않는다(열거형 화면의 미입력 표시 몫). 좌표 = 함수조항 참조 · refPath 값 코드.
 */
export function definitionCrossCheck(doc: DocumentNode, clauseOf: (code: Code) => Clause | undefined, enumOf: (code: Code) => EnumDef | undefined, master: MasterTree = MASTER, base: Coordinate = {}): Issue[] {
  const ix = indexTree(doc, base);
  const out: Issue[] = [];
  for (const e of ix.nodes.values()) {
    const n = e.node;
    if ((n.kind !== "clauseBlockRef" && n.kind !== "clauseInlineRef") || !n.bindings) continue;
    const clause = clauseOf(n.clauseCode);
    if (!clause) continue;
    const loops = enclosingLoops(ix, e);
    for (const [name, b] of Object.entries(n.bindings)) {
      if (b.kind !== "current") continue;
      const loop = loops.find((f) => f.id === b.loop);
      const source = loop?.source;
      if (!isRepeatSource(source) || source.kind !== "union" || !source.where) continue;
      const enumCode = listFieldEnum(source.form, source.field, master);
      const def = enumCode ? enumOf(enumCode) : undefined;
      if (!def) continue;
      const fieldName = def.fields?.find((f) => f.key === source.where!.field)?.label ?? source.where.field;
      for (const sw of switchesOn(clause.body as unknown[], `arg.${name}`)) {
        for (const v of [...def.values].sort((a, c) => a.order - c.order)) {
          const k = sw.cases.find((c) => c.values.includes(v.code));
          const f = enumFieldValue(def, v.code, source.where.field);
          if (!k || f.kind !== "value") continue;
          const at = { ...coordinateOf(ix, e, base), refPath: v.code };
          const hasText = !k.empty && k.children.length > 0;
          if (f.value === source.where.value && k.empty) {
            out.push({ kind: "structure", message: `정의 조 교차 검사 — 함수조항 ${clause.code} 의 값 ${v.code}(${v.label}) 칸이 「문구 없음」인데 ${fieldName} = 예 입니다 — 칸에 문장을 넣거나 필드를 고친다`, at });
          } else if (f.value !== source.where.value && hasText) {
            out.push({ kind: "structure", severity: "warning", message: `정의 조 교차 검사 — 함수조항 ${clause.code} 의 값 ${v.code}(${v.label}) 칸에 문장이 있지만 ${fieldName} 이(가) 거름 값이 아니라 펼쳐지지 않습니다`, at });
          }
        }
      }
    }
  }
  return out;
}
