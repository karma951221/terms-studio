/**
 * 정적 표·박스 렌더 (기능/문면 §3.2) — 문면 편집기(DocBody)와 조립 미리보기(RenderedDoc)가 함께 쓴다.
 * 서식은 노드 필드가 정한다: 제목줄(header) 행은 <th>, 열 너비는 <col style=width%>.
 * 행 반복 표의 펼친 결과는 행마다 `spans`(셀별 rowSpan)를 싣는다 — n > 1 은 rowSpan, 0 은 위 셀에 병합돼 그리지 않는다 (ADR-0070).
 * 순수 렌더 — 규칙 없음. `controls` 는 편집 모드의 행 조작 묶음 자리.
 * `band` 는 행 반복 표 **템플릿**의 for 띠(ADR-0070 구현 메모 9) — 왼쪽 한 칸에 「세부보장마다」 라벨을 세워 템플릿 행을 묶는다.
 * 문면 편집기에서만 준다 (펼친 결과 · 산출본에는 없다).
 */
import type { ReactNode } from "react";

export interface StaticTableShape {
  id: string;
  title?: string;
  columns: { width?: number }[];
  /** 셀은 인라인 노드를 그린 결과다 — 표 안의 조·별표 참조도 계산 번호로 찍힌다 (기능/문면 §3.2). */
  rows: { header?: boolean; cells: ReactNode[]; spans?: number[] }[];
}

export interface StaticBoxShape {
  id: string;
  title: string;
  lines: string[];
}

const BAND_CELL = {
  borderLeft: "3px solid var(--ts-mark)",
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: "var(--ts-ink-3)",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
  padding: "2px 6px",
} as const;

/** 템플릿 행(머리글 아닌 행)의 연속 구간 — 구간 첫 행 번호 → 구간 길이. 띠 칸은 구간마다 하나(rowSpan). */
function bandRuns(rows: readonly { header?: boolean }[]): Map<number, number> {
  const runs = new Map<number, number>();
  let start = -1;
  rows.forEach((r, i) => {
    if (r.header) start = -1;
    else if (start < 0) {
      start = i;
      runs.set(i, 1);
    } else runs.set(start, runs.get(start)! + 1);
  });
  return runs;
}

export function StaticTable({ node, controls, band }: { node: StaticTableShape; controls?: ReactNode; band?: string }) {
  const runs = band ? bandRuns(node.rows) : undefined;
  return (
    <figure id={`node-${node.id}`} className="ts-doc-table-wrap">
      {controls}
      {node.title && <figcaption className="ts-doc-table-title">{node.title}</figcaption>}
      <table className="ts-doc-table">
        <colgroup>
          {band && <col style={{ width: "6.5em" }} />}
          {node.columns.map((c, i) => (
            <col key={i} style={c.width ? { width: `${c.width}%` } : undefined} />
          ))}
        </colgroup>
        <tbody>
          {node.rows.map((r, i) => (
            <tr key={i} className={band && !r.header ? "ts-doc-for-row" : undefined}>
              {band && r.header && <th aria-hidden="true" />}
              {band && runs?.has(i) && (
                <td rowSpan={runs.get(i)} className="ts-doc-for-band" style={BAND_CELL} title={`행 반복 — ${band} 이 행들이 복제된다`}>
                  {band}
                </td>
              )}
              {r.cells.map((cell, j) => {
                const span = r.spans?.[j] ?? 1;
                if (span === 0) return null; // 위 셀에 병합됨
                const rowSpan = span > 1 ? span : undefined;
                return r.header ? (
                  <th key={j} rowSpan={rowSpan}>
                    {cell}
                  </th>
                ) : (
                  <td key={j} rowSpan={rowSpan}>
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function StaticBox({ node, controls }: { node: StaticBoxShape; controls?: ReactNode }) {
  return (
    <aside id={`node-${node.id}`} className="ts-doc-box">
      {controls}
      {node.title && <p className="ts-doc-box-title">【{node.title}】</p>}
      {node.lines.map((l, i) => (
        <p key={i} className="ts-doc-box-line">
          {l}
        </p>
      ))}
    </aside>
  );
}

/**
 * 글머리 목록 — 번호 없는 항목 나열(마커 「-」, 원문 관례). 조립 결과 · 공용조항 모델 · 상품 원문 패널이 함께 쓴다.
 * 항목은 인라인을 그린 결과다. 편집기(DocBody)는 항목마다 그 자리 편집기를 넣어 같은 모양(`ts-doc-bullets`)으로 그린다.
 */
export function StaticBullets({ id, items }: { id: string; items: { id: string; body: ReactNode }[] }) {
  return (
    <ul id={`node-${id}`} className="ts-doc-bullets">
      {items.map((item) => (
        <li key={item.id} className="ts-doc-bullet">
          {item.body}
        </li>
      ))}
    </ul>
  );
}
