import { coordinateHref } from "./coordinateHref";
import { formatCoordinate } from "@/domain/coordinate";
import type { Issue } from "@/domain/types";

/** 심각도별 글리프 — 문자(⚠)가 아니라 그려서 currentColor 로 상속받는다 (디자인원칙 §1.6). */
export function SeverityGlyph({ severity }: { severity: "error" | "warning" }) {
  if (severity === "warning") {
    return (
      <svg className="ts-icon" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <line x1="7" y1="4" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="10" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="ts-icon" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 1.5 L13 12.5 L1 12.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="7" y1="5.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="10.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

export interface IssueLink {
  href: string;
  label: string;
}

/** 기본 이동 — 같은 화면에 그려진 결과 문서의 그 노드 앵커. */
export function previewAnchorLink(issue: Issue): IssueLink | undefined {
  const nodeId = issue.at.nodePath?.at(-1);
  return nodeId ? { href: `#node-${nodeId}`, label: "미리보기에서 보기" } : undefined;
}

/**
 * 원천/결과 좌표와 이동 동작을 공유하는 오류 패널.
 * `total` 을 주면 「오류 N / 전체 M」처럼 분모를 함께 보여준다(디자인원칙 §9.6) — 없으면 분자만.
 *
 * `linkFor` 는 **결과 쪽 이동 링크**를 화면이 정하게 한다 — 기본은 이 화면에 결과 문서가 같이 있다고 보고
 * `#node-…` 앵커를 건다. 다른 문서의 오류까지 싣는 화면(보통약관 탭의 특약 오류)은 도착하지 못할 앵커
 * 대신 그 문서의 좌표를 주거나 링크를 빼야 한다 (코덱스 리뷰 2026-09-15 Minor-5).
 */
export function IssueList({ issues, total, linkFor = previewAnchorLink }: { issues: readonly Issue[]; total?: number; linkFor?: (issue: Issue) => IssueLink | undefined }) {
  if (issues.length === 0) return null;
  const errorCount = issues.filter((i) => i.severity !== "warning").length;
  return (
    <>
      {total !== undefined && (
        <p className="ts-count">
          오류 <b>{errorCount}</b> / 전체 {total}건
        </p>
      )}
      <ul className="ts-issues" role="alert">
        {issues.map((issue, i) => {
          const severity: "error" | "warning" = issue.severity === "warning" ? "warning" : "error";
          const href = coordinateHref(issue.source);
          const link = linkFor(issue);
          return (
            <li key={i} className={severity === "warning" ? "ts-issue-warning" : undefined}>
              <SeverityGlyph severity={severity} />{" "}
              <span className="ts-issue-kind">
                [{severity === "warning" ? "warning" : "error"} · {issue.kind}]
              </span>{" "}
              {issue.message}
              {severity === "warning" && <span className="ts-muted"> · 완결성을 깨지 않는 경고</span>}
              <div className="ts-issue-at">결과: {formatCoordinate(issue.at)}</div>
              {issue.source && <div className="ts-issue-at">원천: {formatCoordinate(issue.source, { source: true })}</div>}
              {link && <a href={link.href}>{link.label}</a>}
              {href && (
                <>
                  {" "}
                  · <a href={href}>고치러 가기</a>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
