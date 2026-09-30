/**
 * 편집본 (ADR-0074) — 저작 화면은 `편집` 때 받은 원본에 명령을 **브라우저에서** 적용하고, 적용한 명령을 목록으로 쌓는다.
 * `저장` 은 그 목록과 시작 판을 서버로 보내고, 서버는 원본에 같은 목록을 다시 적용한다(`replayEdits`).
 * 브라우저와 서버가 이 한 벌의 순수 함수로 명령을 적용하므로 결과가 같다.
 *
 * - 편집 명령 = 트리 명령(`Command`) + **대응 보통약관 지정**(문서의 속성이라 편집에 포함한다 — ADR-0074 결정 6).
 * - 복제는 새 id 를 매기므로, 브라우저에서 매긴 id 를 명령에 실어(`duplicate.ids`) 서버가 같은 id 로 다시 적용한다.
 *   그래야 사본을 가리키는 뒤 명령(사본의 제목 고치기 등)이 서버에서도 성립한다.
 * - 명령 단위 검사는 `applyCommand` 그대로다(건드린 자리). 문서 전체 검증은 `validateDocument`(validate.ts).
 */
import { ok, reject } from "../types";
import type { Id, Result } from "../types";
import type { IdSource } from "./builders";
import { randomIds } from "./builders";
import { applyCommand, type Command } from "./commands";
import { branchesOf, cellNodesOf, indexTree, listOf, slotsOf, type DocumentNode, type Node, type TreeEnv } from "./nodes";
import { referenceKeys } from "./pcode";
import { repeatedKeys } from "./blockRepeat";
import { collectRefs } from "./refs";

/** 편집 명령 — 트리 명령 또는 대응 보통약관 지정(`generalDocumentId` 없음 = 해제). */
export type EditOp = Command | { type: "setGeneralDocument"; generalDocumentId?: Id };

/** 편집본 — 트리와 대응 보통약관. */
export interface DraftState {
  tree: DocumentNode;
  generalDocumentId?: Id;
}

/** 보통약관 한 벌이 조연결 · 보통약관 조 참조에 내놓는 대상. */
export interface GeneralRefs {
  /** 조 id — 조연결 대상. */
  articleIds: ReadonlySet<Id>;
  /** 참조 대상 열쇠(조 id · 조#코드, `refKey`) — `scope:'general'` 조 참조 대상 (ADR-0072). */
  referenceKeys: ReadonlySet<string>;
  /** 반복 블록 안 대상 열쇠 — 대상이 하나여도 연결어가 필요하다 (결정 14 확장). */
  repeatedKeys?: ReadonlySet<string>;
}

export interface EditEnv {
  /** 대응 보통약관을 뺀 검증 환경 (종류 · 별표 · 함수조항 게이트 · 좌표). */
  env: TreeEnv;
  /** 보통약관 템플릿 id → 그 대상. 없는 문서이거나 보통약관이 아니면 undefined. */
  generalRefs: (generalDocumentId: Id) => GeneralRefs | undefined;
  /** 복제의 새 id 공급원. 기본 uuid. */
  newId?: IdSource;
}

export function generalRefsOf(tree: DocumentNode): GeneralRefs {
  const ix = indexTree(tree);
  const articleIds = new Set<Id>();
  for (const e of ix.nodes.values()) if (e.node.kind === "article") articleIds.add(e.node.id);
  return { articleIds, referenceKeys: referenceKeys(ix), repeatedKeys: repeatedKeys(ix) };
}

/** 대응 보통약관이 `generalDocumentId` 일 때의 검증 환경. 담보약관이 아직 안 골랐으면 조연결 대상은 빈 집합이다. */
export function envAt(edit: EditEnv, generalDocumentId: Id | undefined): TreeEnv {
  if (edit.env.kind !== "special") return edit.env;
  const refs = generalDocumentId !== undefined ? edit.generalRefs(generalDocumentId) : undefined;
  return { ...edit.env, generalArticleIds: refs?.articleIds ?? new Set(), generalReferenceKeys: refs?.referenceKeys ?? new Set(), ...(refs?.repeatedKeys ? { generalRepeatedKeys: refs.repeatedKeys } : {}) };
}

function invalid<T>(message: string): Result<T> {
  return reject({ reason: "invalid", issues: [{ kind: "structure", message, at: {} }] });
}

/**
 * 편집 명령 하나를 편집본에 적용한다. 돌려주는 `op` 가 명령 목록에 쌓을 것이다 — 복제면 매긴 사본 id 가 실려 있다.
 * 거부되면 편집본은 그대로다(입력 상태를 바꾸지 않는다).
 */
export function applyEdit(state: DraftState, op: EditOp, edit: EditEnv): Result<{ state: DraftState; op: EditOp }> {
  if (op.type === "setGeneralDocument") {
    if (edit.env.kind !== "special") return invalid("대응 보통약관은 담보약관 템플릿에만 지정합니다");
    if (op.generalDocumentId === undefined) {
      const remaining = collectRefs(state.tree, edit.env.coordinate).filter((r) => r.kind === "link" || (r.kind === "article" && r.scope === "general"));
      if (remaining.length > 0) {
        return reject({ reason: "invalid", issues: remaining.map((r) => ({ kind: "brokenRef", message: "조연결 · 보통약관 조 참조가 남아 있어 대응 보통약관을 해제할 수 없습니다", at: r.at })) });
      }
      const { generalDocumentId: _drop, ...rest } = state;
      void _drop;
      return ok({ state: rest, op });
    }
    if (!edit.generalRefs(op.generalDocumentId)) return reject({ reason: "notFound", what: `보통약관 템플릿 ${op.generalDocumentId}` });
    return ok({ state: { ...state, generalDocumentId: op.generalDocumentId }, op });
  }

  const env = envAt(edit, state.generalDocumentId);
  if (op.type === "duplicate" && op.ids === undefined) {
    const used: Id[] = [];
    const source = edit.newId ?? randomIds;
    const r = applyCommand(state.tree, op, {
      env,
      newId: () => {
        const id = source();
        used.push(id);
        return id;
      },
    });
    return r.ok ? ok({ state: { ...state, tree: r.value }, op: { ...op, ids: used } }) : r;
  }
  const r = applyCommand(state.tree, op, { env, ...(edit.newId ? { newId: edit.newId } : {}) });
  return r.ok ? ok({ state: { ...state, tree: r.value }, op }) : r;
}

/** 명령 목록을 차례로 다시 적용한다 — 하나라도 거부되면 전체 거부 (서버의 저장). */
export function replayEdits(start: DraftState, ops: readonly EditOp[], edit: EditEnv): Result<DraftState> {
  let state = start;
  for (const op of ops) {
    const r = applyEdit(state, op, edit);
    if (!r.ok) return r;
    state = r.value.state;
  }
  return ok(state);
}

/** 트리의 모든 노드 id. */
function nodeIds(tree: DocumentNode): Set<Id> {
  const out = new Set<Id>();
  const walk = (n: Node) => {
    out.add(n.id);
    const brs = branchesOf(n);
    if (brs) {
      for (const br of brs) (br.children as Node[]).forEach(walk);
      return;
    }
    for (const slot of slotsOf(n.kind)) listOf(n, slot)?.forEach(walk);
    cellNodesOf(n).forEach(walk);
  };
  walk(tree);
  return out;
}

/** 원본에 있고 결과에 없는 노드 id — 저장 때 다른 문서가 가리키던 것이 사라지는지 본다. */
export function removedIds(before: DocumentNode, after: DocumentNode): Set<Id> {
  const kept = nodeIds(after);
  return new Set([...nodeIds(before)].filter((id) => !kept.has(id)));
}
