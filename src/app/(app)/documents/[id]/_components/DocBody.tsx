"use client";

/**
 * L3 가운데 — 문면을 **문서 세계**로 그린다 (디자인원칙 §1.1 · 기능/문면 §4.3).
 *
 * - 가운데는 **조 하나**다(`ArticleBody`) — 조 위에 소속 관 머리 줄, 조를 감싼 블록 조건이 있으면 그 띠와 머리 줄.
 *   약관 전체를 이어 읽는 것(`DocBody`)은 더보기 › 미리보기와 사전평가 결과 조문만 쓴다.
 * - 읽기 모드에는 조작이 없다. 편집 모드에서는 **그 자리가 편집기**다 — 제목 · 문장은 그 자리에서 치고, 칩 · 조건 머리는 누르면
 *   바로 아래에 팝업, 넣기 · 이동 · 복제 · 삭제는 오른쪽 클릭 메뉴(자리는 `data-*` 로 읽는다). 블록마다 붙던 버튼 줄은 없다.
 * - 조건 분기는 배경색 없이 왼쪽 띠 + 머리 줄(IF / ELIF / ELSE)로만 표시한다.
 * - 노드 id·8자리 접두를 화면에 내보내지 않는다 (리뷰 #25).
 */
import type { MouseEvent, ReactNode } from "react";

import { StaticTable } from "@/app/_components/StaticNodes";
import { REPEAT_DEPTH_LABEL } from "@/app/_lib/labels";
import { referenceTargetLabel, type ArticleNode, type BlockBranch, type DocumentNode, type Node, type TableNode, type TreeIndex } from "@/domain/document";
import type { Id } from "@/domain/types";

import { parseLines } from "../../lib";
import { anchorOf, chipText, type DocCtx } from "./ctx";
import { EditableText, InlineSlot } from "./Inline";

const flash = (ctx: DocCtx, id: Id) => (ctx.flashId === id ? " is-flash" : "");

/** 블록 조건 가지의 머리 줄 — `IF 조건식` · `ELIF …` · `ELSE`. 편집 모드에서는 눌러서 조건을 고친다(바로 아래 팝업). */
function CondHead({ ctx, branch, label }: { ctx: DocCtx; branch: BlockBranch; label: string }) {
  const { text, full } = chipText(branch.when, ctx.mode, ctx.refLabel);
  const state = ctx.branchEval?.get(branch.id)?.state;
  const suffix = state === "taken" ? " · 참" : state === "notTaken" ? " · 거짓" : state === "undetermined" ? " · 미결" : state === "error" ? " · 오류" : "";
  const body = `${label}${branch.when === undefined ? "" : ` ${text}`}${suffix}`;
  if (!ctx.edit) {
    return (
      <span className="ts-doc-cond-head" title={full}>
        {body}
      </span>
    );
  }
  const edit = ctx.edit;
  return (
    <button
      type="button"
      className="ts-doc-cond-head ts-doc-cond-btn"
      data-cond-head={branch.id}
      title={`조건 고치기 — ${full} · 오른쪽 클릭으로 가지 추가 · 풀기 · 삭제`}
      onClick={(e) => edit.popup({ kind: "when", branchId: branch.id }, anchorOf(e.currentTarget))}
    >
      {body}
    </button>
  );
}

const branchLabel = (branches: readonly { when?: string }[], i: number) => (i === 0 ? "IF" : branches[i].when === undefined ? "ELSE" : "ELIF");

/** 표 셀의 조작 줄 — 누른 셀의 표 바로 위에 뜬다(셀을 가리지 않게). 담보약관이면 「이 행 반복…」. */
function CellToolbar({ ctx, table, row, col }: { ctx: DocCtx; table: TableNode; row: number; col: number }) {
  const edit = ctx.edit!;
  const header = table.rows[row]?.header === true;
  const run = (ops: Parameters<typeof edit.apply>[0], next?: { row: number; col: number }) => {
    if (edit.apply(ops)) edit.setActiveCell(next ? { tableId: table.id, ...next } : undefined);
  };
  const b = (label: string, onClick: (e: MouseEvent<HTMLButtonElement>) => void, disabled = false, danger = false) => (
    <button type="button" className={danger ? "danger" : undefined} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <span className="ts-cell-bar" role="toolbar" aria-label={`${row + 1}행 ${col + 1}열 셀 조작`}>
      <span className="ts-cell-bar-at">
        {row + 1}행 {col + 1}열
      </span>
      {b("위에 행", () => run([{ type: "insertTableRow", tableId: table.id, index: row }], { row: row + 1, col }))}
      {b("아래에 행", () => run([{ type: "insertTableRow", tableId: table.id, index: row + 1 }], { row, col }))}
      {b("왼쪽 열", () => run([{ type: "insertTableColumn", tableId: table.id, index: col }], { row, col: col + 1 }))}
      {b("오른쪽 열", () => run([{ type: "insertTableColumn", tableId: table.id, index: col + 1 }], { row, col }))}
      {b(header ? "제목줄 해제" : "제목줄로", () => run([{ type: "setTableRowHeader", tableId: table.id, index: row, header: !header }], { row, col }))}
      {b("행 삭제", () => run([{ type: "removeTableRow", tableId: table.id, index: row }]), table.rows.length <= 1, true)}
      {b("열 삭제", () => run([{ type: "removeTableColumn", tableId: table.id, index: col }]), table.columns.length <= 1, true)}
      {ctx.docKind === "special" && !header && b("이 행 반복…", (e) => edit.popup({ kind: "repeat", tableId: table.id }, anchorOf(e.currentTarget)))}
    </span>
  );
}

/**
 * 정적 표 · 행 반복 표 (기능/문면 §3.2 · ADR-0070 결정 6).
 * - 미리보기(`ctx.tables`)에 펼침 결과가 있으면 펼친 표(복제 행 · 병합)를, 행 0 이면 회색 「표 생략됨」 자리를 그린다.
 * - 그 밖에는 템플릿 그대로 — 반복 표면 템플릿 행 왼쪽에 for 띠. 편집 모드면 셀마다 그 자리 편집기.
 */
function Table({ node, ctx }: { node: TableNode; ctx: DocCtx }) {
  const evaluated = ctx.tables?.get(node.id);
  if (evaluated?.kind === "omitted") {
    return (
      <figure id={`node-${node.id}`} className="ts-doc-table-wrap ts-muted" style={{ border: "1px dashed var(--ts-rule-strong)", padding: "8px 12px", color: "var(--ts-ink-3)" }}>
        표 생략됨{node.title ? ` — ${node.title}` : ""} (반복할 행이 없다 — 산출본에는 이 표가 나오지 않는다)
      </figure>
    );
  }
  const source = evaluated?.kind === "expanded" ? evaluated.expansion.table : node;
  const editing = ctx.edit !== undefined && evaluated === undefined;
  const active = ctx.edit?.activeCell?.tableId === node.id ? ctx.edit.activeCell : undefined;
  const shape = {
    ...source,
    rows: source.rows.map((row, ri) => ({
      ...row,
      cells: row.cells.map((cell, ci) =>
        editing ? (
          <span key={ci} className="ts-cell">
            <InlineSlot at={{ tableId: node.id, row: ri, col: ci }} nodes={cell} ctx={ctx} placeholder={`${ri + 1}행 ${ci + 1}열`} />
          </span>
        ) : (
          <InlineSlot key={ci} at={{ tableId: node.id, row: ri, col: ci }} nodes={cell} ctx={ctx} />
        ),
      ),
    })),
  };
  const band = node.repeat && evaluated?.kind !== "expanded" ? REPEAT_DEPTH_LABEL[node.repeat.depth].band : undefined;
  return (
    <div className={editing ? "ts-table-edit" : undefined}>
      {/* 셀 조작 줄은 표 바로 위에 뜬다 — 셀을 가리지 않는다 */}
      {editing && active && node.rows[active.row]?.cells[active.col] && <CellToolbar ctx={ctx} table={node} row={active.row} col={active.col} />}
      <StaticTable node={shape} {...(band ? { band } : {})} />
      {evaluated?.kind === "error" && <p className="ts-error-banner">{evaluated.issue.message}</p>}
    </div>
  );
}

/** 【용어풀이】 박스 — 편집 모드면 제목 · 줄을 그 자리에서. */
function Box({ node, ctx }: { node: Node & { kind: "box" }; ctx: DocCtx }) {
  const edit = ctx.edit;
  return (
    <aside id={`node-${node.id}`} className="ts-doc-box">
      <p className="ts-doc-box-title">
        【<EditableText value={node.title} editing={!!edit} label="박스 제목" onCommit={(title) => edit?.setBox(node.id, title, node.lines)} />】
      </p>
      {edit ? (
        <EditableText value={node.lines.join("\n")} editing multiline label="박스 줄 — 한 줄씩" className="ts-doc-box-line" onCommit={(text) => edit.setBox(node.id, node.title, parseLines(text))} />
      ) : (
        node.lines.map((l, i) => (
          <p key={i} className="ts-doc-box-line">
            {l}
          </p>
        ))
      )}
    </aside>
  );
}

/** 블록 조건 — 가지마다 왼쪽 띠 하나 + 머리 줄. 첫 가지는 실선(IF), 나머지는 파선(ELIF · ELSE). */
function CondBlock({ node, ctx, as }: { node: Node & { kind: "condBlock" }; ctx: DocCtx; as: "div" | "li" }) {
  const Tag = as;
  return (
    <>
      {node.branches.map((br, i) => {
        const dim = ctx.branchEval?.get(br.id)?.state === "notTaken";
        return (
          <Tag key={br.id} data-node={br.id} className={`ts-doc-cond${i === 0 ? "" : " is-alt"}${dim ? " ts-dim" : ""}${flash(ctx, br.id)}`} style={dim ? { textDecoration: "line-through" } : undefined}>
            <CondHead ctx={ctx} branch={br} label={branchLabel(node.branches, i)} />
            <Block nodes={br.children} ctx={ctx} inList={as === "li"} />
          </Tag>
        );
      })}
    </>
  );
}

/** 항·호·목·조건 블록 — 자리에 맞는 태그로. `data-block` 은 오른쪽 클릭 메뉴가 자리를 읽는 표지다. */
function Block({ nodes, ctx, inList }: { nodes: readonly Node[]; ctx: DocCtx; inList?: boolean }): ReactNode {
  return nodes.map((node) => {
    switch (node.kind) {
      case "paragraph": {
        const num = ctx.numbers.get(node.id);
        return (
          <div key={node.id} className={`ts-doc-paragraph${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            {num?.label ? <span className="ts-doc-num">{num.label}</span> : null} <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="항 — 문장을 쓴다" />
            {(node.items ?? []).length > 0 && (
              <ol className="ts-doc-items">
                <Block nodes={node.items ?? []} ctx={ctx} inList />
              </ol>
            )}
          </div>
        );
      }

      case "item":
        return (
          <li key={node.id} className={`ts-doc-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="호 — 문장을 쓴다" />
            {(node.subitems ?? []).length > 0 && (
              <ol className="ts-doc-subitems">
                <Block nodes={node.subitems ?? []} ctx={ctx} inList />
              </ol>
            )}
          </li>
        );

      case "subitem":
        return (
          <li key={node.id} className={`ts-doc-subitem${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="목 — 문장을 쓴다" />
          </li>
        );

      case "clauseBlockRef": {
        const num = ctx.numbers.get(node.id);
        const label = ctx.clauseLabel.get(node.clauseCode) ?? `${node.clauseCode}(없는 공용조항)`;
        const edit = ctx.edit;
        return (
          <div key={node.id} className={`ts-doc-paragraph${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <span className="ts-doc-num">{num?.label}</span>{" "}
            <span
              className={`ts-doc-ref${edit ? " ts-chip-inline" : ""}`}
              title={`공용조항(조 단위) · ${node.clauseCode} · ${ctx.optionText(node.clauseCode, node.options)}${edit ? " — 눌러서 옵션 고치기" : ""}`}
              onClick={edit ? (e) => edit.popup({ kind: "editChip", nodeId: node.id }, anchorOf(e.currentTarget)) : undefined}
            >
              〔{label}〕
            </span>{" "}
            <span className="ts-doc-cond-head">{ctx.optionText(node.clauseCode, node.options)}</span>
          </div>
        );
      }

      case "condBlock":
        return <CondBlock key={node.id} node={node} ctx={ctx} as={inList ? "li" : "div"} />;

      // 정적 표·박스 — 항·호 뒤에 붙는 번호 없는 블록 (기능/문면 §3.2). 목록 자리면 <li> 로 감싼다.
      case "table": {
        const body = <Table node={node} ctx={ctx} />;
        return inList ? (
          <li key={node.id} className={`ts-doc-static-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            {body}
          </li>
        ) : (
          <div key={node.id} className={flash(ctx, node.id).trim() || undefined} data-block={node.id} data-node={node.id}>
            {body}
          </div>
        );
      }
      case "box": {
        const body = <Box node={node} ctx={ctx} />;
        return inList ? (
          <li key={node.id} className="ts-doc-static-item" data-block={node.id} data-node={node.id}>
            {body}
          </li>
        ) : (
          <div key={node.id} data-block={node.id} data-node={node.id}>
            {body}
          </div>
        );
      }

      case "section":
        return (
          <section key={node.id} id={`sec-${node.id}`} className="ts-doc-section">
            <SectionHead node={node} ctx={ctx} />
            <Block nodes={node.children} ctx={ctx} />
          </section>
        );

      case "forBlock":
        return (
          <div key={node.id} className="ts-muted" data-block={node.id} data-node={node.id}>
            (반복 블록 — 아직 지원하지 않는다)
          </div>
        );

      case "article":
        return <Article key={node.id} node={node} ctx={ctx} />;

      default:
        return null;
    }
  });
}

/** 관 머리 줄 — 「제N관 제목」. 편집 모드면 제목을 그 자리에서 고친다. */
function SectionHead({ node, ctx }: { node: Node & { kind: "section" }; ctx: DocCtx }) {
  const num = ctx.numbers.get(node.id);
  return (
    <h2 className={`ts-doc-section-title${flash(ctx, node.id)}`} data-section-title={node.id} data-node={node.id}>
      {num?.label ?? "관"} <EditableText value={node.title} editing={!!ctx.edit} label="관 제목" onCommit={(title) => ctx.edit?.setTitle(node.id, title)} />
    </h2>
  );
}

/** 조연결은 조 바로 위 평문이다 (「이 조가 보통약관 어디를 따라가나」는 조와 같이 읽힌다). 편집 모드면 눌러서 고친다. */
function ArticleLink({ article, ctx }: { article: ArticleNode; ctx: DocCtx }) {
  const target = article.linkedArticleId ? ctx.references.general.get(article.linkedArticleId) : undefined;
  const text = `조연결 — 보통약관 ${target ? referenceTargetLabel(target) : "에 없는 조 (연결이 끊겼다)"}`;
  if (!ctx.edit) {
    return (
      <p className="ts-doc-cond-head" title="조연결 — 이 조가 대응 보통약관의 어느 조를 따라가는가">
        {text}
      </p>
    );
  }
  const edit = ctx.edit;
  return (
    <p>
      <button type="button" className="ts-doc-cond-head ts-doc-cond-btn" title="조연결 고치기" onClick={(e) => edit.popup({ kind: "link", articleId: article.id }, anchorOf(e.currentTarget))}>
        {text}
      </button>
    </p>
  );
}

function Article({ node, ctx }: { node: ArticleNode; ctx: DocCtx }) {
  const num = ctx.numbers.get(node.id);
  const label = num?.label ?? "조";
  return (
    <section id={`art-${node.id}`} className="ts-doc-article" data-article={node.id}>
      {node.linkedArticleId !== undefined && <ArticleLink article={node} ctx={ctx} />}
      <h3 className={`ts-doc-article-title${flash(ctx, node.id)}`} data-article-title={node.id} data-node={node.id}>
        {label}(<EditableText value={node.title} editing={!!ctx.edit} label="조 제목" onCommit={(title) => ctx.edit?.setTitle(node.id, title)} />)
      </h3>
      {node.children.length === 0 && ctx.edit ? (
        <p className="ts-muted ts-doc-hint">항이 없다 — 조 제목을 오른쪽 클릭해 「항 추가」.</p>
      ) : (
        <Block nodes={node.children} ctx={ctx} />
      )}
    </section>
  );
}

/**
 * 가운데 — 조 하나. 조의 조상(관 · 블록 조건 가지)을 바깥부터 감싼다: 관이면 머리 줄, 가지면 왼쪽 띠 + 머리 줄.
 * 같은 조건 블록의 다른 가지에 든 조는 목차에서 따로 연다.
 */
export function ArticleBody({ index, articleId, ctx }: { index: TreeIndex; articleId: Id; ctx: DocCtx }) {
  const entry = index.nodes.get(articleId);
  if (!entry || entry.node.kind !== "article") return null;
  let content: ReactNode = <Article node={entry.node} ctx={ctx} />;
  const ancestors = entry.path.slice(1, -1);
  for (const id of [...ancestors].reverse()) {
    const br = index.branches.get(id);
    if (br) {
      const owner = index.nodes.get(br.ownerId)?.node as { branches: BlockBranch[] } | undefined;
      const dim = ctx.branchEval?.get(id)?.state === "notTaken";
      content = (
        <div data-node={id} className={`ts-doc-cond${br.index === 0 ? "" : " is-alt"}${dim ? " ts-dim" : ""}${flash(ctx, id)}`}>
          <CondHead ctx={ctx} branch={br.branch as BlockBranch} label={branchLabel(owner?.branches ?? [], br.index)} />
          {content}
        </div>
      );
      continue;
    }
    const n = index.nodes.get(id)?.node;
    if (n?.kind === "section") {
      content = (
        <section id={`sec-${n.id}`} className="ts-doc-section">
          <SectionHead node={n} ctx={ctx} />
          {content}
        </section>
      );
    }
  }
  return <article className="ts-doc">{content}</article>;
}

/** 문서 하나 전체 — 더보기 › 미리보기 · 사전평가 결과 조문 (읽기 전용). */
export function DocBody({ tree, ctx }: { tree: DocumentNode; ctx: DocCtx }) {
  const read: DocCtx = { ...ctx, mode: "read", edit: undefined };
  return (
    <article className="ts-doc">
      <h2 className="ts-doc-title">{tree.title}</h2>
      {tree.children.length === 0 ? <p className="ts-muted">아직 조가 하나도 없다.</p> : <Block nodes={tree.children} ctx={read} />}
    </article>
  );
}

