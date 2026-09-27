/**
 * 공용조항 상세 (L2) — 보러 오는 것은 이름 · 기재내용 · 옵션이다.
 *
 * 이 파일은 **조판된 본문**과 **사용처 한 장**을 서버에서 그려 편집기(ClauseEditor)에 넘긴다.
 * 문서 세계(명조)는 앱 스킨을 입지 않으므로(§1.1) 렌더러가 client 로 넘어가지 않게 여기 남는다.
 * 옵션 선택은 `{"O01":"V01"}` 이 아니라 「어조: 사망」으로 읽는다 (§9.4 — 실체는 표시명으로 부른다).
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { IssueList, type IssueLink } from "@/app/_components/IssueList";
import { ENTITY_LABEL, MODE_LABEL } from "@/app/_lib/labels";
import type { Block, Clause, Inline, ItemNode, OptionSelection, SubitemNode } from "@/domain/clause";
import { affectedProducts, describeKey, nodeKey, referencesFrom, type RefNodeKey } from "@/domain/refs";
import type { Issue } from "@/domain/types";
import { getServices } from "@/lib/services";

import { ClauseEditor } from "./ClauseEditor";

export const dynamic = "force-dynamic";

const OWNER_KIND_LABEL: Record<string, string> = { coverage: "담보약관", general: "보통약관" };

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

/**
 * 검사 ② 이슈의 「사용처 문서에서 보기」 — 참조가 놓인 문서의 그 노드로.
 * 이슈의 `at`(usageCoordinate) 은 소유 실체 좌표(담보약관이면 ownerId 가 담보 id)지만 참조가 놓인 문서를 `documentId` 에
 * 싣고 있어 `coordinateHref` 가 그 문서의 그 노드(`?node=`)로 보낸다 — 다른 화면의 「고치러 가기」와 같은 규칙이다.
 */
function usageLink(issue: Issue): IssueLink | undefined {
  const href = coordinateHref(issue.at);
  return href ? { href, label: "사용처 문서에서 보기" } : undefined;
}

/** 옵션 선택(`{"O01":"V01"}`) → 「어조: 사망」. 정의에 없는 코드는 코드 그대로 남긴다(깨진 선택). */
function selectionLabel(clause: Clause, selection: OptionSelection | undefined): string {
  if (!selection) return "선택 없음";
  const parts = Object.entries(selection).map(([optionCode, valueCode]) => {
    const option = clause.options.find((o) => o.code === optionCode);
    const value = option?.values.find((v) => v.code === valueCode);
    return `${option?.label ?? optionCode}: ${value?.label ?? `${valueCode}(없는 선택지)`}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "선택 없음";
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

  const [usages, recheck, documents, graph] = await Promise.all([
    services.clause.usages(code),
    services.clause.recheck(code),
    services.document.list(),
    services.refs.graph(),
  ]);
  const documentTitle = new Map(documents.map((d) => [d.id, d.title] as const));
  // 세 검사(기능/공용조항 §3.4)의 재료 — ① 은 정의가 참조하는 것의 수, ③ 은 사용처 문면이 들어가는 상품 (미리보기에서 검사된다).
  const clauseKey: RefNodeKey = { kind: "clause", code: clause.code };
  const articleRefCount = referencesFrom(graph, clauseKey, { via: ["articleRef"] }).length;
  const appendixRefCount = referencesFrom(graph, clauseKey, { via: ["appendixRef"] }).length;
  const products = affectedProducts(graph, clauseKey);
  const recheckEntries = recheck.ok ? recheck.value : [];

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

  /* 사용처 · 세 검사(① 정의 유효 · ② 사용처 문맥 · ③ 실행 시 해소 — 기능/공용조항 §3.4) — 가끔 확인하는 것들이라 모달 한 장에 모은다. */
  const usage = (
    <div>
      <p className="ts-l2-side-title">
        사용처 <span className="ts-count"><b>{usages.length}</b>건</span>
      </p>
      {usages.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">아무 조문도 이 공용조항을 참조하지 않는다 — 지금은 고아다.</p>
          <p className="ts-empty-example">예: 담보약관의 조 안에 「공용조항({MODE_LABEL.block})」 노드를 넣으면 여기 잡힌다.</p>
          <p className="ts-empty-action"><Link href="/documents?kind=general">약관 템플릿 목록으로 →</Link></p>
        </div>
      ) : (
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-flex">약관 템플릿</th>
              <th className="col-fixed-md">소유 모델링</th>
              <th className="col-fixed-md">선택</th>
            </tr>
          </thead>
          <tbody>
            {usages.map((u, i) => (
              <tr key={i}>
                <td className="col-flex">
                  <Link href={`/documents/${u.documentId}`}>
                    {documentTitle.get(u.documentId) ?? u.ownerName ?? "이름 없는 템플릿"}({OWNER_KIND_LABEL[u.ownerKind] ?? u.ownerKind})
                  </Link>
                </td>
                <td className="col-fixed-md" title={u.ownerId}>{u.ownerName ?? "—"}</td>
                <td className="col-fixed-md">{selectionLabel(clause, u.selection)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 검사 — 세 검사의 이름·시점을 그대로 쓴다 (기능/공용조항 §3.4): ① 정의 저장 · ② 삽입·재검사 · ③ 상품 미리보기 */}
      <p className="ts-l2-side-title">검사 ① 정의 유효</p>
      <p className="ts-muted">
        저장 시 검사됨 · 요구 구분자 {clause.required.discriminators.length} · 조 참조 {articleRefCount} · 별표 참조 {appendixRefCount}
      </p>
      {clause.required.discriminators.length > 0 ? (
        <p className="ts-mono">{clause.required.discriminators.join(" · ")}</p>
      ) : (
        <p className="ts-muted">요구 구분자 없음 — 본문의 식에서 자동 추출된다 (ADR-0010)</p>
      )}

      <p className="ts-l2-side-title">
        검사 ② 사용처 문맥 <span className="ts-count"><b>{recheckEntries.length}</b> / {usages.length}건</span>
      </p>
      <p className="ts-muted">삽입할 때와 정의를 고친 뒤 사용처마다 다시 검사된다 — 요구 구분자 존재 · 옵션 선택.</p>
      {recheck.ok && recheckEntries.length === 0 ? <p className="ts-ok">사용처 {usages.length}건 모두 문제 없음.</p> : null}
      {recheckEntries.map((entry, i) => (
        <div key={i}>
          <p>
            <Link href={`/documents/${entry.usage.documentId}`}>
              {documentTitle.get(entry.usage.documentId) ?? entry.usage.ownerName ?? entry.usage.ownerId}
            </Link>
            ({OWNER_KIND_LABEL[entry.usage.ownerKind] ?? entry.usage.ownerKind})
          </p>
          <IssueList issues={entry.issues} linkFor={usageLink} />
        </div>
      ))}

      <p className="ts-l2-side-title">
        검사 ③ 실행 시 해소 <span className="ts-count">영향 받는 상품 <b>{products.length}</b>건</span>
      </p>
      <p className="ts-muted">
        상품 미리보기에서 검사된다 — 값 미입력 · 옵션 미선택 · 참조 대상이 분기로 사라짐. 이 공용조항을 고치면 이 상품들의 저장된
        미리보기가 「오래된 결과」가 된다 — 미리보기에서 다시 실행.
      </p>
      {products.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">이 공용조항의 사용처가 들어가는 상품이 없다.</p>
        </div>
      ) : (
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-fixed-md">상품</th>
              <th className="col-flex">경유</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const last = p.through.at(-1);
              return (
                <tr key={nodeKey(p.product)}>
                  <td>{p.product.kind === "product" ? <Link href={`/products/${p.product.id}/preview`}>{p.productName}</Link> : p.productName}</td>
                  <td className="ts-muted">{last ? describeKey(last, graph) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="ts-empty-action"><Link href={`/relations?kind=clause&code=${clause.code}`}>관계정보에서 보기 →</Link></p>
    </div>
  );

  return <ClauseEditor clause={clause} rendered={rendered} usage={usage} usageCount={usages.length} />;
}
