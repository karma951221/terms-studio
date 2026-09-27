/**
 * 부분 사전평가 (도메인모델 §3 · 기능/문면 §3.9 · ADR-0003).
 *
 * 문맥(`EvalContext`)이 채워지는 만큼만 평가한다 — 담보약관 편집 문맥은 B1 의 `masterEvalContext` 가 만든다
 * (담보 레벨 = 마스터 값, 상품 레벨·담보속성 = 미결). 보통약관 문맥은 담보 레벨까지 미결 (기능/조립산출 §3.2).
 *
 * 결과는 데이터뿐이다 — 톤다운·전체 뷰 토글은 화면 몫.
 *   - 가지 상태: taken(탐) · notTaken(안 탐 → 톤다운) · undetermined(미결 — 톤다운 아님) · error(미입력 등, 좌표 있는 이슈)
 *   - 조건 노드 안 가지는 순서대로: 앞 가지가 taken 이면 뒤는 notTaken, 앞이 미결·오류면 뒤는 undetermined.
 *   - 톤다운된 가지 안의 중첩 조건도 독립적으로 평가한다 (톤다운은 잠금이 아니다 — 사전평가 S4).
 *   - 슬롯: 값 · 미결 · 오류.
 */

import { evaluate, parse } from "../expression";
import type { EvalContext, EvalResult } from "../expression";
import { descend, enumerateRows, type RowSource } from "../structure";
import type { Coordinate, Id, Issue, Value } from "../types";
import { coordinateOf, indexTree, type DocumentNode, type InlineNode, type TableNode } from "./nodes";
import { expandRepeatTable, isRepeatTable, type ExpandedTable } from "./repeat";
import type { BranchState } from "./numbering";

export interface BranchEvaluation {
  state: BranchState;
  /** 미결을 일으킨 참조 경로 (undetermined). */
  reason?: string;
  /** 오류 (error). */
  issue?: Issue;
}

export type SlotEvaluation =
  | { kind: "value"; value: Value }
  | { kind: "undetermined"; reason: string }
  | { kind: "error"; issue: Issue };

/**
 * 반복 표의 평가 (ADR-0070 결정 6) — 펼친 표(복제 행 · 구조 표기 텍스트 · 병합 spans), 조합 0 이면 생략, 원천 없음 · 제공자 없음은 오류.
 * 펼친 표 안 슬롯 · 가지의 평가는 `slots` · `branches` 에 **복제본 id**(`repeatCloneId`)로 실린다.
 */
export type TableEvaluation =
  | { kind: "expanded"; expansion: ExpandedTable }
  | { kind: "omitted" }
  | { kind: "error"; issue: Issue };

export interface PreEvaluation {
  /** 가지 id → 상태. */
  branches: Map<Id, BranchEvaluation>;
  /** 슬롯 노드 id → 값. */
  slots: Map<Id, SlotEvaluation>;
  /** 평가 중 난 오류 전부 (좌표 포함). */
  issues: Issue[];
  /** 반복 표 id → 펼침 결과. 반복 없는 표는 싣지 않는다. */
  tables: Map<Id, TableEvaluation>;
}

export interface PreEvaluateOptions {
  /** 좌표 기본값. 없으면 `ctx.coordinate`. */
  coordinate?: Coordinate;
  /** 반복 표의 행 원천 — 담보 약관 문맥이면 `coverageRowSource`. 없으면 반복 표는 오류 (문맥 담보 없음). */
  rows?: RowSource<EvalContext>;
}

/** 문맥에 좌표만 바꿔 얹는다 (메서드 바인딩 보존). */
function at(ctx: EvalContext, coordinate: Coordinate): EvalContext {
  return {
    lookup: (ref) => ctx.lookup(ref),
    attribute: (code) => ctx.attribute(code),
    children: (ref) => ctx.children(ref),
    coordinate,
  };
}

function run(src: string, ctx: EvalContext, coordinate: Coordinate): EvalResult {
  const parsed = parse(src, coordinate);
  if (!parsed.ok) {
    const issue: Issue =
      parsed.rejection.reason === "invalid" && parsed.rejection.issues[0]
        ? parsed.rejection.issues[0]
        : { kind: "syntax", message: "식을 읽을 수 없습니다", at: coordinate };
    return { kind: "error", issue };
  }
  return evaluate(parsed.value, at(ctx, coordinate));
}

/** 가지 목록을 순서대로 평가한다 — 앞 가지가 taken 이면 뒤는 notTaken, 앞이 미결·오류면 뒤는 undetermined. */
function evalBranches(
  list: readonly { id: Id; when?: string }[],
  ctx: EvalContext,
  coordinateOfBranch: (id: Id) => Coordinate,
  branches: Map<Id, BranchEvaluation>,
  issues: Issue[],
): void {
  // open: 아직 탄 가지 없음 · closed: 앞에서 탐 · unknown: 앞이 미결/오류
  let mode: "open" | "closed" | "unknown" = "open";
  let reason = "";
  for (const br of list) {
    if (mode === "closed") {
      branches.set(br.id, { state: "notTaken" });
      continue;
    }
    if (mode === "unknown") {
      branches.set(br.id, { state: "undetermined", reason });
      continue;
    }
    if (br.when === undefined) {
      branches.set(br.id, { state: "taken" });
      mode = "closed";
      continue;
    }
    const coordinate = coordinateOfBranch(br.id);
    const r = run(br.when, ctx, coordinate);
    if (r.kind === "error") {
      branches.set(br.id, { state: "error", issue: r.issue });
      issues.push(r.issue);
      mode = "unknown";
      reason = r.issue.at.refPath ?? "error";
    } else if (r.kind === "undetermined") {
      branches.set(br.id, { state: "undetermined", reason: r.reason });
      mode = "unknown";
      reason = r.reason;
    } else if (typeof r.value !== "boolean") {
      const issue: Issue = { kind: "typeMismatch", message: `조건식의 결과가 boolean 이 아닙니다 (${typeof r.value})`, at: coordinate };
      branches.set(br.id, { state: "error", issue });
      issues.push(issue);
      mode = "unknown";
      reason = "typeMismatch";
    } else if (r.value) {
      branches.set(br.id, { state: "taken" });
      mode = "closed";
    } else {
      branches.set(br.id, { state: "notTaken" });
    }
  }
}

function evalSlot(id: Id, ref: string, ctx: EvalContext, coordinate: Coordinate, slots: Map<Id, SlotEvaluation>, issues: Issue[]): void {
  const r = run(ref, ctx, coordinate);
  if (r.kind === "error") {
    slots.set(id, { kind: "error", issue: r.issue });
    issues.push(r.issue);
  } else if (r.kind === "undetermined") {
    slots.set(id, { kind: "undetermined", reason: r.reason });
  } else {
    slots.set(id, { kind: "value", value: r.value });
  }
}

/** 반복 표 템플릿 행 안의 노드 · 가지 id — 문서 문맥으로 평가하지 않는다 (행 문맥에서만 뜻이 있다). */
function templateIds(doc: DocumentNode): Set<Id> {
  const out = new Set<Id>();
  const walk = (n: InlineNode) => {
    out.add(n.id);
    if (n.kind === "inlineCond") {
      for (const b of n.branches) {
        out.add(b.id);
        b.children.forEach(walk);
      }
    } else if (n.kind === "inlineFor") n.children.forEach(walk);
  };
  for (const e of indexTree(doc).nodes.values()) {
    if (!isRepeatTable(e.node)) continue;
    for (const row of e.node.rows) if (!row.header) row.cells.forEach((cell) => cell.forEach(walk));
  }
  return out;
}

/** 반복 표 하나 — 조합 열거 → 펼침 → 행 문맥 평가. */
function evalRepeatTable(
  table: TableNode,
  tablePath: Id[],
  tableCoordinate: Coordinate,
  source: RowSource<EvalContext> | undefined,
  out: PreEvaluation,
): TableEvaluation {
  const fail = (message: string): TableEvaluation => {
    const issue: Issue = { kind: "structure", message, at: tableCoordinate };
    out.issues.push(issue);
    return { kind: "error", issue };
  };
  if (!source || !table.repeat) return fail("반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다");
  const keys = enumerateRows(source.root, table.repeat.depth, source.providers);
  if (!keys.ok) return fail(keys.rejection.reason === "notFound" ? `반복할 구조를 읽을 수 없습니다 — ${keys.rejection.what} 없음` : "반복할 구조를 읽을 수 없습니다");
  const expansion = expandRepeatTable(table, keys.value, descend(source.root.level, table.repeat.depth));
  if (!expansion) return { kind: "omitted" };
  for (const s of expansion.strayKeys) {
    out.issues.push({ kind: "structure", message: "구조 표기가 이 표의 반복 레벨 밖입니다", at: { ...tableCoordinate, nodePath: [...tablePath, s.id] } });
  }
  for (const row of expansion.rows) {
    const ctx = source.rowContext(row.node);
    const cells = expansion.table.rows[row.index].cells;
    cells.forEach((cell, ci) => {
      const cellPath = [...tablePath, `${table.id}-r${row.index}c${ci}`];
      const coordinate = (path: Id[]): Coordinate => ({ ...tableCoordinate, nodePath: path });
      const walk = (n: InlineNode, parent: Id[]) => {
        const path = [...parent, n.id];
        if (!ctx) {
          if (n.kind === "slot") {
            const issue: Issue = { kind: "brokenRef", message: `행 노드 ${row.node.name} 의 문맥을 만들 수 없습니다`, at: coordinate(path) };
            out.slots.set(n.id, { kind: "error", issue });
            out.issues.push(issue);
          }
          return;
        }
        if (n.kind === "slot") evalSlot(n.id, n.ref, ctx, coordinate(path), out.slots, out.issues);
        else if (n.kind === "inlineCond") {
          evalBranches(n.branches, ctx, (id) => coordinate([...path, id]), out.branches, out.issues);
          for (const b of n.branches) b.children.forEach((c) => walk(c, [...path, b.id]));
        } else if (n.kind === "inlineFor") n.children.forEach((c) => walk(c, path));
      };
      cell.forEach((n) => walk(n, cellPath));
    });
  }
  return { kind: "expanded", expansion };
}

export function preEvaluate(doc: DocumentNode, ctx: EvalContext, opts: PreEvaluateOptions = {}): PreEvaluation {
  const base = opts.coordinate ?? ctx.coordinate ?? {};
  const ix = indexTree(doc, base);
  const out: PreEvaluation = { branches: new Map(), slots: new Map(), issues: [], tables: new Map() };
  const skip = templateIds(doc);

  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (skip.has(n.id)) continue;
    if (isRepeatTable(n)) {
      out.tables.set(n.id, evalRepeatTable(n, e.path, coordinateOf(ix, e, base), opts.rows, out));
    } else if (n.kind === "condBlock" || n.kind === "inlineCond") {
      evalBranches(
        n.branches,
        ctx,
        (id) => {
          const be = ix.branches.get(id);
          return be ? coordinateOf(ix, be, base) : { ...base, nodePath: [...e.path, id] };
        },
        out.branches,
        out.issues,
      );
    } else if (n.kind === "slot") {
      evalSlot(n.id, n.ref, ctx, coordinateOf(ix, e, base), out.slots, out.issues);
    }
  }
  return out;
}
