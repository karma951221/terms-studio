/**
 * 담보약관 「구분자」 탭 — 값 패널 (ADR-0087 결정 6 · 기능/문면 §3.9).
 * 미리보기에서 고른 상품담보에 대해 이 템플릿이 읽거나 연결한 잎을 「키 경로 + 이름 › 구분자」와 지금 값으로 늘어놓는다.
 * 평가는 조립과 같은 문맥(`specialContext`) · 같은 값 서식(`formatValue`)이다 — 규칙을 따로 두지 않는다.
 */
import { discriminatorResultType } from "../catalog/expression";
import { effectiveBindings, presetUsage } from "../clause";
import { coveredByLoop, keyPathLabel, nodeByKeyPath, type KeyedLevel } from "../coverage/keys";
import { treeLoopLevelsAt } from "../document/blockRepeat";
import { unqualifiedNodeArgUnbound } from "../document/nodeBindings";
import { coordinateOf, indexTree, type DocumentNode, type NodeEntry } from "../document/nodes";
import { evaluate, extractRefs, parse } from "../expression";
import type { Code, Coordinate, Id } from "../types";
import { snapshotTree, specialContext } from "./context";
import { formatValue } from "./substitute";
import type { MasterBundle, ProductInput } from "./types";

export interface LeafRow {
  /** 「세부보장 01 · 유사암 › 급부 1 · 진단비 › 지급률」 · 담보 레벨이면 「지급률」. */
  label: string;
  code: Code;
  /** 키 경로 — 담보 레벨 · 상품 · 세목이면 없음. */
  path?: string;
  /** 표시 값 — 문제면 없음. */
  value?: string;
  problem?: "notEntered" | "brokenKey" | "unbound";
  /** 구분자 주석 (ⓘ). */
  description?: string;
  /** 쓰는 자리 — 첫 자리(조립 오류와 같은 좌표). */
  at: Coordinate;
}

type Place = Pick<NodeEntry, "path" | "node">;

export function leafPanel(master: MasterBundle, product: ProductInput, productCoverageId: Id, tree: DocumentNode): LeafRow[] | { unavailable: string } {
  const input = { ...master, ...product };
  const c = input.coverages.find((x) => x.snapshot.id === productCoverageId);
  if (!c) return { unavailable: "그 상품담보를 찾을 수 없다" };
  const ctx = specialContext(input, c).eval;
  const snap = snapshotTree(c);
  const defs = new Map(input.catalog.map((d) => [d.code, d]));
  const enums = new Map(input.enums.map((e) => [e.code, e]));
  const ix = indexTree(tree);
  const rows = new Map<string, LeafRow>();
  const keyed = (code: Code): KeyedLevel | undefined => {
    const level = defs.get(code)?.level;
    return level === "subCoverage" || level === "benefit" ? level : undefined;
  };

  /** 끊어진 키 경로의 라벨 — 있는 세부보장은 실제 이름으로, 나머지는 마디 그대로. */
  const brokenHead = (path: string): string => {
    const [subKey, ...rest] = path.split(".");
    const sub = snap.subCoverages.find((x) => x.key === subKey);
    const first = sub ? keyPathLabel(snap, sub.key)! : `세부보장 ${subKey}`;
    return [first, ...rest.map((k) => `급부 ${k}`)].join(" › ");
  };

  const add = (code: Code, path: string | undefined, at: Coordinate, problem?: LeafRow["problem"]) => {
    const id = `${code}@${path ?? ""}`;
    if (rows.has(id)) return;
    const def = defs.get(code);
    const name = def?.label ?? code;
    const head = path ? (keyPathLabel(snap, path) ?? brokenHead(path)) : undefined;
    const row: LeafRow = { label: head ? `${head} › ${name}` : name, code, ...(path ? { path } : {}), ...(def?.description ? { description: def.description } : {}), at };
    if (problem) row.problem = problem;
    else if (path && !nodeByKeyPath(snap, path)) row.problem = "brokenKey";
    else {
      const parsed = parse(path ? `${code}@${path}` : code);
      const r = parsed.ok ? evaluate(parsed.value, { ...ctx, coordinate: at }) : undefined;
      const f = r?.kind === "value" ? formatValue(r.value, def ? discriminatorResultType(def, input.master, defs) : undefined, enums, at) : undefined;
      if (f?.ok) row.value = f.text;
      else row.problem = "notEntered";
    }
    rows.set(id, row);
  };

  /** 한정자 없는 참조 — 반복이 그 레벨을 푸는 만큼(레벨 이하) 도는 키마다, 아니면 담보 레벨로 한 번. */
  const each = (code: Code, loopLevel: KeyedLevel | undefined, at: Coordinate) => {
    const level = keyed(code);
    if (level && loopLevel && coveredByLoop(level, loopLevel)) {
      for (const sub of snap.subCoverages) {
        if (level === "subCoverage") add(code, sub.key, at);
        else for (const b of sub.benefits) add(code, `${sub.key}.${b.key}`, at);
      }
      return;
    }
    add(code, undefined, at);
  };

  const fromSource = (src: string, place: Place, at: Coordinate) => {
    const parsed = parse(src);
    if (!parsed.ok) return;
    const inner = treeLoopLevelsAt(ix, place).at(-1);
    for (const { ref } of extractRefs(parsed.value)) {
      if (ref.kind !== "discriminator") continue;
      if (ref.node) add(ref.code, ref.node.path, at);
      else each(ref.code, inner?.level, at);
    }
  };

  for (const be of ix.branches.values()) {
    if (be.branch.when === undefined) continue;
    // 가지는 노드가 아니라 자기 소유 조건 노드 자리에서 감싼 반복을 본다.
    fromSource(be.branch.when, { path: be.path, node: { id: be.ownerId } as Place["node"] }, coordinateOf(ix, be));
  }
  for (const e of ix.nodes.values()) {
    const n = e.node;
    const at = coordinateOf(ix, e);
    if (n.kind === "slot") fromSource(n.ref, e, at);
    if (n.kind !== "clauseBlockRef" && n.kind !== "clauseInlineRef") continue;
    const clause = input.clauses.find((x) => x.code === n.clauseCode);
    if (!clause) continue;
    const loops = treeLoopLevelsAt(ix, e);
    const used = presetUsage(clause, n, at);
    for (const [name, b] of Object.entries(effectiveBindings(clause, used.bindings))) {
      if (b.kind !== "discriminator") continue;
      const here = { ...at, refPath: `arg.${name}` };
      if (b.node && "path" in b.node) add(b.code, b.node.path, here);
      else if (b.node && "current" in b.node) {
        const current = b.node.current;
        each(b.code, loops.find((l) => l.loop === current)?.level, here);
      } else {
        const level = keyed(b.code);
        if (level && unqualifiedNodeArgUnbound(level, loops)) add(b.code, undefined, here, "unbound");
        else each(b.code, loops.at(-1)?.level, here);
      }
    }
  }
  return [...rows.values()];
}
