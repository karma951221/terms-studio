"use client";

/**
 * 상품담보 탭 — 무엇을 얹는가 (기능/상품 §3.8 · §4.5): 기본계약 표 · 특별약관 표. 기본계약 표에 얹은 것이 곧 기본계약이다.
 *
 * **읽기 / 편집 · 저장 하나** (2026-10-04 사용자 결정) — 읽기로 열고, 탭 첫 줄 오른쪽 `편집`(기본정보 · 보통약관 탭과 같은 `ProductEditButtons`)을
 * 누르면 표 안에서 상품담보명 · 세목 부착/해제 · 🗑 탑재 해제 · 표 아래 「+ 담보 추가」를 초안(`coveragesDraft`)에 쌓는다. `저장` 한 번이
 * `saveProductCoveragesAction` → 서비스 `saveCoverages` 한 트랜잭션. 잃는 것(탑재 해제 · 세목 부착 해제)이 있으면 저장 확인 모달(`SaveConfirmDialog`)을
 * 거친다 — 관리자만, 편집자의 저장은 그 행에서 거부된다. 저장 거부는 그 행 아래에 붙는다. 떠나기 확인은 `ProductEditProvider` 가 한다.
 * 특약 그룹은 담보 마스터의 것이라 여기서 고르지 않는다 — 특별약관 표의 「그룹」 열이 읽기 전용으로 보인다 (ADR-0080).
 */
import { useEffect, useMemo, useReducer, useState } from "react";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { rejectionMessage } from "@/app/_lib/rejection";
import type { AttributeKind, BaseContractCheck, ProductCoverage, ProductPlan } from "@/domain/product";
import type { Id, Impact, Result } from "@/domain/types";

import { saveProductCoveragesAction } from "../../actions";
import { CoverageMountSection, MOUNT_QUERY_KEYS, type CoverageRef } from "./CoverageMountSection";
import { coveragesDraftDirty, coveragesDraftReducer, initCoveragesDraft, issuesByRow, toCoveragesInput } from "./coveragesDraft";
import { ProductEditButtons, useProductEdit } from "./ProductEdit";
import { SaveConfirmDialog } from "./SaveConfirmDialog";

export interface CoveragesTabProps {
  productId: Id;
  /** 기본계약 절의 상품담보. */
  baseCoverages: ProductCoverage[];
  /** 특약 절의 상품담보. */
  specialCoverages: ProductCoverage[];
  /** 담보 마스터 — 담보코드 · 담보명 · 특약 그룹 이름(그 담보의 「특약 그룹」 값, ADR-0080). */
  coverages: CoverageRef[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 상품담보 id → 부착한 종·형 조합 id. */
  attachedPlans: Record<Id, Id[]>;
  /** 작명 틀 — 더한 행의 상품담보명을 짓는다(서버의 탑재와 같은 규칙). */
  namingTemplate: string;
  /** 저장된 상품담보마다 작명 규칙이 지금 지어 줄 이름. */
  suggestedNames: Record<Id, string>;
  /** 절마다의 「담보 검색」 · 페이지 (`MOUNT_QUERY_KEYS`) — 읽기에만. */
  mountSearch: Record<"base" | "special", { query?: string; page?: string }>;
  baseCheck: Result<BaseContractCheck[]>;
  /** 독립특약 상품 — 기본계약 표에 더하지 못한다 (계약형태 E0007 · 기능/상품 §3.1 · §4.5). */
  standalone?: boolean;
  /** 처음부터 그 절의 「+ 담보 추가」 줄을 펼쳐 둔다 — 렌더 검사용. */
  initialAddOpen?: "base" | "special";
}

const NO_ERRORS: ReadonlyMap<string, string[]> = new Map();

export function CoveragesTab(props: CoveragesTabProps) {
  const { productId, baseCoverages, specialCoverages, coverages, attributeKinds, plans, attachedPlans, namingTemplate, suggestedNames, mountSearch, baseCheck, standalone = false, initialAddOpen } = props;
  const { editing, pending, register, save: requestSave } = useProductEdit();
  const saved = useMemo(() => initCoveragesDraft(baseCoverages, specialCoverages, attachedPlans), [baseCoverages, specialCoverages, attachedPlans]);
  const [draft, dispatch] = useReducer(coveragesDraftReducer, saved);
  const [errors, setErrors] = useState(NO_ERRORS);
  const [message, setMessage] = useState<string>();
  const [confirmation, setConfirmation] = useState<Impact>();

  const clear = () => {
    setErrors(NO_ERRORS);
    setMessage(undefined);
    setConfirmation(undefined);
  };
  const begin = () => {
    dispatch({ type: "reset", draft: saved });
    clear();
  };
  const save = async (confirmed: boolean): Promise<"done" | "stay"> => {
    const input = toCoveragesInput(saved, draft);
    if (!input.added.length && !input.updated.length && !input.removed.length) {
      clear();
      return "done";
    }
    try {
      const outcome = await saveProductCoveragesAction(productId, input, confirmed);
      if (outcome.ok === true) {
        clear();
        return "done";
      }
      if (outcome.ok === "confirm") {
        setConfirmation(outcome.impact);
        setMessage(undefined);
        return "stay";
      }
      const byRow = issuesByRow(outcome.issues);
      setErrors(byRow.rows);
      setMessage([outcome.message, ...byRow.other].join(" "));
      setConfirmation(undefined);
      return "stay";
    } catch {
      setMessage("저장하지 못했습니다. 고친 내용은 유지됩니다. 다시 시도해 주세요.");
      return "stay";
    }
  };
  // 매 렌더 등록 — 손잡이가 최신 초안을 닫아 두도록 (BasicTab · GeneralEdit 과 같은 방식)
  useEffect(() => {
    register({ begin, cancel: clear, save, dirty: () => coveragesDraftDirty(saved, draft) });
    return () => register(null);
  });

  // 한 절의 페이저를 넘겨도 다른 절 검색이 풀리지 않게 — 서로의 검색 쿼리를 싣는다
  const keep = (other: "base" | "special") => ({ [MOUNT_QUERY_KEYS[other].query]: mountSearch[other].query || undefined });
  const edit = editing ? { draft, saved, dispatch, errors, namingTemplate, standalone } : undefined;
  const common = { productId, coverages, attributeKinds, plans, attachedPlans, suggestedNames };
  return (
    <div className="ts-coverages-tab">
      {/* 탭 첫 줄 — 편집 · 저장은 이 탭에 걸린다는 것이 보이도록 탭 안 오른쪽 끝 (2026-10-03 사용자 QA) */}
      <div className="ts-tab-head">
        <ProductEditButtons />
      </div>
      {editing && message && (
        <p role="alert" className="ts-error-banner">
          {message}
        </p>
      )}
      {/* 잃는 것이 있으면 화면 위쪽 모달 하나로 묻는다 — 탑재 해제(세부보장 · 급부 · 세목 부착 · 값 행) · 세목 부착 해제 */}
      {editing && confirmation && <SaveConfirmDialog impact={confirmation} pending={pending} onCancel={() => setConfirmation(undefined)} onConfirm={() => requestSave(true)} />}
      {/* 오류 좌표(refPath baseContract)의 「고치러 가기」가 `#base-contract` 로 여기에 닿는다 (coordinateHref). 기본계약 검사 결과도 표 위에 */}
      <div id="base-contract">
        {!baseCheck.ok && <ErrorBanner message={rejectionMessage(baseCheck)} />}
        {baseCheck.ok && <IssueList issues={baseCheck.value.flatMap((chk) => chk.issues)} />}
      </div>
      <fieldset className="ts-coverages-body" disabled={pending || !!confirmation} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <CoverageMountSection
          {...common}
          section="base"
          items={baseCoverages}
          query={mountSearch.base.query}
          page={mountSearch.base.page}
          keepQuery={keep("special")}
          {...(edit ? { edit } : {})}
          initialAddOpen={initialAddOpen === "base"}
        />
        <CoverageMountSection
          {...common}
          section="special"
          items={specialCoverages}
          query={mountSearch.special.query}
          page={mountSearch.special.page}
          keepQuery={keep("base")}
          {...(edit ? { edit } : {})}
          initialAddOpen={initialAddOpen === "special"}
        />
      </fieldset>
    </div>
  );
}
