"use client";

/**
 * 담보 상세 — 탭 없는 한 화면 (기능/담보 §4 「상세」): 헤더(편집 흐름) · 담보약관 띠 · 구조 = 중첩 카드.
 *
 * - **편집 입구는 하나다** — `편집` 을 누르면 카드의 이름 · 값 · 구조(⊕ 추가 · ↑↓ 순서 · ✕ 삭제)가 한꺼번에 입력기가 되고,
 *   `저장` 한 번이 담보명 · 구조 · 모든 카드의 값을 한 트랜잭션에 담는다. 탑재 여부로 갈리지 않는다 — 삭제가 섞이거나 탑재된 담보의
 *   구조가 바뀌면 저장이 먼저 영향을 확인시킨다 (ADR-0075 · `edit-actions.ts`).
 * - 주석(description)은 화면에 없다 — 초안에는 실려 저장값을 그대로 지킨다.
 * - 담보약관 띠는 읽기 · 편집 어디서나 즉시 실행 명령(열기 · 만들기) — 편집 중 변경이 있으면 「버립니까?」 확인 뒤.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { EditShell, useEditLeave } from "@/app/_components/EditShell";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { encodeNodeKey, savedStructureOf, structureIssues } from "@/domain/coverage";
import type { FormModel } from "@/forms";

import { createSpecialDocumentAction } from "../actions";
import { removeCoverageEditAction, saveCoverageEditAction } from "../edit-actions";
import type { CoverageEditData } from "../edit-types";

import { CoverageCards } from "./CoverageCards";

/** 담보약관 템플릿 요약 — 띠 한 줄에 선다. */
export interface CoverageTemplate {
  id: string;
  title: string;
  /** 조 수 (관 · 조건 블록 안의 조까지). */
  articleCount: number;
  /** 남은 미결정 공용조항 옵션 수 — 담보 마스터 안에서 다 정해야 한다 (기능/담보 §3.5). */
  unresolvedOptionCount: number;
}

export interface CoverageEditorProps {
  id: string;
  initial: CoverageEditData;
  /** 노드 키 → 그 레벨 마스터 값 폼 (ADR-0037: 레벨 하나에 폼 하나). */
  formByNode: Record<string, FormModel>;
  usageCount: number;
  template?: CoverageTemplate;
  /** 담보속성 유효값 표시명 — 담보명에 섞이면 경고한다 (Q-C: 경고까지, 거부 아님). */
  attributeValueLabels: string[];
  /** 진입 좌표의 노드 (`encodeNodeKey`) — 그 카드를 펼치고 스크롤 · 강조한다. */
  target?: string;
  /** 강조할 값 자리 `폼키.필드키` — `target` 카드의 폼에서만. */
  highlightPath?: string;
  /** 관리자 — 값 폼 필드 옆에 코드 칩. */
  showCodes?: boolean;
}

/** 담보약관 띠 — 헤더 바로 아래 한 줄. 있으면 제목 · 조 N · 옵션 미결정 N + 열기, 없으면 만들기. */
function TemplateBand({ coverageId, template }: { coverageId: string; template?: CoverageTemplate }) {
  const leave = useEditLeave();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = ENTITY_LABEL.coverageTemplate;

  if (!template) {
    return (
      <p className="ts-cov-band">
        <span className="ts-cov-band-label">{label}</span> — <span className="ts-muted">없음</span>
        <button type="button" className="ts-cov-band-action" disabled={pending} onClick={() => leave(() => startTransition(() => createSpecialDocumentAction(coverageId)))}>
          {pending ? "만드는 중…" : "만들기"}
        </button>
      </p>
    );
  }
  const href = `/documents/${template.id}`;
  return (
    <p className="ts-cov-band">
      <span className="ts-cov-band-label">{label}</span> — <b>{template.title}</b>
      <span className="ts-muted"> · 조 {template.articleCount}</span>
      {template.unresolvedOptionCount > 0 ? <span className="ts-warn-text"> · 옵션 미결정 {template.unresolvedOptionCount}</span> : null}
      <Link href={href} className="ts-cov-band-action" onClick={(e) => { e.preventDefault(); leave(() => router.push(href)); }}>
        열기 →
      </Link>
    </p>
  );
}

export function CoverageEditor(props: CoverageEditorProps) {
  const { id, initial, usageCount, template } = props;
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
      headerMeta={
        <>
          <span className="ts-count">탑재 상품담보 <b>{usageCount}</b></span>
          {/* 담보약관 옵션은 담보 마스터 안에서 다 정해야 한다 (기능/담보 §3.5) — 남았으면 문면으로 보낸다. */}
          {template && template.unresolvedOptionCount > 0 ? (
            <Link className="ts-badge warning" href={`/documents/${template.id}`}>
              공용조항 옵션 미결정 {template.unresolvedOptionCount}
            </Link>
          ) : null}
        </>
      }
    >
      <TemplateBand coverageId={id} template={template} />
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
