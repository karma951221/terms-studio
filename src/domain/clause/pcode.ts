/**
 * 함수조항 본문의 P코드 (ADR-0072 결정 3 · 4 · 최종 결정 12) — 판정 · 채번은 문면과 같은 규칙(`document/pcode.ts`)이고, 범위만 본문 하나다.
 *
 * - 코드 자리 = 항 · 호 · 목. 조건 블록의 가지 · 값별 분기(switch)의 칸은 배타 — 칸마다 같은 자리의 항은 같은 코드를 쓴다
 *   (가지 순서 · 위치가 같으면 전환 채번이 같은 코드를 준다).
 * - 선택지 문구(인라인)에는 구조가 없어 코드가 없다.
 *
 * DB·React import 금지 (순수층).
 */
import { codeConflicts, codeFormatMessage, conflictMessage, fillCodes, suggestCode, type CodedEntry } from "../document/pcode";
import type { Code, Id } from "../types";
import type { ClauseBody } from "./types";

const CODED = new Set(["paragraph", "item", "subitem"]);
const SCOPE = "clause";

type Loose = {
  id?: Id;
  kind?: string;
  code?: Code;
  children?: unknown[];
  items?: unknown[];
  subitems?: unknown[];
  branches?: { id?: Id; children?: unknown[] }[];
  cases?: { id?: Id; children?: unknown[] }[];
};

/** 본문의 코드 자리 — 등장 순. 검증을 거치지 않은 입력도 견딘다. `nodes` 는 id → 노드(제자리 수정용). */
export function clauseCodeEntries(body: ClauseBody): { entries: CodedEntry[]; nodes: Map<Id, Loose>; paths: Map<Id, Id[]> } {
  const entries: CodedEntry[] = [];
  const nodes = new Map<Id, Loose>();
  const paths = new Map<Id, Id[]>();
  const list = (xs: unknown[] | undefined, branches: (readonly [Id, Id])[], depth: number, path: Id[]) =>
    (xs ?? []).forEach((x, i) => visit(x, branches, depth, i + 1, path));
  const visit = (x: unknown, branches: (readonly [Id, Id])[], depth: number, position: number, path: Id[]): void => {
    if (!x || typeof x !== "object") return;
    const n = x as Loose;
    const here = [...path, String(n.id)];
    const arms = n.kind === "condBlock" ? n.branches : n.kind === "switchBlock" ? n.cases : undefined;
    if (arms) {
      for (const arm of arms) list(arm?.children, [...branches, [String(n.id), String(arm?.id)] as const], depth, [...here, String(arm?.id)]);
      return;
    }
    if (!CODED.has(String(n.kind)) || typeof n.id !== "string") return;
    entries.push({ id: n.id, code: n.code, scope: SCOPE, branches, position, depth });
    nodes.set(n.id, n);
    paths.set(n.id, here);
    list(n.items, branches, depth + 1, here);
    list(n.subitems, branches, depth + 1, here);
  };
  list(body as unknown[], [], 0, []);
  return { entries, nodes, paths };
}

/** 코드가 없는 자리를 채운 본문 사본 (전환 규칙 — ADR-0072 결정 10). 채울 것이 없으면 입력 그대로. */
export function withClauseCodes<B extends ClauseBody>(body: B): B {
  if (clauseCodeEntries(body).entries.every((e) => e.code !== undefined)) return body;
  const copy = structuredClone(body);
  const { entries, nodes } = clauseCodeEntries(copy);
  for (const [id, code] of fillCodes(entries)) nodes.get(id)!.code = code;
  return copy;
}

/** 본문의 코드 검사 — 형식 · 공존 중복. 노드 경로(본문 뿌리부터) · 문구. */
export function clauseCodeIssues(body: ClauseBody): { path: Id[]; message: string }[] {
  const { entries, paths } = clauseCodeEntries(body);
  const out: { path: Id[]; message: string }[] = [];
  for (const e of entries) {
    const message = e.code !== undefined ? codeFormatMessage(e.code) : undefined; // PZ 는 상품 조 사본 전용 — 함수조항에는 거부 (ADR-0081)
    if (message) out.push({ path: paths.get(e.id)!, message });
  }
  for (const c of codeConflicts(entries)) out.push({ path: paths.get(c.entry.id)!, message: conflictMessage(c, suggestCode(entries, c.entry.id)).replace("같은 조의", "이 함수조항의") });
  return out;
}
