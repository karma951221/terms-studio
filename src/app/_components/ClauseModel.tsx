/**
 * 공용조항의 **모델** — 사용처(보통약관 · 담보약관 템플릿 · 상품 보통약관 원문 패널)의 공용조항 상자 안에서
 * 그 공용조항이 어떻게 짜였는지를 읽기 전용으로 편다 (기능/함수조항 §4.4 · 2026-09-28 사용자 요청).
 *
 * 가운데 = 모델(구조), 오른쪽 = 조립 결과(문장). 둘을 나란히 대조하려면 가운데가 접힌 이름표여서는 안 된다 —
 * 글 · 슬롯 칩 · **옵션 자리(선택지 전부 + 이 사용처가 고른 것)** · 문장 안 조건(IF 머리) · 블록 조건(IF 상자) ·
 * 조 참조 · 별표 참조 칩을 그 자리에 그린다.
 *
 * - 조작이 없다. 공용조항 자체는 공용조항 화면에서 고친다(상자 머리의 「공용조항에서 고치기 →」는 호출부가 단다).
 * - `data-block` · `data-inline` · `data-node` 를 심지 않는다 — 문면 편집기의 자리 읽기(`place.ts`)와 E2E 의 블록 셈이
 *   공용조항 본문을 이 문서의 자리로 착각하지 않게.
 * - 훅이 없어 서버 · 클라이언트 어느 쪽에서도 그린다.
 */
import { Fragment, type ReactNode } from "react";

import type { ArticleRefNode, Block, BulletListNode, Clause, Inline, ItemBodyNode, SubitemBodyNode } from "@/domain/clause";
import { clauseBodyToTree, clauseInlineToTree, clausePositions, clauseScopedRefLabel, numberTree, referenceChunkLabel, type NodeNumber, type ReferenceTarget } from "@/domain/document";
import type { Box } from "@/domain/document/box";
import type { Code, Id } from "@/domain/types";

import { BoxView } from "./BoxView";

export interface ClauseModelProps {
  clause: Clause;
  /** 이 사용처가 고른 선택지 — 옵션 코드 → 선택지 코드 (마스터 기본 위에 오버라이드를 얹은 결과). */
  selected: Readonly<Record<Code, Code>>;
  /** 보통약관 조 참조 대상 — 노드 id → 번호가 매겨진 대상. 제 항 · 사용처 위치 참조는 본문 순번으로 적는다 (기능/함수조항 §3.5). */
  references: ReadonlyMap<Id, ReferenceTarget>;
  /** 별표 코드 → 이름. 모르면 코드만. */
  appendixName?: (code: Code) => string | undefined;
  /** 정적 마스터 박스 조회 — 박스 참조를 내용째 그린다. 모르면 코드만. */
  boxOf?: (code: Code) => Box | undefined;
  /** 식(조건 · 슬롯) 표시 — 구분자 코드를 표시명으로. 없으면 원문. */
  exprText?: (source: string) => string;
}

interface Ctx extends ClauseModelProps {
  numbers: ReadonlyMap<Id, NodeNumber>;
  positions: ReadonlyMap<Id, number[]>;
}

const expr = (ctx: Ctx, source: string) => (ctx.exprText ? ctx.exprText(source) : source);

function articleRefText(node: ArticleRefNode, ctx: Ctx): string {
  // 제 항 · 사용처 위치 참조 — 본문 안 순번으로 (사용처에서는 펼친 자리의 계산 번호로 찍힌다)
  const scoped = clauseScopedRefLabel(clauseInlineToTree(node), ctx.positions);
  if (scoped !== undefined) return scoped;
  const alive: ReferenceTarget[] = [];
  let broken = 0;
  for (const { nodeId } of node.targets) {
    const target = ctx.references.get(nodeId);
    if (target) alive.push(target);
    else broken += 1;
  }
  const joined = alive.length === 0 ? "없는 조(연결 끊김)" : referenceChunkLabel(alive, node.connector);
  return `보통약관 ${joined}${alive.length > 0 && broken > 0 ? ` (연결 끊김 ${broken}건)` : ""}`;
}

/** 옵션 자리 — 「〔옵션명: ✓고른 선택지 | 다른 선택지〕」. 고른 것이 없으면 「미선택」을 드러낸다. */
function OptionPlace({ optionCode, ctx }: { optionCode: Code; ctx: Ctx }) {
  const option = ctx.clause.options.find((o) => o.code === optionCode);
  if (!option) {
    return (
      <span className="ts-clause-model-opt is-broken" title="없는 옵션">
        〔{optionCode} — 없는 옵션〕
      </span>
    );
  }
  const chosen = ctx.selected[option.code];
  const values = [...option.values].sort((a, b) => a.order - b.order);
  const bodyText = (body: readonly Inline[]) => body.map((n) => (n.kind === "text" ? n.text : "〔…〕")).join("");
  return (
    <span className="ts-clause-model-opt" title={`옵션 자리 — ${option.label} · ${values.map((v) => `${v.label}: ${bodyText(v.body) || "(빈 문구)"}`).join(" / ")}`}>
      〔<span className="ts-clause-model-opt-name">{option.label}</span>:{" "}
      {values.map((v, i) => (
        <Fragment key={v.code}>
          {i > 0 && <span className="ts-clause-model-opt-sep"> | </span>}
          {v.code === chosen ? (
            <b className="ts-clause-model-opt-value is-chosen" aria-current="true">
              ✓{v.label}
            </b>
          ) : (
            <span className="ts-clause-model-opt-value">{v.label}</span>
          )}
        </Fragment>
      ))}
      {chosen === undefined && <span className="ts-clause-model-opt-missing"> · 미선택</span>}
      {chosen !== undefined && !values.some((v) => v.code === chosen) && <span className="ts-clause-model-opt-missing"> · {chosen}(없는 선택지)</span>}〕
    </span>
  );
}

function Inlines({ nodes, ctx }: { nodes: readonly Inline[]; ctx: Ctx }): ReactNode {
  return nodes.map((node) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={node.id}>{node.text}</Fragment>;
      case "slot":
        return (
          <span key={node.id} className="ts-doc-slot ts-clause-model-chip" title={`치환 슬롯 · ${node.ref}`}>
            〔{expr(ctx, node.ref)}〕
          </span>
        );
      case "articleRef":
        return (
          <span key={node.id} className="ts-doc-ref ts-clause-model-chip" title="조 참조 — 번호는 계산값이다">
            {articleRefText(node, ctx)}
          </span>
        );
      case "appendixRef":
        return (
          <span key={node.id} className="ts-doc-ref ts-clause-model-chip" title={`별표 참조 · ${node.appendixCode}`}>
            【별표 {ctx.appendixName?.(node.appendixCode) ?? node.appendixCode}】
          </span>
        );
      case "optionSlot":
        return <OptionPlace key={node.id} optionCode={node.optionCode} ctx={ctx} />;
      case "inlineCond":
        // 문장 안 조건 — 가지마다 머리(IF 식 / ELIF 식 / ELSE) + 그 가지 문장. 편집기의 칩과 같은 모양
        return (
          <span key={node.id} className="ts-doc-inline-chip" title="문장 안 조건">
            {node.branches.map((br, i) => (
              <Fragment key={br.id}>
                {i > 0 && <span className="ts-doc-inline-sep"> │ </span>}
                <span className="ts-doc-inline-head">
                  {i === 0 ? "IF " : br.when === undefined ? "ELSE" : "ELIF "}
                  {br.when === undefined ? "" : expr(ctx, br.when)}
                </span>{" "}
                <Inlines nodes={br.children} ctx={ctx} />
              </Fragment>
            ))}
          </span>
        );
    }
  });
}

function Num({ id, ctx }: { id: Id; ctx: Ctx }) {
  const label = ctx.numbers.get(id)?.label;
  return label ? <span className="ts-doc-num">{label} </span> : null;
}

/** 글머리 목록 — 번호 없는 「-」 항목. */
function Bullets({ node, ctx }: { node: BulletListNode; ctx: Ctx }) {
  return (
    <ul className="ts-doc-bullets">
      {node.children.map((b) => (
        <li key={b.id} className="ts-doc-bullet">
          <Inlines nodes={b.children} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

/** 목록 자리의 조건 블록 — 가지마다 머리 줄 + 그 자리 목록(호 · 목 유형 본문). */
function ListCond({ node, ctx, children }: { node: { branches: readonly { id: Id; when?: string }[] }; ctx: Ctx; children: (branchIndex: number) => ReactNode }) {
  return node.branches.map((br, i) => (
    <li key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
      <p className="ts-doc-cond-head">
        <span className="ts-cond-badge">{i === 0 ? "IF" : br.when === undefined ? "ELSE" : "ELIF"}</span> {br.when === undefined ? "그 밖의 경우" : expr(ctx, br.when)}
      </p>
      {children(i)}
    </li>
  ));
}

function Items({ nodes, ctx }: { nodes: readonly ItemBodyNode[]; ctx: Ctx }) {
  return (
    <ol className="ts-doc-items">
      {nodes.map((item) =>
        item.kind === "condBlock" ? (
          <ListCond key={item.id} node={item} ctx={ctx}>
            {(i) => <Items nodes={item.branches[i].children} ctx={ctx} />}
          </ListCond>
        ) : item.kind === "boxRef" ? (
          <li key={item.id} className="ts-doc-static-item">
            <BoxView code={item.boxCode} box={ctx.boxOf?.(item.boxCode)} />
          </li>
        ) : item.kind === "bulletList" ? (
          <li key={item.id} className="ts-doc-static-item">
            <Bullets node={item} ctx={ctx} />
          </li>
        ) : (
        <li key={item.id} className="ts-doc-item">
          <Inlines nodes={item.children} ctx={ctx} />
          {(item.subitems ?? []).length > 0 && <Subitems nodes={item.subitems ?? []} ctx={ctx} />}
        </li>
        ),
      )}
    </ol>
  );
}

function Subitems({ nodes, ctx }: { nodes: readonly SubitemBodyNode[]; ctx: Ctx }) {
  return (
    <ol className="ts-doc-subitems">
      {nodes.map((s) =>
        s.kind === "condBlock" ? (
          <ListCond key={s.id} node={s} ctx={ctx}>
            {(i) => <Subitems nodes={s.branches[i].children} ctx={ctx} />}
          </ListCond>
        ) : (
          <li key={s.id} className="ts-doc-subitem">
            <Inlines nodes={s.children} ctx={ctx} />
          </li>
        ),
      )}
    </ol>
  );
}

function Blocks({ nodes, ctx }: { nodes: readonly Block[]; ctx: Ctx }): ReactNode {
  return nodes.map((node) => {
    if (node.kind === "bulletList") return <Bullets key={node.id} node={node} ctx={ctx} />;
    if (node.kind === "boxRef") return <BoxView key={node.id} code={node.boxCode} box={ctx.boxOf?.(node.boxCode)} />;
    if (node.kind === "paragraph") {
      return (
        <div key={node.id} className={ctx.numbers.get(node.id)?.label ? "ts-doc-paragraph" : "ts-doc-paragraph is-bare"}>
          <Num id={node.id} ctx={ctx} />
          <Inlines nodes={node.children} ctx={ctx} />
          {(node.items ?? []).length > 0 && <Items nodes={node.items ?? []} ctx={ctx} />}
        </div>
      );
    }
    // 블록 조건 — 문면 편집기 읽기 모드와 같은 상자: 가지마다 머리 줄(IF / ELIF / ELSE 배지 + 식) + 내용
    return node.branches.map((br, i) => (
      <div key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
        <p className="ts-doc-cond-head">
          <span className="ts-cond-badge">{i === 0 ? "IF" : br.when === undefined ? "ELSE" : "ELIF"}</span> {br.when === undefined ? "그 밖의 경우" : expr(ctx, br.when)}
        </p>
        <Blocks nodes={br.children} ctx={ctx} />
      </div>
    ));
  });
}

export function ClauseModel(props: ClauseModelProps) {
  const { clause } = props;
  const tree = clauseBodyToTree(clause.mode, clause.body, clause.label);
  const ctx: Ctx = { ...props, numbers: numberTree(tree), positions: clausePositions(tree) };
  if (clause.body.length === 0) return <p className="ts-muted">본문이 비어 있다.</p>;
  return (
    <div className="ts-clause-model" aria-label={`함수조항 ${clause.label} 모델`}>
      {clause.mode === "inline" ? (
        <p className="ts-doc-paragraph is-line">
          <Inlines nodes={clause.body} ctx={ctx} />
        </p>
      ) : clause.mode === "item" ? (
        <Items nodes={clause.body} ctx={ctx} />
      ) : clause.mode === "subitem" ? (
        <Subitems nodes={clause.body} ctx={ctx} />
      ) : (
        <Blocks nodes={clause.body} ctx={ctx} />
      )}
    </div>
  );
}

/** 공용조항 화면 링크 — 공용조항 자체는 거기서 고친다. */
export function clauseEditHref(code: Code): string {
  return `/functions/${code}`;
}
