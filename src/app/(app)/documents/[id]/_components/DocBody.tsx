/**
 * L3 중앙 — 문면을 **문서 세계**로 그린다 (디자인원칙 §1.1 · §2 L3 · 리뷰 #43).
 *
 * - 명조 15px/1.9 · 측정폭 44em 은 `.ts-doc` 이 준다. 여기서는 구조만 만든다.
 * - 읽기 모드에는 조작이 하나도 없다. 편집 모드에서만 행 오른쪽 끝에 아이콘 버튼이 붙는다 (§2 L3).
 * - 조건 분기는 배경색 없이 괘선 + 조건식 칩(mono)으로만 표시한다.
 * - 노드 id·8자리 접두를 화면에 내보내지 않는다 (리뷰 #25).
 * - 편집 모드의 조작은 전부 **편집본**에 적용된다 (ADR-0074) — 이동 · 복제는 그 자리에서, 삭제는 확인 카드를 거쳐.
 *   서버에는 `저장` 때 한 번 간다.
 */
import type { ReactNode } from "react";

import { IconButton, IconCopy, IconDown, IconEdit, IconPlus, IconTrash, IconUp } from "@/app/_components/icons";
import { StaticBox, StaticTable } from "@/app/_components/StaticNodes";
import { REPEAT_DEPTH_LABEL, STRUCT_KEY_CHIP } from "@/app/_lib/labels";
import { referenceChunkLabel, referenceTargetLabel, type ArticleRefNode, type BlockBranch, type InlineBranch, type Node, type ReferenceTarget, type TableNode } from "@/domain/document";
import type { Id } from "@/domain/types";

import { chipText, type DocCtx } from "./ctx";

/** 행 오른쪽 끝 조작 묶음 — 위로 · 아래로 · 복제 · 삭제 + 우측 패널에서 열기 (§1.6 전부 tooltip). */
export function NodeControls({ ctx, nodeId, what }: { ctx: DocCtx; nodeId: Id; what: string }) {
  return (
    <span className="ts-doc-actions">
      <IconButton
        label={`${what} 고치기`}
        aria-current={ctx.selectedId === nodeId ? "true" : undefined}
        icon={<IconEdit />}
        onClick={() => ctx.select({ node: nodeId })}
      />
      <IconButton label={`${what} 위로`} icon={<IconUp />} onClick={() => ctx.move(nodeId, -1)} />
      <IconButton label={`${what} 아래로`} icon={<IconDown />} onClick={() => ctx.move(nodeId, 1)} />
      <IconButton label={`${what} 복제`} icon={<IconCopy />} onClick={() => ctx.apply([{ type: "duplicate", nodeId }])} />
      <IconButton danger label={`${what} 삭제`} icon={<IconTrash />} onClick={() => ctx.askRemove(nodeId)} />
    </span>
  );
}

/** 조건 가지 머리 — 조건식 칩 하나 (+ IF/ELIF/ELSE 접두, 블록 조건만). 편집 모드에서는 눌러 우측 패널에 싣는다 (§2 L3 · Q8). */
function CondChip({ ctx, branch, label }: { ctx: DocCtx; branch: BlockBranch | InlineBranch; label?: string }) {
  const { text, full } = chipText(branch.when, ctx.mode, ctx.refLabel);
  const state = ctx.branchEval?.get(branch.id)?.state;
  const suffix = state === "taken" ? " · 참" : state === "notTaken" ? " · 거짓" : state === "undetermined" ? " · 미결" : state === "error" ? " · 오류" : "";
  const prefix = label ? `${label} ` : "";
  if (ctx.mode === "read") {
    return (
      <span className="ts-doc-cond-head" title={full}>
        {prefix}
        {text}
        {suffix}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="ts-doc-pick ts-doc-cond-head"
      onClick={() => ctx.select({ node: branch.id })}
      title={`조건식 고치기 — ${full}`}
      aria-current={ctx.selectedId === branch.id ? "true" : undefined}
    >
      {prefix}
      {text}
      {suffix}
    </button>
  );
}

function articleRefText(node: ArticleRefNode, ctx: DocCtx): string {
  // 편집기 미리보기 — 조립과 같은 덩어리 규칙(기능/문면 §3.5). 전체 뷰 번호라 분기 결과는 반영되지 않는다.
  const index = node.scope === "general" ? ctx.references.general : ctx.references.self;
  const alive: ReferenceTarget[] = [];
  let broken = 0;
  for (const { nodeId } of node.targets) {
    const target = index.get(nodeId);
    if (target) alive.push(target);
    else broken += 1;
  }
  const joined = alive.length === 0 ? (broken > 0 ? "없는 조(연결 끊김)" : "대상 없음") : referenceChunkLabel(alive, node.connector);
  return `${node.scope === "general" ? "보통약관 " : ""}${joined}${alive.length > 0 && broken > 0 ? ` (연결 끊김 ${broken}건)` : ""}`;
}

/** 인라인 노드 한 줄. 편집 모드에서도 인라인에는 조작 아이콘을 달지 않는다 — 문면 흐름이 끊긴다. */
function Inline({ node, ctx }: { node: Node; ctx: DocCtx }): ReactNode {
  switch (node.kind) {
    case "text":
      return <>{node.text}</>;

    case "slot": {
      const ev = ctx.slotEval?.get(node.id);
      const shown = ev?.kind === "value" ? String(ev.value) : node.ref;
      const why = ev?.kind === "undetermined" ? ` — 아직 정해지지 않았다 (${ev.reason})` : ev?.kind === "error" ? ` — ${ev.issue.message}` : "";
      return (
        <span className="ts-doc-slot" title={`치환 슬롯 · ${node.ref}${why}`}>
          {shown}
        </span>
      );
    }

    case "articleRef":
      return (
        <span className="ts-doc-ref" title="조 참조 슬롯 — 번호는 계산값이다">
          {articleRefText(node, ctx)}
        </span>
      );

    case "appendixRef":
      return (
        <span className="ts-doc-ref" title={`별표 참조 · ${node.appendixCode}`}>
          【별표 {ctx.appendixName.get(node.appendixCode) ?? `${node.appendixCode}(없는 별표)`}】
        </span>
      );

    case "clauseInlineRef":
      return (
        <span className="ts-doc-ref" title={`공용조항(문장 안) · ${node.clauseCode} · ${ctx.optionText(node.clauseCode, node.options)}`}>
          〔{ctx.clauseLabel.get(node.clauseCode) ?? `${node.clauseCode}(없는 공용조항)`}〕
        </span>
      );

    // 문장 안 조건은 **점선 밑줄만**이다 — 칩도 배경도 두지 않는다 (§2 L3). 조건식은 tooltip 으로 준다.
    // 편집 모드에서만 칩이 나타나 눌러서 우측 패널에 싣는다 (Q8).
    case "inlineCond":
      return (
        <>
          {node.branches.map((br, i) => {
            const state = ctx.branchEval?.get(br.id)?.state;
            const { full } = chipText(br.when, "edit", ctx.refLabel);
            const body = br.children.map((c) => <Inline key={c.id} node={c} ctx={ctx} />);
            return (
              <span
                key={br.id}
                className={`ts-doc-inline-cond${i === 0 ? "" : " is-alt"}${state === "notTaken" ? " ts-dim" : ""}`}
                title={`문장 안 조건 — ${full}`}
              >
                {ctx.mode === "edit" && (
                  <>
                    <CondChip ctx={ctx} branch={br} />{" "}
                  </>
                )}
                {body}
              </span>
            );
          })}
        </>
      );

    case "inlineFor":
      return <span className="ts-muted">(문장 안 반복 — 아직 지원하지 않는다)</span>;

    // 구조 표기 — 반복 표 셀에서 행마다 key 표기로 바뀌는 자리 (ADR-0070 결정 6). 펼친 미리보기에서는 이미 텍스트다.
    case "structKey":
      return (
        <span className="ts-doc-ref" title="구조 표기 — 행마다 그 행의 노드 이름이 찍힌다">
          {STRUCT_KEY_CHIP[node.level]}
        </span>
      );

    default:
      return null;
  }
}

const INLINE_WHAT: Record<string, string> = {
  text: "문장",
  slot: "치환 슬롯",
  articleRef: "조 참조 슬롯",
  appendixRef: "별표 참조 슬롯",
  clauseInlineRef: "공용조항 참조",
  inlineCond: "문장 안 조건",
  inlineFor: "문장 안 반복",
  structKey: "구조 표기",
};

/**
 * 인라인 자리에는 아이콘 버튼을 달지 않는다 — 문면 흐름이 끊긴다 (§2 L3).
 * 대신 **편집 모드에서만 글자 자체가 눌리는 자리가 되고**(점선 밑줄이 「여기 고칠 수 있다」를 말한다),
 * 누르면 우측 패널에 그 자리의 폼이 실린다.
 */
function Inlines({ nodes, ctx }: { nodes: readonly Node[]; ctx: DocCtx }) {
  return nodes.map((c) => {
    const body = <Inline key={c.id} node={c} ctx={ctx} />;
    if (ctx.mode !== "edit" || c.kind === "inlineCond" || c.kind === "inlineFor") return body;
    const selected = ctx.selectedId === c.id;
    return (
      <button
        key={c.id}
        type="button"
        className="ts-doc-pick"
        onClick={() => ctx.select({ node: c.id })}
        title={`${INLINE_WHAT[c.kind] ?? c.kind} 고치기 — 오른쪽 패널에서 연다`}
        aria-label={`${INLINE_WHAT[c.kind] ?? c.kind} 고치기`}
        aria-current={selected ? "true" : undefined}
      >
        {body}
      </button>
    );
  });
}

/** 셀에 넣기 — 편집 모드에서 셀마다 작은 ＋. 누르면 우측 패널에 그 셀의 「여기에 추가」가 실린다. */
function CellAdd({ ctx, tableId, row, col }: { ctx: DocCtx; tableId: Id; row: number; col: number }) {
  const selected = ctx.selectedCell?.tableId === tableId && ctx.selectedCell.row === row && ctx.selectedCell.col === col;
  return (
    <button
      type="button"
      onClick={() => ctx.select({ node: tableId, cell: { row, col } })}
      className="ts-doc-cell-add"
      title={`${row + 1}행 ${col + 1}열 셀에 넣기 — 오른쪽 패널에서 연다`}
      aria-label={`${row + 1}행 ${col + 1}열 셀에 추가`}
      aria-current={selected ? "true" : undefined}
    >
      <IconPlus />
    </button>
  );
}

/**
 * 정적 표 · 행 반복 표 (기능/문면 §3.2 · ADR-0070 결정 6).
 * - 미리보기(`ctx.tables`)에 펼침 결과가 있으면 펼친 표(복제 행 · 병합)를, 행 0 이면 회색 「표 생략됨」 자리를 그린다.
 * - 그 밖에는 템플릿 그대로 — 반복 표면 템플릿 행 왼쪽에 for 띠.
 */
function Table({ node, ctx }: { node: TableNode; ctx: DocCtx }) {
  const controls = ctx.mode === "edit" ? <NodeControls ctx={ctx} nodeId={node.id} what={`표${node.title ? ` ${node.title}` : ""}`} /> : undefined;
  const evaluated = ctx.tables?.get(node.id);
  if (evaluated?.kind === "omitted") {
    return (
      <figure id={`node-${node.id}`} className="ts-doc-table-wrap ts-muted" style={{ border: "1px dashed var(--ts-rule-strong)", padding: "8px 12px", color: "var(--ts-ink-3)" }}>
        {controls}
        표 생략됨{node.title ? ` — ${node.title}` : ""} (반복할 행이 없다 — 산출본에는 이 표가 나오지 않는다)
      </figure>
    );
  }
  const source = evaluated?.kind === "expanded" ? evaluated.expansion.table : node;
  const editCells = ctx.mode === "edit" && evaluated === undefined;
  const shape = {
    ...source,
    rows: source.rows.map((row, ri) => ({
      ...row,
      cells: row.cells.map((cell, ci) => (
        <span key={ci}>
          <Inlines nodes={cell} ctx={ctx} />
          {editCells && <CellAdd ctx={ctx} tableId={node.id} row={ri} col={ci} />}
        </span>
      )),
    })),
  };
  const band = node.repeat && evaluated?.kind !== "expanded" ? REPEAT_DEPTH_LABEL[node.repeat.depth].band : undefined;
  return (
    <>
      <StaticTable node={shape} controls={controls} {...(band ? { band } : {})} />
      {evaluated?.kind === "error" && <p className="ts-error-banner">{evaluated.issue.message}</p>}
    </>
  );
}

/** 블록 조건 — 가지마다 괘선 하나. 첫 가지는 실선(if), 나머지는 파선(elif · else). */
function CondBlock({ node, ctx, as }: { node: Node & { kind: "condBlock" }; ctx: DocCtx; as: "div" | "li" }) {
  const Tag = as;
  return (
    <>
      {node.branches.map((br, i) => {
        const dim = ctx.branchEval?.get(br.id)?.state === "notTaken";
        const label = i === 0 ? "IF" : br.when === undefined ? "ELSE" : "ELIF";
        return (
          <Tag key={br.id} className={`ts-doc-cond${i === 0 ? "" : " is-alt"}${dim ? " ts-dim" : ""}`} style={dim ? { textDecoration: "line-through" } : undefined}>
            <CondChip ctx={ctx} branch={br} label={label} />
            <Block nodes={br.children} ctx={ctx} inList={as === "li"} />
          </Tag>
        );
      })}
    </>
  );
}

/** 항·호·목·조건 블록 — 자리에 맞는 태그로. */
function Block({ nodes, ctx, inList }: { nodes: readonly Node[]; ctx: DocCtx; inList?: boolean }): ReactNode {
  return nodes.map((node) => {
    switch (node.kind) {
      case "paragraph": {
        const num = ctx.numbers.get(node.id);
        return (
          <div key={node.id} className="ts-doc-paragraph">
            {ctx.mode === "edit" && <NodeControls ctx={ctx} nodeId={node.id} what={num ? `제${num.n}항` : "항"} />}
            {num?.label ? <span className="ts-doc-num">{num.label}</span> : null} <Inlines nodes={node.children} ctx={ctx} />
            {(node.items ?? []).length > 0 && (
              <ol className="ts-doc-items">
                <Block nodes={node.items ?? []} ctx={ctx} inList />
              </ol>
            )}
          </div>
        );
      }

      case "item": {
        const num = ctx.numbers.get(node.id);
        return (
          <li key={node.id} className="ts-doc-item">
            {ctx.mode === "edit" && <NodeControls ctx={ctx} nodeId={node.id} what={`제${num?.n ?? "?"}호`} />}
            <Inlines nodes={node.children} ctx={ctx} />
            {(node.subitems ?? []).length > 0 && (
              <ol className="ts-doc-subitems">
                <Block nodes={node.subitems ?? []} ctx={ctx} inList />
              </ol>
            )}
          </li>
        );
      }

      case "subitem": {
        const num = ctx.numbers.get(node.id);
        return (
          <li key={node.id} className="ts-doc-subitem">
            {ctx.mode === "edit" && <NodeControls ctx={ctx} nodeId={node.id} what={`제${num?.n ?? "?"}목`} />}
            <Inlines nodes={node.children} ctx={ctx} />
          </li>
        );
      }

      case "clauseBlockRef": {
        const num = ctx.numbers.get(node.id);
        const label = ctx.clauseLabel.get(node.clauseCode) ?? `${node.clauseCode}(없는 공용조항)`;
        return (
          <div key={node.id} className="ts-doc-paragraph">
            {ctx.mode === "edit" && <NodeControls ctx={ctx} nodeId={node.id} what={`공용조항 ${label}`} />}
            <span className="ts-doc-num">{num?.label}</span>{" "}
            <span className="ts-doc-ref" title={`공용조항(조 단위) · ${node.clauseCode} · ${ctx.optionText(node.clauseCode, node.options)}`}>
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
        return inList ? <li key={node.id} className="ts-doc-static-item">{body}</li> : <div key={node.id}>{body}</div>;
      }
      case "box": {
        const body = <StaticBox node={node} controls={ctx.mode === "edit" ? <NodeControls ctx={ctx} nodeId={node.id} what={`박스 ${node.title}`} /> : undefined} />;
        return inList ? <li key={node.id} className="ts-doc-static-item">{body}</li> : <div key={node.id}>{body}</div>;
      }

      case "section": {
        const num = ctx.numbers.get(node.id);
        const heading = `${num?.label ?? "관"} ${node.title}`;
        return (
          <section key={node.id} id={`sec-${node.id}`} className="ts-doc-section">
            {ctx.mode === "edit" && <NodeControls ctx={ctx} nodeId={node.id} what={heading} />}
            <h2 className="ts-doc-section-title">{heading}</h2>
            <Block nodes={node.children} ctx={ctx} />
          </section>
        );
      }

      case "forBlock":
        return (
          <div key={node.id} className="ts-muted">
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

/** 조연결은 조 바로 위 평문이다 (§2 L3 — 「이 조가 보통약관 어디를 따라가나」는 조와 같이 읽힌다). */
function ArticleLink({ linkedArticleId, ctx }: { linkedArticleId: Id; ctx: DocCtx }) {
  const target = ctx.references.general.get(linkedArticleId);
  return (
    <p className="ts-doc-cond-head" title="조연결 — 이 조가 대응 보통약관의 어느 조를 따라가는가">
      조연결 — 보통약관 {target ? referenceTargetLabel(target) : "에 없는 조 (연결이 끊겼다)"}
    </p>
  );
}

function Article({ node, ctx }: { node: Node & { kind: "article" }; ctx: DocCtx }) {
  const num = ctx.numbers.get(node.id);
  const heading = `${num?.label ?? "조"}(${node.title})`;
  return (
    <section id={`art-${node.id}`} className="ts-doc-article">
      {ctx.mode === "edit" && <NodeControls ctx={ctx} nodeId={node.id} what={heading} />}
      {node.linkedArticleId !== undefined && <ArticleLink linkedArticleId={node.linkedArticleId} ctx={ctx} />}
      <h3 className="ts-doc-article-title">{heading}</h3>
      <Block nodes={node.children} ctx={ctx} />
    </section>
  );
}

/** 문서 하나 전체. */
export function DocBody({ tree, ctx }: { tree: Node & { kind: "document" }; ctx: DocCtx }) {
  return (
    <article className="ts-doc">
      <h2 className="ts-doc-title">{tree.title}</h2>
      {tree.children.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">아직 조가 하나도 없다 — 이 템플릿은 조립해도 아무것도 만들지 않는다.</p>
          <p className="ts-empty-example">예: 제1조(보험금의 지급사유) · 제2조(보험금을 지급하지 않는 사유)</p>
          <p className="ts-empty-action">위 바의 「편집」을 누르고 오른쪽 패널의 「여기에 추가」(관 또는 조)로 시작하라. 다 쓰면 「저장」.</p>
        </div>
      ) : (
        <Block nodes={tree.children} ctx={ctx} />
      )}
    </article>
  );
}
