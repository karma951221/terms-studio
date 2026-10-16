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
import { belowLoop, LEVEL_WORD, nodeByKeyPath } from "../coverage/keys";
import type { Coverage } from "../coverage/types";
import { extractRefs, parse, refPath, type Expr, type ExprType, type Ref, type TypeResolver } from "../expression";
import { findMasterField, formsOfLevel, MASTER, type MasterTree } from "../master";
import { isInlineRepeatConnector, type AttachLevel, type Code, type Coordinate, type Id, type Issue } from "../types";
import { coordinateOf, fallbackPathId, indexTree, isRepeatNode, type DocumentNode, type NodeEntry, type RepeatNode, type TreeIndex } from "./nodes";
import { clauseCodeEntries, withClauseCodes } from "../clause/pcode";
import { missingValueMessage } from "../catalog/values";
import { CODED_KINDS, isCodedKind, nodesOfTarget, refKey } from "./pcode";

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

/** 담보 트리 원천 (ADR-0087 결정 5) — 담보약관 템플릿만. 원소 = 스냅샷 노드(트리 순서). */
export type TreeRepeatSource = { kind: "subCoverages" } | { kind: "benefits" } | { kind: "benefitsOfCurrent"; loop: Id };

export type RepeatSource = PlanOptionsRepeatSource | ListOfCurrentRepeatSource | UnionRepeatSource | TreeRepeatSource;

const TREE_KINDS = new Set(["subCoverages", "benefits", "benefitsOfCurrent"]);

export function isTreeSource(s: RepeatSource): s is TreeRepeatSource {
  return TREE_KINDS.has(s.kind);
}

/** 반복 깊이 한도 — 반복 안 반복 하나 (ADR-0077 결정 4). */
export const REPEAT_MAX_DEPTH = 2;

export function isRepeatSource(x: unknown): x is RepeatSource {
  if (typeof x !== "object" || x === null) return false;
  const k = (x as { kind?: unknown }).kind;
  return k === "planOptions" || k === "listOfCurrent" || k === "union" || (typeof k === "string" && TREE_KINDS.has(k));
}

export interface RepeatEnv {
  master?: MasterTree;
  /** 열거형 정의 — 합집합 거름 필드 · 교차 검사 · 이름. 없으면 그 검사는 건너뛴다. */
  enumOf?: (code: Code) => EnumDef | undefined;
  /** 문맥 담보가 있는 문서(담보약관)인가 — 담보 트리 원천의 허용. */
  hasCoverage?: boolean;
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
    case "subCoverages":
      return { kind: "coverageNode", level: "subCoverage" };
    case "benefits":
    case "benefitsOfCurrent":
      return { kind: "coverageNode", level: "benefit" };
  }
}

/**
 * 경로 위의 반복(블록 · 인라인) — 바깥 → 안쪽. 「비었을 때」 칸 표지가 바로 뒤에 선 반복은 뺀다 — 칸은 그 반복의 원소 문맥 밖이다 (ADR-0088 결정 3).
 * `self` 는 빼고 센다(자기 자신이 반복이어도 감싼 것이 아니다).
 */
export function loopsOnPath(ix: TreeIndex, path: readonly Id[], self?: Id): RepeatNode[] {
  const out: RepeatNode[] = [];
  path.forEach((id, i) => {
    if (id === self) return;
    const n = ix.nodes.get(id)?.node;
    if (!isRepeatNode(n) || path[i + 1] === fallbackPathId(id)) return;
    out.push(n);
  });
  return out;
}

/** 경로가 지나는 「비었을 때」 칸의 반복 — 칸 안 노드가 그 반복의 현재 원소를 읽으면 저장 오류다 (ADR-0088 결정 3). */
export function fallbacksOnPath(ix: TreeIndex, path: readonly Id[]): RepeatNode[] {
  const out: RepeatNode[] = [];
  path.forEach((id, i) => {
    const n = ix.nodes.get(id)?.node;
    if (isRepeatNode(n) && path[i + 1] === fallbackPathId(id)) out.push(n);
  });
  return out;
}

/** 노드(색인 항목)를 감싼 반복들(블록 · 인라인) — 바깥 → 안쪽, 자기 자신 제외 · 「비었을 때」 칸의 주인 제외. */
export function enclosingLoops(ix: TreeIndex, e: Pick<NodeEntry, "path" | "node">): RepeatNode[] {
  return loopsOnPath(ix, e.path, e.node.id);
}

/** 자리를 감싼 담보 트리 반복 — 바깥 → 안쪽, 반복 id · 현재 노드 레벨. 기본 연결 · 반복 안 참조 검사 · 키 한정 검사가 쓴다. */
export function treeLoopLevelsAt(ix: TreeIndex, e: Pick<NodeEntry, "path" | "node">): { loop: Id; level: "subCoverage" | "benefit" }[] {
  return enclosingLoops(ix, e).flatMap((f) => {
    if (!isRepeatSource(f.source) || !isTreeSource(f.source)) return [];
    return [{ loop: f.id, level: f.source.kind === "subCoverages" ? ("subCoverage" as const) : ("benefit" as const) }];
  });
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
 * 반복 원천 검사 (저장) — 블록 반복 · 인라인 반복 공통. `outers` = 이 반복을 감싼 반복들(바깥 → 안쪽).
 * 원천 없음 · 세목 폼 아님 · 거름(그 폼 필드만 · 참거짓) · 안쪽 원천은 바로 바깥 반복의 현재 원소의 목록뿐 · 목록 필드는 목록값(복수) · 합집합 거름 필드.
 */
export function checkRepeatSource(node: RepeatNode, outers: readonly RepeatNode[], env: RepeatEnv, at: Coordinate): Issue[] {
  const master = env.master ?? MASTER;
  const source: unknown = node.source;
  const fail = (kind: Issue["kind"], message: string, refPath?: string): Issue[] => [{ kind, message, at: { ...at, ...(refPath !== undefined ? { refPath } : {}) } }];
  if (!isRepeatSource(source)) return fail("structure", `${node.kind === "inlineFor" ? "문장 안 반복" : "반복 블록"}의 원천을 고른다 — 세목 선택지 · 바깥 반복의 현재 원소의 목록 · 목록값의 합집합`);
  const outer = outers.at(-1);
  if (outer && isRepeatSource(outer.source) && isTreeSource(outer.source) !== isTreeSource(source)) {
    return fail("structure", "담보 트리 반복과 세목 반복은 섞어 중첩하지 않습니다 — 한 단계 중첩은 같은 계열 안에서만(종 › 사유, 세부보장 › 급부). 종에 따라 갈리는 문장은 조건식으로 쓴다 (ADR-0087 결정 5)");
  }
  if (isTreeSource(source)) {
    if (!env.hasCoverage) return fail("structure", "담보 트리 반복(세부보장마다 · 급부마다)은 담보약관 템플릿에서만 쓸 수 있습니다 — 문맥 담보가 없습니다");
    if (outer && source.kind !== "benefitsOfCurrent") return fail("structure", "안쪽 담보 트리 반복은 「현재 세부보장의 급부마다」뿐입니다");
    if (source.kind === "benefitsOfCurrent") {
      if (!outer || outer.id !== source.loop) return fail("structure", "「현재 세부보장의 급부마다」는 바로 바깥 「세부보장마다」 반복 안에 둔다");
      if (!isRepeatSource(outer.source) || outer.source.kind !== "subCoverages") return fail("structure", "「현재 세부보장의 급부마다」의 바깥 반복은 「세부보장마다」여야 합니다");
    }
    return [];
  }
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
    default:
      return [];
  }
}

// ───────────────────────────── 인라인 반복 · 「현재 값」 슬롯 (ADR-0088) ─────────────────────────────

/** 인라인 반복 연결어 미선택 — 원소 수를 템플릿 시점에 모르므로 늘 고른다 (ADR-0088 결정 2 · 조 참조 규칙). */
export const INLINE_REPEAT_CONNECTOR_MESSAGE = "문장 안 반복의 연결어를 고르세요 (및 · 또는 · 쉼표만) — 원소가 몇 개일지 템플릿에서 모릅니다";

/**
 * 인라인 반복 검사 (저장) — 조 제목이면 원천은 세목 선택지 · 합집합만(조 제목은 반복 블록 안에 서지 않는다), 원천 검사(블록 반복과 같다),
 * 연결어(「및」·「또는」·「,」 — 기본값 없음). 한 겹 · 깊이는 색인(`indexTree`)이 본다.
 */
export function inlineRepeatIssues(node: RepeatNode & { kind: "inlineFor" }, e: Pick<NodeEntry, "path" | "node" | "inTitle" | "inInlineFor">, ix: TreeIndex, env: RepeatEnv, at: Coordinate): Issue[] {
  if (e.inInlineFor) return []; // 한 겹 위반 — 색인이 이미 말했다
  const source: unknown = node.source;
  if (e.inTitle && isRepeatSource(source) && source.kind === "listOfCurrent") {
    return [{ kind: "structure", message: "조 제목의 문장 안 반복은 세목 선택지 · 합집합 원천만 씁니다 — 조 제목은 반복 블록 안에 서지 않습니다 (ADR-0088 결정 1)", at }];
  }
  const sourceIssues = checkRepeatSource(node, enclosingLoops(ix, e), env, at);
  if (sourceIssues.length > 0) return sourceIssues;
  const connector: unknown = node.connector;
  if (connector === undefined) return [{ kind: "structure", message: INLINE_REPEAT_CONNECTOR_MESSAGE, at }];
  if (!isInlineRepeatConnector(connector)) return [{ kind: "structure", message: `문장 안 반복의 연결어는 「및」·「또는」·「,」 중 하나여야 합니다: ${String(connector)}`, at }];
  return [];
}

/** 「현재 값」 슬롯 경로의 머리 — `builtin.value.name`(값 이름) · `builtin.value.<필드키>`(열거값 글 필드). */
export const CURRENT_VALUE_PREFIX = "builtin.value.";

/** 슬롯 경로 → 「현재 값」의 무엇. 「현재 값」 슬롯이 아니면 undefined. */
export function currentValueSlot(ref: string): { kind: "name" } | { kind: "field"; field: Code } | undefined {
  const r = ref.trim();
  if (!r.startsWith(CURRENT_VALUE_PREFIX)) return undefined;
  const prop = r.slice(CURRENT_VALUE_PREFIX.length);
  return prop === "name" ? { kind: "name" } : { kind: "field", field: prop };
}

/** 「현재 값」 슬롯 경로 — 값 이름(필드 없음) 또는 열거값 필드. */
export function currentValueRef(field?: Code): string {
  return `${CURRENT_VALUE_PREFIX}${field ?? "name"}`;
}

/** 반복 노드의 원소 타입 — 감싼 반복(그 반복 자신을 감싼 것)의 가장 안쪽을 바깥 원천으로. */
function ownElementType(ix: TreeIndex, loop: RepeatNode, master: MasterTree): LoopElementType | undefined {
  if (!isRepeatSource(loop.source)) return undefined;
  const h = ix.nodes.get(loop.id);
  const outer = h ? enclosingLoops(ix, h).at(-1) : undefined;
  return loopElementType(loop.source, outer && isRepeatSource(outer.source) ? outer.source : undefined, master);
}

/**
 * 현재 원소를 읽는 슬롯의 검사 (저장, ADR-0088 결정 1 · 3) — 「현재 종」(`builtin.plan.*`) · 「현재 값」(`builtin.value.*`).
 * - 「비었을 때」 칸 안에서 그 반복의 현재 원소를 읽으면 오류 — 칸은 원소 문맥 밖이다(바깥 반복의 원소는 읽는다).
 * - 「현재 값」은 원소가 열거값인 반복 안에서만 · 필드는 그 열거형의 글 필드만(열거형을 알 때).
 * 「현재 종」이 반복 밖에 선 것은 여기서 막지 않는다 — 조립의 미입력이다(옛 규칙 그대로).
 */
export function currentSlotIssues(ref: string, e: Pick<NodeEntry, "path" | "node">, ix: TreeIndex, env: RepeatEnv, at: Coordinate): Issue[] {
  const master = env.master ?? MASTER;
  const value = currentValueSlot(ref);
  const plan = ref.trim().startsWith("builtin.plan.");
  if (!value && !plan) return [];
  const want = value ? "enum" : "planOptions";
  const here = { ...at, refPath: ref };
  const hit = [...loopTypesAt(ix, e, master).values()].reverse().find((t) => t.kind === want);
  if (!hit) {
    const owner = fallbacksOnPath(ix, e.path).find((l) => ownElementType(ix, l, master)?.kind === want);
    if (owner) return [{ kind: "structure", message: `「비었을 때」 칸은 원소 문맥 밖이라 ${value ? "「현재 값」" : "「현재 종」"}을 읽을 수 없습니다 — 칸에는 원소가 없을 때의 글을 쓴다 (ADR-0088 결정 3)`, at: here }];
    return value ? [{ kind: "structure", message: "「현재 값」 슬롯은 원소가 열거값(사유)인 반복 안에서만 씁니다", at: here }] : [];
  }
  if (value?.kind !== "field" || hit.kind !== "enum") return [];
  const def = env.enumOf?.(hit.enumCode);
  if (!def) return [];
  const field = def.fields?.find((f) => f.key === value.field);
  if (!field) return [{ kind: "brokenRef", message: `「현재 값」 필드 ${value.field} 이(가) 열거형 ${def.code} 에 없습니다`, at: here }];
  if (field.type !== "string") return [{ kind: "typeMismatch", message: `「현재 값」 슬롯은 열거값 글 필드만 찍습니다 — ${field.label} 은(는) 참거짓 필드입니다`, at: here }];
  return [];
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
    case "subCoverages":
      return "세부보장마다";
    case "benefits":
      return "세부보장 › 급부마다";
    case "benefitsOfCurrent":
      return "현재 세부보장의 급부마다";
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
  /** 문맥 담보 — 키 한정의 키 존재 검사 (ADR-0087 결정 10). 없으면 건너뛴다. */
  coverage?: Coverage;
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
  return valueLoopEnumOf(ix, nodesOfTarget(ix, { articleId: t.articleId, code: t.code }), master);
}

/** `valueLoopEnum` 의 몸 — 대상 코드의 노드들을 이미 안 때(`refTargetFacts` 가 한 번에 모은다). */
function valueLoopEnumOf(ix: TreeIndex, ids: readonly Id[], master: MasterTree): Code | undefined {
  let enumCode: Code | undefined;
  for (const id of ids) {
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

/** 대상(안쪽 코드면 그 참조 노드)이 선 담보 트리 반복 — 안쪽 것. 대상이 트리 반복 블록 자신이면 그 블록. 없으면 undefined (ADR-0087 결정 10). */
export function treeLoopOfTarget(ix: TreeIndex, t: { articleId: Id; code?: Code }): { loop: Id; level: "subCoverage" | "benefit" } | undefined {
  if (t.code === undefined) return undefined;
  return treeLoopOfIds(ix, nodesOfTarget(ix, { articleId: t.articleId, code: t.code }));
}

/** `treeLoopOfTarget` 의 몸 — 대상 코드의 노드들을 이미 안 때(`refTargetFacts` 가 한 번에 모은다). */
function treeLoopOfIds(ix: TreeIndex, ids: readonly Id[]): { loop: Id; level: "subCoverage" | "benefit" } | undefined {
  let found: { loop: Id; level: "subCoverage" | "benefit" } | undefined;
  for (const id of ids) {
    const h = ix.nodes.get(id);
    if (!h) continue;
    const loops = treeLoopLevelsAt(ix, h);
    if (h.node.kind === "forBlock" && isRepeatSource(h.node.source) && isTreeSource(h.node.source)) loops.push({ loop: h.node.id, level: h.node.source.kind === "subCoverages" ? "subCoverage" : "benefit" });
    if (loops.length > 0) found = loops.at(-1);
  }
  return found;
}

/**
 * 참조 대상 머리(대상 코드의 노드)의 사실 — 안쪽 코드 · 값 한정 검사 재료 (ADR-0077 결정 6 · 7). 이 문서 대상은 그 자리에서 짓고,
 * 대응 보통약관 대상은 보통약관 한 벌이 열쇠마다 지어 넘긴다(`GeneralRefs.targets`) — 담보약관 · 함수조항 저장이 그 문서를 열지 않고 같은 검사를 한다.
 */
export interface RefTargetFact {
  /** 대상 코드의 첫 노드 종류. */
  headKind: string;
  /** 함수조항 블록 참조면 그 함수조항 코드. */
  clauseCode?: Code;
  /** 그 함수조항 본문의 안쪽 코드 — 함수조항을 알 때만. */
  innerCodes?: ReadonlySet<Code>;
  /** 대상(또는 그 반복 블록 자신)을 감싼 원소가 열거값인 반복의 열거형 — 없으면 값 한정을 걸 수 없다. */
  valueEnum?: Code;
  /** 대상(또는 그 반복 블록 자신)을 감싼 담보 트리 반복의 레벨 — 안쪽 것. 없으면 키 한정을 걸 수 없다 (ADR-0087 결정 10). */
  treeLevel?: "subCoverage" | "benefit";
}

/** 대상 열쇠의 사실 — 그 코드의 노드가 없으면 undefined. */
export function refTargetFact(ix: TreeIndex, t: { articleId: Id; code?: Code }, env: RefTargetEnv): RefTargetFact | undefined {
  if (t.code === undefined) return undefined;
  return factOf(ix, nodesOfTarget(ix, { articleId: t.articleId, code: t.code }), env, (c) => {
    const clause = env.clauseOf?.(c);
    return clause ? clauseInnerCodes(clause) : undefined;
  });
}

function factOf(ix: TreeIndex, ids: readonly Id[], env: RefTargetEnv, innerOf: (clauseCode: Code) => ReadonlySet<Code> | undefined): RefTargetFact | undefined {
  const head = ids.map((id) => ix.nodes.get(id)).find(Boolean);
  if (!head) return undefined;
  const innerCodes = head.node.kind === "clauseBlockRef" ? innerOf(head.node.clauseCode) : undefined;
  const valueEnum = valueLoopEnumOf(ix, ids, env.master ?? MASTER);
  const treeLevel = treeLoopOfIds(ix, ids)?.level;
  return {
    headKind: head.node.kind,
    ...(head.node.kind === "clauseBlockRef" ? { clauseCode: head.node.clauseCode } : {}),
    ...(innerCodes ? { innerCodes } : {}),
    ...(valueEnum !== undefined ? { valueEnum } : {}),
    ...(treeLevel !== undefined ? { treeLevel } : {}),
  };
}

/**
 * 문서 한 벌의 대상 열쇠(조#코드)마다 사실 — 대응 보통약관으로 넘길 표. 열쇠마다 노드를 한 번에 모으고 함수조항 안쪽 코드는 함수조항마다 한 번 짓는다
 * (문서 저장마다 대응 보통약관 전체를 훑는다 — 열쇠마다 트리를 다시 걷지 않는다).
 */
export function refTargetFacts(ix: TreeIndex, env: RefTargetEnv): Map<string, RefTargetFact> {
  const groups = new Map<string, Id[]>();
  for (const e of ix.nodes.values()) {
    const code = (e.node as { code?: Code }).code;
    if (code === undefined || !isCodedKind(e.node.kind) || e.articleId === undefined) continue;
    const key = refKey({ articleId: e.articleId, code });
    const list = groups.get(key);
    if (list) list.push(e.node.id);
    else groups.set(key, [e.node.id]);
  }
  const inner = new Map<Code, ReadonlySet<Code> | undefined>();
  const innerOf = (c: Code) => {
    if (!inner.has(c)) {
      const clause = env.clauseOf?.(c);
      inner.set(c, clause ? clauseInnerCodes(clause) : undefined);
    }
    return inner.get(c);
  };
  const out = new Map<string, RefTargetFact>();
  for (const [key, ids] of groups) {
    const fact = factOf(ix, ids, env, innerOf);
    if (fact) out.set(key, fact);
  }
  return out;
}

/**
 * 참조 대상 하나의 검사 (ADR-0077 결정 6 · 7) — 존재는 호출부가 본다. `fact` 는 대상 머리의 사실(없으면 머리를 모른다 — 그 검사는 건너뛴다),
 * `currentTypes` 는 참조 자리를 감싼 반복의 원소 타입(「현재 값」 검사).
 * - 안쪽 코드: 대상 코드가 함수조항 블록 참조여야 하고, 그 함수조항 본문에 그 코드가 있어야 한다.
 * - 값 한정: 대상(안쪽 코드면 그 참조 노드)이 원소가 열거값인 반복 안(또는 그 반복 블록)이어야 한다. 해당 값들 = 비지 않은 그 열거형의 값,
 *   현재 값 = 참조 자리를 감싼 열거값 반복.
 * - 키 한정 (ADR-0087 결정 10): 대상이 담보 트리 반복 안(또는 그 반복 블록)이어야 한다. 키는 하나 이상 · 「세부보장마다」 대상엔 세부보장 키만 ·
 *   문맥 담보에 없는 키 = 「없는 키」. 트리 반복 대상의 「현재」 = 참조 자리를 감싼 담보 트리 반복 — 대상이 「세부보장마다」면 급부 반복은 안 된다.
 */
export function refTargetFactIssues(
  t: { innerCode?: Code; restrict?: unknown },
  fact: RefTargetFact | undefined,
  currentTypes: () => ReadonlyMap<Id, LoopElementType>,
  env: Pick<RefTargetEnv, "enumOf" | "coverage">,
  code?: Code,
  treeLevelsAt: () => readonly { loop: Id; level: "subCoverage" | "benefit" }[] = () => [],
): { kind: Issue["kind"]; message: string }[] {
  const out: { kind: Issue["kind"]; message: string }[] = [];
  if (t.innerCode !== undefined && fact) {
    if (fact.clauseCode === undefined) out.push({ kind: "structure", message: `안쪽 코드 ${t.innerCode} 는 함수조항 블록 참조를 가리킬 때만 쓴다 — ${code ?? "대상"} 는 함수조항 참조가 아닙니다` });
    else if (fact.innerCodes && !fact.innerCodes.has(t.innerCode)) out.push({ kind: "brokenRef", message: `함수조항 ${fact.clauseCode} 본문에 참조 대상 ${t.innerCode} 가 없습니다` });
  }
  if (t.restrict === undefined) return out;
  const r = t.restrict as { values?: unknown; current?: unknown; keys?: unknown };
  const tree = fact?.treeLevel;
  if (Array.isArray(r.keys)) {
    if (fact && !tree) return [...out, { kind: "structure", message: "키 한정은 담보 트리 반복으로 생긴 노드에만 건다 — 이 대상은 그런 반복 안이 아닙니다" }];
    const keys = r.keys.filter((k): k is string => typeof k === "string");
    if (keys.length === 0) return [...out, { kind: "structure", message: "키 한정의 키를 하나 이상 고른다" }];
    if (tree === "subCoverage" && keys.some((k) => k.includes("."))) out.push({ kind: "structure", message: "「세부보장마다」 반복 대상에는 세부보장 키만 고른다" });
    const coverage = env.coverage;
    const missing = coverage ? keys.filter((k) => !nodeByKeyPath(coverage, k)) : [];
    if (missing.length > 0) out.push({ kind: "brokenRef", message: `없는 키 ${missing.join(" · ")} — 문맥 담보에 그 세부보장 · 급부가 없습니다` });
    return out;
  }
  if (typeof r.current === "string" && tree) {
    const cur = treeLevelsAt().find((l) => l.loop === r.current);
    if (!cur) out.push({ kind: "structure", message: "키 한정 「현재」의 반복이 이 참조를 감싸지 않습니다 — 그 담보 트리 반복 안에서만 쓴다" });
    // 급부 원소의 키 경로(01.1)는 세부보장 원소(01)를 고르지 못한다 — 조립에서 0개가 된다 (위 「세부보장마다 대상엔 세부보장 키만」과 같은 규칙)
    else if (cur.level === "benefit" && tree === "subCoverage") out.push({ kind: "structure", message: "「세부보장마다」 반복 대상의 「현재」는 세부보장 반복이다 — 급부 반복의 「현재」는 세부보장을 고르지 못한다" });
    return out;
  }
  const enumCode = fact?.valueEnum;
  if (fact && enumCode === undefined) {
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
    const lt = currentTypes().get(r.current);
    if (!lt) out.push({ kind: "structure", message: `값 한정 「현재 값」의 반복이 이 참조를 감싸지 않습니다 — 그 반복 블록 안에서만 쓴다` });
    else if (lt.kind === "coverageNode") out.push({ kind: "structure", message: "담보 트리 반복의 「현재 세부보장 · 급부」 한정은 담보 트리 반복으로 생긴 대상에만 건다 — 이 대상은 그런 반복 안이 아닙니다" });
    else if (lt.kind !== "enum") out.push({ kind: "structure", message: "값 한정 「현재 값」은 원소가 열거값(사유)인 반복에만 쓴다 — 종 반복은 안 된다" });
    else if (enumCode !== undefined && lt.enumCode !== enumCode) out.push({ kind: "typeMismatch", message: `값 한정 「현재 값」의 열거형(${lt.enumCode})이 대상 반복의 열거형(${enumCode})과 다릅니다` });
  } else out.push({ kind: "structure", message: "값 한정은 값들 또는 현재 값 중 하나다" });
  return out;
}

/** 이 문서 안 참조 대상 하나의 검사 — `refTargetFactIssues` 를 이 문서의 대상 머리 · 참조 자리로. */
export function refTargetIssues(t: { articleId: Id; code?: Code; innerCode?: Code; restrict?: unknown }, refEntry: Pick<NodeEntry, "path" | "node">, ix: TreeIndex, env: RefTargetEnv): { kind: Issue["kind"]; message: string }[] {
  return refTargetFactIssues(t, refTargetFact(ix, t, env), () => loopTypesAt(ix, refEntry, env.master ?? MASTER), env, t.code, () => treeLoopLevelsAt(ix, refEntry));
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

/**
 * 담보 트리 반복 안의 조건 · 슬롯 — 한정자 없는 세부보장 · 급부 레벨 구분자는 현재 노드(자기 또는 조상)에서 읽힌다.
 * 반복 레벨보다 아래 레벨(「세부보장마다」 안의 급부 레벨)은 읽을 노드가 없어 저장 오류다 (기능/문면 §3.7 · 반복 표와 같은 규칙 — 공용 술어 `belowLoop`).
 */
export function treeLoopRefIssues(doc: DocumentNode, levelOf: (code: Code) => AttachLevel | undefined, base: Coordinate = {}): Issue[] {
  const ix = indexTree(doc, base);
  const out: Issue[] = [];
  const check = (src: string, e: Pick<NodeEntry, "path" | "node">, at: Coordinate) => {
    const inner = treeLoopLevelsAt(ix, e).at(-1);
    if (!inner) return;
    const parsed = parse(src);
    if (!parsed.ok) return;
    for (const { ref, path, aggregate } of extractRefs(parsed.value)) {
      if (ref.kind !== "discriminator" || ref.node || aggregate) continue;
      const level = levelOf(ref.code);
      if (level === undefined || !belowLoop(level, inner.level)) continue;
      const loopWord = inner.level === "subCoverage" ? "세부보장마다" : "급부마다";
      out.push({
        kind: "structure",
        message: `「${loopWord}」 반복 안에서 ${LEVEL_WORD[level as "subCoverage" | "benefit"]} 레벨 구분자 ${ref.code} 를 한정자 없이 읽을 수 없습니다 — 키 경로로 고르거나 「현재 세부보장의 급부마다」 안에 두세요`,
        at: { ...at, refPath: path },
      });
    }
  };
  for (const be of ix.branches.values()) {
    if (be.branch.when === undefined) continue;
    const owner = ix.nodes.get(be.ownerId);
    if (owner) check(be.branch.when, { path: be.path, node: owner.node }, coordinateOf(ix, be, base));
  }
  for (const e of ix.nodes.values()) if (e.node.kind === "slot") check(e.node.ref, e, coordinateOf(ix, e, base));
  return out;
}
