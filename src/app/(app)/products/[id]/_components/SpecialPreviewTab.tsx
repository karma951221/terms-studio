import Link from "next/link";

import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { SpecialPreview } from "@/domain/assembly";
import type { EnumDef } from "@/domain/catalog";
import type { Clause } from "@/domain/clause";
import { clauseSpanBy, numberTree, referenceTargetIndex, type Box, type DocumentNode } from "@/domain/document";
import type { ProductCoverage } from "@/domain/product";
import type { Id, Result } from "@/domain/types";

import { articleCount, generalSections, specialCoveragePath, type SpecialCoverageGroup } from "../../lib";
import { SpecialCoveragePanes, type SpecialCoveragePane } from "./SpecialCoveragePanes";
import { TemplateSource } from "./TemplateSource";

export interface SpecialPreviewTabProps {
  productId: Id;
  /** 특약 상품담보를 담보 마스터별로 묶은 것 — 왼쪽 목록 (`specialCoverageGroups`). */
  groups: readonly SpecialCoverageGroup[];
  /** 고른 담보 · 상품담보 (`resolveSpecialSelection` — 특약 절에 있는 좌표만 믿는다). 0건이면 undefined. */
  selected: { group: SpecialCoverageGroup; pc: ProductCoverage } | undefined;
  /** 고른 담보의 담보약관 템플릿 — 없으면 undefined (가운데에 한 줄 안내). */
  template: { id: Id; tree: DocumentNode } | undefined;
  /** 고른 담보의 상품담보마다 조립 결과 (상품담보 id 키) — 서버가 다 그려 두고 선택기가 바꿔 붙인다. */
  previews: ReadonlyMap<Id, Result<SpecialPreview>>;
  /** 함수조항 정의 — 원문 모델의 상자 · 번호(clauseSpan). */
  clauses: readonly Clause[];
  appendices: readonly { code: string; name: string }[];
  boxes: readonly Box[];
  enums?: readonly EnumDef[];
  discriminators: readonly { code: string; label: string }[];
}

/** 오른쪽 패널 한 건 — 머리 「오류 e / 조 n」 · 오류 목록 · 문면. */
function PreviewBody({ productId, preview }: { productId: Id; preview: Result<SpecialPreview> | undefined }) {
  if (!preview) return <p className="ts-muted">미리볼 수 없다.</p>;
  if (!preview.ok) return <p className="ts-muted">미리볼 수 없다 — {rejectionMessage(preview)}</p>;
  const errorCount = preview.value.issues.filter((i) => i.severity !== "warning").length;
  return (
    <>
      <p className="ts-count">
        보통약관 + 준용 계산 결과 · 오류 <b>{errorCount}</b> / 조 {articleCount(preview.value.doc)}
      </p>
      <p className="ts-form-hint ts-dim">
        별표 번호는 이 특약만의 임시 번호 — 책자 번호는 <Link href={`/products/${productId}/preview`}>조립 미리보기</Link>
      </p>
      <IssueList issues={preview.value.issues} />
      <RenderedDoc doc={preview.value.doc} />
    </>
  );
}

/**
 * 약관 › 담보별 미리보기 — 담보 단위 세 패널 (기능/상품 §4.7, 2026-10-03 사용자 결정).
 *
 * 왼쪽은 특약 상품담보를 담보 마스터별로 묶은 **담보** 목록(`&cov=` 링크), 가운데는 고른 담보의 **담보약관 템플릿 원문 모델**
 * (읽기 전용 — 고치는 곳은 담보약관 템플릿 화면), 오른쪽은 그 담보의 **상품담보 선택기** + 고른 한 건의 조립 결과
 * (보통약관 + 준용까지 계산). 담보 모델은 상품담보마다 같아 가운데는 그대로 두고 오른쪽만 바꾼다 — 서버 왕복 없음.
 */
export function SpecialPreviewTab({ productId, groups, selected, template, previews, clauses, appendices, boxes, enums, discriminators }: SpecialPreviewTabProps) {
  if (groups.length === 0 || !selected) {
    return (
      <div className="ts-terms-focus">
        <p className="ts-muted">특약 상품담보가 없다 — 상품담보 탭에서 탑재한다.</p>
      </div>
    );
  }
  const { group } = selected;

  // 가운데 — 원문 모델 번호는 함수조항이 펼칠 항 · 호 · 목 수만큼 센다(보통약관 작성과 같은 규칙)
  const tree = template?.tree;
  const numbers = tree ? numberTree(tree, { clauseSpan: clauseSpanBy((code) => clauses.find((c) => c.code === code)) }) : new Map();
  const references = tree ? referenceTargetIndex(tree, numbers) : new Map();
  const nodes = tree ? generalSections(tree).flatMap((s) => s.nodes) : [];

  const panes: SpecialCoveragePane[] = group.productCoverages.map((pc) => ({
    id: pc.id,
    name: pc.name,
    body: <PreviewBody productId={productId} preview={previews.get(pc.id)} />,
  }));

  return (
    <div className="ts-terms-focus ts-special-preview">
      <div className="ts-terms-panels">
        <nav className="ts-terms-panel ts-special-list" aria-label="담보">
          <div className="ts-terms-panel-head">
            <h3 className="ts-terms-panel-title">담보</h3>
          </div>
          <ul>
            {groups.map((g) => (
              <li key={g.coverageId}>
                <Link href={specialCoveragePath(productId, g.coverageId)} aria-current={g.coverageId === group.coverageId ? "page" : undefined}>
                  {g.name}
                  {g.productCoverages.length > 1 && (
                    <>
                      {" "}
                      <span className="ts-count">{g.productCoverages.length}</span>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className="ts-terms-panel" aria-label="모델링">
          <div className="ts-terms-panel-head">
            <h3 className="ts-terms-panel-title">모델링 — {group.name}</h3>
          </div>
          {template ? (
            <TemplateSource
              productId={productId}
              nodes={nodes}
              numbers={numbers}
              hidden={new Set()}
              references={references}
              clauses={clauses}
              overrides={[]}
              overrideTargets={[]}
              appendices={appendices}
              boxes={boxes}
              {...(enums ? { enums } : {})}
              discriminators={discriminators}
              readOnly
            />
          ) : (
            <p className="ts-muted">이 담보에는 담보약관 템플릿이 없다 — 담보 화면에서 만든다.</p>
          )}
        </section>
        <SpecialCoveragePanes productId={productId} panes={panes} initialId={selected.pc.id} />
      </div>
    </div>
  );
}
