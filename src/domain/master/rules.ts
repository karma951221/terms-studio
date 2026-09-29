/**
 * 폼 교차 규칙 검사 — `MasterForm.rules` 를 최종 상태로 돌린다 (결정 16 · 기능/마스터 §3.4).
 * 값 쓰기(상품 기본정보 저장 · 세목 선택지 값 제출)가 저장된 값 위에 이번 제출을 얹은 읽개로 부른다.
 */
import type { Coordinate, Issue, ValueSlot } from "../types";
import { masterPath } from "./paths";
import type { MasterForm, MasterPath } from "./types";

export function formRuleIssues(form: MasterForm, read: (path: MasterPath) => ValueSlot | undefined, at: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  for (const rule of form.rules ?? []) {
    const broken = rule.check((key) => read(masterPath(form.key, key)));
    if (broken) issues.push({ kind: "typeMismatch", message: broken.message, at: { ...at, refPath: masterPath(form.key, broken.field) } });
  }
  return issues;
}
