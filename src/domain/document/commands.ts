/**
 * 트리 편집 커맨드 — 전부 `(tree, command) → Result<tree>` 순수 함수. 입력 트리는 바꾸지 않는다.
 *
 * 구조 편집기(ADR-0012)의 조작이 그대로 커맨드다: 추가 · 삭제 · 이동 · 복제 · 텍스트/조 명 · 슬롯/참조 대상 ·
 * 조건 가지(추가·식·삭제·순서) · 반복 속성 · 조연결 · 공용조항 옵션.
 *
 * 검증 원칙:
 * - 커맨드는 **자기가 건드린 자리**만 검사한다 (허용 자식 · 중첩 · id 유일 · 가지 규칙 · 참조 대상 존재).
 *   문서 전체의 저장 검증은 `validateTree` + `validateExpressions` (서비스가 저장 직전에).
 * - 참조를 **추가하는 시점**에 대상 존재를 검증한다 (기능/문면 §3.5 — 추가할 때와 저장할 때 두 번 검증). 공용조항 옵션 미선택은
 *   추가 시점엔 통과, 저장 시점에 거부 (기능/함수조항 §3.2).
 * - 참조되는 조는 삭제할 수 없다 — 참조처 좌표를 제시한다 (D-P4-7). 같이 지워지는 참조는 무관.
 */

import type { Bindings } from "../clause/params";
import { ok, reject } from "../types";
import type { Code, Id, Issue, Result } from "../types";
import type { IdSource } from "./builders";
import { randomIds } from "./builders";
import {
  allowedChildren,
  allowedIn,
  branchesOf,
  cellNodesOf,
  checkNodeRefs,
  coordinateOf,
  indexTree,
  listOf,
  slotsOf,
  tableIssues,
  type ArticleRefNode,
  type BlockBranch,
  type BlockNode,
  type BoxNode,
  type DocumentNode,
  type InlineBranch,
  type InlineNode,
  type Node,
  type NodeEntry,
  type SlotName,
  type TableColumn,
  type TableNode,
  type TableRow,
  type TreeEnv,
  type TreeIndex,
} from "./nodes";

// ───────────────────────────── 커맨드 ─────────────────────────────

/** 인라인 목록의 자리 — 문장 자리(항 · 호 · 목 · 문장 안 조건 가지)이거나 표 셀. */
export type InlineAt = { parentId: Id } | { tableId: Id; row: number; col: number };

/**
 * 인라인 목록을 새로 짤 때의 한 조각 (`setInlines`).
 * - `{ id, text }` — 문장. 그 목록에 같은 id 의 문장이 있으면 그것을 고치고, 없으면 그 id 로 새 문장. 빈 문장은 버린다.
 * - `{ keep }` — 그 목록에 이미 있는 칩(슬롯 · 참조 · 문장 안 조건 …)을 그대로 둔다. 목록에 없으면 거부.
 * - `{ node }` — 새로 넣는 인라인 노드(칩을 그 자리에 넣기 · 조건 풀기로 가지 내용을 꺼내기).
 */
export type InlineRun = { id: Id; text: string } | { keep: Id } | { node: InlineNode };

/** 삽입 자리 — 부모(노드 id 또는 가지 id) · 목록 자리 · 위치(없으면 끝). */
export interface Position {
  parentId: Id;
  slot?: SlotName;
  index?: number;
}

export type Command =
  | { type: "insert"; node: BlockNode | InlineNode; at: Position }
  | { type: "remove"; nodeId: Id }
  | { type: "move"; nodeId: Id; to: Position }
  /**
   * 하위 트리 · 조연결 · 참조 대상을 그대로 복사한 사본을 원본 바로 뒤(또는 `at`)에 (D-P4-9). 노드 id 는 새로.
   * `ids` = 사본이 쓸 id 를 매기는 순서대로(노드 · 가지, 전위) — 주면 공급원 대신 이것을 쓴다.
   * 브라우저 편집본에서 매긴 id 를 서버가 그대로 다시 적용하게 한다 (ADR-0074 — 사본을 가리키는 뒤 명령이 이어진다).
   */
  | { type: "duplicate"; nodeId: Id; at?: Position; ids?: readonly Id[] }
  | { type: "setText"; nodeId: Id; text: string }
  /**
   * 인라인 목록 하나를 통째로 다시 짠다 — 가운데 본문의 그 자리 편집(문장 입력 · 칩 삭제 · 커서 자리에 칩 넣기)이 한 명령으로 온다.
   * 목록에서 빠진 노드는 지워진다(인라인 노드는 참조 대상이 아니라 깨질 참조가 없다). 새 노드는 자리 규칙 · 참조 대상을 검사한다.
   */
  | { type: "setInlines"; at: InlineAt; runs: readonly InlineRun[] }
  /** 조 명 또는 문서 제목. */
  | { type: "setTitle"; nodeId: Id; title: string }
  | { type: "setSlotRef"; nodeId: Id; ref: string }
  /** 정적 표의 제목·열·행을 통째로 바꾼다. 셀 수 = 열 수. */
  /** 표 — 제목·열은 항상, 행은 주면 통째로 바꾼다(셀은 텍스트). 참조 슬롯이 든 표는 행을 주지 않고 제목·너비만 고친다. */
  | { type: "setTable"; nodeId: Id; title?: string; columns: TableColumn[]; rows?: { header?: boolean; cells: string[] }[] }
  | { type: "setBox"; nodeId: Id; title: string; lines: string[] }
  /** 표의 행 반복 — `repeat` 만 바꾸고 행은 그대로 (ADR-0070 결정 6). undefined = 반복 없음. */
  | { type: "setTableRepeat"; nodeId: Id; repeat?: { depth: 1 | 2 } }
  /** 표의 행 · 열 넣기 · 빼기 — 새 셀은 빈 셀. 열이나 행을 하나도 남기지 않는 삭제는 거부. */
  | { type: "insertTableRow"; tableId: Id; index: number; header?: boolean }
  | { type: "removeTableRow"; tableId: Id; index: number }
  | { type: "insertTableColumn"; tableId: Id; index: number }
  | { type: "removeTableColumn"; tableId: Id; index: number }
  /** 행 하나의 제목줄 여부. */
  | { type: "setTableRowHeader"; tableId: Id; index: number; header: boolean }
  /** 표 셀(행 · 열)에 인라인 노드를 넣는다 — 구조 표기 · 슬롯 등. `index` 없으면 끝. */
  | { type: "insertCell"; tableId: Id; row: number; col: number; node: InlineNode; index?: number }
  | { type: "setArticleRef"; nodeId: Id; targets: { nodeId: Id }[]; connector: ArticleRefNode["connector"]; scope: ArticleRefNode["scope"] }
  | { type: "setAppendixRef"; nodeId: Id; appendixCode: Code }
  /** 함수조항 참조의 옵션 선택 · 인자 연결. `bindings` 없으면 연결은 그대로, 빈 맵이면 걷는다(모두 기본 연결, 최종 결정 2). */
  | { type: "setClauseOptions"; nodeId: Id; options: Record<Code, Code>; bindings?: Bindings }
  | { type: "setFor"; nodeId: Id; source?: string; alias?: string; separator?: string }
  | { type: "addBranch"; condId: Id; branch: BlockBranch | InlineBranch; index?: number }
  /** `when` 없음 = else 로 바꾼다. */
  | { type: "setWhen"; branchId: Id; when?: string }
  | { type: "removeBranch"; branchId: Id }
  | { type: "moveBranch"; branchId: Id; index: number }
  /** 조연결 설정(`linkedArticleId`) 또는 해제(undefined). */
  | { type: "link"; articleId: Id; linkedArticleId?: Id };

export interface ApplyOptions {
  env?: TreeEnv;
  /** 복제가 쓰는 새 id 공급원. 기본 uuid. */
  newId?: IdSource;
}

// ───────────────────────────── 헬퍼 ─────────────────────────────

function invalid<T>(issues: Issue[]): Result<T> {
  return reject({ reason: "invalid", issues });
}

function structure<T>(message: string, nodePath: Id[]): Result<T> {
  return invalid([{ kind: "structure", message, at: { nodePath } }]);
}

function notFound<T>(what: string): Result<T> {
  return reject({ reason: "notFound", what });
}

/** 하위 트리의 모든 id (노드 + 가지). */
function idsIn(node: Node): Set<Id> {
  const out = new Set<Id>();
  const walk = (n: Node) => {
    out.add(n.id);
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) {
        out.add(br.id);
        (br.children as Node[]).forEach(walk);
      }
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(walk);
    cellNodesOf(n).forEach(walk);
  };
  walk(node);
  return out;
}

/** 하위 트리의 노드들 (자기 포함, 전위 순). */
function nodesIn(node: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    out.push(n);
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) (br.children as Node[]).forEach(walk);
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(walk);
    cellNodesOf(n).forEach(walk);
  };
  walk(node);
  return out;
}

interface Container {
  list: Node[];
  allowed: readonly Node["kind"][];
  path: Id[];
}

/** 자리(Position)의 목록을 찾는다. 항의 items 같은 선택 목록은 없으면 만든다. */
function containerOf(ix: TreeIndex, pos: Position): Result<Container> {
  const slot = pos.slot ?? "children";
  const br = ix.branches.get(pos.parentId);
  if (br) {
    if (slot !== "children") return structure(`가지에는 ${slot} 자리가 없습니다`, br.path);
    return ok({ list: br.branch.children as Node[], allowed: br.allowed, path: br.path });
  }
  const e = ix.nodes.get(pos.parentId);
  if (!e) return notFound(`노드 ${pos.parentId}`);
  const allowed = allowedIn(e.node.kind, slot);
  if (allowed === undefined) return structure(`${e.node.kind} 에는 ${slot} 자리가 없습니다`, e.path);
  let list = listOf(e.node, slot);
  if (!list) {
    list = [];
    (e.node as unknown as Record<string, unknown>)[slot] = list;
  }
  return ok({ list, allowed, path: e.path });
}

/** 색인의 규칙 위반 중 주어진 id 들을 경로에 품은 것만 — 「이 커맨드가 건드린 자리」의 위반. */
function issuesTouching(ix: TreeIndex, ids: ReadonlySet<Id>): Issue[] {
  return ix.issues.filter((i) => i.at.nodePath?.some((id) => ids.has(id)));
}

/** 하위 트리 안 참조 노드들의 대상 검증 (추가 시점). */
function refIssuesIn(ix: TreeIndex, root: Node, env: TreeEnv): Issue[] {
  const out: Issue[] = [];
  for (const n of nodesIn(root)) {
    const e = ix.nodes.get(n.id);
    if (e) out.push(...checkNodeRefs(e, ix, env, false));
  }
  return out;
}

/** 삽입·이동 뒤 공통 검사 — 건드린 자리의 구조 위반 + 참조 대상. */
function verifyPlaced(doc: DocumentNode, node: Node, env: TreeEnv): Result<DocumentNode> {
  const ix = indexTree(doc, env.coordinate);
  const issues = [...issuesTouching(ix, idsIn(node)), ...refIssuesIn(ix, node, env)];
  return issues.length > 0 ? invalid(issues) : ok(doc);
}

/** 삭제될 조를 밖에서 가리키는 조 참조 슬롯 (D-P4-7). */
function danglingRefs(ix: TreeIndex, removed: ReadonlySet<Id>, env: TreeEnv): Issue[] {
  const out: Issue[] = [];
  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (n.kind !== "articleRef" || n.scope !== "self" || removed.has(n.id)) continue;
    for (const target of n.targets) {
      if (!removed.has(target.nodeId)) continue;
      out.push({
        kind: "brokenRef",
        message: `노드 ${target.nodeId} 를 가리키는 참조 슬롯이 남아 있습니다`,
        at: { ...coordinateOf(ix, e, env.coordinate), refPath: target.nodeId },
      });
    }
  }
  return out;
}

/** else 는 마지막에 최대 1개 (D-P4-11). */
function elseRule(branches: (BlockBranch | InlineBranch)[], path: Id[]): Result<void> {
  const elseAt = branches.findIndex((b) => b.when === undefined);
  if (elseAt !== -1 && elseAt !== branches.length - 1) return structure("else 가지는 마지막에만 올 수 있습니다", path);
  if (branches.filter((b) => b.when === undefined).length > 1) return structure("else 가지는 하나만 둘 수 있습니다", path);
  return ok(undefined);
}

function entryOf(ix: TreeIndex, id: Id): Result<NodeEntry> {
  const e = ix.nodes.get(id);
  return e ? ok(e) : notFound(`노드 ${id}`);
}

/** 하위 트리를 새 id 로 복사한다. 사본 안의 자기 조 참조는 사본의 조를 가리킨다. 조연결·보통약관 참조는 그대로. */
function cloneSubtree<T extends Node>(root: T, newId: IdSource): T {
  const copy = structuredClone(root);
  const map = new Map<Id, Id>();
  const relabel = (n: Node) => {
    const id = newId();
    map.set(n.id, id);
    n.id = id;
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) {
        const bid = newId();
        map.set(br.id, bid);
        br.id = bid;
        (br.children as Node[]).forEach(relabel);
      }
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(relabel);
    cellNodesOf(n).forEach(relabel);
  };
  relabel(copy);
  for (const n of nodesIn(copy)) {
    if (n.kind === "articleRef" && n.scope === "self") {
      n.targets = n.targets.map(({ nodeId }) => ({ nodeId: map.get(nodeId) ?? nodeId }));
    }
  }
  return copy;
}

/** 문서 복제 (D-P4-4) — 모든 id 새로, 내부 조 참조는 따라간다. */
export function cloneTree(doc: DocumentNode, newId: IdSource = randomIds, title?: string): DocumentNode {
  const copy = cloneSubtree(doc, newId);
  return title === undefined ? copy : { ...copy, title };
}

// ───────────────────────────── 적용 ─────────────────────────────

export function applyCommands(doc: DocumentNode, commands: readonly Command[], opts: ApplyOptions = {}): Result<DocumentNode> {
  let cur = doc;
  for (const cmd of commands) {
    const r = applyCommand(cur, cmd, opts);
    if (!r.ok) return r;
    cur = r.value;
  }
  return ok(cur);
}

export function applyCommand(doc: DocumentNode, cmd: Command, opts: ApplyOptions = {}): Result<DocumentNode> {
  const env = opts.env ?? {};
  const work = structuredClone(doc);
  const ix = indexTree(work, env.coordinate);

  switch (cmd.type) {
    case "insert": {
      const c = containerOf(ix, cmd.at);
      if (!c.ok) return c;
      if (!c.value.allowed.includes(cmd.node.kind)) {
        return structure(`이 자리에 ${cmd.node.kind} 은(는) 올 수 없습니다 (허용: ${c.value.allowed.join(" · ")})`, [...c.value.path]);
      }
      const node = structuredClone(cmd.node);
      c.value.list.splice(clampIndex(cmd.at.index, c.value.list.length), 0, node);
      return verifyPlaced(work, node, env);
    }

    case "remove": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.parentId === undefined) return structure("문서 루트는 삭제할 수 없습니다", e.value.path);
      const dangling = danglingRefs(ix, idsIn(e.value.node), env);
      if (dangling.length > 0) return invalid(dangling);
      detach(ix, e.value);
      return ok(work);
    }

    case "move": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.parentId === undefined) return structure("문서 루트는 옮길 수 없습니다", e.value.path);
      const subtree = idsIn(e.value.node);
      if (subtree.has(cmd.to.parentId)) return structure("노드를 자기 하위로 옮길 수 없습니다", e.value.path);
      const c = containerOf(ix, cmd.to);
      if (!c.ok) return c;
      if (!c.value.allowed.includes(e.value.node.kind)) {
        return structure(`이 자리에 ${e.value.node.kind} 은(는) 올 수 없습니다 (허용: ${c.value.allowed.join(" · ")})`, [...c.value.path]);
      }
      detach(ix, e.value);
      c.value.list.splice(clampIndex(cmd.to.index, c.value.list.length), 0, e.value.node);
      return verifyPlaced(work, e.value.node, env);
    }

    case "duplicate": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.parentId === undefined) return structure("문서 루트는 복제할 수 없습니다 (문서 복제는 서비스 몫)", e.value.path);
      let source = opts.newId ?? randomIds;
      if (cmd.ids) {
        if (cmd.ids.length !== idsIn(e.value.node).size) return structure(`사본 id 가 ${idsIn(e.value.node).size}개 필요한데 ${cmd.ids.length}개입니다`, e.value.path);
        const queue = [...cmd.ids];
        source = () => queue.shift()!;
      }
      const copy = cloneSubtree(e.value.node, source);
      const at: Position = cmd.at ?? { parentId: e.value.parentId, slot: e.value.slot, index: e.value.index + 1 };
      const c = containerOf(ix, at);
      if (!c.ok) return c;
      if (!c.value.allowed.includes(copy.kind)) return structure(`이 자리에 ${copy.kind} 은(는) 올 수 없습니다`, [...c.value.path]);
      c.value.list.splice(clampIndex(at.index, c.value.list.length), 0, copy);
      return verifyPlaced(work, copy, env);
    }

    case "setText": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "text") return structure("텍스트런이 아닙니다", e.value.path);
      e.value.node.text = cmd.text;
      return ok(work);
    }

    case "setTitle": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "article" && e.value.node.kind !== "document" && e.value.node.kind !== "section") {
        return structure("제목은 문서 · 관 · 조에만 둘 수 있습니다", e.value.path);
      }
      e.value.node.title = cmd.title;
      return ok(work);
    }

    case "setTable": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "table") return structure("표가 아닌 노드에는 표 내용을 넣을 수 없습니다", e.value.path);
      const node = e.value.node as TableNode;
      let columns = cmd.columns.map((c) => (c.width !== undefined ? { width: c.width } : {}));
      // 행을 그대로 두는 편집(제목·너비만)에서는 열 수를 기존 행에 맞춘다
      if (!cmd.rows && node.rows.length > 0) {
        const width = node.rows[0].cells.length;
        columns = Array.from({ length: width }, (_x, i) => columns[i] ?? {});
      }
      const rows: TableRow[] = cmd.rows
        ? cmd.rows.map((row, ri) => ({
            ...(row.header ? { header: true } : {}),
            cells: row.cells.map((text, ci): InlineNode[] => [{ id: `${node.id}-r${ri}c${ci}`, kind: "text", text }]),
          }))
        : node.rows;
      const issues = tableIssues({ ...node, columns, rows });
      if (issues.length > 0) return structure(issues[0], e.value.path);
      delete node.title;
      if (cmd.title !== undefined && cmd.title !== "") node.title = cmd.title;
      node.columns = columns;
      node.rows = rows;
      return ok(work);
    }

    case "setTableRepeat": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "table") return structure("표가 아닌 노드에는 행 반복을 둘 수 없습니다", e.value.path);
      const node = e.value.node as TableNode;
      if (cmd.repeat === undefined) delete node.repeat;
      else if (cmd.repeat.depth !== 1 && cmd.repeat.depth !== 2) return structure("행 반복 깊이는 1(세부보장마다) 또는 2(세부보장 › 급부마다)입니다", e.value.path);
      else node.repeat = { depth: cmd.repeat.depth };
      return ok(work);
    }

    case "insertCell": {
      const e = entryOf(ix, cmd.tableId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "table") return structure("표가 아닙니다", e.value.path);
      const cell = (e.value.node as TableNode).rows[cmd.row]?.cells[cmd.col];
      if (!cell) return structure(`표에 ${cmd.row + 1}행 ${cmd.col + 1}열 셀이 없습니다`, e.value.path);
      const allowed = allowedChildren.paragraph;
      if (!allowed.includes(cmd.node.kind)) return structure(`표 셀에 ${cmd.node.kind} 은(는) 올 수 없습니다`, e.value.path);
      const node = structuredClone(cmd.node);
      cell.splice(clampIndex(cmd.index, cell.length), 0, node);
      return verifyPlaced(work, node, env);
    }

    case "insertTableRow":
    case "removeTableRow":
    case "insertTableColumn":
    case "removeTableColumn":
    case "setTableRowHeader": {
      const e = entryOf(ix, cmd.tableId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "table") return structure("표가 아닙니다", e.value.path);
      const node = e.value.node as TableNode;
      const width = node.columns.length;
      if (cmd.type === "insertTableRow") {
        node.rows.splice(clampIndex(cmd.index, node.rows.length), 0, { ...(cmd.header ? { header: true } : {}), cells: Array.from({ length: width }, () => []) });
      } else if (cmd.type === "removeTableRow") {
        if (!node.rows[cmd.index]) return structure(`표에 ${cmd.index + 1}행이 없습니다`, e.value.path);
        if (node.rows.length <= 1) return structure("표에는 행이 하나 이상 있어야 합니다 — 표를 지우세요", e.value.path);
        node.rows.splice(cmd.index, 1);
      } else if (cmd.type === "insertTableColumn") {
        const at = clampIndex(cmd.index, width);
        node.columns.splice(at, 0, {});
        for (const row of node.rows) row.cells.splice(at, 0, []);
      } else if (cmd.type === "removeTableColumn") {
        if (cmd.index < 0 || cmd.index >= width) return structure(`표에 ${cmd.index + 1}열이 없습니다`, e.value.path);
        if (width <= 1) return structure("표에는 열이 하나 이상 있어야 합니다 — 표를 지우세요", e.value.path);
        node.columns.splice(cmd.index, 1);
        for (const row of node.rows) row.cells.splice(cmd.index, 1);
      } else {
        const row = node.rows[cmd.index];
        if (!row) return structure(`표에 ${cmd.index + 1}행이 없습니다`, e.value.path);
        if (cmd.header) row.header = true;
        else delete row.header;
      }
      const issues = tableIssues(node);
      return issues.length > 0 ? structure(issues[0], e.value.path) : ok(work);
    }

    case "setInlines": {
      let list: Node[];
      let allowed: readonly Node["kind"][];
      let path: Id[];
      if ("tableId" in cmd.at) {
        const e = entryOf(ix, cmd.at.tableId);
        if (!e.ok) return e;
        if (e.value.node.kind !== "table") return structure("표가 아닙니다", e.value.path);
        const cell = (e.value.node as TableNode).rows[cmd.at.row]?.cells[cmd.at.col];
        if (!cell) return structure(`표에 ${cmd.at.row + 1}행 ${cmd.at.col + 1}열 셀이 없습니다`, e.value.path);
        list = cell;
        allowed = allowedChildren.paragraph;
        path = e.value.path;
      } else {
        const c = containerOf(ix, { parentId: cmd.at.parentId });
        if (!c.ok) return c;
        if (!c.value.allowed.includes("text")) return structure("문장 자리가 아닙니다", c.value.path);
        list = c.value.list;
        allowed = c.value.allowed;
        path = c.value.path;
      }
      const current = new Map(list.map((n) => [n.id, n] as const));
      const used = new Set<Id>();
      const next: Node[] = [];
      const added: Node[] = [];
      for (const run of cmd.runs) {
        if ("keep" in run) {
          const n = current.get(run.keep);
          if (!n || used.has(run.keep)) return structure(`이 자리에 노드 ${run.keep} 가 없습니다`, path);
          used.add(run.keep);
          next.push(n);
        } else if ("text" in run) {
          if (run.text === "") continue;
          const n = current.get(run.id);
          if (n && (n.kind !== "text" || used.has(run.id))) return structure(`노드 ${run.id} 는 이 자리의 문장이 아닙니다`, path);
          if (n) {
            used.add(run.id);
            (n as { text: string }).text = run.text;
            next.push(n);
          } else {
            const t: Node = { id: run.id, kind: "text", text: run.text };
            next.push(t);
            added.push(t);
          }
        } else {
          if (!allowed.includes(run.node.kind)) return structure(`이 자리에 ${run.node.kind} 은(는) 올 수 없습니다 (허용: ${allowed.join(" · ")})`, path);
          const n = structuredClone(run.node);
          next.push(n);
          added.push(n);
        }
      }
      list.splice(0, list.length, ...next);
      const after = indexTree(work, env.coordinate);
      const ids = new Set<Id>();
      for (const n of added) idsIn(n).forEach((id) => ids.add(id));
      const issues = issuesTouching(after, ids);
      for (const n of added) issues.push(...refIssuesIn(after, n, env));
      return issues.length > 0 ? invalid(issues) : ok(work);
    }

    case "setBox": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "box") return structure("박스가 아닌 노드에는 박스 내용을 넣을 수 없습니다", e.value.path);
      const node = e.value.node as BoxNode;
      node.title = cmd.title;
      node.lines = [...cmd.lines];
      return ok(work);
    }

    case "setSlotRef": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "slot") return structure("슬롯이 아닙니다", e.value.path);
      e.value.node.ref = cmd.ref;
      return ok(work);
    }

    case "setArticleRef":
    case "setAppendixRef":
    case "setClauseOptions": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      const n = e.value.node;
      if (cmd.type === "setArticleRef") {
        if (n.kind !== "articleRef") return structure("조 참조 슬롯이 아닙니다", e.value.path);
        n.targets = cmd.targets.map((target) => ({ ...target }));
        if (cmd.connector === undefined) delete n.connector;
        else n.connector = cmd.connector;
        n.scope = cmd.scope;
      } else if (cmd.type === "setAppendixRef") {
        if (n.kind !== "appendixRef") return structure("별표 참조 슬롯이 아닙니다", e.value.path);
        n.appendixCode = cmd.appendixCode;
      } else {
        if (n.kind !== "clauseBlockRef" && n.kind !== "clauseInlineRef") return structure("함수조항 참조가 아닙니다", e.value.path);
        n.options = { ...cmd.options };
        if (cmd.bindings !== undefined) {
          if (Object.keys(cmd.bindings).length === 0) delete n.bindings;
          else n.bindings = structuredClone(cmd.bindings);
        }
      }
      const issues = checkNodeRefs(e.value, ix, env, false);
      return issues.length > 0 ? invalid(issues) : ok(work);
    }

    case "setFor": {
      const e = entryOf(ix, cmd.nodeId);
      if (!e.ok) return e;
      const n = e.value.node;
      if (n.kind !== "forBlock" && n.kind !== "inlineFor") return structure("반복 노드가 아닙니다", e.value.path);
      if (cmd.source !== undefined) n.source = cmd.source;
      if (cmd.alias !== undefined) n.alias = cmd.alias;
      if (cmd.separator !== undefined && n.kind === "inlineFor") n.separator = cmd.separator;
      return ok(work);
    }

    case "addBranch": {
      const e = entryOf(ix, cmd.condId);
      if (!e.ok) return e;
      const brs = branchesOf(e.value.node);
      if (!brs) return structure("조건 노드가 아닙니다", e.value.path);
      const branch = structuredClone(cmd.branch);
      brs.splice(clampIndex(cmd.index, brs.length), 0, branch as BlockBranch & InlineBranch);
      const rule = elseRule(brs, e.value.path);
      if (!rule.ok) return rule;
      const after = indexTree(work, env.coordinate);
      const ids = new Set<Id>([branch.id]);
      (branch.children as Node[]).forEach((c) => idsIn(c).forEach((id) => ids.add(id)));
      const issues = issuesTouching(after, ids);
      for (const child of branch.children as Node[]) issues.push(...refIssuesIn(after, child, env));
      return issues.length > 0 ? invalid(issues) : ok(work);
    }

    case "setWhen": {
      const b = ix.branches.get(cmd.branchId);
      if (!b) return notFound(`가지 ${cmd.branchId}`);
      if (cmd.when === undefined) delete b.branch.when;
      else b.branch.when = cmd.when;
      const owner = ix.nodes.get(b.ownerId)!;
      const rule = elseRule(branchesOf(owner.node)!, owner.path);
      return rule.ok ? ok(work) : rule;
    }

    case "removeBranch": {
      const b = ix.branches.get(cmd.branchId);
      if (!b) return notFound(`가지 ${cmd.branchId}`);
      const owner = ix.nodes.get(b.ownerId)!;
      const brs = branchesOf(owner.node)!;
      if (brs.length <= 1) return reject({ reason: "minimumStructure", what: "마지막 남은 조건 가지 — 조건 노드를 삭제하세요" });
      const removed = new Set<Id>([b.branch.id]);
      (b.branch.children as Node[]).forEach((c) => idsIn(c).forEach((id) => removed.add(id)));
      const dangling = danglingRefs(ix, removed, env);
      if (dangling.length > 0) return invalid(dangling);
      brs.splice(b.index, 1);
      return ok(work);
    }

    case "moveBranch": {
      const b = ix.branches.get(cmd.branchId);
      if (!b) return notFound(`가지 ${cmd.branchId}`);
      const owner = ix.nodes.get(b.ownerId)!;
      const brs = branchesOf(owner.node)!;
      brs.splice(b.index, 1);
      brs.splice(clampIndex(cmd.index, brs.length), 0, b.branch as BlockBranch & InlineBranch);
      const rule = elseRule(brs, owner.path);
      return rule.ok ? ok(work) : rule;
    }

    case "link": {
      const e = entryOf(ix, cmd.articleId);
      if (!e.ok) return e;
      if (e.value.node.kind !== "article") return structure("조연결은 조에만 둘 수 있습니다", e.value.path);
      if (cmd.linkedArticleId === undefined) delete e.value.node.linkedArticleId;
      else e.value.node.linkedArticleId = cmd.linkedArticleId;
      const issues = checkNodeRefs(e.value, ix, env, false);
      return issues.length > 0 ? invalid(issues) : ok(work);
    }
  }
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  return Math.max(0, Math.min(index, length));
}

/** 노드를 부모 목록에서 뗀다 (색인 기준). */
function detach(ix: TreeIndex, e: NodeEntry): void {
  const parentBranch = ix.branches.get(e.parentId!);
  const list = parentBranch ? (parentBranch.branch.children as Node[]) : listOf(ix.nodes.get(e.parentId!)!.node, e.slot)!;
  const i = list.indexOf(e.node);
  list.splice(i, 1);
}
