/**
 * 약관 섹션 가운데 — 템플릿에 모델링된 **원문**을 관 단위로 (기능/상품 §4 「보통약관」 약관 — 원문(가운데)).
 *
 * - 읽기 표기는 문면 편집기 읽기 모드(`documents/[id]/_components/DocBody.tsx`)를 따른다 — 다만 `DocCtx`(편집·평가 문맥)에
 *   기대지 않고 이 컴포넌트가 직접 그린다. 조작은 하나도 없다.
 * - **유일한 입력은 공용조항 상자 안의 옵션 선택**이다 (기능/함수조항 §3.2 · 기능/상품 §3.6). 마스터 기본값을 옆에 보이고,
 *   다르면 「오버라이드」 배지 + 되돌리기(↺). 상자 안에는 그 공용조항의 **모델**(`ClauseModel` — 슬롯 · 옵션 자리 · 조건 · 참조)이 선다.
 * - 끈 조는 자리에 남되 흐리게 + 「노출 끔」 (다시 켜는 것은 목차에서).
 * - **조를 감싼 조건 블록도 그대로 그린다** — 목차는 조건 블록을 펴지만(조는 어디 있든 한 줄),
 *   원문에서 조상 조건식을 잃으면 조건부인 조가 무조건 있는 것처럼 보인다 (코덱스 리뷰 2026-09-15 Important-3).
 * - 앵커는 `art-<조 id>` — 오른쪽 조립 결과의 `node-<조 id>` 와 짝이다 (`PanelScrollSync`).
 *   표·박스에는 id 를 심지 않는다 — 오른쪽 패널의 `node-<id>` 와 겹쳐 오류 패널의 이동이 엉킨다.
 */
import { BoxView } from "@/app/_components/BoxView";
import { ClauseModel, clauseEditHref } from "@/app/_components/ClauseModel";
import { IconButton, IconRevert } from "@/app/_components/icons";
import { STRUCT_KEY_CHIP } from "@/app/_lib/labels";
import type { Clause } from "@/domain/clause";
import { referenceChunkLabel, referenceKeyIndex, refKey, type ArticleNode, type Box, type CondBlockNode, type InlineNode, type Node, type NodeNumber, type ReferenceTarget, type TableNode } from "@/domain/document";
import { format, parse, refPath } from "@/domain/expression";
import type { ClauseOptionOverride } from "@/domain/product";
import type { Code, Id } from "@/domain/types";

import { removeOptionOverrideAction, setOptionOverrideAction } from "../../actions";
import { OptionOverrideForm, type OverrideTarget } from "./OptionOverrideForm";

export interface TemplateSourceProps {
  productId: Id;
  /** 고른 관의 **최상위 노드** — 조, 그리고 조를 감싼 조건 블록 (`GeneralSection.nodes`). */
  nodes: readonly (ArticleNode | CondBlockNode)[];
  numbers: ReadonlyMap<Id, NodeNumber>;
  hidden: ReadonlySet<Id>;
  /** 조 참조 슬롯 표기의 재료 — 노드 id → 참조 대상(템플릿 번호). `referenceTargetIndex` 가 만든다. */
  references: ReadonlyMap<Id, ReferenceTarget>;
  clauses: readonly Clause[];
  overrides: readonly ClauseOptionOverride[];
  /** page.tsx 가 `document.refs` 로 만든 공용조항 자리 — 노드 id 로 찾는다. */
  overrideTargets: readonly OverrideTarget[];
  /** 별표 코드 → 이름 — 별표 참조 칩. 없으면 코드. */
  appendices?: readonly { code: Code; name: string }[];
  /** 구분자 코드 → 표시명 — 조건식 · 슬롯 칩을 한글로. 없으면 식 원문. */
  discriminators?: readonly { code: Code; label: string }[];
  /** 정적 마스터 박스 — 박스 참조를 내용째 그린다. 없으면 코드만. */
  boxes?: readonly Box[];
}

interface Ctx {
  productId: Id;
  /** 지금 그리는 조 — 그 조 안의 옵션 저장은 이 조로 돌아온다 (`ArticleNodes` 가 조마다 채운다). */
  articleId: Id | undefined;
  appendixName: (code: Code) => string | undefined;
  boxOf: (code: Code) => Box | undefined;
  exprText: (source: string) => string;
  numbers: ReadonlyMap<Id, NodeNumber>;
  hidden: ReadonlySet<Id>;
  references: ReadonlyMap<Id, ReferenceTarget>;
  clauseByCode: ReadonlyMap<Code, Clause>;
  overrideByNode: ReadonlyMap<Id, ClauseOptionOverride>;
  targetByNode: ReadonlyMap<Id, OverrideTarget>;
  optionText: (clauseCode: Code, options: Record<Code, Code>) => string;
}

/** 「소멸 사유: 사망 · 어조: 일반」 — 문면 편집기와 같은 문장 (미선택도 그대로 드러낸다). */
function optionTextOf(clauseByCode: ReadonlyMap<Code, Clause>, clauseCode: Code, options: Record<Code, Code>): string {
  const clause = clauseByCode.get(clauseCode);
  const entries = Object.entries(options);
  if (!clause) return entries.length > 0 ? entries.map(([o, v]) => `${o}: ${v}`).join(" · ") : "옵션 선택 없음";
  if (clause.options.length === 0) return "옵션 없음";
  return clause.options
    .map((o) => {
      const chosen = options[o.code];
      const value = chosen !== undefined ? o.values.find((v) => v.code === chosen) : undefined;
      return `${o.label}: ${value?.label ?? (chosen !== undefined ? `${chosen}(없는 선택지)` : "미선택")}`;
    })
    .join(" · ");
}

/** 식 → 표시 — 구분자 코드를 표시명으로 (문면 편집기 `refLabelOf` 의 노드 없는 판). 파싱 실패면 원문. */
function exprDisplay(source: string, labelOf: ReadonlyMap<Code, string>): string {
  const parsed = parse(source);
  if (!parsed.ok) return source;
  return format(parsed.value, (ref) => (ref.kind === "discriminator" ? (labelOf.get(ref.code) ?? ref.code) : refPath(ref)));
}

// ───────────────────────────── 인라인 ─────────────────────────────

function Inline({ node, ctx }: { node: InlineNode; ctx: Ctx }) {
  switch (node.kind) {
    case "text":
      return <>{node.text}</>;

    case "structKey":
      return (
        <span className="ts-doc-ref" title="구조 표기 — 반복 표의 행마다 그 행의 노드 이름이 찍힌다">
          {STRUCT_KEY_CHIP[node.level]}
        </span>
      );

    case "slot":
      return (
        <span className="ts-doc-slot" title={`치환 슬롯 · ${node.ref}`}>
          〔{ctx.exprText(node.ref)}〕
        </span>
      );

    case "articleRef": {
      // 표기 규칙(「제3조부터 제5조까지」 · 항까지)은 도메인이 안다 — 문면 편집기와 같은 덩어리 규칙 (기능/문면 §3.5).
      const alive: ReferenceTarget[] = [];
      let broken = 0;
      const byKey = referenceKeyIndex(ctx.references);
      for (const t of node.targets) {
        const found = byKey.get(refKey(t));
        if (found) alive.push(found.target);
        else broken += 1;
      }
      const joined = alive.length === 0 ? "없는 조(연결 끊김)" : referenceChunkLabel(alive, node.connector);
      return (
        <span className="ts-doc-ref" title="조 참조 슬롯 — 번호는 계산값이다">
          {node.scope === "general" ? "보통약관 " : ""}
          {joined}
          {alive.length > 0 && broken > 0 ? ` (연결 끊김 ${broken}건)` : ""}
        </span>
      );
    }

    case "appendixRef":
      return (
        <span className="ts-doc-ref" title={`별표 참조 · ${node.appendixCode}`}>
          【별표 {ctx.appendixName(node.appendixCode) ?? node.appendixCode}】
        </span>
      );

    case "clauseInlineRef":
      return (
        <span className="ts-doc-ref" title={`함수조항(문장 안) · ${node.clauseCode} · ${ctx.optionText(node.clauseCode, node.options)}`}>
          〔{ctx.clauseByCode.get(node.clauseCode)?.label ?? `${node.clauseCode}(없는 함수조항)`}〕
        </span>
      );

    case "inlineCond":
      return (
        <>
          {node.branches.map((br, i) => (
            <span key={br.id} className={i === 0 ? "ts-doc-inline-cond" : "ts-doc-inline-cond is-alt"} title={`문장 안 조건 — ${br.when === undefined ? "그 밖의 경우 (else)" : ctx.exprText(br.when)}`}>
              <Inlines nodes={br.children} ctx={ctx} />
            </span>
          ))}
        </>
      );

    case "inlineFor":
      return <span className="ts-muted">(문장 안 반복 — 아직 지원하지 않는다)</span>;
  }
}

function Inlines({ nodes, ctx }: { nodes: readonly InlineNode[]; ctx: Ctx }) {
  return nodes.map((n) => <Inline key={n.id} node={n} ctx={ctx} />);
}

type ClauseInlineRef = Extract<InlineNode, { kind: "clauseInlineRef" }>;

/** 문장 안 공용조항 참조 — 옵션 박스는 문장 흐름을 끊지 않도록 그 항 **아래**에 모아 선다. */
function inlineClauseRefs(nodes: readonly InlineNode[]): ClauseInlineRef[] {
  return nodes.flatMap((n) =>
    n.kind === "clauseInlineRef" ? [n] : n.kind === "inlineCond" ? n.branches.flatMap((br) => inlineClauseRefs(br.children)) : n.kind === "inlineFor" ? inlineClauseRefs(n.children) : [],
  );
}

/**
 * 블록 아래의 **모든** 공용조항 인라인 참조 — 호·목·표 셀·중첩 조건 블록·반복까지 (코덱스 리뷰 2026-09-15 Important-2).
 * 이전에는 항 본문만 모아, 호·목·표 셀의 참조에는 옵션을 고를 자리가 아예 없었다.
 */
function blockClauseRefs(nodes: readonly Node[]): ClauseInlineRef[] {
  return nodes.flatMap((n) => {
    switch (n.kind) {
      case "paragraph":
        return [...inlineClauseRefs(n.children), ...blockClauseRefs(n.items ?? [])];
      case "item":
        return [...inlineClauseRefs(n.children), ...blockClauseRefs(n.subitems ?? [])];
      case "subitem":
      case "bullet":
        return inlineClauseRefs(n.children);
      case "bulletList":
        return blockClauseRefs(n.children);
      case "table":
        return tableClauseRefs(n);
      case "condBlock":
        return n.branches.flatMap((br) => blockClauseRefs(br.children));
      case "forBlock":
        return blockClauseRefs(n.children);
      default:
        return [];
    }
  });
}

function tableClauseRefs(node: TableNode): ClauseInlineRef[] {
  return node.rows.flatMap((r) => r.cells.flatMap((cell) => inlineClauseRefs(cell)));
}

/** 같은 자리를 두 번 그리지 않는다 — 노드 id 로 중복 제거(문서 순서는 그대로). */
function dedupeRefs(refs: readonly ClauseInlineRef[]): ClauseInlineRef[] {
  const seen = new Set<Id>();
  return refs.filter((r) => !seen.has(r.id) && (seen.add(r.id), true));
}

// ───────────────────────────── 공용조항 박스 ─────────────────────────────

/**
 * 공용조항 자리 — 문면 편집기와 같은 상자(머리 띠 「공용조항 (이름)」)에 **그 공용조항의 모델**을 편다 (2026-09-28).
 * 가운데는 모델(슬롯 · 옵션 자리 · 조건 · 참조), 오른쪽은 조립 결과 — 둘을 나란히 대조한다. 공용조항 자체는 공용조항 화면에서 고친다.
 * 모델 아래에 이 자리의 옵션 선택(마스터 기본 · 이 상품 오버라이드)이 선다 — 옵션이 없는 공용조항이면 선택 줄도 없다.
 */
function ClauseBox({ nodeId, clauseCode, baseOptions, ctx }: { nodeId: Id; clauseCode: Code; baseOptions: Record<Code, Code>; ctx: Ctx }) {
  const clause = ctx.clauseByCode.get(clauseCode);
  const label = clause?.label ?? `${clauseCode}(없는 함수조항)`;
  const override = ctx.overrideByNode.get(nodeId);
  const target = ctx.targetByNode.get(nodeId);
  const effective = override ? { ...baseOptions, ...override.options } : baseOptions;
  // 미선택 = 마스터 기본도 상품 선택도 없는 옵션 — 저장 오류가 되기 전에 여기서 말한다 (기능/함수조항 §3.2).
  const unresolved = (clause?.options ?? []).filter((o) => effective[o.code] === undefined).map((o) => o.label);
  const hasOptions = !clause || clause.options.length > 0;
  const scope = { kind: "product", id: ctx.productId } as const;
  return (
    <div className="ts-doc-clause" data-clause-box={nodeId}>
      <div className="ts-doc-clause-head">
        <span className="ts-doc-clause-name" title={`함수조항 · ${clauseCode}`}>
          함수조항 ({label})
        </span>
        {override && <span className="ts-badge">오버라이드</span>}
        {clause && (
          <a className="ts-doc-clause-link" href={clauseEditHref(clause.code)} target="_blank" rel="noopener" title="함수조항 화면을 새 탭으로 연다 — 본문 · 옵션은 거기서 고친다">
            함수조항에서 고치기 →
          </a>
        )}
      </div>
      <div className="ts-doc-clause-body">
        {clause ? (
          <ClauseModel clause={clause} selected={effective} references={ctx.references} appendixName={ctx.appendixName} boxOf={ctx.boxOf} exprText={ctx.exprText} />
        ) : (
          <p className="ts-muted">{clauseCode} — 없는 함수조항이다(깨진 참조).</p>
        )}
        {hasOptions && (
          <div className="ts-clause-use">
            <p className="ts-muted">마스터 기본 — {ctx.optionText(clauseCode, baseOptions)}</p>
            {/* 폼은 <p> 안에 둘 수 없다 — 파서가 <p> 를 닫아 서버 DOM 과 React 트리가 어긋난다. */}
            {override && (
              <div className="ts-clause-box-row">
                <span>이 상품 — {ctx.optionText(clauseCode, effective)}</span>{" "}
                <form action={removeOptionOverrideAction.bind(null, ctx.productId, scope, nodeId, clauseCode, ctx.articleId)} style={{ display: "inline" }}>
                  <IconButton type="submit" label={`마스터 기본으로 되돌리기 · ${label}`} icon={<IconRevert />} />
                </form>
              </div>
            )}
            {unresolved.length > 0 && <p className="ts-warn">옵션 미선택 — {unresolved.join(" · ")} (고르지 않으면 조립이 막힌다)</p>}
            {target ? (
              // 저장된 선택이 바뀌면 폼도 새로 연다 — `useState` 의 시작값은 다시 읽히지 않는다.
              <OptionOverrideForm
                key={JSON.stringify(override?.options ?? {})}
                targets={[target]}
                action={setOptionOverrideAction.bind(null, ctx.productId, scope)}
                current={override?.options}
                articleId={ctx.articleId}
              />
            ) : (
              <p className="ts-muted">이 자리는 고를 옵션이 없다.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── 블록 ─────────────────────────────

function StaticTableView({ node, ctx }: { node: TableNode; ctx: Ctx }) {
  return (
    <figure className="ts-doc-table-wrap">
      {node.title && <figcaption className="ts-doc-table-title">{node.title}</figcaption>}
      <table className="ts-doc-table">
        <colgroup>
          {node.columns.map((c, i) => (
            <col key={i} style={c.width ? { width: `${c.width}%` } : undefined} />
          ))}
        </colgroup>
        <tbody>
          {node.rows.map((r, i) => (
            <tr key={i}>
              {r.cells.map((cell, j) => {
                const body = <Inlines nodes={cell} ctx={ctx} />;
                return r.header ? <th key={j}>{body}</th> : <td key={j}>{body}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * `gathered` = **위쪽 항이 이 아래의 공용조항 참조를 이미 모았다**는 표시.
 * 항은 제 호·목·표 셀까지 재귀로 모아 항 아래 한 줄로 세우므로, 그 안의 표가 같은 박스를 또 그리면 안 된다.
 */
function Block({ nodes, ctx, inList, gathered }: { nodes: readonly Node[]; ctx: Ctx; inList?: boolean; gathered?: boolean }) {
  return nodes.map((node) => {
    switch (node.kind) {
      case "paragraph": {
        // 읽는 순서 — 항 본문 → 호·목·표 → 이 항이 품은 공용조항 박스들.
        const boxes = dedupeRefs([...inlineClauseRefs(node.children), ...blockClauseRefs(node.items ?? [])]);
        return (
          <div key={node.id} className={ctx.numbers.get(node.id)?.label ? "ts-doc-paragraph" : "ts-doc-paragraph is-bare"}>
            {ctx.numbers.get(node.id)?.label ? <span className="ts-doc-num">{ctx.numbers.get(node.id)?.label}</span> : null} <Inlines nodes={node.children} ctx={ctx} />
            {(node.items ?? []).length > 0 && (
              <ol className="ts-doc-items">
                <Block nodes={node.items ?? []} ctx={ctx} inList gathered />
              </ol>
            )}
            {boxes.map((b) => (
              <ClauseBox key={b.id} nodeId={b.id} clauseCode={b.clauseCode} baseOptions={b.options} ctx={ctx} />
            ))}
          </div>
        );
      }

      case "item":
        return (
          <li key={node.id} className="ts-doc-item">
            <Inlines nodes={node.children} ctx={ctx} />
            {(node.subitems ?? []).length > 0 && (
              <ol className="ts-doc-subitems">
                <Block nodes={node.subitems ?? []} ctx={ctx} inList gathered={gathered} />
              </ol>
            )}
          </li>
        );

      case "subitem":
        return (
          <li key={node.id} className="ts-doc-subitem">
            <Inlines nodes={node.children} ctx={ctx} />
          </li>
        );

      case "clauseBlockRef":
        // 호 목록 자리(항 · 호 뒤)의 공용조항은 「박스」 — 목록 안이면 <li>
        return inList ? (
          <li key={node.id} className="ts-doc-static-item">
            <ClauseBox nodeId={node.id} clauseCode={node.clauseCode} baseOptions={node.options} ctx={ctx} />
          </li>
        ) : (
          <div key={node.id} className={ctx.numbers.get(node.id)?.label ? "ts-doc-paragraph" : "ts-doc-paragraph is-bare"}>
            {ctx.numbers.get(node.id)?.label ? <span className="ts-doc-num">{ctx.numbers.get(node.id)?.label}</span> : null}
            <ClauseBox nodeId={node.id} clauseCode={node.clauseCode} baseOptions={node.options} ctx={ctx} />
          </div>
        );

      case "condBlock":
        return node.branches.map((br, i) => {
          const body = (
            <>
              <span className="ts-doc-cond-head">{br.when === undefined ? "그 밖의 경우 (else)" : ctx.exprText(br.when)}</span>
              <Block nodes={br.children} ctx={ctx} inList={inList} gathered={gathered} />
            </>
          );
          const className = i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt";
          return inList ? (
            <li key={br.id} className={className}>
              {body}
            </li>
          ) : (
            <div key={br.id} className={className}>
              {body}
            </div>
          );
        });

      case "table": {
        // 조 바로 아래의 표 — 항이 없으니 셀의 공용조항 박스를 표 뒤에 직접 세운다.
        const boxes = gathered ? [] : dedupeRefs(tableClauseRefs(node));
        const body = (
          <>
            <StaticTableView node={node} ctx={ctx} />
            {boxes.map((b) => (
              <ClauseBox key={b.id} nodeId={b.id} clauseCode={b.clauseCode} baseOptions={b.options} ctx={ctx} />
            ))}
          </>
        );
        return inList ? (
          <li key={node.id} className="ts-doc-static-item">
            {body}
          </li>
        ) : (
          <div key={node.id}>{body}</div>
        );
      }

      case "box": {
        const body = (
          <aside className="ts-doc-box">
            <p className="ts-doc-box-title">【{node.title}】</p>
            {node.lines.map((l, i) => (
              <p key={i} className="ts-doc-box-line">
                {l}
              </p>
            ))}
          </aside>
        );
        return inList ? (
          <li key={node.id} className="ts-doc-static-item">
            {body}
          </li>
        ) : (
          <div key={node.id}>{body}</div>
        );
      }

      // 정적 마스터 박스 참조 — 박스 마스터 내용 그대로 (기능/박스 §3.2)
      case "boxRef": {
        const body = <BoxView code={node.boxCode} box={ctx.boxOf(node.boxCode)} />;
        return inList ? (
          <li key={node.id} className="ts-doc-static-item">
            {body}
          </li>
        ) : (
          <div key={node.id}>{body}</div>
        );
      }

      // 글머리 목록 — 번호 없는 「-」 항목 (항목 문장의 공용조항 박스는 목록 뒤)
      case "bullet":
        return (
          <li key={node.id} className="ts-doc-bullet">
            <Inlines nodes={node.children} ctx={ctx} />
          </li>
        );

      case "bulletList": {
        const body = (
          <ul className="ts-doc-bullets">
            <Block nodes={node.children} ctx={ctx} inList gathered={gathered} />
          </ul>
        );
        return inList ? (
          <li key={node.id} className="ts-doc-static-item">
            {body}
          </li>
        ) : (
          <div key={node.id}>{body}</div>
        );
      }

      // 반복은 자리만 잡혀 있다 (P7) — 자식을 그대로 낸다.
      case "forBlock":
        return <Block key={node.id} nodes={node.children} ctx={ctx} inList={inList} gathered={gathered} />;

      default:
        return null;
    }
  });
}

/**
 * 관 아래의 조와 **조를 감싼 조건 블록** — 조 안의 조건 블록(`Block`)과 같은 표기로 그린다
 * (`.ts-doc-cond` + 조건식 칩, 뒤 가지는 `is-alt`). 조건 블록은 중첩될 수 있어 재귀한다.
 */
function ArticleNodes({ nodes, ctx }: { nodes: readonly Node[]; ctx: Ctx }) {
  return nodes.map((node) => {
    if (node.kind === "article") {
      const isHidden = ctx.hidden.has(node.id);
      const label = `${ctx.numbers.get(node.id)?.label ?? "조"}(${node.title})`;
      return (
        <section key={node.id} id={`art-${node.id}`} className={isHidden ? "ts-doc-article is-hidden-article" : "ts-doc-article"}>
          <h4 className="ts-doc-article-title">
            {label} {isHidden && <span className="ts-dim">— 노출 끔</span>}
          </h4>
          {/* 이 조 안의 옵션 저장은 이 조로 돌아온다 — 목차가 클라이언트에서 관을 바꿔도 좌표가 어긋나지 않는다 */}
          <Block nodes={node.children} ctx={{ ...ctx, articleId: node.id }} />
        </section>
      );
    }
    if (node.kind === "condBlock")
      return node.branches.map((br, i) => (
        <div key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
          <span className="ts-doc-cond-head">{br.when === undefined ? "그 밖의 경우 (else)" : ctx.exprText(br.when)}</span>
          <ArticleNodes nodes={br.children} ctx={ctx} />
        </div>
      ));
    return null;
  });
}

export function TemplateSource({ productId, nodes, numbers, hidden, references, clauses, overrides, overrideTargets, appendices = [], discriminators = [], boxes = [] }: TemplateSourceProps) {
  const boxByCode = new Map(boxes.map((x) => [x.code, x] as const));
  const clauseByCode = new Map(clauses.map((c) => [c.code, c] as const));
  const appendixByCode = new Map(appendices.map((a) => [a.code, a.name] as const));
  const labelOf = new Map(discriminators.map((d) => [d.code, d.label] as const));
  const ctx: Ctx = {
    productId,
    articleId: undefined,
    appendixName: (code) => appendixByCode.get(code),
    boxOf: (code) => boxByCode.get(code),
    exprText: (source) => exprDisplay(source, labelOf),
    numbers,
    hidden,
    references,
    clauseByCode,
    overrideByNode: new Map(overrides.map((o) => [o.nodeId, o] as const)),
    targetByNode: new Map(overrideTargets.map((t) => [t.nodeId, t] as const)),
    optionText: (clauseCode, options) => optionTextOf(clauseByCode, clauseCode, options),
  };
  if (nodes.length === 0) return <p className="ts-muted">이 관에는 조가 없다.</p>;
  return (
    <article className="ts-doc">
      <ArticleNodes nodes={nodes} ctx={ctx} />
    </article>
  );
}
