/**
 * 값별 분기(switch, 최종 결정 5) 칸 머리의 순수 재료 — 대상 후보 · 칸 없는 값 · 값 순서 · 값 표시명.
 * 편집 트리에서 분기는 조건 노드 + `switchOn` 운반체다(document/nodes.ts `SwitchCaseMark`). 지금은 함수조항 편집기만 쓴다.
 */

/** 값별 분기 대상 후보 — 목록값(열거형) 인자 · 내부 변수(`arg.X` · `var.X`)와 그 열거형 값(열거형 순서). */
export interface SwitchSubject {
  code: string;
  label: string;
  values: readonly { code: string; label: string }[];
}

/** 칸 머리 · 대상 줄이 쓰는 말 — 값 코드 → 표시명(모르면 코드). */
export function switchValueLabel(subject: SwitchSubject | undefined, code: string): string {
  return subject?.values.find((v) => v.code === code)?.label ?? code;
}

/** 칸이 없는 값 — 대상 열거형 순서. 대상을 모르면 빈 목록. */
export function unassignedValues(subject: SwitchSubject | undefined, branches: readonly { values?: readonly string[] }[]): { code: string; label: string }[] {
  const taken = new Set(branches.flatMap((b) => b.values ?? []));
  return (subject?.values ?? []).filter((v) => !taken.has(v.code));
}

/** 값 목록을 대상 열거형 순서로 — 모르는 코드(없는 값)는 뒤에 그대로. */
export function sortValues(subject: SwitchSubject | undefined, values: readonly string[]): string[] {
  const order = (subject?.values ?? []).map((v) => v.code);
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : Number.MAX_SAFE_INTEGER);
  return [...values].sort((a, b) => rank(a) - rank(b));
}

/** 조건 · 슬롯 고르기의 변수 칸에서 값별 분기 대상 후보를 — 목록값(열거형) 인자 · 내부 변수만(필드 칸 · 목록값(복수)은 아니다). */
export function switchSubjectsOf(discriminators: readonly { code: string; label: string; param?: true; local?: true; type?: { kind: string }; enumOptions?: readonly { code: string; label: string }[] }[]): SwitchSubject[] {
  return discriminators.filter((d) => (d.param || d.local) && d.type?.kind === "enum").map((d) => ({ code: d.code, label: d.label, values: d.enumOptions ?? [] }));
}
