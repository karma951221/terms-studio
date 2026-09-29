/**
 * P코드 — 항 · 호 · 목(과 함수조항 블록 참조)의 참조 정체성 (ADR-0072 결정 1 · 3 · 4 · 5 · 10).
 *
 * - 식별 두 층: uuid 는 노드 정체성(편집 · 출처 추적), **참조의 정체성은 코드**. 조는 코드를 두지 않는다(uuid 하나).
 * - 코드는 `P` + 숫자(기본 4자리 100 단위 — P0100). 단계(항/호/목)는 코드가 아니라 트리 위치로 정해진다. P9900 을 넘으면 자릿수를 늘린다.
 * - **유일성 = 공존하는 노드끼리만**(결정 4): 두 노드를 감싼 공통 조건 블록(값별 분기 포함)에서 서로 다른 가지에 있으면 배타 → 같은 코드 허용.
 *   그 밖(분기 밖 ↔ 가지 안 · 같은 가지 안 · 중첩)은 공존 → 중복 금지. 범위는 조 하나(문면) · 함수조항 본문 하나.
 * - **채번**(결정 5): 새 노드는 기본 위치값 n×100(n = 목록 자리의 1부터 위치)에서 시작해 공존 코드와 겹치면 100 씩 올린다.
 *   코드 순서 ≠ 실제 순서를 허용한다. 붙여넣기(복제)는 항상 재채번, 이동은 재채번하지 않는다(충돌은 저장 검사가 드러낸다).
 * - **전환**(결정 10): 코드가 없는 노드는 같은 규칙으로 채운다 — 깊이 순(항 → 호 → 목), 같은 깊이는 문서 순.
 *   그래서 배타 가지의 같은 자리 항은 같은 코드를 받는다(가지마다 위치가 같으므로).
 *
 * 문면 트리와 함수조항 본문이 같은 규칙을 쓰도록 판정 · 채번은 트리 모양과 무관한 항목(`CodedEntry`) 위에서 한다.
 * DB·React import 금지 (순수층).
 */

import type { Code, Id } from "../types";
import { indexTree, type DocumentNode, type Node, type NodeKind, type TreeIndex } from "./nodes";

/** P코드 형식 — `P` + 숫자 4자리 이상. */
export const PCODE_PATTERN = /^P\d{4,}$/;

/** 코드가 붙는 문면 노드 종류 — 항 · 호 · 목 + 함수조항 블록 참조(펼친 안쪽 노드를 두 마디로 가리키는 바깥 마디, 결정 3 개정). */
export const CODED_KINDS: readonly NodeKind[] = ["paragraph", "item", "subitem", "clauseBlockRef"];

export function isCodedKind(kind: string): boolean {
  return (CODED_KINDS as readonly string[]).includes(kind);
}

export function isPCode(code: unknown): code is Code {
  return typeof code === "string" && PCODE_PATTERN.test(code);
}

/** 코드 → 숫자 (형식이 아니면 NaN). */
export function pcodeNumber(code: Code): number {
  return isPCode(code) ? Number(code.slice(1)) : Number.NaN;
}

/** 숫자 → 코드 (4자리 미만은 0 채움, 넘치면 자릿수를 늘린다 — P10000). */
export function formatPCode(n: number): Code {
  return `P${String(n).padStart(4, "0")}`;
}

/** 채번 · 판정 재료 — 트리 모양과 무관한 코드 자리 하나. */
export interface CodedEntry {
  id: Id;
  code?: Code;
  /** 유일성 범위 — 조 id(문면) · 함수조항 본문 하나. */
  scope: string;
  /** 감싼 조건 블록 · 값별 분기의 [소유 노드 id, 가지 id] — 바깥부터. */
  branches: readonly (readonly [Id, Id])[];
  /** 목록 자리의 1부터 위치 — 기본 코드 n×100. */
  position: number;
  /** 코드 자리 조상의 수 (항 = 0 · 호 = 1 · 목 = 2) — 전환 채번 순서. */
  depth: number;
}

/** 두 자리가 배타인가 — 공통 조건 블록에서 서로 다른 가지에 있다. */
export function exclusive(a: CodedEntry, b: CodedEntry): boolean {
  return a.branches.some(([owner, branch]) => b.branches.some(([o, br]) => o === owner && br !== branch));
}

/** 두 자리가 공존하는가 — 같은 범위이고 배타가 아니다. */
export function coexist(a: CodedEntry, b: CodedEntry): boolean {
  return a.id !== b.id && a.scope === b.scope && !exclusive(a, b);
}

/** 기본 위치값 n×100 에서 시작해 쓰인 번호를 피한 코드. */
export function nextCode(taken: ReadonlySet<number>, position: number): Code {
  let n = Math.max(1, position) * 100;
  while (taken.has(n)) n += 100;
  return formatPCode(n);
}

function takenBy(entry: CodedEntry, entries: readonly CodedEntry[], code: (e: CodedEntry) => Code | undefined): Set<number> {
  const out = new Set<number>();
  for (const other of entries) {
    const c = code(other);
    if (c !== undefined && coexist(entry, other)) out.add(pcodeNumber(c));
  }
  return out;
}

/**
 * 코드를 매길 자리에 코드를 채운다 — 깊이 순 · 같은 깊이는 주어진(문서) 순. 매길 자리 = 코드가 없는 자리 + `renumber` 에 든 자리
 * (가진 코드를 버리고 새로). `only` 를 주면 그 자리만 매긴다(나머지 코드 없는 자리는 그대로 둔다). 돌려주는 것은 새로 매긴 id → 코드.
 */
export function fillCodes(entries: readonly CodedEntry[], opts: { renumber?: ReadonlySet<Id>; only?: ReadonlySet<Id> } = {}): Map<Id, Code> {
  const assigned = new Map<Id, Code>();
  const pending = (e: CodedEntry) => (opts.only === undefined || opts.only.has(e.id)) && (e.code === undefined || opts.renumber?.has(e.id) === true);
  const current = (e: CodedEntry): Code | undefined => (assigned.has(e.id) ? assigned.get(e.id) : pending(e) ? undefined : e.code);
  const order = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => pending(e))
    .sort((x, y) => x.e.depth - y.e.depth || x.i - y.i);
  for (const { e } of order) assigned.set(e.id, nextCode(takenBy(e, entries, current), e.position));
  return assigned;
}

/** 자리 하나의 추천 코드 — 자기 코드를 빼고 공존 코드를 피한 기본 위치값(이동 충돌 · 코드 수정 창의 기본값, 결정 5). */
export function suggestCode(entries: readonly CodedEntry[], id: Id): Code | undefined {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return undefined;
  return nextCode(takenBy(entry, entries, (e) => e.code), entry.position);
}

/** 공존하는 두 자리가 같은 코드를 가진 쌍 — 뒤에 나온 자리 기준(앞의 것은 이미 그 코드의 주인이다). */
export interface CodeConflict {
  entry: CodedEntry;
  with: CodedEntry;
  code: Code;
}

export function codeConflicts(entries: readonly CodedEntry[]): CodeConflict[] {
  const out: CodeConflict[] = [];
  entries.forEach((e, i) => {
    if (e.code === undefined) return;
    const first = entries.slice(0, i).find((o) => o.code === e.code && coexist(e, o));
    if (first) out.push({ entry: e, with: first, code: e.code });
  });
  return out;
}

/** 코드 충돌 문구 — 추천값을 함께 (코드 수정 창은 다음 작업 — 기능/문면 §5). */
export function conflictMessage(c: CodeConflict, suggestion: Code | undefined): string {
  return `코드 ${c.code} 가 같은 조의 다른 항 · 호 · 목과 겹칩니다 — 같은 조건 블록의 다른 가지에서만 같은 코드를 쓸 수 있습니다${suggestion ? ` (추천 ${suggestion})` : ""}`;
}

// ───────────────────────────── 문면 트리 ─────────────────────────────

/** 문면 트리의 코드 자리 — 색인 순(전위 = 문서 순). 조 밖(없음)은 뺀다. */
export function documentCodeEntries(doc: DocumentNode, ix: TreeIndex = indexTree(doc)): CodedEntry[] {
  const out: CodedEntry[] = [];
  for (const e of ix.nodes.values()) {
    if (!isCodedKind(e.node.kind) || e.articleId === undefined) continue;
    const branches: [Id, Id][] = [];
    let depth = 0;
    for (const id of e.path.slice(0, -1)) {
      const br = ix.branches.get(id);
      if (br) branches.push([br.ownerId, id]);
      else if (isCodedKind(ix.nodes.get(id)?.node.kind ?? "")) depth += 1;
    }
    out.push({ id: e.node.id, code: (e.node as { code?: Code }).code, scope: e.articleId, branches, position: e.index + 1, depth });
  }
  return out;
}

/** 문면 트리에 코드를 매긴다 — **제자리 수정**(편집 명령의 작업 사본용). 매긴 id → 코드. */
export function codeTreeInPlace(doc: DocumentNode, opts: { renumber?: ReadonlySet<Id>; only?: ReadonlySet<Id> } = {}): Map<Id, Code> {
  const ix = indexTree(doc);
  const assigned = fillCodes(documentCodeEntries(doc, ix), opts);
  for (const [id, code] of assigned) (ix.nodes.get(id)!.node as Node & { code?: Code }).code = code;
  return assigned;
}

/** 코드가 없는 자리를 채운 사본 (전환 규칙 — 결정 10). 채울 것이 없으면 입력 그대로. */
export function withCodes(doc: DocumentNode): DocumentNode {
  const entries = documentCodeEntries(doc);
  if (entries.every((e) => e.code !== undefined)) return doc;
  const copy = structuredClone(doc);
  codeTreeInPlace(copy);
  return copy;
}

/** 문면 트리의 코드 검사 — 형식 · 공존 중복 (저장 거부). 코드 없는 자리는 저장 때 채워지므로 오류가 아니다. */
export function documentCodeIssues(doc: DocumentNode, ix: TreeIndex = indexTree(doc)): { id: Id; message: string }[] {
  const entries = documentCodeEntries(doc, ix);
  const out: { id: Id; message: string }[] = [];
  for (const e of entries) if (e.code !== undefined && !isPCode(e.code)) out.push({ id: e.id, message: `코드 ${String(e.code)} 는 P코드 형식(P + 숫자 4자리 이상)이 아닙니다` });
  for (const c of codeConflicts(entries)) out.push({ id: c.entry.id, message: conflictMessage(c, suggestCode(entries, c.entry.id)) });
  return out;
}
