/**
 * 조문 저작 화면 (L3) — 서버는 원본과 편집에 필요한 정의를 한 번 읽어 넘긴다. 화면은 `DocumentEditor`(클라이언트)다.
 *
 * ADR-0074: 편집은 브라우저 편집본에서 하고 `저장` 한 번에 서버로 간다. 이 페이지가 넘기는 것:
 * - 원본 트리 · 판 · 대응 보통약관(트리 — 조연결 · 보통약관 조 참조 후보)
 * - 검증 재료(별표 · 공용조항 · 구분자 · 담보속성 유효값 · 문맥 담보) — 브라우저의 검증 목록이 서버 저장 검증과 같은 코드를 탄다
 * - 사전평가 문맥(담보 마스터 값) · 조건 팝업 문맥
 *
 * 편집본 밖의 조작(문서 삭제 `?del=1` · 복제 `?dup=1`)은 읽기 모드 더보기 메뉴에서 오고, 확인 카드는 여기서 그린다.
 */
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { NavHint } from "@/app/_components/NavLink";
import { DOC_TEMPLATE_LABEL, ENTITY_LABEL } from "@/app/_lib/labels";
import { previewOutcome } from "@/app/_lib/rejection";
import { discriminatorResultType } from "@/domain/catalog";
import type { Id } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import { duplicateGeneralAction, duplicateSpecialAction, removeDocumentAction } from "../actions";
import { docListHref } from "../lib";
import { buildConditionContext } from "./_components/condition/conditionContext";
import { DocumentEditor } from "./_components/DocumentEditor";

export const dynamic = "force-dynamic";

interface Query {
  error?: string;
  del?: string;
  dup?: string;
  view?: string;
  node?: string;
}

export default async function DocumentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const sp = await searchParams;
  const services = getServices();
  const doc = await services.document.get(id);
  if (!doc) {
    return (
      <div style={{ padding: 20 }}>
        <Breadcrumb items={[{ label: ENTITY_LABEL.generalTemplate, href: docListHref("general") }, { label: id }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const actor = await currentActor();

  const [appendices, clauses, discriminators, enums, generalSummaries, attributeKinds] = await Promise.all([
    services.document.listAppendices(),
    services.clause.list(),
    services.catalog.list(),
    services.catalog.listEnums(),
    services.document.list("general"),
    services.product.listAttributeKinds(),
  ]);

  // 슬롯이 찍을 수 있는 것은 구분자뿐이고(ADR-0037), 결과 타입이 string·enum 인 것만 (기능/문면 §3.4).
  const catalog = new Map(discriminators.map((d) => [d.code, d]));
  const slotCandidates = discriminators.flatMap((def) => {
    const type = discriminatorResultType(def, undefined, catalog);
    return type && (type.kind === "string" || type.kind === "enum") ? [{ path: def.code, label: def.label }] : [];
  });

  // ── 담보 마스터 값 — 사전평가와 조건 팝업 문맥이 함께 쓴다 (한 번만 부른다) ──
  const special = doc.kind === "special" && doc.ownerId !== undefined;
  const mv = special ? await services.coverage.masterValues(doc.ownerId!) : undefined;
  const evalNote = !special ? "보통약관은 담보 레벨 문맥이 없어 여기서 평가하지 않는다." : mv && !mv.ok ? "담보 마스터 값을 읽지 못했다." : undefined;
  const condition = buildConditionContext(
    mv?.ok ? { coverage: mv.value.tree, values: mv.value.values, discriminators, enums, attributes: attributeKinds } : { discriminators, enums, attributes: attributeKinds },
  );

  const generalDocument = doc.kind === "special" && doc.generalDocumentId ? await services.document.get(doc.generalDocumentId) : undefined;

  // ── 대응 보통약관 제안 (#4) — 이 담보를 탑재한 상품이 실제로 쓰는 템플릿 ──
  let suggestedGeneralId: Id | undefined;
  if (doc.kind === "special" && doc.generalDocumentId === undefined && doc.ownerId) {
    const products = await services.product.listProducts();
    for (const p of products) {
      if (!p.generalDocumentId) continue;
      const pcs = await services.product.listProductCoverages(p.id);
      if (pcs.some((pc) => pc.coverageId === doc.ownerId)) {
        suggestedGeneralId = p.generalDocumentId;
        break;
      }
    }
  }

  // ── 문서 삭제 확인 (`?del=1`, 더보기) ──
  let notice = null;
  if (sp.del === "1") {
    const outcome = previewOutcome(await services.document.remove(actor, id));
    notice =
      outcome.kind === "confirm" ? (
        <Confirm
          impact={outcome.impact}
          action={removeDocumentAction.bind(null, id)}
          targetLabel={`${DOC_TEMPLATE_LABEL[doc.kind]} ${doc.title}`}
          actionLabel={`${doc.title} 삭제`}
          cancelHref={`/documents/${id}`}
        />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  }

  // ── 복제 (`?dup=1`, 더보기) — 보통약관은 새 이름, 담보약관은 템플릿이 없는 담보로 (기능/문면 §3.1) ──
  if (sp.dup === "1") {
    const freeCoverages = doc.kind === "special" ? (await services.coverage.listSummaries()).filter((c) => !c.documentId && c.id !== doc.ownerId) : [];
    notice = (
      <section className="ts-confirm" aria-label="템플릿 복제">
        <p className="ts-confirm-title">
          {DOC_TEMPLATE_LABEL[doc.kind]} {doc.title} 복제
        </p>
        <p className="ts-muted">문서 안 조 참조는 사본의 조를 가리키고, 보통약관 조 참조 · 조연결 · 공용조항 · 별표 · 구분자는 그대로 둔다. 원본은 바뀌지 않는다.</p>
        {doc.kind === "general" ? (
          <form action={duplicateGeneralAction.bind(null, id)}>
            <div className="ts-form-row">
              <label htmlFor="dup-title">새 이름</label>
              <input id="dup-title" type="text" name="title" defaultValue={`${doc.title} (사본)`} required />
            </div>
            <div className="ts-confirm-actions">
              <button type="submit" className="primary">
                복제
              </button>
              <a href={`/documents/${id}`}>취소</a>
            </div>
          </form>
        ) : freeCoverages.length === 0 ? (
          <>
            <p>템플릿이 없는 담보가 없다 — 담보약관 템플릿은 담보 하나가 한 벌 소유한다. 담보를 먼저 만든다.</p>
            <div className="ts-confirm-actions">
              <a href={`/documents/${id}`}>닫기</a>
            </div>
          </>
        ) : (
          <form action={duplicateSpecialAction.bind(null, id)}>
            <div className="ts-form-row">
              <label htmlFor="dup-coverage">담보</label>
              <select id="dup-coverage" name="coverageId" defaultValue={freeCoverages[0].id}>
                {freeCoverages.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ts-form-row">
              <label htmlFor="dup-title">이름</label>
              <input id="dup-title" type="text" name="title" defaultValue={`${doc.title} (사본)`} required />
            </div>
            <div className="ts-confirm-actions">
              <button type="submit" className="primary">
                복제
              </button>
              <a href={`/documents/${id}`}>취소</a>
            </div>
          </form>
        )}
      </section>
    );
  }

  const coverage = special && mv?.ok ? mv.value.tree : undefined;

  return (
    <>
      <NavHint kind={doc.kind === "general" ? "general" : "coverage"} />
      <DocumentEditor
        // 판이 바뀌어도(저장 뒤 · 편집 시작 때 낡은 원본을 새로 받음) 화면 상태는 이어진다 — 편집본은 판과 함께 브라우저가 든다
        key={doc.id}
        doc={{
          id: doc.id,
          kind: doc.kind,
          ...(doc.ownerId ? { ownerId: doc.ownerId } : {}),
          title: doc.title,
          tree: doc.tree,
          version: doc.version,
          ...(doc.generalDocumentId ? { generalDocumentId: doc.generalDocumentId } : {}),
        }}
        {...(generalDocument && generalDocument.kind === "general" ? { general: { id: generalDocument.id, title: generalDocument.title, tree: generalDocument.tree } } : {})}
        generals={generalSummaries.filter((g) => g.id !== id).map((g) => ({ id: g.id, title: g.title }))}
        {...(suggestedGeneralId ? { suggestedGeneralId } : {})}
        appendices={appendices}
        clauses={clauses}
        discriminators={discriminators}
        attributeValues={Object.fromEntries(attributeKinds.map((k) => [k.code, k.values.map((v) => v.code)]))}
        {...(coverage ? { coverage } : {})}
        {...(special && mv?.ok ? { master: { tree: mv.value.tree, values: mv.value.values } } : {})}
        {...(evalNote ? { evalNote } : {})}
        condition={condition}
        slotCandidates={slotCandidates}
        {...(sp.node ? { initialNode: sp.node } : {})}
        initialEval={sp.view === "eval"}
        notice={
          <>
            <ErrorBanner message={sp.error} />
            {notice}
          </>
        }
        moreItems={[
          { label: "복제", href: `/documents/${id}?dup=1` },
          { label: "템플릿 삭제", href: `/documents/${id}?del=1`, danger: true },
        ]}
      />
    </>
  );
}
