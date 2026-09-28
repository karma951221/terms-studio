import Link from "next/link";
import type { ReactNode } from "react";

import { Combobox } from "@/app/_components/Combobox";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconButton, IconCheck, IconClose, IconLink, IconPlus, IconTrash } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { AttributeKind, BaseContractCheck, ProductCoverage, ProductPlan } from "@/domain/product";
import type { Id, Result } from "@/domain/types";
import type { SpecialGroupView } from "@/services/product";

import { createGroupAction, designateBaseContractAction, placeInGroupAction, releaseBaseContractAction, removeFromGroupAction, renameGroupAction } from "../../actions";
import { specialPreviewPath } from "../../lib";
import { CoverageMountSection, MOUNT_QUERY_KEYS } from "./CoverageMountSection";

export interface CoveragesTabProps {
  productId: Id;
  /** 기본계약 절의 상품담보 — 탑재 표 · 탑재 폼. */
  baseCoverages: ProductCoverage[];
  /** 특약 절의 상품담보. */
  specialCoverages: ProductCoverage[];
  /** 기본계약 지정 select 는 상품담보 전부를 고를 수 있다. */
  productCoverages: ProductCoverage[];
  coverages: { id: Id; code?: string; name: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 절마다의 「담보 검색」 · 페이지 (`MOUNT_QUERY_KEYS`). */
  mountSearch: Record<"base" | "special", { query?: string; page?: string }>;
  wouldBeName: (pc: ProductCoverage) => string;
  baseCheck: Result<BaseContractCheck[]>;
  groups: SpecialGroupView[];
  unplaced: ProductCoverage[];
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 상품담보 탭 — 무엇을 얹는가 (기능/상품 §4.5, 2026-09-28 「안 2」): 보통약관 기본계약 표 · 기본계약 지정 · 특별약관 표 · 특약 그룹.
 * 조작은 전부 즉시 저장 명령이다(탑재/해제 · 이름 · 세목 부착 · 기본계약 지정 · 그룹). 문면 미리보기는 약관 탭에 있다 —
 * 특약 행의 「미리보기」가 약관 › 담보별 미리보기로 간다.
 */
export function CoveragesTab({ productId, baseCoverages, specialCoverages, productCoverages, coverages, attributeKinds, plans, mountSearch, wouldBeName, baseCheck, groups, unplaced, confirm, confirmNode }: CoveragesTabProps) {
  // 한 절의 페이저를 넘겨도 다른 절 검색이 풀리지 않게 — 서로의 검색 쿼리를 싣는다
  const keep = (other: "base" | "special") => ({ [MOUNT_QUERY_KEYS[other].query]: mountSearch[other].query || undefined });
  return (
    <>
      <CoverageMountSection
        productId={productId}
        section="base"
        items={baseCoverages}
        coverages={coverages}
        attributeKinds={attributeKinds}
        plans={plans}
        query={mountSearch.base.query}
        page={mountSearch.base.page}
        keepQuery={keep("special")}
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
              <Combobox name="productCoverageId" required placeholder="상품담보 이름으로 찾기" options={productCoverages.map((pc) => ({ value: pc.id, label: pc.name }))} />
            </label>
            <div className="ts-form-actions">
              <button type="submit">기본계약 지정</button>
            </div>
          </form>
        )}
      </section>

      <CoverageMountSection
        productId={productId}
        section="special"
        items={specialCoverages}
        coverages={coverages}
        attributeKinds={attributeKinds}
        plans={plans}
        query={mountSearch.special.query}
        page={mountSearch.special.page}
        keepQuery={keep("base")}
        wouldBeName={wouldBeName}
        previewPath={(pcId) => specialPreviewPath(productId, pcId)}
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
                href={`?tab=coverages&confirm=group:${g.id}`}
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
              <Combobox
                name="productCoverageId"
                required
                ariaLabel={`배치할 상품담보 · ${g.title}`}
                placeholder={unplaced.length === 0 ? "미배치 상품담보 없음" : "미배치 상품담보 찾기"}
                disabled={unplaced.length === 0}
                options={unplaced.map((pc) => ({ value: pc.id, label: pc.name }))}
              />
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
    </>
  );
}
