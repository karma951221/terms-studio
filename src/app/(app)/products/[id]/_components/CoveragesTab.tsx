import Link from "next/link";
import type { ReactNode } from "react";

import { Combobox } from "@/app/_components/Combobox";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IconButton, IconCheck, IconClose, IconPlus, IconTrash } from "@/app/_components/icons";
import { IssueList } from "@/app/_components/IssueList";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { AttributeKind, BaseContractCheck, ProductCoverage, ProductPlan } from "@/domain/product";
import type { Id, Result } from "@/domain/types";
import type { SpecialGroupView } from "@/services/product";

import { createGroupAction, placeInGroupAction, removeFromGroupAction, renameGroupAction } from "../../actions";
import { CoverageMountSection, MOUNT_QUERY_KEYS } from "./CoverageMountSection";

export interface CoveragesTabProps {
  productId: Id;
  /** 기본계약 절의 상품담보 — 탑재 표 · 탑재 폼. */
  baseCoverages: ProductCoverage[];
  /** 특약 절의 상품담보. */
  specialCoverages: ProductCoverage[];
  coverages: { id: Id; code?: string; name: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 절마다의 「담보 검색」 · 페이지 (`MOUNT_QUERY_KEYS`). */
  mountSearch: Record<"base" | "special", { query?: string; page?: string }>;
  wouldBeName: (pc: ProductCoverage) => string;
  baseCheck: Result<BaseContractCheck[]>;
  /** 독립특약 상품 — 기본계약 표에 얹지 못한다 (계약형태 E0007 · 기능/상품 §3.1 · §4.5). */
  standalone?: boolean;
  groups: SpecialGroupView[];
  unplaced: ProductCoverage[];
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 상품담보 탭 — 무엇을 얹는가 (기능/상품 §4.5, 2026-09-28 「안 2」): 기본계약 표 · 특별약관 표 · 특약 그룹.
 * 기본계약 표에 얹은 것이 곧 기본계약이다 — 따로 지정하는 절은 없다 (2026-10-01). 독립특약 상품은 기본계약 표의 탑재가 막힌다 (§3.1).
 * 조작은 전부 즉시 저장 명령이다(탑재/해제 · 이름 · 세목 부착 · 기본계약 지정 · 그룹). 문면 미리보기는 특별약관 탭에 있다.
 */
export function CoveragesTab({ productId, baseCoverages, specialCoverages, coverages, attributeKinds, plans, mountSearch, wouldBeName, baseCheck, standalone = false, groups, unplaced, confirm, confirmNode }: CoveragesTabProps) {
  // 한 절의 페이저를 넘겨도 다른 절 검색이 풀리지 않게 — 서로의 검색 쿼리를 싣는다
  const keep = (other: "base" | "special") => ({ [MOUNT_QUERY_KEYS[other].query]: mountSearch[other].query || undefined });
  return (
    <>
      {/* 오류 좌표(refPath baseContract)의 「고치러 가기」가 `#base-contract` 로 여기에 닿는다 (coordinateHref). 기본계약 검사 결과도 표 위에 */}
      <div id="base-contract">
        {!baseCheck.ok && <ErrorBanner message={rejectionMessage(baseCheck)} />}
        {baseCheck.ok && <IssueList issues={baseCheck.value.flatMap((chk) => chk.issues)} />}
      </div>
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
        mountBlockedHint={
          standalone ? "독립특약 상품은 기본계약을 두지 않습니다" : baseCoverages.length > 0 ? "변경하려면 먼저 해제하세요 — 기본계약은 하나만 지정할 수 있다 (MVP)" : undefined
        }
        confirm={confirm}
        confirmNode={confirmNode}
      />

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
