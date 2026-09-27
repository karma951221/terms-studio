"use client";

/**
 * 담보 상세 — 탭 없는 한 화면 (기능/담보 §4 「상세」): 헤더(편집 흐름) · 구조 = 중첩 카드.
 *
 * - **편집 입구는 하나다** — `편집` 을 누르면 카드의 이름 · 값 · 구조(+ 추가 · ↑↓ 순서 · ⊖ 빼기)가 한꺼번에 입력기가 되고,
 *   `저장` 한 번이 담보명 · 구조 · 모든 카드의 값을 한 트랜잭션에 담는다. 탑재 여부로 갈리지 않는다 — 삭제가 섞이거나 탑재된 담보의
 *   구조가 바뀌면 저장이 먼저 영향을 확인시킨다 (ADR-0075 · `edit-actions.ts`).
 * - 주석(description)은 화면에 없다 — 초안에는 실려 저장값을 그대로 지킨다.
 * - 담보약관 템플릿은 이 화면에 없다 (2026-09-27) — 담보약관 템플릿 메뉴가 입구다. 입구가 둘이면 헷갈린다.
 */
import { EditShell } from "@/app/_components/EditShell";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { encodeNodeKey, savedStructureOf, structureIssues } from "@/domain/coverage";
import type { FormModel } from "@/forms";

import { removeCoverageEditAction, saveCoverageEditAction } from "../edit-actions";
import type { CoverageEditData } from "../edit-types";

import { CoverageCards } from "./CoverageCards";

export interface CoverageEditorProps {
  id: string;
  initial: CoverageEditData;
  /** 노드 키 → 그 레벨 마스터 값 폼 (ADR-0037: 레벨 하나에 폼 하나). */
  formByNode: Record<string, FormModel>;
  usageCount: number;
  /** 담보속성 유효값 표시명 — 담보명에 섞이면 경고한다 (Q-C: 경고까지, 거부 아님). */
  attributeValueLabels: string[];
  /** 진입 좌표의 노드 (`encodeNodeKey`) — 그 카드로 스크롤 · 강조한다. */
  target?: string;
  /** 강조할 값 자리 `폼키.필드키` — `target` 카드의 폼에서만. */
  highlightPath?: string;
  /** 관리자 — 값 폼 필드 옆에 코드(ⓘ) 링크. */
  showCodes?: boolean;
}

export function CoverageEditor(props: CoverageEditorProps) {
  const { id, initial, usageCount } = props;
  return (
    <EditShell
      initial={initial}
      title={initial.label}
      path={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }]}
      saveAction={saveCoverageEditAction.bind(null, id)}
      saveDisabled={(data) => structureIssues(data.structure).length > 0}
      deleteAction={removeCoverageEditAction.bind(null, id)}
      deleteLabel={`${initial.label} 삭제`}
      deleteTooltip={`담보 ${initial.label} 삭제`}
      deleteSuccessHref="/coverages"
      headerMeta={<span className="ts-count">탑재 상품담보 <b>{usageCount}</b></span>}
    >
      <CoverageCards
        coverageKey={encodeNodeKey("coverage", id)}
        formByNode={props.formByNode}
        original={savedStructureOf(initial.structure)}
        attributeValueLabels={props.attributeValueLabels}
        target={props.target}
        highlightPath={props.highlightPath}
        showCodes={props.showCodes}
      />
    </EditShell>
  );
}
