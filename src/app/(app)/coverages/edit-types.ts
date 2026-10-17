/**
 * 담보 상세의 편집 초안 — EditShell 하나가 한 화면(중첩 카드)의 변경을 다 담는다 (기능/담보 §4 「상세」).
 * 키는 `<level>:<id>` (도메인 `encodeNodeKey`) 로 통일한다.
 */
import type { StructureDraftSub } from "@/domain/coverage";
import type { Submission } from "@/forms";

export interface CoverageEditData extends Record<string, unknown> {
  /** 담보명 — 담보 카드의 이름. EditShell 이 `label` 을 헤더 제목으로 쓴다. */
  label: string;
  /** 주석 — 화면에는 없지만 저장값을 그대로 실어 보낸다 (지우지 않는다). */
  description: string;
  /** 담보분류 — 열거형 「담보분류」(E0009)의 값 코드, 필수 (ADR-0090). 빈 문자열 = 미입력(옛 데이터) — 저장은 거부한다. */
  category: string;
  /**
   * 세부보장 · 급부의 구조 초안 — 이름 · 순서 · 추가(id 없음) · 삭제(빠짐)가 한 자리에 (ADR-0075).
   * 담보 자신은 `label` 이 정본이라 여기 없다. 탑재 여부와 상관없이 구조를 바꾸고, 저장이 영향을 확인시킨다.
   */
  structure: StructureDraftSub[];
  /** 노드별 값 초안. 손댄 노드만 들어온다. 키는 기존 노드 — 새 노드는 저장 뒤에야 값을 받는다. */
  values: Record<string, Submission>;
}
