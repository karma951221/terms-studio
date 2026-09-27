/**
 * 담보 상세의 편집 초안 — EditShell 하나가 네 탭의 변경을 다 담는다 (기능/담보 §4 「상세」).
 * 키는 `<level>:<id>` (도메인 `encodeNodeKey`) 로 통일한다.
 */
import type { StructureDraftSub } from "@/domain/coverage";
import type { Submission } from "@/forms";

export interface CoverageEditData extends Record<string, unknown> {
  /** 담보명. EditShell 이 `label` 을 헤더 제목으로 쓴다. */
  label: string;
  description: string;
  /**
   * 세부보장 · 급부의 구조 초안 — 이름 · 순서 · 추가(id 없음) · 삭제(빠짐)가 한 자리에 (ADR-0052 결정 1).
   * 담보 자신은 `label` 이 정본이라 여기 없다. 미탑재 담보만 구조를 바꿀 수 있고, 탑재된 담보는 이름만 바뀐다.
   */
  structure: StructureDraftSub[];
  /** 노드별 값 초안. 손댄 노드만 들어온다. 키는 기존 노드 — 새 노드는 저장 뒤에야 값을 받는다. */
  values: Record<string, Submission>;
}
