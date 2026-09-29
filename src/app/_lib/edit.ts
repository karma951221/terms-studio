import type { RefEdge } from "@/domain/refs";
import type { Impact } from "@/domain/types";

export type EditOutcome =
  /** `recheck` — 저장은 됐지만 사람이 다시 볼 사용처 (열거값 추가의 재검사 목록, ADR-0078 결정 4). 화면이 `onSaved` 로 받는다. */
  | { ok: true; recheck?: RefEdge[] }
  | { ok: false; message: string }
  /**
   * 파괴적 변경 — 영향 대화상자 뒤 `confirm=true` 로 재호출. `title` · `actionLabel` 은 화면별 문구 (없으면 EditShell 기본).
   * `valueRowsLine` — 값 행 줄 문구 (없으면 「사람이 입력한 값 N건이 사라진다」). 값을 지우지 않고 오류로 남기는 변경(열거값 삭제)이 쓴다.
   */
  | { ok: "confirm"; impact: Impact; token: string; title?: string; actionLabel?: string; valueRowsLine?: string };

function normalized(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

export function isDirty(initial: unknown, current: unknown): boolean {
  return JSON.stringify(normalized(initial)) !== JSON.stringify(normalized(current));
}
