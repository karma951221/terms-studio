/**
 * 담보 상세 값 폼의 편집 세션 세대 — React 없는 상태 전이.
 *
 * 한 화면에 모든 노드의 값 폼(StructForm)이 동시에 떠 있다 — 접힌 카드도 폼을 내리지 않는다. 그래서 노드별 초안을 따로
 * 보관할 필요가 없고(각 인스턴스가 제 초안을 들고 있다), 저장 한 번이 EditShell 이 모은 모든 노드의 값을 담는다.
 * 여기서 정하는 것은 **언제 인스턴스를 새로 띄우는가** 하나다.
 * - 세션이 **취소**로 끝나면(편집 → 읽기, 값 초안이 세션 시작 때와 같음) 세대(`session`)를 올린다 —
 *   모든 폼이 새로 떠서 읽기 화면은 저장값을 보인다.
 * - **저장**으로 끝나면(값 초안이 시작 때와 다름) 세대를 그대로 둔다 — 서버가 새 값을 내려보내기 전까지 방금 저장한 값을 보이고,
 *   새 값이 오면 StructForm 이 저장값 지문으로 스스로 다시 세운다.
 * - 편집에 들어갈 때는 세대를 올리지 않는다 — 읽기 화면의 인스턴스가 그대로 입력기가 된다.
 */
import { isDirty } from "@/app/_lib/edit";

export type EditMode = "read" | "edit";

export interface FormSession {
  mode: EditMode;
  /** 편집 세션 세대 — 취소로 끝날 때마다 올라 StructForm 인스턴스를 새로 띄운다. */
  session: number;
  /** 편집을 시작할 때의 값 초안(EditShell `values`) — 끝날 때 견주어 저장인지 취소인지 가른다. */
  start?: unknown;
}

export function initFormSession(mode: EditMode): FormSession {
  return { mode, session: 0 };
}

/** 편집 모드가 바뀌었다 — `values` 는 그 순간의 EditShell 값 초안. */
export function formSessionReducer(current: FormSession, action: { mode: EditMode; values: unknown }): FormSession {
  if (action.mode === current.mode) return current;
  if (action.mode === "edit") return { ...current, mode: "edit", start: action.values };
  // 취소는 값 초안을 시작 때로 되돌린다 — 그대로면 취소(또는 값 변경 없는 저장)라 새로 띄운다.
  const saved = isDirty(current.start, action.values);
  return { mode: "read", session: saved ? current.session : current.session + 1 };
}

/** 노드의 StructForm key — 노드마다, 세대마다 다른 인스턴스. */
export function formKeyOf(session: FormSession, node: string): string {
  return `${session.session}:${node}`;
}
