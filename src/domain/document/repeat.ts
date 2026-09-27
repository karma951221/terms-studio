/**
 * 행 반복 표 (ADR-0070 결정 6) — 템플릿 행 복제 · 구조 표기 치환 · 바깥 key 세로 병합 · 저장 검사.
 *
 * - 머리글이 아닌 행이 **템플릿**이다. 문맥 노드에서 `descend(depth)` 로 얻은 행 레벨 사슬의 key 조합마다
 *   템플릿 행 전부를 복제한다 (바깥 order → 안쪽 order). 조합이 0 이면 표를 통째로 생략한다 (호출자 몫).
 * - 복제본의 노드 · 가지 id 는 `${원 id}@${행 노드 id}` — 문서 안에서 유일하고, 좌표(nodePath)에 행 노드 id 가 실린다.
 *   원 템플릿 id 는 `templateIdOf` 로 되찾는다 (편집기가 오류 자리를 템플릿 셀로 안내할 때).
 * - `structKey{level}` 는 그 행의 `level` 노드 표기(`keyLabel`) 텍스트로 바뀐다.
 * - 한정자 없는 구분자 참조는 **행 노드(가장 안쪽 key)의 문맥**에서 평가한다 — 문맥이 자기-또는-조상을 찾으므로
 *   구분자 레벨 노드가 곧 행 문맥의 그 레벨 노드다. `@노드` 한정 참조는 그대로(고정 노드).
 * - 병합: 템플릿 행이 하나일 때, 바깥 레벨 구조 표기만 든 열은 같은 노드가 이어지는 동안 첫 행 span = n, 나머지 0.
 *
 * 순수층 — DB · React 없음.
 */

import { extractRefs, parse } from "../expression";
import { descend, keyLabel, type ChildLevel, type RowKey, type StructNode } from "../structure";
import { ATTACH_LEVEL_LABEL, ATTACH_LEVELS, type AttachLevel, type Code, type Coordinate, type Id, type Issue } from "../types";
import { coordinateOf, indexTree, type DocumentNode, type InlineNode, type NodeEntry, type TableNode, type TableRow, type TreeIndex } from "./nodes";

/** 담보 약관 문서의 반복 뿌리 레벨 — 문맥 노드 = 문맥 담보. 상품 문맥 반복은 이후 (ADR-0070 결정 7). */
export const REPEAT_ROOT_LEVEL: AttachLevel = "coverage";

const CLONE_SEP = "@";

/** 복제본 id — 템플릿 노드 id + 행 노드 id. */
export function repeatCloneId(templateId: Id, rowNodeId: Id): Id {
  return `${templateId}${CLONE_SEP}${rowNodeId}`;
}

/** 복제본 id → 템플릿 노드 id (복제본이 아니면 그대로). */
export function templateIdOf(id: Id): Id {
  const i = id.indexOf(CLONE_SEP);
  return i < 0 ? id : id.slice(0, i);
}

export function isRepeatTable(node: { kind: string }): node is TableNode & { repeat: { depth: 1 | 2 } } {
  return node.kind === "table" && (node as TableNode).repeat !== undefined;
}

/** 반복 표의 행 레벨 사슬 (담보 문서: 1 = [세부보장], 2 = [세부보장, 급부]). */
export function repeatLevels(table: TableNode, root: AttachLevel = REPEAT_ROOT_LEVEL): ChildLevel[] {
  return table.repeat ? descend(root, table.repeat.depth) : [];
}

/**
 * 반복 셀에서 한정자 없이 읽을 수 있는 레벨 — 행 레벨과 그 위 전부 (「현재 행」 가지의 잎 레벨).
 * 편집기 트리 패널이 반복 셀에서 맨 위에 그리는 가지의 재료다.
 */
export function rowReadableLevels(levels: readonly ChildLevel[]): AttachLevel[] {
  const row = levels[levels.length - 1];
  if (!row) return [];
  return ATTACH_LEVELS.slice(0, ATTACH_LEVELS.indexOf(row) + 1);
}

/** 노드가 반복 표 **템플릿 행** 안에 있으면 그 표와 행 레벨 사슬. 편집기의 「현재 행」 가지 판단용. */
export function repeatScopeOf(doc: DocumentNode, nodeId: Id): { table: TableNode; levels: ChildLevel[]; readable: AttachLevel[] } | undefined {
  const ix = indexTree(doc);
  const e = ix.nodes.get(nodeId);
  if (!e) return undefined;
  const hit = enclosingTemplate(ix, e);
  if (!hit) return undefined;
  const levels = repeatLevels(hit.table);
  return { table: hit.table, levels, readable: rowReadableLevels(levels) };
}

/** 색인 항목이 서 있는 표 셀 — 경로의 셀 표식(`${표id}-r${행}c${열}`)으로 찾는다. */
function enclosingCell(ix: TreeIndex, e: { path: Id[] }): { table: TableNode; row: number; col: number } | undefined {
  for (let i = e.path.length - 1; i >= 0; i--) {
    const m = /^(.*)-r(\d+)c(\d+)$/.exec(e.path[i]);
    if (!m) continue;
    const t = ix.nodes.get(m[1])?.node;
    if (t?.kind === "table") return { table: t, row: Number(m[2]), col: Number(m[3]) };
  }
  return undefined;
}

function enclosingTemplate(ix: TreeIndex, e: { path: Id[] }): { table: TableNode; row: number } | undefined {
  const cell = enclosingCell(ix, e);
  if (!cell || !isRepeatTable(cell.table) || cell.table.rows[cell.row]?.header) return undefined;
  return cell;
}

// ───────────────────────────── 펼침 ─────────────────────────────

/** 인라인 노드 하나를 행으로 복제 — id 에 행 노드 id 를 붙이고, 구조 표기는 key 표기 텍스트로. */
function cloneInline(n: InlineNode, key: RowKey, rowId: Id, issues: { level: ChildLevel; id: Id }[]): InlineNode {
  const id = repeatCloneId(n.id, rowId);
  switch (n.kind) {
    case "structKey": {
      const hit = key.find((k) => k.level === n.level);
      if (!hit) {
        issues.push({ level: n.level, id });
        return { ...n, id };
      }
      return { id, kind: "text", text: keyLabel(hit) };
    }
    case "inlineCond":
      return { ...n, id, branches: n.branches.map((b) => ({ ...b, id: repeatCloneId(b.id, rowId), children: b.children.map((c) => cloneInline(c, key, rowId, issues)) })) };
    case "inlineFor":
      return { ...n, id, children: n.children.map((c) => cloneInline(c, key, rowId, issues)) };
    case "articleRef":
      return { ...n, id, targets: n.targets.map((t) => ({ ...t })) };
    case "clauseInlineRef":
      return { ...n, id, options: { ...n.options } };
    default:
      return { ...n, id };
  }
}

/** 셀이 바깥 key 열인가 — 바깥 레벨 구조 표기가 있고 행 레벨(가장 안쪽) 구조 표기는 없다. */
function outerLevelOf(cell: readonly InlineNode[], levels: readonly ChildLevel[]): ChildLevel | undefined {
  if (levels.length < 2) return undefined;
  const inner = levels[levels.length - 1];
  const keys = structKeysIn(cell);
  if (keys.some((k) => k.level === inner)) return undefined;
  return keys.find((k) => levels.slice(0, -1).includes(k.level))?.level;
}

/** 인라인 목록 안의 구조 표기 전부 (가지 · 반복 안까지). */
export function structKeysIn(list: readonly InlineNode[]): (InlineNode & { kind: "structKey" })[] {
  const out: (InlineNode & { kind: "structKey" })[] = [];
  const walk = (n: InlineNode) => {
    if (n.kind === "structKey") out.push(n);
    else if (n.kind === "inlineCond") n.branches.forEach((b) => b.children.forEach(walk));
    else if (n.kind === "inlineFor") n.children.forEach(walk);
  };
  list.forEach(walk);
  return out;
}

export interface ExpandedRow {
  /** 펼친 표에서의 행 번호. */
  index: number;
  /** 원 표의 템플릿 행 번호. */
  template: number;
  key: RowKey;
  /** 행 노드 — 가장 안쪽 key. 셀의 한정자 없는 참조를 평가하는 문맥 노드. */
  node: StructNode;
}

export interface ExpandedTable {
  /** 펼친 표 — `repeat` 은 지워지고, 복제 행은 id 가 바뀌고 구조 표기는 텍스트다. 병합이 있으면 행마다 `spans`. */
  table: TableNode;
  rows: ExpandedRow[];
  /** 행 사슬 밖 구조 표기(저장 검사가 막는 꼴) — 복제본 id 와 레벨. */
  strayKeys: { level: ChildLevel; id: Id }[];
}

/**
 * 반복 표를 key 조합으로 펼친다 — 조합이 비어 있으면 undefined (표 생략).
 * 머리글 행은 제자리, 템플릿 행 묶음은 첫 템플릿 행 자리에 조합 수만큼 펼친다.
 */
export function expandRepeatTable(table: TableNode, keys: readonly RowKey[], levels: readonly ChildLevel[] = repeatLevels(table)): ExpandedTable | undefined {
  if (keys.length === 0) return undefined;
  const templates = table.rows.map((row, i) => ({ row, i })).filter((x) => !x.row.header);
  const firstTemplate = templates[0]?.i ?? table.rows.length;
  const before = table.rows.slice(0, firstTemplate).filter((r) => r.header);
  const after = table.rows.slice(firstTemplate).filter((r) => r.header);
  const strayKeys: { level: ChildLevel; id: Id }[] = [];
  const body: TableRow[] = [];
  const rows: ExpandedRow[] = [];
  for (const key of keys) {
    const node = key[key.length - 1];
    for (const t of templates) {
      rows.push({ index: before.length + body.length, template: t.i, key, node });
      body.push({ cells: t.row.cells.map((cell) => cell.map((n) => cloneInline(n, key, node.id, strayKeys))) });
    }
  }
  // 바깥 key 세로 병합 — 템플릿 행이 하나일 때만 (여러 줄 템플릿의 병합은 ADR-0070 「그 외 병합」 — 이후)
  if (templates.length === 1) {
    const cols = templates[0].row.cells.map((cell) => outerLevelOf(cell, levels));
    if (cols.some((c) => c !== undefined)) {
      body.forEach((r) => (r.spans = r.cells.map(() => 1)));
      cols.forEach((level, c) => {
        if (level === undefined) return;
        let start = 0;
        for (let i = 1; i <= keys.length; i++) {
          const same = i < keys.length && keys[i].find((k) => k.level === level)?.id === keys[start].find((k) => k.level === level)?.id;
          if (same) continue;
          body[start].spans![c] = i - start;
          for (let j = start + 1; j < i; j++) body[j].spans![c] = 0;
          start = i;
        }
      });
    }
  }
  const { repeat: _repeat, ...rest } = table;
  void _repeat;
  return { table: { ...rest, rows: [...before, ...body, ...after] }, rows, strayKeys };
}

// ───────────────────────────── 저장 검사 (설계 §2.6) ─────────────────────────────

export interface RepeatScope {
  /** 문맥 담보가 있는 문서(담보 약관 템플릿)인가. */
  hasCoverage: boolean;
  /** 구분자 레벨 조회 — 없으면 한정자 없는 참조의 레벨 검사를 건너뛴다. */
  levelOf?: (code: Code) => AttachLevel | undefined;
}

const MSG = {
  noCoverage: "반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다",
  depth1Benefit: "이 표는 세부보장까지만 반복합니다 — 급부 표기는 깊이 2 에서",
  belowRow: "행보다 아래 레벨은 그 레벨을 집계한 구분자로 쓰세요",
  outside: "구조 표기는 반복 표 안에서만",
  flat: "모든 행이 같아집니다",
} as const;

/** 식 소스의 참조들 — 문법이 깨졌으면 빈 목록 (문법 오류는 `validateExpressions` 가 보고한다). */
function refsOf(src: string) {
  const parsed = parse(src);
  return parsed.ok ? extractRefs(parsed.value) : [];
}

/**
 * 반복 표 저장 검사 — 오류 넷 · 경고 하나 (설계 §2.6). 경고는 `severity: "warning"`.
 * 기존 `@노드` 검사(끊어진 참조 · 레벨 불일치)는 `validateExpressions` 그대로.
 */
export function repeatTableIssues(doc: DocumentNode, scope: RepeatScope, base: Coordinate = {}): Issue[] {
  const ix = indexTree(doc, base);
  const issues: Issue[] = [];
  const at = (e: { path: Id[]; articleId?: Id }, extra: Partial<Coordinate> = {}): Coordinate => ({ ...coordinateOf(ix, e, base), ...extra });

  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (isRepeatTable(n)) {
      if (!scope.hasCoverage) issues.push({ kind: "structure", message: MSG.noCoverage, at: at(e), severity: "error" });
      const templates = n.rows.filter((r) => !r.header);
      const live = templates.some((r) => r.cells.some((cell) => cellHasDynamic(cell)));
      if (!live) issues.push({ kind: "structure", message: MSG.flat, at: at(e), severity: "warning" });
      continue;
    }
    if (n.kind === "structKey") {
      const tpl = enclosingTemplate(ix, e);
      if (!tpl) {
        issues.push({ kind: "structure", message: MSG.outside, at: at(e), severity: "error" });
        continue;
      }
      const levels = repeatLevels(tpl.table);
      if (!levels.includes(n.level)) {
        const message =
          tpl.table.repeat?.depth === 1 && n.level === "benefit"
            ? MSG.depth1Benefit
            : `구조 표기 「${ATTACH_LEVEL_LABEL[n.level]}」 은(는) 이 표의 반복 레벨(${levels.map((l) => ATTACH_LEVEL_LABEL[l]).join(" › ")}) 밖입니다`;
        issues.push({ kind: "structure", message, at: at(e), severity: "error" });
      }
      continue;
    }
    if (!scope.levelOf) continue;
    const sources = expressionSources(n, ix, e, base);
    if (sources.length === 0) continue;
    const tpl = enclosingTemplate(ix, e);
    if (!tpl) continue;
    const levels = repeatLevels(tpl.table);
    const row = levels[levels.length - 1];
    if (!row) continue;
    for (const s of sources) {
      for (const { ref, path, aggregate } of refsOf(s.src)) {
        if (ref.kind !== "discriminator" || ref.node || aggregate) continue;
        const level = scope.levelOf(ref.code);
        if (level === undefined || ATTACH_LEVELS.indexOf(level) <= ATTACH_LEVELS.indexOf(row)) continue;
        issues.push({ kind: "structure", message: MSG.belowRow, at: { ...s.at, refPath: path }, severity: "error" });
      }
    }
  }
  return issues;
}

/** 노드의 식 자리 — 슬롯 ref · 인라인 조건 가지 when. */
function expressionSources(n: NodeEntry["node"], ix: TreeIndex, e: NodeEntry, base: Coordinate): { src: string; at: Coordinate }[] {
  if (n.kind === "slot") return [{ src: n.ref, at: coordinateOf(ix, e, base) }];
  if (n.kind === "inlineCond") {
    return n.branches.flatMap((b) => {
      const be = ix.branches.get(b.id);
      return b.when !== undefined && be ? [{ src: b.when, at: coordinateOf(ix, be, base) }] : [];
    });
  }
  return [];
}

/** 셀이 행마다 달라질 수 있는가 — 구조 표기 · 슬롯 · 조건식이 하나라도. */
function cellHasDynamic(cell: readonly InlineNode[]): boolean {
  const walk = (n: InlineNode): boolean => {
    switch (n.kind) {
      case "structKey":
      case "slot":
        return true;
      case "inlineCond":
        return n.branches.some((b) => b.when !== undefined || b.children.some(walk));
      case "inlineFor":
        return n.children.some(walk);
      default:
        return false;
    }
  };
  return cell.some(walk);
}
