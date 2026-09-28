import type { ReactNode } from "react";

import { Combobox } from "@/app/_components/Combobox";
import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import type { Booklet } from "@/domain/assembly";
import type { Clause } from "@/domain/clause";
import { referenceTargetIndex, type DocumentNode, type NodeNumber } from "@/domain/document";
import type { ClauseOptionOverride, ProductCoverage } from "@/domain/product";
import type { Id } from "@/domain/types";

import { setProductGeneralDocumentAction } from "../../actions";
import { currentGeneralArticle, generalIssueLink, generalSections, generalSectionLabel, generalTabIssues, renderedNodeIds, sectionPreviewDoc } from "../../lib";
import { GeneralPanels, type GeneralPane } from "./GeneralPanels";
import type { TocSection } from "./GeneralToc";
import { type OverrideTarget } from "./OptionOverrideForm";
import { TemplateSource } from "./TemplateSource";

export interface GeneralTabProps {
  productId: Id;
  generalDocumentId: Id | undefined;
  generals: { id: Id; title: string }[];
  /** 기본계약 상품담보 — 오류 링크의 행선(기본계약은 제 상품담보 화면으로 · `generalIssueLink`). */
  baseCoverages: ProductCoverage[];
  overrides: ClauseOptionOverride[];
  overrideTargets: OverrideTarget[];
  /** 공용조항 정의 — 상자 안의 모델 · 옵션 이름 · 선택지 이름. */
  clauses: Clause[];
  /** 별표 · 구분자 표시명 — 원문 모델의 칩을 한글로. */
  appendices: { code: string; name: string }[];
  discriminators: { code: string; label: string }[];
  /** 보통약관 템플릿 트리 — 미지정이면 undefined (세 패널 대신 한 줄 안내). */
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
 * 약관 › 보통약관 작성 — 보통약관 본문에만 집중한다 (기능/상품 §4.6, 2026-09-28 「안 2」).
 *
 * 위는 템플릿 선택 한 줄(선택 + 저장)뿐, 아래는 화면 높이를 채우는 세 패널 — 목차(조 노출 토글) · 원문 모델(공용조항 옵션만 편집) ·
 * 조립 결과. 기본계약 · 탑재 표는 상품담보 탭에 산다. 옵션 오버라이드는 별도 섹션 없이 문면의 그 자리에서 고친다 (기능/상품 §3.6).
 */
export function GeneralTab({
  productId,
  generalDocumentId,
  generals,
  baseCoverages,
  overrides,
  overrideTargets,
  clauses,
  appendices,
  discriminators,
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
  const references = generalTree ? referenceTargetIndex(generalTree, generalNumbers) : new Map();
  const { errorCount } = generalTabIssues(booklet?.issues ?? [], new Set());
  const appendixCount = booklet?.appendices.length ?? 0;
  const baseCoverageIds = new Set(baseCoverages.map((pc) => pc.id));

  // ── 목차 — 관 제목 · 조(템플릿 번호 + 제목 · 노출) ─────────────────────────
  const toc: TocSection[] = sections.map((s, i) => ({
    key: s.id ?? `loose-${i}`,
    ...(s.id ? { label: `${generalNumbers.get(s.id)?.label ?? "관"} ${s.title}` } : {}),
    articles: s.articles.map((a) => ({ id: a.id, label: `${generalNumbers.get(a.id)?.label ?? "조"}(${a.title})`, hidden: hidden.has(a.id) })),
  }));

  // ── 관마다 가운데(원문 모델) · 오른쪽(조립 결과를 같은 관으로 자른 것 · Minor-4) — 목차는 서버 없이 관을 바꾼다 ──
  const panes: GeneralPane[] = sections.map((section, i) => {
    const previewDoc = sectionPreviewDoc(booklet?.general, section);
    // 조를 끄면 준용·기본계약 쪽에서 오류가 난다 — 그 결과 좌표는 특약이라 여기서 문서로 거르면 안 된다 (generalTabIssues 주석)
    const { section: sectionIssues } = generalTabIssues(booklet?.issues ?? [], new Set(section.articles.map((a) => a.id)));
    // 오류 링크는 도착할 수 있는 자리만 — 특약 오류는 그 상품담보 미리보기로 (Minor-5, `generalIssueLink`).
    const previewNodeIds = renderedNodeIds(previewDoc);
    return {
      key: section.id ?? `loose-${i}`,
      label: generalSectionLabel(sections, section, generalNumbers),
      articleIds: section.articles.map((a) => a.id),
      center: (
        <TemplateSource
          productId={productId}
          nodes={section.nodes}
          numbers={generalNumbers}
          hidden={hidden}
          references={references}
          clauses={clauses}
          overrides={overrides}
          overrideTargets={overrideTargets}
          appendices={appendices}
          discriminators={discriminators}
        />
      ),
      right: (
        <>
          <IssueList issues={sectionIssues} linkFor={(issue) => generalIssueLink(productId, previewNodeIds, baseCoverageIds, issue)} />
          {previewDoc ? <RenderedDoc doc={previewDoc} /> : <p className="ts-muted">{bookletNote ?? "조립 결과가 없다 — 보통약관이 조립되지 않았다."}</p>}
        </>
      ),
    };
  });

  return (
    <div className="ts-terms-focus">
      <form action={setProductGeneralDocumentAction.bind(null, productId)} className="ts-terms-template">
        <label>
          <span>보통약관 템플릿</span>
          <Combobox
            name="generalDocumentId"
            defaultValue={generalDocumentId ?? ""}
            placeholder="— 미지정 — (이름으로 찾기)"
            options={[{ value: "", label: "미지정" }, ...generals.map((g) => ({ value: g.id, label: g.title }))]}
          />
        </label>
        <button type="submit">템플릿 저장</button>
        {generalTree && (
          <span className="ts-count ts-terms-template-count">
            <b>{articleTotal}</b>조 중 <b>{shownCount}</b> 노출 · 오버라이드 {overrides.length} · 오류 {errorCount} · 별표 {appendixCount}(자동)
          </span>
        )}
      </form>
      {/* 교체로 조 노출·오버라이드를 잃으면 액션이 `?confirm=template:<새 id>` 로 보낸다 (코덱스 리뷰 Important-6). */}
      {confirm?.startsWith("template:") && confirmNode}
      {generalTree === undefined ? (
        <p className="ts-muted">보통약관 템플릿을 고르면 여기에 목차 · 원문 · 미리보기가 선다.</p>
      ) : (
        <GeneralPanels productId={productId} toc={toc} panes={panes} initialArticleId={currentArticleId} />
      )}
    </div>
  );
}
