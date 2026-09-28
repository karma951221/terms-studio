import Link from "next/link";

import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { SpecialPreview } from "@/domain/assembly";
import type { ProductCoverage } from "@/domain/product";
import type { Id, Result } from "@/domain/types";

import { articleCount, specialPreviewPath } from "../../lib";

export interface SpecialPreviewTabProps {
  productId: Id;
  /** 특약 절의 상품담보 — 왼쪽 목록. */
  specialCoverages: ProductCoverage[];
  /** `?pc=` 로 고른 특약 상품담보 — 없거나 이 절의 것이 아니면 undefined (URL 의 좌표를 믿지 않는다). */
  selected: ProductCoverage | undefined;
  /** 고른 상품담보의 조립 결과 — 고른 것이 없으면 undefined. */
  preview: Result<SpecialPreview> | undefined;
}

/**
 * 약관 › 담보별 미리보기 — 탑재한 특약 상품담보마다 **보통약관 + 준용까지 계산된** 특별약관 한 벌 (기능/상품 §4.7).
 * 왼쪽은 상품담보 목록(`?pc=` 링크), 오른쪽은 고른 한 건의 문면 · 오류. 고치는 곳은 상품담보 탭 · 담보 · 문면이다.
 */
export function SpecialPreviewTab({ productId, specialCoverages, selected, preview }: SpecialPreviewTabProps) {
  const errorCount = preview?.ok ? preview.value.issues.filter((i) => i.severity !== "warning").length : 0;
  return (
    <div className="ts-terms-focus ts-special-preview">
      <nav className="ts-terms-panel ts-special-list" aria-label="특약 상품담보">
        <h3 className="ts-terms-panel-title">특별약관 {specialCoverages.length}</h3>
        {specialCoverages.length === 0 ? (
          <p className="ts-muted">특약 상품담보가 없다 — 상품담보 탭에서 탑재한다.</p>
        ) : (
          <ul>
            {specialCoverages.map((pc) => (
              <li key={pc.id}>
                <Link href={specialPreviewPath(productId, pc.id)} aria-current={pc.id === selected?.id ? "page" : undefined}>
                  {pc.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section className="ts-terms-panel" aria-label="담보별 미리보기">
        <h3 className="ts-terms-panel-title">
          미리보기{selected ? ` — ${selected.name}` : ""}{" "}
          {preview?.ok && (
            <span className="ts-count">
              보통약관 + 준용 계산 결과 · 오류 <b>{errorCount}</b> / 조 {articleCount(preview.value.doc)}
            </span>
          )}
        </h3>
        {preview?.ok && (
          <p className="ts-form-hint ts-dim">
            별표 번호는 이 특약만의 임시 번호 — 책자 번호는 <Link href={`/products/${productId}/preview`}>조립 미리보기</Link>
          </p>
        )}
        {!preview ? (
          <p className="ts-muted">왼쪽에서 상품담보를 골라 미리보기</p>
        ) : preview.ok ? (
          <>
            <IssueList issues={preview.value.issues} />
            <RenderedDoc doc={preview.value.doc} />
          </>
        ) : (
          <p className="ts-muted">미리볼 수 없다 — {rejectionMessage(preview)}</p>
        )}
      </section>
    </div>
  );
}
