import Link from "next/link";
import type { ReactNode } from "react";

import { IconButton, IconCheck, IconClose, IconPlus, IconTrash } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { SpecialPreview } from "@/domain/assembly";
import type { AttributeKind, ProductCoverage, ProductPlan } from "@/domain/product";
import type { Id, Result } from "@/domain/types";
import type { SpecialGroupView } from "@/services/product";

import { createGroupAction, placeInGroupAction, removeFromGroupAction, renameGroupAction } from "../../actions";
import { articleCount, specialPreviewPath } from "../../lib";
import { CoverageMountSection } from "./CoverageMountSection";

export interface SpecialTabProps {
  productId: Id;
  /** 특약 절의 상품담보 — 탑재 표 · 탑재 폼. */
  specialCoverages: ProductCoverage[];
  coverages: { id: Id; name: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  coverageName: Map<Id, string>;
  wouldBeName: (pc: ProductCoverage) => string;
  groups: SpecialGroupView[];
  unplaced: ProductCoverage[];
  /** `?pc=` 로 고른 특약 상품담보 — 없거나 이 절의 것이 아니면 undefined (URL 의 좌표를 믿지 않는다). */
  selected: ProductCoverage | undefined;
  /** 고른 상품담보의 조립 결과 — 고른 것이 없으면 undefined. */
  preview: Result<SpecialPreview> | undefined;
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 특별약관 탭 — 특약을 얹는다 (기능/상품 §4 「특별약관」): 특약 상품담보 · 특약 그룹 · 미배치 · 고른 상품담보의 미리보기.
 *
 * 미리보기는 탑재 표의 「미리보기」가 고른 한 건이다 (`?tab=special&pc=…`) — **보통약관 + 준용까지 계산된** 문면.
 */
export function SpecialTab({ productId, specialCoverages, coverages, attributeKinds, plans, coverageName, wouldBeName, groups, unplaced, selected, preview, confirm, confirmNode }: SpecialTabProps) {
  const errorCount = preview?.ok ? preview.value.issues.filter((i) => i.severity !== "warning").length : 0;

  return (
    <>
      <CoverageMountSection
        productId={productId}
        section="special"
        items={specialCoverages}
        coverages={coverages}
        attributeKinds={attributeKinds}
        plans={plans}
        coverageName={coverageName}
        wouldBeName={wouldBeName}
        previewPath={(pcId) => specialPreviewPath(productId, pcId)}
        selectedId={selected?.id}
        confirm={confirm}
        confirmNode={confirmNode}
      />

      <section className="ts-section">
        <h2 className="ts-section-title">
          특약 그룹 <span className="ts-count">{groups.length}개</span>
        </h2>
        {groups.map((g) => (
          <div key={g.id} className="ts-panel">
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <form action={renameGroupAction.bind(null, productId, g.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input type="text" name="title" defaultValue={g.title} />
                <IconButton type="submit" label={`그룹 이름 저장 · ${g.title}`} icon={<IconCheck />} />
              </form>
              <Link
                href={`?tab=special&confirm=group:${g.id}`}
                className="ts-iconbtn danger"
                title={`그룹 삭제 · ${g.title} (상품담보 ${g.members.length}건 미배치로)`}
                aria-label={`그룹 삭제 · ${g.title}`}
              >
                <IconTrash />
              </Link>
            </div>
            {confirm === `group:${g.id}` && confirmNode}
            <ul>
              {g.members.map((m) => (
                <li key={m.id}>
                  {m.name}{" "}
                  <form action={removeFromGroupAction.bind(null, productId, m.id)} style={{ display: "inline" }}>
                    <IconButton type="submit" danger label={`배치 해제 · ${m.name} 를 ${g.title} 에서`} icon={<IconClose />} />
                  </form>
                </li>
              ))}
              {g.members.length === 0 && <li className="ts-muted">배치된 상품담보 없음</li>}
            </ul>
            <form action={placeInGroupAction.bind(null, productId, g.id)} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select name="productCoverageId">
                {unplaced.map((pc) => (
                  <option key={pc.id} value={pc.id}>
                    {pc.name}
                  </option>
                ))}
              </select>
              <IconButton type="submit" label={`배치 · ${g.title} 에`} icon={<IconPlus />} disabled={unplaced.length === 0} />
            </form>
          </div>
        ))}
        <form action={createGroupAction.bind(null, productId)} className="ts-form">
          <label className="ts-field">
            <span>새 그룹 제목</span>
            <input type="text" name="title" required />
          </label>
          <div className="ts-form-actions">
            <button type="submit">그룹 추가</button>
          </div>
        </form>
        <p className="ts-muted">미배치 상품담보: {unplaced.map((p) => p.name).join(", ") || "없음"}</p>
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          미리보기{selected ? ` — ${selected.name}` : ""}{" "}
          {preview?.ok && (
            <span className="ts-count">
              보통약관 + 준용 계산 결과 · 오류 <b>{errorCount}</b> / 조 {articleCount(preview.value.doc)}
            </span>
          )}
        </h2>
        {preview?.ok && (
          <p className="ts-form-hint ts-dim">
            별표 번호는 이 특약만의 임시 번호 — 책자 번호는{" "}
            <Link href={`/products/${productId}/preview`}>조립 미리보기</Link>
          </p>
        )}
        {!preview ? (
          <p className="ts-muted">표에서 상품담보를 골라 미리보기</p>
        ) : preview.ok ? (
          <>
            <IssueList issues={preview.value.issues} />
            <RenderedDoc doc={preview.value.doc} />
          </>
        ) : (
          <p className="ts-muted">미리볼 수 없다 — {rejectionMessage(preview)}</p>
        )}
      </section>
    </>
  );
}
