/**
 * 인자 · 내부 변수 이름 바꾸기 표 — 화면 몫 (순수, 기능/함수조항 §3.7 「이름 변경」).
 *
 * 편집본의 줄(인자 카드 · 내부 변수 행)마다 「저장된 옛 이름」을 들고 따라간다. 표 조작은 셋뿐이다 — 칸 고침(같은 길이 · 같은 자리),
 * 맨 뒤 덧붙이기, 한 줄 빼기. 저장 때 옛 이름 ≠ 지금 이름인 줄이 「옛 → 새」 표가 되고, 도메인 `normalizeRenames` · `renameIn*` 이 안쪽을 고친다.
 */

/** 시작 — 저장된 이름 그대로. */
export function originsOf(rows: readonly { name: string }[]): (string | undefined)[] {
  return rows.map((r) => r.name);
}

/**
 * 표가 바뀐 뒤의 옛 이름 줄. `prev` · `next` 는 바뀌기 전 · 뒤 줄(같은 줄은 같은 객체), `saved` 는 저장된 이름(통째로 바뀌었을 때 이름으로 다시 맞춘다).
 */
export function trackOrigins<T extends { name: string }>(prev: readonly T[], next: readonly T[], origins: readonly (string | undefined)[], saved: readonly string[] = []): (string | undefined)[] {
  if (next.length === prev.length) return [...origins];
  if (next.length === prev.length + 1 && prev.every((row, i) => next[i] === row)) return [...origins, undefined];
  if (next.length === prev.length - 1) {
    const gone = prev.findIndex((row, i) => next[i] !== row);
    const at = gone === -1 ? prev.length - 1 : gone;
    if (next.every((row, i) => row === prev[i < at ? i : i + 1])) return origins.filter((_o, i) => i !== at);
  }
  const known = new Set(saved);
  return next.map((row) => (known.has(row.name) ? row.name : undefined));
}

/** 옛 이름 → 지금 이름(다듬은) — 다른 줄만. 새 줄(옛 이름 없음)은 바꾸기가 아니다. */
export function renamesFrom(origins: readonly (string | undefined)[], rows: readonly { name: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  rows.forEach((row, i) => {
    const from = origins[i];
    const to = row.name.trim();
    if (from !== undefined && to !== "" && from !== to) out[from] = to;
  });
  return out;
}
