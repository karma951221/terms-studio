import type { ReactNode } from "react";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { AttributeKind, BaseContractCheck, ProductCoverage, ProductPlan } from "@/domain/product";
import type { Id, Result } from "@/domain/types";

import { CoverageMountSection, MOUNT_QUERY_KEYS } from "./CoverageMountSection";

export interface CoveragesTabProps {
  productId: Id;
  /** 기본계약 절의 상품담보 — 탑재 표 · 탑재 폼. */
  baseCoverages: ProductCoverage[];
  /** 특약 절의 상품담보. */
  specialCoverages: ProductCoverage[];
  /** 담보 마스터 — 담보코드 · 담보명 · 특약 그룹 이름(그 담보의 「특약 그룹」 값, ADR-0080). */
  coverages: { id: Id; code?: string; name: string; group?: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 절마다의 「담보 검색」 · 페이지 (`MOUNT_QUERY_KEYS`). */
  mountSearch: Record<"base" | "special", { query?: string; page?: string }>;
  wouldBeName: (pc: ProductCoverage) => string;
  baseCheck: Result<BaseContractCheck[]>;
  /** 독립특약 상품 — 기본계약 표에 얹지 못한다 (계약형태 E0007 · 기능/상품 §3.1 · §4.5). */
  standalone?: boolean;
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 상품담보 탭 — 무엇을 얹는가 (기능/상품 §4.5, 2026-09-28 「안 2」): 기본계약 표 · 특별약관 표.
 * 특약 그룹은 담보 마스터의 것이라 여기서 고르지 않는다 — 특별약관 표의 「그룹」 열이 읽기 전용으로 보인다 (ADR-0080).
 * 기본계약 표에 얹은 것이 곧 기본계약이다 — 따로 지정하는 절은 없다 (2026-10-01). 독립특약 상품은 기본계약 표의 탑재가 막힌다 (§3.1).
 * 조작은 전부 즉시 저장 명령이다(탑재/해제 · 이름 · 세목 부착). 문면 미리보기는 특별약관 탭에 있다.
 */
export function CoveragesTab({ productId, baseCoverages, specialCoverages, coverages, attributeKinds, plans, mountSearch, wouldBeName, baseCheck, standalone = false, confirm, confirmNode }: CoveragesTabProps) {
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

    </>
  );
}
