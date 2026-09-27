import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconButton, IconLink } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { Booklet } from "@/domain/assembly";
import type { Clause } from "@/domain/clause";
import { referenceTargetIndex, type DocumentNode, type NodeNumber } from "@/domain/document";
import type { AttributeKind, BaseContractCheck, ClauseOptionOverride, ProductCoverage, ProductPlan } from "@/domain/product";
import type { Id, Result } from "@/domain/types";

import { designateBaseContractAction, releaseBaseContractAction, setProductGeneralDocumentAction } from "../../actions";
import { currentGeneralArticle, generalIssueLink, generalSections, generalSectionLabel, generalTabIssues, renderedNodeIds, sectionOfArticle, sectionPreviewDoc } from "../../lib";
import { CoverageMountSection } from "./CoverageMountSection";
import { GeneralToc } from "./GeneralToc";
import { type OverrideTarget } from "./OptionOverrideForm";
import { PanelScrollSync } from "./PanelScrollSync";
import { TemplateSource } from "./TemplateSource";

export interface GeneralTabProps {
  productId: Id;
  generalDocumentId: Id | undefined;
  generals: { id: Id; title: string }[];
  /** 기본계약 절의 상품담보 — 탑재 표 · 탑재 폼. */
  baseCoverages: ProductCoverage[];
  /** 기본계약 지정 select 는 상품담보 전부를 고를 수 있다. */
  productCoverages: ProductCoverage[];
  coverages: { id: Id; code?: string; name: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 탑재 표의 「담보 검색」 `?mq=` · 페이지 `?mpage=`. */
  mountSearch: { query?: string; page?: string };
  wouldBeName: (pc: ProductCoverage) => string;
  baseCheck: Result<BaseContractCheck[]>;
  overrides: ClauseOptionOverride[];
  overrideTargets: OverrideTarget[];
  /** 공용조항 정의 — 박스의 옵션 이름·선택지 이름. */
  clauses: Clause[];
  /** 보통약관 템플릿 트리 — 미지정이면 undefined (약관 섹션 대신 한 줄 안내). */
  generalTree: DocumentNode | undefined;
  /** 템플릿 번호 (원천 노드 id 키) — 목차·원문이 쓰는 「끄기 전」 번호. */
  generalNumbers: ReadonlyMap<Id, NodeNumber>;
  hiddenArticles: readonly Id[];
  /** 조립 결과 — 오른쪽 미리보기 · 오류 · 별표 카운트. */
  booklet: Booklet | undefined;
  /** 조립이 안 된 사유 한 줄 (booklet 이 없을 때). */
  bookletNote: string | undefined;
  /** `?art=` — 고른 조. 없거나 없는 조면 첫 조. */
  articleId: Id | undefined;
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 보통약관 탭 — 기본계약을 완성한다 (기능/상품 §4 「보통약관」): 템플릿 · 기본계약 상품담보 · 기본계약 지정 · 약관 세 패널.
 *
 * 약관 섹션은 **한 관**을 셋으로 나눠 본다 — 목차(조 노출 토글) · 원문(공용조항 옵션만 편집) · 조립 결과(기능/상품 §4.5).
 * 옵션 오버라이드는 별도 섹션을 두지 않는다: 문면의 그 자리에서 고친다 (기능/상품 §3.6).
 */
export function GeneralTab({
  productId,
  generalDocumentId,
  generals,
  baseCoverages,
  productCoverages,
  coverages,
  attributeKinds,
  plans,
  mountSearch,
  wouldBeName,
  baseCheck,
  overrides,
  overrideTargets,
  clauses,
  generalTree,
  generalNumbers,
  hiddenArticles,
  booklet,
  bookletNote,
  articleId,
  confirm,
  confirmNode,
}: GeneralTabProps) {
  // ── 약관 섹션의 좌표 — 관 하나가 세 패널의 단위다 ──────────────────────────
  const sections = generalTree ? generalSections(generalTree) : [];
  const hidden = new Set(hiddenArticles);
  const allArticles = sections.flatMap((s) => s.articles);
  const articleTotal = allArticles.length;
  const shownCount = allArticles.filter((a) => !hidden.has(a.id)).length;
  const currentArticleId = currentGeneralArticle(sections, articleId);
  const section = sectionOfArticle(sections, currentArticleId);
  const sectionLabel = generalSectionLabel(sections, section, generalNumbers);
  const references = generalTree ? referenceTargetIndex(generalTree, generalNumbers) : new Map();

  // ── 오른쪽 패널 — 조립 결과를 같은 관으로 자른다 (묶음의 조 id 기준 · Minor-4) ──
  const previewDoc = sectionPreviewDoc(booklet?.general, section);
  const sectionArticleIds = new Set(section?.articles.map((a) => a.id) ?? []);
  // 조를 끄면 준용·기본계약 쪽에서 오류가 난다 — 그 결과 좌표는 특약이라 여기서 문서로 거르면 안 된다 (generalTabIssues 주석)
  const { section: sectionIssues, errorCount } = generalTabIssues(booklet?.issues ?? [], sectionArticleIds);
  const appendixCount = booklet?.appendices.length ?? 0;

  // 오류 링크는 도착할 수 있는 자리만 — 특약 오류는 그 상품담보 미리보기로 (Minor-5, `generalIssueLink`).
  const previewNodeIds = renderedNodeIds(previewDoc);
  const baseCoverageIds = new Set(baseCoverages.map((pc) => pc.id));

  return (
    <>
      <section className="ts-section">
        <h2 className="ts-section-title">보통약관 템플릿</h2>
        <form action={setProductGeneralDocumentAction.bind(null, productId)} className="ts-form">
          <label className="ts-field">
            <span>보통약관 템플릿</span>
            <select name="generalDocumentId" defaultValue={generalDocumentId ?? ""}>
              <option value="">— 미지정 —</option>
              {generals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <div className="ts-form-actions">
            <button type="submit">템플릿 저장</button>
            <Link href="/attributes">담보속성 카탈로그 →</Link>
          </div>
        </form>
        {/* 교체로 조 노출·오버라이드를 잃으면 액션이 `?confirm=template:<새 id>` 로 보낸다 (코덱스 리뷰 Important-6). */}
        {confirm?.startsWith("template:") && confirmNode}
      </section>

      <CoverageMountSection
        productId={productId}
        section="base"
        items={baseCoverages}
        coverages={coverages}
        attributeKinds={attributeKinds}
        plans={plans}
        query={mountSearch.query}
        page={mountSearch.page}
        wouldBeName={wouldBeName}
        mountBlockedHint={baseCoverages.length > 0 ? "변경하려면 먼저 해제하세요 — 기본계약은 하나만 지정할 수 있다 (MVP)" : undefined}
        confirm={confirm}
        confirmNode={confirmNode}
      />

      {/* 오류 좌표(refPath baseContract)의 「고치러 가기」가 `#base-contract` 로 여기에 닿는다 (coordinateHref). */}
      <section className="ts-section" id="base-contract">
        <h2 className="ts-section-title">기본계약</h2>
        {baseCoverages.length === 0 ? (
          <p className="ts-muted">기본계약을 하나 지정하세요 — 보통약관이 담보 레벨 값을 읽는 자리는 기본계약에서 온다</p>
        ) : (
          <>
            {/* 2개 이상(기존 데이터) — 읽기 검사 문구 「하나만 남기고 해제하세요」 를 오류 배너로 · 1개인데 검사가 거부되면(템플릿 미선택 등) 그 사유 */}
            {!baseCheck.ok && <ErrorBanner message={rejectionMessage(baseCheck)} />}
            <ul>
              {baseCoverages.map((pc) => (
                <li key={pc.id}>
                  {pc.name}{" "}
                  <form action={releaseBaseContractAction.bind(null, productId, pc.id)} style={{ display: "inline" }}>
                    <IconButton type="submit" danger label={`기본계약 해제 · ${pc.name}`} icon={<IconLink />} />
                  </form>
                  {baseCheck.ok && <IssueList issues={baseCheck.value.find((chk) => chk.productCoverageId === pc.id)?.issues ?? []} />}
                </li>
              ))}
            </ul>
            {/* 1개 이상이면 지정 폼은 숨긴다 — 두 번째 지정은 서비스가 거부한다 (MVP 정확히 1개) */}
            {baseCoverages.length === 1 && <p className="ts-muted">변경하려면 먼저 해제하세요 — 기본계약은 하나만 지정할 수 있다 (MVP)</p>}
          </>
        )}
        {baseCoverages.length === 0 && (
          <form action={designateBaseContractAction.bind(null, productId)} className="ts-form">
            <label className="ts-field">
              <span>기본계약으로 지정</span>
              <select name="productCoverageId" required>
                {productCoverages.map((pc) => (
                  <option key={pc.id} value={pc.id}>
                    {pc.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ts-form-actions">
              <button type="submit">기본계약 지정</button>
            </div>
          </form>
        )}
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          약관{" "}
          {generalTree && (
            <span className="ts-count">
              <b>{articleTotal}</b>조 중 <b>{shownCount}</b> 노출 · 오버라이드 {overrides.length} · 오류 {errorCount} · 별표 {appendixCount}(자동)
            </span>
          )}
        </h2>
        {generalTree === undefined ? (
          <p className="ts-muted">보통약관 템플릿을 고르면 여기에 선다.</p>
        ) : (
          <div className="ts-terms-panels">
            <div className="ts-terms-panel">
              <h3 className="ts-terms-panel-title">목차</h3>
              <GeneralToc productId={productId} sections={sections} numbers={generalNumbers} hidden={hidden} currentArticleId={currentArticleId} />
            </div>
            <div className="ts-terms-panel">
              <h3 className="ts-terms-panel-title">약관 — {sectionLabel} (원문)</h3>
              <TemplateSource
                productId={productId}
                nodes={section?.nodes ?? []}
                numbers={generalNumbers}
                hidden={hidden}
                references={references}
                clauses={clauses}
                overrides={overrides}
                overrideTargets={overrideTargets}
                articleId={currentArticleId}
              />
            </div>
            <div className="ts-terms-panel">
              <h3 className="ts-terms-panel-title">미리보기 — {sectionLabel} (평가)</h3>
              <IssueList issues={sectionIssues} linkFor={(issue) => generalIssueLink(productId, previewNodeIds, baseCoverageIds, issue)} />
              {previewDoc ? <RenderedDoc doc={previewDoc} /> : <p className="ts-muted">{bookletNote ?? "조립 결과가 없다 — 보통약관이 조립되지 않았다."}</p>}
            </div>
            <PanelScrollSync articleId={currentArticleId} />
          </div>
        )}
      </section>

    </>
  );
}
