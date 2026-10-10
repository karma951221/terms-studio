/**
 * L3 우측 패널 — **보조 정보만** 둔다. 입력칸이 없다 (기능/문면 §4.3).
 *
 * 탭 둘 〔미리보기 | 검증 N〕 (2026-10-10):
 * - 미리보기 — 가운데 조 하나를 고른 상품의 조립 문맥으로 (`PreviewTab`, §3.9). 처음 탭.
 * - 검증 — 저장 검증 목록(편집 중이면 편집본, 「고칠 자리로」는 가운데에서 그 조를 열고 그 자리를 강조). 편집 중이면 그 위에 템플릿 이름 · 대응 보통약관.
 * 두 탭 다 그려 두고 숨긴다 — 탭을 오가도 미리보기의 고른 상품 · 받은 재료가 남는다.
 */
import { useState, type ReactNode } from "react";

import { SeverityGlyph } from "@/app/_components/IssueList";
import { formatCoordinate } from "@/domain/coordinate";
import type { Id, Issue } from "@/domain/types";

export interface PanelData {
  /** 편집본(읽기 모드면 원본)의 저장 검증 — 경고 포함. */
  issues: readonly Issue[];
  documentTitle: string;
  /** 대응 보통약관 이름 (담보약관) — 지정했거나 제안값. */
  generalTitle?: string;
  generalProposed: boolean;
  /** 미리보기 탭 내용 (`PreviewTab`). */
  preview: ReactNode;
  /** 「고칠 자리로」 — 가운데에서 그 조를 열고 그 자리를 강조한다. */
  go: (nodeId: Id) => void;
}

/**
 * 검증 목록 — 편집본의 오류 · 경고. 「고칠 자리로」는 가운데에 그 자리를 연다(화면을 떠나지 않는다).
 * 오류가 하나라도 있으면 저장은 서버가 거부한다 (서버가 최종 검증자).
 */
export function DraftIssues({ go, issues }: { go: (nodeId: Id) => void; issues: readonly Issue[] }) {
  return (
    <ul className="ts-issues" role="alert">
      {issues.map((issue, i) => {
        const severity: "error" | "warning" = issue.severity === "warning" ? "warning" : "error";
        const nodeId = issue.at.nodePath?.at(-1) ?? issue.at.articleId;
        return (
          <li key={i} className={severity === "warning" ? "ts-issue-warning" : undefined}>
            <SeverityGlyph severity={severity} />{" "}
            <span className="ts-issue-kind">
              [{severity} · {issue.kind}]
            </span>{" "}
            {issue.message}
            {severity === "warning" && <span className="ts-muted"> · 저장을 막지 않는 경고</span>}
            <div className="ts-issue-at">{formatCoordinate(issue.at)}</div>
            {nodeId && (
              <button type="button" className="ts-doc-pick" onClick={() => go(nodeId)}>
                고칠 자리로
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type PanelTab = "preview" | "issues";

export function SidePanel({ docKind, editing, data }: { docKind: "special" | "general"; editing: boolean; data: PanelData }) {
  const [tab, setTab] = useState<PanelTab>("preview");
  const tabs: { key: PanelTab; label: string }[] = [
    { key: "preview", label: "미리보기" },
    { key: "issues", label: `검증 ${data.issues.length}` },
  ];
  return (
    <aside className="ts-l3-side" id="ts-l3-side">
      <div className="ts-basic-tabs ts-side-tabs" role="tablist" aria-label="우측 패널">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" id={`ts-side-tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`ts-side-panel-${t.key}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="ts-side-panel-preview" aria-labelledby="ts-side-tab-preview" hidden={tab !== "preview"}>
        {data.preview}
      </div>
      <div role="tabpanel" id="ts-side-panel-issues" aria-labelledby="ts-side-tab-issues" hidden={tab !== "issues"}>
        {editing && (
          <>
            <dl className="ts-side-facts">
              <dt>이름</dt>
              <dd>{data.documentTitle}</dd>
              {docKind === "special" && (
                <>
                  <dt>대응 보통약관</dt>
                  <dd>
                    {data.generalTitle ?? "없음"}
                    {data.generalProposed && <span className="ts-badge proposed">제안값 — 더보기에서 확인하고 저장해야 확정</span>}
                  </dd>
                </>
              )}
            </dl>
            <p className="ts-muted">이름 · 대응 보통약관은 바의 더보기에서 바꾼다.</p>
          </>
        )}
        {data.issues.length === 0 ? <p className="ts-ok">문제 없음.</p> : <DraftIssues go={data.go} issues={data.issues} />}
      </div>
    </aside>
  );
}
