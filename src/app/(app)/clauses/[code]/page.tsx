/**
 * 공용조항 상세 (L2) — 보러 오는 것은 이름 · 기재내용 · 옵션이다.
 *
 * 이 파일은 **조판된 본문**을 서버에서 그려 편집기(ClauseEditor)에 넘긴다.
 * 문서 세계(명조)는 앱 스킨을 입지 않으므로(§1.1) 렌더러가 client 로 넘어가지 않게 여기 남는다.
 * 옵션 선택은 `{"O01":"V01"}` 이 아니라 「어조: 사망」으로 읽는다 (§9.4 — 실체는 표시명으로 부른다).
 */
import type { ReactNode } from "react";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ENTITY_LABEL, MODE_LABEL } from "@/app/_lib/labels";
import type { Block, Clause, Inline, ItemNode, SubitemNode } from "@/domain/clause";
import { getServices } from "@/lib/services";

import { ClauseEditor } from "./ClauseEditor";

export const dynamic = "force-dynamic";

/** 읽기 모드 조건식 칩 — 길면 자르고 전체는 tooltip 으로 (§2 L3). */
function CondHead({ when }: { when?: string }) {
  const text = when ?? "그 밖의 경우 (else)";
  return (
    <span className="ts-doc-cond-head" title={text}>
      {text.length > 60 ? `${text.slice(0, 60)}…` : text}
    </span>
  );
}

function InlineNodes({ nodes, clause }: { nodes: readonly Inline[]; clause: Clause }): ReactNode {
  return nodes.map((n) => {
    switch (n.kind) {
      case "text":
        return <span key={n.id}>{n.text}</span>;
      case "slot":
        return (
          <span key={n.id} className="ts-doc-slot" title={`치환 슬롯 · ${n.ref}`}>
            {n.ref}
          </span>
        );
      case "articleRef":
        return (
          <span key={n.id} className="ts-doc-ref" title="조 참조 슬롯 — 번호는 조립에서 계산된다">
            제○조
          </span>
        );
      case "appendixRef":
        return (
          <span key={n.id} className="ts-doc-ref" title={`별표 참조 · ${n.appendixCode}`}>
            【별표 {n.appendixCode}】
          </span>
        );
      case "optionSlot": {
        const option = clause.options.find((o) => o.code === n.optionCode);
        return (
          <span key={n.id} className="ts-doc-ref" title={`옵션 자리 — 사용처가 고른 선택지가 여기 들어간다 (${n.optionCode})`}>
            〔{option?.label ?? n.optionCode}〕
          </span>
        );
      }
      case "inlineCond":
        return (
          <span key={n.id} className="ts-doc-cond">
            {n.branches.map((br) => (
              <span key={br.id}>
                <CondHead {...(br.when !== undefined ? { when: br.when } : {})} /> <InlineNodes nodes={br.children} clause={clause} />
              </span>
            ))}
          </span>
        );
    }
  });
}

function Subitems({ nodes, clause }: { nodes: readonly SubitemNode[]; clause: Clause }) {
  return (
    <ol className="ts-doc-subitems">
      {nodes.map((s) => (
        <li key={s.id} className="ts-doc-subitem">
          <InlineNodes nodes={s.children} clause={clause} />
        </li>
      ))}
    </ol>
  );
}

function Items({ nodes, clause }: { nodes: readonly ItemNode[]; clause: Clause }) {
  return (
    <ol className="ts-doc-items">
      {nodes.map((it) => (
        <li key={it.id} className="ts-doc-item">
          <InlineNodes nodes={it.children} clause={clause} />
          {it.subitems && it.subitems.length > 0 && <Subitems nodes={it.subitems} clause={clause} />}
        </li>
      ))}
    </ol>
  );
}

function Blocks({ nodes, clause }: { nodes: readonly Block[]; clause: Clause }): ReactNode {
  return nodes.map((n) =>
    n.kind === "paragraph" ? (
      <div key={n.id} className="ts-doc-paragraph">
        <InlineNodes nodes={n.children} clause={clause} />
        {n.items && n.items.length > 0 && <Items nodes={n.items} clause={clause} />}
      </div>
    ) : (
      <div key={n.id}>
        {n.branches.map((br, i) => (
          <div key={br.id} className={i === 0 ? "ts-doc-cond" : "ts-doc-cond is-alt"}>
            <CondHead {...(br.when !== undefined ? { when: br.when } : {})} />
            <Blocks nodes={br.children} clause={clause} />
          </div>
        ))}
      </div>
    ),
  );
}

export default async function ClauseDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const services = getServices();
  const clause = await services.clause.get(code);
  if (!clause) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.clause, href: "/clauses" }, { label: code }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  /* 조판된 본문 — 문서 세계(명조)는 서버에서 그려 편집기에 넘긴다 (§1.1). */
  const rendered = (
    <article className="ts-doc">
      {clause.body.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">본문이 비어 있다 — 이 공용조항을 참조해도 아무 조문도 나오지 않는다.</p>
          <p className="ts-empty-example">
            예: {clause.mode === "block" ? `${MODE_LABEL.block} 하나 「이 특별약관은 …」` : `${MODE_LABEL.inline} 「보험금을 지급하지 않습니다」`}
          </p>
          <p className="ts-empty-action">편집을 눌러 노드를 채운다.</p>
        </div>
      ) : clause.mode === "block" ? (
        <Blocks nodes={clause.body} clause={clause} />
      ) : (
        <div className="ts-doc-paragraph">
          <InlineNodes nodes={clause.body} clause={clause} />
        </div>
      )}
    </article>
  );

  return <ClauseEditor clause={clause} rendered={rendered} />;
}
