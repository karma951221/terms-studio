/**
 * 담보 상세 값 탭의 노드별 초안 (점검 H4) — React 없는 상태 전이.
 *
 * 한 편집 세션(저장 한 번) 동안 노드 · 탭을 오가도 각 노드의 편집 상태(FormState)를 여기 보관한다.
 * - StructForm 은 노드마다 따로 뜬다 — key 는 `formKeyOf`. 같은 인스턴스를 다른 노드가 이어 쓰면
 *   A 의 초안이 B 화면에 남아 B 로 제출되거나(①), A 로 돌아올 때 입력이 사라진다(②).
 * - 노드를 다시 열면 `byNode[노드]` 를 initialState 로 받아 복원한다. 저장할 값(Submission)은 따로 EditShell 이 모은다.
 * - 세션이 **취소**로 끝나면(편집 → 읽기, 값 초안이 세션 시작 때로 돌아감) 초안을 걷고 세대(`session`)를 올린다 —
 *   인스턴스가 새로 떠서 읽기 화면은 저장값을 보인다.
 * - **저장**으로 끝나면(값 초안이 시작 때와 다름) 초안을 그대로 둔다 — 서버가 새 값을 내려보내기 전까지 방금 저장한 값을 보이고,
 *   새 값이 오면 StructForm 이 저장값 지문으로 스스로 다시 세운다(지문이 다른 초안은 복원하지 않는다).
 * - 편집에 들어갈 때는 세대를 올리지 않는다 — 읽기 화면의 인스턴스가 그대로 입력기가 된다.
 */
import { isDirty } from "@/app/_lib/edit";
import type { FormState } from "@/forms";

export type EditMode = "read" | "edit";

export interface ValueDrafts {
  mode: EditMode;
  /** 편집 세션 세대 — 취소로 끝날 때마다 올라 StructForm 인스턴스를 새로 띄운다. */
  session: number;
  /** 노드 키(`encodeNodeKey`) → 그 노드의 편집 상태. 연 적 없는 노드는 없다. */
  byNode: Readonly<Record<string, FormState>>;
  /** 편집을 시작할 때의 값 초안(EditShell `values`) — 끝날 때 견주어 저장인지 취소인지 가른다. */
  start?: unknown;
}

export type ValueDraftsAction =
  /** 편집 모드가 바뀌었다 — `values` 는 그 순간의 EditShell 값 초안. */
  | { type: "mode"; mode: EditMode; values: unknown }
  | { type: "draft"; node: string; state: FormState };

export function initValueDrafts(mode: EditMode): ValueDrafts {
  return { mode, session: 0, byNode: {} };
}

export function valueDraftsReducer(drafts: ValueDrafts, action: ValueDraftsAction): ValueDrafts {
  if (action.type === "mode") {
    if (action.mode === drafts.mode) return drafts;
    if (action.mode === "edit") return { ...drafts, mode: "edit", start: action.values };
    // 취소는 값 초안을 시작 때로 되돌린다 — 그대로면 취소(또는 값 변경 없는 저장)라 초안을 걷는다.
    const saved = isDirty(drafts.start, action.values);
    return saved
      ? { mode: "read", session: drafts.session, byNode: drafts.byNode }
      : { mode: "read", session: drafts.session + 1, byNode: {} };
  }
  // 읽기 모드에서는 초안이 생기지 않는다 — 올라와도 받지 않는다.
  if (drafts.mode !== "edit") return drafts;
  if (drafts.byNode[action.node] === action.state) return drafts;
  return { ...drafts, byNode: { ...drafts.byNode, [action.node]: action.state } };
}

/** 노드의 StructForm key — 노드마다, 세대마다 다른 인스턴스. */
export function formKeyOf(drafts: ValueDrafts, node: string): string {
  return `${drafts.session}:${node}`;
}
