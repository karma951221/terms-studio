"use client";

/**
 * 우측 패널 「구분자」 탭 — 미리보기에서 고른 상품담보에 대해 이 템플릿이 읽거나 연결한 잎의 지금 값 (ADR-0087 결정 6 · 기능/문면 §3.9).
 * 담보약관만. 편집 중이면 편집본 기준. 문제 줄은 ⚠ + 좌표 + 「고칠 자리로」, 설명은 구분자 주석(ⓘ).
 */
import { useMemo } from "react";

import { leafPanel, type LeafRow } from "@/domain/assembly";
import { formatCoordinate } from "@/domain/coordinate";
import type { DocumentNode } from "@/domain/document";
import type { Id } from "@/domain/types";

import type { PreviewSelection } from "./previewSelection";

const PROBLEM: Record<NonNullable<LeafRow["problem"]>, string> = { notEntered: "미입력", brokenKey: "끊어진 키", unbound: "연결이 빈 인자" };

export function LeafRows({ rows, go }: { rows: readonly LeafRow[]; go: (nodeId: Id) => void }) {
  if (rows.length === 0) return <p className="ts-muted">이 템플릿이 읽는 구분자가 없다.</p>;
  return (
    <ul className="ts-issues ts-leaf-rows">
      {rows.map((r) => {
        const nodeId = r.at.nodePath?.at(-1);
        return (
          <li key={`${r.code}@${r.path ?? ""}`} className={r.problem ? "ts-issue-warning" : undefined}>
            <span>{r.label}</span>
            {r.description && (
              <span className="ts-muted" title={r.description}>
                {" "}
                ⓘ {r.description}
              </span>
            )}
            {" — "}
            {r.problem ? <strong>⚠ {PROBLEM[r.problem]}</strong> : <span>{r.value}</span>}
            {r.problem && <div className="ts-issue-at">{formatCoordinate(r.at)}</div>}
            {r.problem && nodeId && (
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

export function LeafPanelTab({ selection, tree, go }: { selection: PreviewSelection; tree: DocumentNode; go: (nodeId: Id) => void }) {
  const { selected, outcome } = selection;
  const rows = useMemo(() => {
    if (!selected?.productCoverageId || !outcome?.ok) return undefined;
    try {
      return leafPanel(outcome.material.master, outcome.material.product, selected.productCoverageId, tree);
    } catch (e) {
      return { unavailable: e instanceof Error ? e.message : String(e) };
    }
  }, [selected, outcome, tree]);
  if (selection.products.length === 0) return <p className="ts-muted">이 담보를 특약으로 탑재한 상품이 없다 — 미리보기 탭과 같은 상품을 쓴다.</p>;
  if (!outcome)
    return (
      <p className="ts-muted" aria-busy="true">
        상품 재료를 받는 중…
      </p>
    );
  if (!outcome.ok) return <p className="ts-error-banner">상품 재료를 받지 못했다 — {outcome.message}</p>;
  if (!rows) return null;
  if (!Array.isArray(rows)) return <p className="ts-error-banner">{rows.unavailable}</p>;
  return (
    <>
      <p className="ts-muted">미리보기에서 고른 상품담보({selected?.productCoverageName ?? selected?.productName})의 값 — 편집 중이면 편집본 기준.</p>
      <LeafRows rows={rows} go={go} />
    </>
  );
}
