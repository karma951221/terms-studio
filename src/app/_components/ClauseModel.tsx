/**
 * 함수조항의 **모델** — 사용처(보통약관 · 담보약관 템플릿 · 상품 보통약관 원문 패널)의 함수조항 상자 안에서
 * 그 함수조항이 어떻게 짜였는지를 읽기 전용으로 편다 (기능/함수조항 §4.4 · 2026-09-28 사용자 요청).
 *
 * 가운데 = 모델(구조), 오른쪽 = 조립 결과(문장). 둘을 나란히 대조하려면 가운데가 접힌 이름표여서는 안 된다 —
 * 글 · 슬롯 칩 · **옵션 자리(선택지 전부 + 이 사용처가 고른 것)** · 문장 안 조건(IF 머리) · 블록 조건(IF 상자) · 값별 분기(칸 머리 = 값 · 「문구 없음」) ·
 * 조 참조 · 별표 참조 칩을 그 자리에 그린다.
 *
 * - **인자를 가진 함수조항은 접어 둔다** (최종 결정 8 · 기능/함수조항 §4.4) — 블록 · 목록 자리의 조건 가지 · 값별 분기 칸은 머리 줄(배지 · 식 또는 배정 값 이름 · 문장 수)만
 *   보이고, 누른 칸만 펼친다(`<details name>` — 한 분기의 칸은 한 묶음, 묶음 이름 앞마디 = 사용처 상자 id). 칸 밖 본문 · 문장 안 칩은 그대로. 인자 0개 조항은 전체.
 * - 조작이 없다. 함수조항 자체는 함수조항 화면에서 고친다(상자 머리의 「함수조항에서 고치기 →」는 호출부가 단다).
 * - `data-block` · `data-inline` · `data-node` 를 심지 않는다 — 문면 편집기의 자리 읽기(`place.ts`)와 E2E 의 블록 셈이
 *   함수조항 본문을 이 문서의 자리로 착각하지 않게.
 * - 훅이 없어 서버 · 클라이언트 어느 쪽에서도 그린다 — 접힘 상태도 브라우저(`<details>`)가 쥔다.
 */
import { Fragment, type ReactNode } from "react";

import type { ArticleRefNode, Block, BulletListNode, Clause, Inline, ItemBodyNode, SubitemBodyNode } from "@/domain/clause";
import { clauseBodyToTree, clauseInlineToTree, clausePositions, clauseScopedRefLabel, numberTree, referenceChunkLabel, referenceKeyIndex, refKey, type NodeNumber, type ReferenceTarget } from "@/domain/document";
import type { Box } from "@/domain/document/box";
import type { Code, Id } from "@/domain/types";

import { SWITCH_WORD } from "@/app/_lib/labels";

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
  /** 값별 분기 칸의 값 표시 — (대상 식, 값 코드) → 표시명(`switchValueLabeler`). 값 코드는 열거형마다 겹치므로 대상을 같이 준다. 없으면 코드. */
  valueLabel?: (on: string, code: Code) => string | undefined;
  /** 접힌 칸 묶음(`<details name>`)의 앞마디 — 사용처 상자마다 다르게(상자 노드 id). 같은 함수조항 상자가 둘이어도 서로 닫지 않게. 없으면 함수조항 코드. */
  foldScope?: string;
}

interface Ctx extends ClauseModelProps {
  numbers: ReadonlyMap<Id, NodeNumber>;
  positions: ReadonlyMap<Id, number[]>;
  /** 인자를 가진 함수조항 — 조건 · 값별 분기 칸을 접어 머리만 보인다 (최종 결정 8). 인자 0개는 전체. */
  fold: boolean;
}

const SENTENCE_KINDS = new Set(["paragraph", "item", "subitem", "bullet"]);

/** 칸 안 문장 수 — 항 · 호 · 목 · 글머리 항목 (안쪽 분기까지). 접힌 칸 머리의 「문장 N」. */
function sentenceCount(nodes: readonly unknown[]): number {
  let n = 0;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const o = node as Record<string, unknown>;
    if (typeof o.kind === "string" && SENTENCE_KINDS.has(o.kind)) n += 1;
    for (const key of ["children", "items", "subitems", "branches", "cases"]) {
      const list = o[key];
      if (Array.isArray(list)) n += sentenceCount(list);
    }
  }
  return n;
}

/**
 * 칸 하나(조건 가지 · 값별 분기 칸) — 머리 줄 + 내용. 접는 상자면 `<details>` — 누른 칸만 펼치고, 한 분기의 칸은 한 묶음(`name`)이라
 * 다른 칸을 누르면 앞 칸은 닫힌다. 훅 없이 브라우저가 상태를 쥐어 서버 컴포넌트(상품 원문 패널)에서도 그린다. 펼칠 내용이 없으면(문구 없음) 머리만.
 */
function Cell({ ctx, group, head, nodes, children }: { ctx: Ctx; group: Id; head: ReactNode; nodes: readonly unknown[] | undefined; children?: ReactNode }) {
  if (!ctx.fold || nodes === undefined) {
    return (
      <>
        <p className="ts-doc-cond-head">{head}</p>
        {children}
      </>
    );
  }
  return (
    <details className="ts-clause-cell" name={`${ctx.foldScope ?? ctx.clause.code}:${group}`}>
      <summary className="ts-doc-cond-head">
        {head} <span className="ts-clause-cell-count">문장 {sentenceCount(nodes)}</span>
      </summary>
      {children}
    </details>
  );
}

const expr = (ctx: Ctx, source: string) => (ctx.exprText ? ctx.exprText(source) : source);

/** 값별 분기 칸 머리 — 「V01 · V02」 또는 「문구 없음」 (화면단어). */
function caseHead(ctx: Ctx, on: string, k: { values: readonly Code[]; empty?: true }): string {
  const values = k.values.map((v) => ctx.valueLabel?.(on, v) ?? v).join(" · ");
  return k.empty ? `${values} — ${SWITCH_WORD.empty}` : values;
}

/** 값별 분기 (블록 · 목록 자리) — 첫 칸 위에 대상 줄, 칸마다 머리 줄(값) + 그 칸 내용. 편집기 읽기 모드와 같은 상자. */
function SwitchBox({ node, ctx, as, children }: { node: { id: Id; on: string; cases: readonly { id: Id; values: readonly Code[]; empty?: true; children: readonly unknown[] }[] }; ctx: Ctx; as: "div" | "li"; children: (caseIndex: number) => ReactNode }) {
  const Tag = as;
  return node.cases.map((k, i) => (
    <Tag key={k.id} className={i === 0 ? "ts-doc-cond is-switch" : "ts-doc-cond is-switch is-alt"}>
      {i === 0 && (
        <p className="ts-doc-cond-head ts-switch-on">
          <span className="ts-cond-badge">{SWITCH_WORD.switch}</span> {expr(ctx, node.on)}
        </p>
      )}
      <Cell ctx={ctx} group={node.id} nodes={k.empty ? undefined : k.children} head={<><span className="ts-cond-badge">{SWITCH_WORD.case}</span> {caseHead(ctx, node.on, k)}</>}>
        {!k.empty && children(i)}
      </Cell>
    </Tag>
  ));
}

function articleRefText(node: ArticleRefNode, ctx: Ctx): string {
  // 제 항 · 사용처 위치 참조 — 본문 안 순번으로 (사용처에서는 펼친 자리의 계산 번호로 찍힌다)
  const scoped = clauseScopedRefLabel(clauseInlineToTree(node), ctx.positions);
  if (scoped !== undefined) return scoped;
  const alive: ReferenceTarget[] = [];
  let broken = 0;
  const byKey = referenceKeyIndex(ctx.references);
  for (const t of node.targets) {
    const found = t.articleId !== undefined ? byKey.get(refKey({ articleId: t.articleId, ...(t.code !== undefined ? { code: t.code } : {}) })) : undefined;
    if (found) alive.push(found.target);
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
      case "inlineSwitch":
        // 문장 안 값별 분기 — 칸마다 머리(값) + 그 칸 문장
        return (
          <span key={node.id} className="ts-doc-inline-chip is-switch" title={`문장 안 ${SWITCH_WORD.switch}`}>
            <span className="ts-doc-inline-head">
              {SWITCH_WORD.switch} {expr(ctx, node.on)}
            </span>
            {node.cases.map((k) => (
              <Fragment key={k.id}>
                <span className="ts-doc-inline-sep"> │ </span>
                <span className="ts-doc-inline-head">{caseHead(ctx, node.on, k)}</span> {!k.empty && <Inlines nodes={k.children} ctx={ctx} />}
              </Fragment>
            ))}
          </span>
        );
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
function ListCond({ node, ctx, children }: { node: { id: Id; branches: readonly { id: Id; when?: string; children: readonly unknown[] }[] }; ctx: Ctx; children: (branchIndex: number) => ReactNode }) {
  return node.branches.map((br, i) => (
    <li key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
      <Cell ctx={ctx} group={node.id} nodes={br.children} head={<BranchHead ctx={ctx} i={i} when={br.when} />}>
        {children(i)}
      </Cell>
    </li>
  ));
}

/** 조건 가지 머리 — IF / ELIF / ELSE 배지 + 식. */
function BranchHead({ ctx, i, when }: { ctx: Ctx; i: number; when: string | undefined }) {
  return (
    <>
      <span className="ts-cond-badge">{i === 0 ? "IF" : when === undefined ? "ELSE" : "ELIF"}</span> {when === undefined ? "그 밖의 경우" : expr(ctx, when)}
    </>
  );
}

function Items({ nodes, ctx }: { nodes: readonly ItemBodyNode[]; ctx: Ctx }) {
  return (
    <ol className="ts-doc-items">
      {nodes.map((item) =>
        item.kind === "condBlock" ? (
          <ListCond key={item.id} node={item} ctx={ctx}>
            {(i) => <Items nodes={item.branches[i].children} ctx={ctx} />}
          </ListCond>
        ) : item.kind === "switchBlock" ? (
          <SwitchBox key={item.id} node={item} ctx={ctx} as="li">
            {(i) => <Items nodes={item.cases[i].children} ctx={ctx} />}
          </SwitchBox>
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
        ) : s.kind === "switchBlock" ? (
          <SwitchBox key={s.id} node={s} ctx={ctx} as="li">
            {(i) => <Subitems nodes={s.cases[i].children} ctx={ctx} />}
          </SwitchBox>
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
    if (node.kind === "switchBlock") {
      return (
        <SwitchBox key={node.id} node={node} ctx={ctx} as="div">
          {(i) => <Blocks nodes={node.cases[i].children} ctx={ctx} />}
        </SwitchBox>
      );
    }
    // 블록 조건 — 문면 편집기 읽기 모드와 같은 상자: 가지마다 머리 줄(IF / ELIF / ELSE 배지 + 식) + 내용
    return node.branches.map((br, i) => (
      <div key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
        <Cell ctx={ctx} group={node.id} nodes={br.children} head={<BranchHead ctx={ctx} i={i} when={br.when} />}>
          <Blocks nodes={br.children} ctx={ctx} />
        </Cell>
      </div>
    ));
  });
}

export function ClauseModel(props: ClauseModelProps) {
  const { clause } = props;
  const tree = clauseBodyToTree(clause.mode, clause.body, clause.label);
  const ctx: Ctx = { ...props, numbers: numberTree(tree), positions: clausePositions(tree), fold: (clause.params ?? []).length > 0 };
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

/** 함수조항 화면 링크 — 함수조항 자체는 거기서 고친다. */
export function clauseEditHref(code: Code): string {
  return `/functions/${code}`;
}
