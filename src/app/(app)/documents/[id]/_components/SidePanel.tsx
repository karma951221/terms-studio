/**
 * L3 우측 패널 — **보조 정보만** 둔다. 입력칸이 없다 (기능/문면 §4.3).
 *
 * - 읽기 모드 → 사전평가 · 미리보기: 조건식마다 「식 · 참/거짓 · 채택 분기」 한 줄, 그 아래 명조로 렌더된 결과 조문.
 * - 편집 모드 → 템플릿 설정(읽기 — 바꾸는 곳은 더보기) · 저장 검증 목록(「고칠 자리로」는 가운데에서 그 조를 열고 그 자리를 강조) ·
 *   사전평가 안내. 고치는 곳은 가운데 본문 그 자리다.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { SeverityGlyph } from "@/app/_components/IssueList";
import { formatCoordinate } from "@/domain/coordinate";
import type { BlockBranch, BranchEvaluation, InlineBranch, Node, TreeIndex } from "@/domain/document";
import type { Id, Issue } from "@/domain/types";

import { chipText, type DocCtx } from "./ctx";

export interface PanelData {
  index: TreeIndex;
  /** 편집본(읽기 모드면 원본)의 저장 검증 — 경고 포함. */
  issues: readonly Issue[];
  documentTitle: string;
  /** 대응 보통약관 이름 (담보약관) — 지정했거나 제안값. */
  generalTitle?: string;
  generalProposed: boolean;
  branchEval?: ReadonlyMap<Id, BranchEvaluation>;
  evalRan: boolean;
  evalAvailable: boolean;
  evalNote?: string;
  rendered?: ReactNode;
  /** 사전평가를 켜고 끈다 — 실시간이 아니라 눌러서 돈다. */
  toggleEval: () => void;
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

function EvalLines({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  const conds = [...data.index.nodes.values()].map((e) => e.node).filter((n): n is Node & { branches: (BlockBranch | InlineBranch)[] } => n.kind === "condBlock" || n.kind === "inlineCond");
  if (conds.length === 0) return <p className="ts-muted">조건식이 없는 템플릿이다 — 평가할 분기가 없다.</p>;
  return (
    <>
      {conds.map((cond) => {
        const taken = cond.branches.find((br) => data.branchEval?.get(br.id)?.state === "taken");
        return (
          <div key={cond.id} style={{ margin: "6px 0" }}>
            {cond.branches.map((br) => {
              const ev = data.branchEval?.get(br.id);
              const verdict = ev?.state === "taken" ? "참" : ev?.state === "notTaken" ? "거짓" : ev?.state === "undetermined" ? `미결 (${ev.reason ?? "문맥 부족"})` : ev?.state === "error" ? `오류 — ${ev.issue?.message ?? ""}` : "평가 안 됨";
              return (
                <p key={br.id} className="ts-doc-cond-head" title={chipText(br.when, "edit", ctx.refLabel).full}>
                  {chipText(br.when, "read", ctx.refLabel).text} · {verdict}
                </p>
              );
            })}
            <p className="ts-muted">채택 분기: {taken ? chipText(taken.when, "read", ctx.refLabel).text : "없음 (어느 가지도 타지 않았다)"}</p>
          </div>
        );
      })}
    </>
  );
}

function EvalSection({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  const editing = ctx.mode === "edit";
  return (
    <>
      <h3 className="ts-form-title">사전평가 · 미리보기</h3>
      {!data.evalAvailable ? (
        <div className="ts-empty">
          <p className="ts-empty-what">{data.evalNote ?? "이 템플릿은 사전평가 문맥을 만들 수 없다."}</p>
          <p className="ts-empty-example">사전평가는 담보약관에서 담보 마스터 값을 문맥으로 삼아 돈다.</p>
          <p className="ts-empty-action">
            <Link href="/products">상품 조립 미리보기로 →</Link>
          </p>
        </div>
      ) : (
        <>
          <p className="ts-muted">
            {editing ? "편집본을 담보 마스터 값으로 평가한다 — 거짓 가지가 톤다운된다." : "담보 마스터 값을 문맥으로 조건식을 평가한다. 실시간이 아니라 눌러서 돌린다."}
          </p>
          {/* 패널의 주 행동은 텍스트 버튼을 유지한다 (§1.6 예외 ①). 실시간이 아니라 눌러서 돈다. */}
          <div className="ts-form-actions">
            {data.evalRan ? (
              <button type="button" onClick={data.toggleEval} title="평가 결과를 지우고 원래 조문으로 돌아간다">
                평가 결과 지우기
              </button>
            ) : (
              <button type="button" onClick={data.toggleEval} className={editing ? undefined : "primary"} title="담보 마스터 값을 문맥으로 조건식을 평가한다">
                {editing ? "편집본 미리보기" : "미리보기"}
              </button>
            )}
          </div>
          {data.evalRan && (
            <>
              <EvalLines ctx={ctx} data={data} />
              {data.rendered && (
                <>
                  <h3 className="ts-form-title">결과 조문</h3>
                  {data.rendered}
                </>
              )}
            </>
          )}
        </>
      )}
      <p className="ts-muted">약관 전체를 이어 읽으려면 바의 더보기 › 미리보기.</p>
    </>
  );
}

export function SidePanel({ ctx, data }: { ctx: DocCtx; data: PanelData }) {
  if (ctx.mode === "read") {
    return (
      <aside className="ts-l3-side">
        <EvalSection ctx={ctx} data={data} />
      </aside>
    );
  }
  const errors = data.issues.filter((i) => i.severity !== "warning").length;
  return (
    <aside className="ts-l3-side">
      <h3 className="ts-form-title">템플릿</h3>
      <dl className="ts-side-facts">
        <dt>이름</dt>
        <dd>{data.documentTitle}</dd>
        {ctx.docKind === "special" && (
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

      <h3 className="ts-form-title">
        저장 검증{" "}
        <span className="ts-count">
          <b>{errors}</b> / 노드 {data.index.nodes.size}
        </span>
      </h3>
      {data.issues.length === 0 ? <p className="ts-ok">문제 없음.</p> : <DraftIssues go={data.go} issues={data.issues} />}

      <EvalSection ctx={ctx} data={data} />
    </aside>
  );
}
