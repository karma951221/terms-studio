/**
 * 구조 상수 — 문맥 트리를 dict 로 읽는 규칙 (ADR-0070 결정 1 · 2).
 *
 * dict 는 실체가 아니다. **가지 = 부착 레벨**, **key = 문맥 트리의 실제 노드**, **잎 = 그 레벨의 구분자**.
 * 여기에는 레벨 → 자식 레벨 · key 표기 규칙(다섯 층 상수)과 레벨별 자식 제공자 인터페이스만 둔다.
 * 제공자 구현은 문맥을 아는 쪽이 댄다 — MVP 는 담보 트리(coverage · subCoverage, `coverage/children.ts`).
 * plan · product 제공자(종·형 조합의 탑재)는 인터페이스만 있다 — 없으면 「제공자 없음」.
 *
 * 순수층 — DB · React 없음.
 */

import { ATTACH_LEVEL_LABEL, type AttachLevel, type DictType, type FieldType, type Id, reject, ok, type Result } from "./types";

/** 자식이 될 수 있는 레벨 — 상품은 루트라 key 가 되지 않는다. */
export type ChildLevel = Exclude<AttachLevel, "product">;

/** 구조 노드 지시자 — 레벨 + id. 담보 트리 레벨이면 `CoverageNodeRef` 와 같은 모양이다. */
export interface StructNodeRef {
  level: AttachLevel;
  id: Id;
}

/** 구조 노드 — 지시자 + 이름 + 형제 순서(0부터). 반복 표의 key 한 칸. */
export interface StructNode extends StructNodeRef {
  name: string;
  order: number;
}

export interface LevelStructure {
  level: AttachLevel;
  child?: ChildLevel;
  /** 이 레벨 아래 key(자식 노드)의 표기 — 반복 표 key 열 · 트리 노드 표기. 잎은 자식이 없어 없다. */
  keyLabel?: (node: StructNode) => string;
}

const byName = (n: StructNode) => n.name;

/** 다섯 층 — 상품 › 세목 › 담보 › 세부보장 › 급부. 급부가 잎. */
export const LEVEL_STRUCTURE: readonly LevelStructure[] = [
  { level: "product", child: "plan", keyLabel: byName }, // 세목명
  { level: "plan", child: "coverage", keyLabel: byName }, // 상품담보명
  { level: "coverage", child: "subCoverage", keyLabel: byName }, // 세부보장명
  // 급부 N 급부명 — N 은 사람이 세는 순번 (order 는 0부터라 +1)
  { level: "subCoverage", child: "benefit", keyLabel: (n) => `급부 ${n.order + 1} ${n.name}` },
  { level: "benefit" },
];

export function levelStructure(level: AttachLevel): LevelStructure {
  return LEVEL_STRUCTURE.find((l) => l.level === level)!;
}

export function childLevelOf(level: AttachLevel): ChildLevel | undefined {
  return levelStructure(level).child;
}

/** key 표기 — 부모 레벨(자식이 이 노드의 레벨인 층)의 규칙으로. 루트(상품)는 key 가 아니라 이름 그대로. */
export function keyLabel(node: StructNode): string {
  const parent = LEVEL_STRUCTURE.find((l) => l.child === node.level);
  return parent?.keyLabel ? parent.keyLabel(node) : node.name;
}

/** 반복 표의 행 레벨 사슬 — `from` 의 자식부터 `depth` 층. 잎을 넘으면 거기서 끊긴다. */
export function descend(from: AttachLevel, depth: 1 | 2): ChildLevel[] {
  const out: ChildLevel[] = [];
  let level: AttachLevel = from;
  for (let i = 0; i < depth; i++) {
    const child = childLevelOf(level);
    if (!child) break;
    out.push(child);
    level = child;
  }
  return out;
}

/**
 * 레벨의 dict 타입 — 상수에서 파생 (조회 트리 · 검사용). 잎(급부)은 dict 가 아니다.
 * 가장 안쪽 value 는 `leaf`(그 레벨 구분자의 결과 타입). 주지 않으면 key 표기(string) — 모양만 볼 때.
 */
export function dictTypeOf(level: AttachLevel, leaf: FieldType = { kind: "string" }): DictType | undefined {
  const child = childLevelOf(level);
  if (!child) return undefined;
  return { kind: "dict", key: { kind: "node", level: child }, value: dictTypeOf(child, leaf) ?? leaf };
}

// ───────────────────────────── 자식 제공자 ─────────────────────────────

/** 노드 → 자식 노드들 (order 오름차순). 레벨마다 하나. */
export interface ChildrenProvider {
  children(node: StructNodeRef): StructNode[];
}

/** 레벨별 제공자 — 키 레벨 = 부모 레벨. MVP 구현은 coverage · subCoverage 둘. */
export type ChildrenProviders = Partial<Record<AttachLevel, ChildrenProvider>>;

/** 반복 표의 한 행 key — 바깥부터 안쪽까지의 노드 사슬 (`descend` 순). */
export type RowKey = StructNode[];

/**
 * key 조합 열거 — 문맥 노드에서 `depth` 층 내려가며 제공자로 자식을 펼친다 (바깥 order → 안쪽 order).
 * 도중에 자식이 없는 가지는 조합을 내지 않는다. 제공자가 없는 레벨이면 거부(notFound — 「제공자 없음」).
 */
export function enumerateRows(root: StructNode, depth: 1 | 2, providers: ChildrenProviders): Result<RowKey[]> {
  const chain = descend(root.level, depth);
  if (chain.length === 0) return reject({ reason: "notFound", what: `${ATTACH_LEVEL_LABEL[root.level]} 아래 반복할 레벨` });
  const rows: RowKey[] = [];
  const walk = (parent: StructNode, prefix: RowKey, i: number): Result<void> => {
    const provider = providers[parent.level];
    if (!provider) return reject({ reason: "notFound", what: `${ATTACH_LEVEL_LABEL[parent.level]} 자식 제공자` });
    const kids = [...provider.children(parent)].sort((a, b) => a.order - b.order);
    for (const kid of kids) {
      const key = [...prefix, kid];
      if (i === chain.length - 1) rows.push(key);
      else {
        const r = walk(kid, key, i + 1);
        if (!r.ok) return r;
      }
    }
    return ok(undefined);
  };
  const r = walk(root, [], 0);
  return r.ok ? ok(rows) : r;
}

/**
 * 반복 표의 행 원천 — 문맥 노드(뿌리) · 자식 제공자 · 행 노드의 평가 문맥.
 * 문맥 종류(`C`)는 쓰는 쪽이 정한다 (조립은 식 언어의 EvalContext).
 */
export interface RowSource<C> {
  root: StructNode;
  providers: ChildrenProviders;
  /** 행 노드(가장 안쪽 key)의 평가 문맥 — 한정자 없는 참조는 그 노드의 자기-또는-조상에서 읽힌다. 없는 노드면 undefined. */
  rowContext(node: StructNodeRef): C | undefined;
}
