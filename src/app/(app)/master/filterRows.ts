/**
 * 마스터 표의 행과 검색 규칙 — 순수 (기능/마스터 §4.1).
 *
 * 행 = 필드. 폼 › 필드를 코드 순서 그대로 평탄화한 것이다 — 서버가 `MASTER` + enum 표시명으로 이 모양을 만든다.
 * 검색은 코드(`폼키.필드키`) · 필드 표시명 · 폼 표시명 · 폼키 **부분 일치 · 대소문자 무시**.
 * 아무것도 안 맞으면 빈 배열 (화면이 「맞는 항목이 없습니다」).
 */
import type { AttachLevel } from "@/domain/types";

export interface MasterRow {
  /** `폼키.필드키` */
  path: string;
  label: string;
  formKey: string;
  formLabel: string;
  level: AttachLevel;
  levelLabel: string;
  typeLabel: string;
  /** enum · list<enum> 이면 열거형변수 표시명 · 코드. */
  enumLabel?: string;
  enumCode?: string;
}

export function filterRows(rows: readonly MasterRow[], query: string): MasterRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...rows];
  return rows.filter((row) => [row.path, row.label, row.formLabel, row.formKey].some((v) => v.toLowerCase().includes(q)));
}
