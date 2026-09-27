/**
 * 「구조 편집」 화면의 편집 초안 (ADR-0052 결정 2) — 세부보장 · 급부 구조만. 담보명 · 값은 상세 화면 몫이다.
 */
import type { StructureDraftSub } from "@/domain/coverage";

export interface CoverageStructureData extends Record<string, unknown> {
  /** 상세 화면의 `CoverageEditData.structure` 와 같은 초안 — 이름 · 순서 · 추가(id 없음) · 삭제(빠짐). */
  structure: StructureDraftSub[];
}
