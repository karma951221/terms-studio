import type { ReactNode } from "react";

import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import type { Booklet } from "@/domain/assembly";
import type { EnumDef } from "@/domain/catalog";
import type { Clause } from "@/domain/clause";
import { clauseSpanBy, numberTree, referenceTargetIndex, type Box, type DocumentNode, type NodeNumber } from "@/domain/document";
import { applyArticleCopies, articleHash, articlesById, type ArticleCopy, type ClauseOptionOverride, type ProductCoverage } from "@/domain/product";
import type { Id } from "@/domain/types";

import { currentGeneralArticle, generalIssueLink, generalSections, generalSectionLabel, generalTabIssues, renderedNodeIds, sectionPreviewDoc } from "../../lib";
import type { CopyEditorData } from "./ArticleCopyEditor";
import { GeneralEditProvider, type OverrideTarget } from "./GeneralEdit";
import { GeneralPanels, type GeneralPane } from "./GeneralPanels";
import { GeneralTemplateLine } from "./GeneralTemplateLine";
import type { TocSection } from "./GeneralToc";
import { TemplateSource } from "./TemplateSource";

export interface GeneralTabProps {
  productId: Id;
  generalDocumentId: Id | undefined;
  generals: { id: Id; title: string }[];
  /** 기본계약 상품담보 — 오류 링크의 행선(기본계약은 제 상품담보 화면으로 · `generalIssueLink`). */
  baseCoverages: ProductCoverage[];
  overrides: ClauseOptionOverride[];
  overrideTargets: OverrideTarget[];
  /** 함수조항 정의 — 상자 안의 모델 · 옵션 이름 · 선택지 이름. */
  clauses: Clause[];
  /** 별표 · 구분자 표시명 — 원문 모델의 칩을 한글로. */
  appendices: { code: string; name: string }[];
  /** 정적 마스터 박스 — 원문 모델의 박스 참조를 내용째. */
  boxes: Box[];
  /** 열거형 — 함수조항 상자의 값별 분기 칸 머리를 값 이름으로. */
  enums?: readonly EnumDef[];
  discriminators: { code: string; label: string }[];
  /** 보통약관 템플릿 트리 — 미지정이면 undefined (세 패널 대신 한 줄 안내). */
  generalTree: DocumentNode | undefined;
  /** 템플릿 판 — 편집을 시작할 때 본 판으로 저장된다(「템플릿이 바뀌었습니다」의 기준). */
  templateVersion?: number;
  /** 마지막 저장 뒤 템플릿이 바뀌었다 (템플릿 판 > 이 상품의 기준 판, ADR-0079). */
  templateChanged?: boolean;
  /** 이 상품의 조 사본 — 템플릿에 자리가 남은 것만 (ADR-0079). */
  articleCopies?: readonly ArticleCopy[];
  /** 편집 중 조 편집 패널의 재료(템플릿 · 트리 밖) — 별표 · 박스 · 함수조항 · 구분자 · 열거형 · 조건 문맥. */
  copyEditorData?: Omit<CopyEditorData, "templateId" | "template">;
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
 * 보통약관 탭 — 보통약관 본문에만 집중한다 (기능/상품 §4.6).
 *
 * 위는 템플릿 한 줄(이름 · 집계 · 편집/저장 · 템플릿이 바뀌었으면 경고)뿐, 아래는 화면 높이를 채우는 세 패널 — 목차(조 노출 · 사본 점) ·
 * 모델링(이 상품의 본문 = 템플릿 + 조 사본) · 미리보기(조립 결과). 편집 중에는 목차 + 조 편집 두 패널 (ADR-0079). 기본계약 · 탑재 표는 상품담보 탭에 산다. 옵션 오버라이드는 별도 섹션 없이 문면의 그 자리에서 고친다 (기능/상품 §3.6).
 *
 * 읽기로 연다. 편집 → 조 노출 · 조 사본 · 옵션을 초안에 고르고 저장 한 번 (기능/상품 §3.8 — `GeneralEditProvider`). 템플릿 교체만 확인 카드에서 즉시.
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
  boxes,
  enums,
  discriminators,
  generalTree: templateTree,
  templateVersion,
  templateChanged = false,
  articleCopies = [],
  copyEditorData,
  generalNumbers: templateNumbers,
  hiddenArticles,
  booklet,
  bookletNote,
  articleId,
  confirm,
  confirmNode,
}: GeneralTabProps) {
  // ── 이 상품의 보통약관 트리 = 템플릿 + 조 사본 (ADR-0079) — 읽기의 목차 · 모델링이 이것을 본다(미리보기는 조립 결과) ──
  const generalTree = templateTree ? applyArticleCopies(templateTree, articleCopies) : undefined;
  const templateArticles = templateTree ? articlesById(templateTree) : new Map();
  // ── 약관 섹션의 좌표 — 관 하나가 세 패널의 단위다 ──────────────────────────
  const sections = generalTree ? generalSections(generalTree) : [];
  // 원문 모델 번호 — 함수조항 참조는 펼칠 항 · 호 · 목 수만큼 센다(뒤 형제 · 조 참조 표기가 조립과 같게, 2026-10-03 사용자 QA)
  const generalNumbers = generalTree ? numberTree(generalTree, { clauseSpan: clauseSpanBy((code) => clauses.find((c) => c.code === code)) }) : templateNumbers;
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
    articles: s.articles.map((a) => {
      const number = generalNumbers.get(a.id)?.label ?? "조";
      const original = templateArticles.get(a.id);
      return { id: a.id, label: `${number}(${a.title})`, number, templateTitle: original?.title ?? a.title, hidden: hidden.has(a.id), templateHash: original ? articleHash(original) : "" };
    }),
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
          boxes={boxes}
          {...(enums ? { enums } : {})}
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

  const summary = generalTree ? (
    <>
      <b>{articleTotal}</b>조 중 <b>{shownCount}</b> 노출 · 사본 {articleCopies.length} · 오버라이드 {overrides.length} · 오류 {errorCount} · 별표 {appendixCount}(자동)
    </>
  ) : undefined;
  const templateTitle = generalDocumentId ? generals.find((g) => g.id === generalDocumentId)?.title : undefined;
  const body = (
    <>
      <GeneralTemplateLine productId={productId} generalDocumentId={generalDocumentId} templateTitle={templateTitle} generals={generals} summary={summary} templateChanged={templateChanged} />
      {/* 교체로 조 노출·오버라이드를 잃으면 액션이 `?confirm=template:<새 id>` 로 보낸다 (코덱스 리뷰 Important-6). */}
      {confirm?.startsWith("template:") && confirmNode}
      {generalTree === undefined ? (
        <p className="ts-muted">{generalDocumentId ? "보통약관 템플릿을 읽을 수 없다." : "보통약관 템플릿을 지정하면 여기에 목차 · 모델링 · 미리보기가 선다."}</p>
      ) : (
        <GeneralPanels
          productId={productId}
          toc={toc}
          panes={panes}
          initialArticleId={currentArticleId}
          requestedArticleId={articleId}
          {...(copyEditorData && generalDocumentId && templateTree ? { copyEditor: { ...copyEditorData, templateId: generalDocumentId, template: templateTree } } : {})}
        />
      )}
    </>
  );

  return (
    <div className="ts-terms-focus">
      {generalDocumentId ? (
        // 템플릿이 바뀌면 초안을 새로 — 옛 템플릿의 노드 id 가 남지 않게
        <GeneralEditProvider
          key={generalDocumentId}
          productId={productId}
          generalDocumentId={generalDocumentId}
          {...(templateVersion !== undefined ? { templateVersion } : {})}
          hiddenArticles={hiddenArticles}
          overrides={overrides}
          copies={articleCopies}
        >
          {body}
        </GeneralEditProvider>
      ) : (
        body
      )}
    </div>
  );
}
