"use client";

/**
 * 상품담보 탭 — 무엇을 얹는가 (기능/상품 §3.8 · §4.5): 기본계약 표 · 특별약관 표. 기본계약 표에 얹은 것이 곧 기본계약이다.
 *
 * **읽기 / 편집 · 저장 하나** (2026-10-04 사용자 결정) — 읽기로 열고, 탭 첫 줄 오른쪽 `편집`(기본정보 · 보통약관 탭과 같은 `ProductEditButtons`)을
 * 누르면 표 안에서 상품담보명 · 세목 부착/해제 · 🗑 탑재 해제 · 표 아래 「+ 담보 추가」를 초안(`coveragesDraft`)에 쌓는다. `저장` 한 번이
 * `saveProductCoveragesAction` → 서비스 `saveCoverages` 한 트랜잭션. 잃는 것(탑재 해제 · 세목 부착 해제)이 있으면 저장 확인 모달(`SaveConfirmDialog`)을
 * 거친다 — 관리자만, 편집자의 저장은 그 행에서 거부된다. 저장 거부는 그 행 아래에 붙는다. 떠나기 확인은 `ProductEditProvider` 가 한다.
 * 표들 아래 「특약 그룹」 섹션(ADR-0090 · §3.7) — 기본 그룹(담보분류)과 사용자 그룹의 목록 · 순서 · 소속도 같은 초안 · 같은 저장이다.
 * 특별약관 표의 「그룹」 열은 읽기 전용으로 그 초안을 따른다.
 */
import { useEffect, useMemo, useReducer, useState } from "react";

import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { IssueList } from "@/app/_components/IssueList";
import { rejectionMessage } from "@/app/_lib/rejection";
import { NO_PRODUCT_GROUPS, type AttributeKind, type BaseContractCheck, type ProductCoverage, type ProductGroupSetting, type ProductPlan } from "@/domain/product";
import type { Id, Impact, Result } from "@/domain/types";

import { saveProductCoveragesAction } from "../../actions";
import { CoverageMountSection, MOUNT_QUERY_KEYS, type CoverageRef, type GroupCellLabel } from "./CoverageMountSection";
import { coveragesDraftDirty, coveragesDraftReducer, groupOfCoverage, initCoveragesDraft, issuesByRow, toCoveragesInput, type CoveragesDraft, type GroupContext } from "./coveragesDraft";
import { groupTitle, SpecialGroupsSection, type CategoryInfo } from "./SpecialGroupsSection";
import { ProductEditButtons, useProductEdit } from "./ProductEdit";
import { SaveConfirmDialog } from "./SaveConfirmDialog";

export interface CoveragesTabProps {
  productId: Id;
  /** 기본계약 절의 상품담보. */
  baseCoverages: ProductCoverage[];
  /** 특약 절의 상품담보. */
  specialCoverages: ProductCoverage[];
  /** 담보 마스터 — 담보코드 · 담보명 · 담보분류(기본 특약 그룹의 재료, ADR-0090). */
  coverages: CoverageRef[];
  /** 열거형 「담보분류」의 값 — 순서 = 기본 그룹 순서, 「그룹 제목」 필드 = 기본 그룹 제목 (ADR-0090). */
  categories?: CategoryInfo[];
  /** 이 상품의 특약 그룹 설정(저장본) — 그룹 목록 · 사용자 그룹 소속. */
  groups?: ProductGroupSetting;
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
const NO_CATEGORIES: CategoryInfo[] = [];

/** 특별약관 표 「그룹」 칸 — 사용자 그룹 이름 / 기본 그룹 제목(tooltip 「기본 — 담보분류 상해」) / 지운 담보분류 「없는 값 V03」 / 미입력 「—」. */
export function groupCellLabel(draft: CoveragesDraft, ctx: GroupContext, categories: readonly CategoryInfo[], coverageId: Id): GroupCellLabel {
  const group = groupOfCoverage(draft, ctx, coverageId);
  if (group?.kind === "user") return { text: groupTitle(group, categories) ?? "(이름 없음)", tip: "사용자 그룹 — 아래 「특약 그룹」 섹션에서 바꾼다" };
  if (group) {
    const category = categories.find((c) => c.code === group.code);
    return { text: category?.title ?? "(그룹 제목 없음)", tip: `기본 — 담보분류 ${category?.label ?? group.code}` };
  }
  const code = ctx.categoryOf(coverageId);
  if (code !== undefined) return { text: `없는 값 ${code}`, tip: "열거형 「담보분류」에서 지워진 값 — 담보 화면에서 다른 값을 고른다" };
  return { tip: "담보분류 미입력 — 담보 화면에서 고른다" };
}

export function CoveragesTab(props: CoveragesTabProps) {
  const { productId, baseCoverages, specialCoverages, coverages, categories = NO_CATEGORIES, groups = NO_PRODUCT_GROUPS, attributeKinds, plans, attachedPlans, namingTemplate, suggestedNames, mountSearch, baseCheck, standalone = false, initialAddOpen } = props;
  const { editing, pending, register, save: requestSave } = useProductEdit();
  const saved = useMemo(() => initCoveragesDraft(baseCoverages, specialCoverages, attachedPlans, groups), [baseCoverages, specialCoverages, attachedPlans, groups]);
  const coverageById = useMemo(() => new Map(coverages.map((c) => [c.id, c])), [coverages]);
  const ctx: GroupContext = useMemo(() => ({ categoryOf: (id) => coverageById.get(id)?.category, categoryOrder: categories.map((c) => c.code) }), [coverageById, categories]);
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
    const input = toCoveragesInput(saved, draft, ctx);
    if (!input.added.length && !input.updated.length && !input.removed.length && !input.groups) {
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
    register({ begin, cancel: clear, save, dirty: () => coveragesDraftDirty(saved, draft, ctx) });
    return () => register(null);
  });

  // 한 절의 페이저를 넘겨도 다른 절 검색이 풀리지 않게 — 서로의 검색 쿼리를 싣는다
  const keep = (other: "base" | "special") => ({ [MOUNT_QUERY_KEYS[other].query]: mountSearch[other].query || undefined });
  const edit = editing ? { draft, saved, dispatch, errors, namingTemplate, standalone } : undefined;
  // 특별약관 표의 「그룹」 열 — 편집 중이면 초안, 읽기면 저장본을 따른다(읽기 전용 · 바꾸는 곳은 「특약 그룹」 섹션)
  const current: CoveragesDraft = editing ? draft : saved;
  const groupLabel = (coverageId: Id): GroupCellLabel => groupCellLabel(current, ctx, categories, coverageId);
  const common = { productId, coverages, attributeKinds, plans, attachedPlans, suggestedNames, groupLabel };
  const coverageName = (id: Id) => coverageById.get(id)?.name ?? draft.rows.find((r) => r.coverageId === id)?.coverageName ?? id;
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
        <SpecialGroupsSection draft={current} ctx={ctx} categories={categories} coverageName={coverageName} errors={errors} {...(editing ? { edit: { dispatch } } : {})} />
      </fieldset>
    </div>
  );
}
