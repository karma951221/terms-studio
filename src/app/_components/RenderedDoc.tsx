/**
 * 조립 결과 문서트리(`RenderedDoc`) 재귀 렌더 — 조립 미리보기(`/products/[id]/preview`)와
 * 상품담보 미리보기(`/products/[id]/coverages/[pcId]`)가 함께 쓴다.
 *
 * 오류 마커 노드(`kind:'error'`)는 그 자리에 붉은 배지로 표시하고, 앵커(`id="node-<id>"`)를 심어
 * 오류 패널에서 클릭하면 해당 자리로 이동할 수 있게 한다. 순수 렌더 — 규칙 없음.
 */
import type {
  ErrorNode,
  RenderedArticle,
  RenderedBlockGroup,
  RenderedDoc as RenderedDocType,
  RenderedGroup,
  RenderedInline,
  RenderedItem,
  RenderedParagraph,
  RenderedSection,
  RenderedStatic,
  RenderedSubitem,
} from "@/domain/assembly";

import { StaticBox, StaticBullets, StaticTable } from "./StaticNodes";

/** 정적 표·박스 (기능/문면 §3.2) — 편집기와 같은 컴포넌트. 표 셀의 참조도 계산 번호로 찍힌다. */
function Static({ node }: { node: RenderedStatic }) {
  if (node.kind === "box") return <StaticBox node={node} />;
  if (node.kind === "bulletList")
    return (
      <StaticBullets
        id={node.id}
        items={node.items.map((b) => ({
          id: b.id,
          body: b.children.map((c, j) => <Inline key={j} node={c} />),
        }))}
      />
    );
  const shape = {
    ...node,
    rows: node.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, i) => (
        <span key={i}>
          {cell.map((c, j) => (
            <Inline key={j} node={c} />
          ))}
        </span>
      )),
    })),
  };
  return <StaticTable node={shape} />;
}

/** 오류 표식 — 문자 글리프(⚠)가 아니라 그린다. 색은 `currentColor` 로 상속된다 (디자인원칙 §1.6). */
function WarningIcon() {
  return (
    <svg className="ts-icon" width={12} height={12} viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M7 1.5 L13 12.5 L1 12.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="7" y1="5.5" x2="7" y2="9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="10.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function ErrorMark({ node }: { node: ErrorNode }) {
  return (
    <span id={`node-${node.id}`} className="ts-doc-error" role="alert" title={node.issue.message}>
      <WarningIcon />
      {node.issue.message}
    </span>
  );
}

function Inline({ node }: { node: RenderedInline }) {
  switch (node.kind) {
    case "text":
      return <>{node.text}</>;
    case "articleRef":
      return (
        <span id={`node-${node.id}`} className="ts-doc-ref">
          {node.label}
        </span>
      );
    case "appendixRef":
      return (
        <span id={`node-${node.id}`} className="ts-doc-ref">
          {node.label}
        </span>
      );
    case "error":
      return <ErrorMark node={node} />;
  }
}

function Subitem({ node }: { node: RenderedSubitem | RenderedStatic | ErrorNode }) {
  if (node.kind === "error") return <li><ErrorMark node={node} /></li>;
  if (node.kind !== "subitem") return <li className="ts-doc-static-item"><Static node={node} /></li>;
  return (
    <li id={`node-${node.id}`} className="ts-doc-subitem">
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
    </li>
  );
}

function Item({ node }: { node: RenderedItem | RenderedStatic | ErrorNode }) {
  if (node.kind === "error") return <li><ErrorMark node={node} /></li>;
  if (node.kind !== "item") return <li className="ts-doc-static-item"><Static node={node} /></li>;
  return (
    <li id={`node-${node.id}`} className="ts-doc-item">
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
      {node.subitems && node.subitems.length > 0 && (
        <ol className="ts-doc-subitems">
          {node.subitems.map((s, i) => (
            <Subitem key={i} node={s} />
          ))}
        </ol>
      )}
    </li>
  );
}

/** 항 — 호 목록이 있으면 `<div>` 로, 없으면 `<p>` 로 낸다 — `<ol>` 을 `<p>` 안에 두지 않기 위해서다 (문단 표시는 클래스가 한다). */
function Paragraph({ node }: { node: RenderedParagraph | RenderedStatic | ErrorNode }) {
  if (node.kind === "error")
    return (
      <p className="ts-doc-paragraph">
        <ErrorMark node={node} />
      </p>
    );
  if (node.kind !== "paragraph") return <Static node={node} />;
  const items = node.items ?? [];
  const body = (
    <>
      {node.label ? <span className="ts-doc-num">{node.label}</span> : null}{" "}
      {node.children.map((c, i) => (
        <Inline key={i} node={c} />
      ))}
    </>
  );
  if (items.length === 0)
    return (
      <p id={`node-${node.id}`} className={node.label ? "ts-doc-paragraph" : "ts-doc-paragraph is-bare"}>
        {body}
      </p>
    );
  return (
    <div id={`node-${node.id}`} className={node.label ? "ts-doc-paragraph" : "ts-doc-paragraph is-bare"}>
      {body}
      <ol className="ts-doc-items">
        {items.map((it, i) => (
          <Item key={i} node={it} />
        ))}
      </ol>
    </div>
  );
}

function Section({ node }: { node: RenderedSection }) {
  return (
    <section id={`node-${node.id}`} className="ts-doc-section">
      <h2 className="ts-doc-section-title">
        {node.label} {node.title}
      </h2>
      {node.children.map((a, i) => (
        <Article key={i} node={a} />
      ))}
    </section>
  );
}

function Article({ node }: { node: RenderedArticle | RenderedSection | ErrorNode }) {
  if (node.kind === "error") return <div className="ts-doc-article"><ErrorMark node={node} /></div>;
  if (node.kind === "section") return <Section node={node} />;
  return (
    <section id={`node-${node.id}`} className="ts-doc-article">
      <h3 className="ts-doc-article-title">
        {node.label}({node.title})
      </h3>
      {node.children.map((p, i) => (
        <Paragraph key={i} node={p} />
      ))}
    </section>
  );
}

/** 조 하나 — 문면 저작 화면 미리보기 탭이 고른 상품 문맥으로 조립한 조를 그린다 (기능/문면 §3.9). */
export function RenderedArticleView({ node }: { node: RenderedArticle }) {
  return <Article node={node} />;
}

/** `heading` — 문서 제목 대신 찍을 머리(절 형태의 「제1절 일반조항」 · 블록 머리 「1. {제목}」). */
export function RenderedDoc({ doc, heading }: { doc: RenderedDocType; heading?: string }) {
  return (
    <article className="ts-doc" data-owner={doc.ownerId}>
      <h2 className="ts-doc-title">{heading ?? doc.title}</h2>
      {doc.children.map((a, i) => (
        <Article key={i} node={a} />
      ))}
    </article>
  );
}

/**
 * 책자의 특약 그룹 하나 (ADR-0090) — 제목 = 사용자 그룹 이름 · 담보분류 값의 「그룹 제목」. 「그룹 제목」이 비었으면 제목 자리에 오류 마커.
 * 담보분류를 정할 수 없는 상품담보(미입력 · 지운 값)의 자리는 제목 줄이 없다.
 */
export function RenderedGroupView({ group }: { group: RenderedGroup }) {
  return (
    <section className="ts-doc-group" aria-label={group.title ?? (group.titleError ? "그룹 제목 없는 특별약관" : "그룹 없는 특별약관")}>
      {group.title !== undefined && <h2 className="ts-doc-group-title">{group.title}</h2>}
      {group.title === undefined && group.titleError && (
        <h2 className="ts-doc-group-title">
          <ErrorMark node={group.titleError} />
        </h2>
      )}
      {group.docs.map((d, i) => (
        <RenderedDoc key={`${d.ownerId ?? d.id}-${i}`} doc={d} />
      ))}
    </section>
  );
}

/**
 * 절 형태의 제2절 보장조항 (기능/조립산출 §3.8 · §4.1) — 블록을 그룹 순서대로. 그룹 제목 표시를 켰으면 그룹 머리 줄 「Ⅰ. {그룹 제목}」
 * (제목이 빈 기본 그룹은 그 자리에 오류 마커), 블록마다 머리 「{블록 머리} {블록 제목}」 + 블록 조(제1조부터).
 */
export function RenderedBlocksView({ groups }: { groups: readonly RenderedBlockGroup[] }) {
  return (
    <section className="ts-doc-part" aria-label="제2절 보장조항">
      <h2 className="ts-doc-title">제2절 보장조항</h2>
      {groups.length === 0 && <p className="ts-muted">블록이 없다.</p>}
      {groups.map((g) => (
        <section key={g.id} className="ts-doc-group" aria-label={g.label !== undefined ? `${g.label} ${g.title ?? ""}`.trim() : "블록"}>
          {g.label !== undefined && (
            <h3 className="ts-doc-group-title">
              {g.label} {g.title ?? (g.titleError ? <ErrorMark node={g.titleError} /> : null)}
            </h3>
          )}
          {g.blocks.map((b) => (
            <RenderedDoc key={b.productCoverageId} doc={b.doc} heading={`${b.label} ${b.title}`} />
          ))}
        </section>
      ))}
    </section>
  );
}
