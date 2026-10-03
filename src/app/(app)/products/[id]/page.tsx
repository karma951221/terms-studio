import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { Confirm } from "@/app/_components/Confirm";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { previewOutcome, rejectionMessage } from "@/app/_lib/rejection";
import { articleRefLabel, type NodeNumber } from "@/domain/document";
import type { Id } from "@/domain/types";
import { CONTRACT_KIND_PATH, findForm, isStandaloneContract } from "@/domain/master";
import { defaultCoverageName, planOptionLabel, planTypeOptions, type ProductCoverage } from "@/domain/product";
import { buildForm } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { BasicTab } from "./_components/BasicTab";
import { CoveragesTab } from "./_components/CoveragesTab";
import { GeneralTab } from "./_components/GeneralTab";
import { type OverrideTarget } from "./_components/OptionOverrideForm";
import { ProductEditProvider, ProductHeadActions, ProductPath } from "./_components/ProductEdit";
import { ProductTabs } from "./_components/ProductTabs";
import { SpecialPreviewTab } from "./_components/SpecialPreviewTab";
import { confirmProductGeneralDocumentAction, deleteGroupAction, deleteProductAction, detachPlanAction, removePlanAction, removePlanOptionAction, unmountAction } from "../actions";
import { legacyProductTabRedirect, productDetailPath, productTabOf, resolveSpecialSelection, specialCoverageGroups } from "../lib";

export const dynamic = "force-dynamic";

/**
 * 상품 상세 — 헤더(경로 「상품 › 상품명」 · 편집 · 더보기) + 한 줄 탭 넷 기본정보 · 상품담보 · 보통약관 · 특별약관
 * (기능/상품 §3.8 · §4.3, 2026-10-03). 옛 약관 탭 주소(`?tab=terms&sub=`)는 새 자리로 redirect 한다.
 *
 * 헤더의 편집 · 취소 · 저장은 클라이언트 `ProductEditProvider` 가 기본정보 탭과 나눠 쓴다 — 서버 컴포넌트인
 * 이 파일은 Provider 로 본문을 감싸기만 한다. 목록 이동은 경로의 「상품」 링크 하나, 미리보기 · 삭제는 더보기 안이다.
 *
 * 이 파일은 **로드 · 헤더 · 분기**만 한다. 섹션은 탭 컴포넌트에 있다.
 * 탭은 `?tab=` 이라 서버가 그대로 렌더한다 — 한 번에 한 탭만 그리지만 데이터는 확인 카드 때문에 한 벌로 읽는다.
 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; sub?: string; error?: string; confirm?: string; option?: string; field?: string; art?: string; pc?: string; cov?: string; mq?: string; mpage?: string; bq?: string; bpage?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const legacy = legacyProductTabRedirect(id, sp);
  if (legacy) redirect(legacy);
  const tab = productTabOf(sp.tab);
  const services = getServices();
  const product = await services.product.getProduct(id);
  if (!product) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.product, href: "/products" }, { label: id }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const actor = await currentActor();
  const [generals, enumsList, planOptions, plans, coverages, attributeKinds, productCoverages, baseContractIds, groups, unplaced, overrides, namingTemplate, clauses] =
    await Promise.all([
      services.document.list("general"),
      services.catalog.listEnums(),
      services.product.listPlanOptions(id),
      services.product.listPlans(id),
      services.coverage.list(),
      services.product.listAttributeKinds(),
      services.product.listProductCoverages(id),
      services.product.listBaseContractIds(id),
      services.product.listGroups(id),
      services.product.listUnplaced(id),
      services.product.listOptionOverrides({ kind: "product", id }),
      services.product.getNamingTemplate(),
      services.clause.list(),
    ]);
  const productValues = await services.product.getProductValues(id);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  const productForm = buildForm("product", enumLookup, productValues);
  // 세목 선택지 값 폼 — 선택지마다 **제 세목유형 폼 하나**만 (마스터의 세목 값 노드 규칙 · 기능/마스터 §3.4).
  const planOptionForms = await Promise.all(
    planOptions.map(async (o) => {
      const form = findForm(o.planTypeCode);
      const values = await services.product.getPlanOptionValues(o.id);
      return { option: o, model: buildForm("plan", enumLookup, values, undefined, form ? [form] : []) };
    }),
  );
  // `?option=<선택지 id>&field=<경로>` — 마스터 값 노드 링크의 좌표. 이 상품의 선택지일 때만 믿는다 (아니면 무시).
  const highlightOption = sp.option && planOptions.some((o) => o.id === sp.option) ? sp.option : undefined;
  const productHighlight = highlightOption ? undefined : sp.field;
  const planTypes = planTypeOptions();
  const baseCheck = await services.product.checkBaseContract(id);
  const baseContractSet = new Set(baseContractIds);
  const coverageName = new Map(coverages.map((c) => [c.id, c.name]));
  const baseCoverages = productCoverages.filter((coverage) => baseContractSet.has(coverage.id));
  const specialCoverages = productCoverages.filter((coverage) => !baseContractSet.has(coverage.id));

  /** 작명 규칙이 지금 지어 줄 이름 — 누르기 전에 결과를 보여준다 (리뷰 #27 · §9.3). */
  const wouldBeName = (pc: ProductCoverage) => defaultCoverageName(coverageName.get(pc.coverageId) ?? "", pc.attributes, attributeKinds, namingTemplate);

  // ── 보통약관 탭의 재료 (기능/상품 §4.6) ───────────────────────
  // 템플릿 트리 · 템플릿 번호 · 숨긴 조 · 조립 결과. 그 탭을 열었을 때만 읽는다 — 조립은 매번 재계산이라 싸지 않다.
  const gid = tab === "general" ? product.generalDocumentId : undefined;
  const [generalDoc, generalNumbers, hiddenArticles, bookletResult] = gid
    ? await Promise.all([services.document.get(gid), services.document.numbering(gid), services.product.listHiddenArticles(id), services.assembly.preview(id)])
    : [undefined, new Map<Id, NodeNumber>(), [] as Id[], undefined];
  // 원문 모델의 칩 재료(별표 이름 · 구분자 표시명 · 박스) — 보통약관 · 특별약관 탭 둘 다 원문 모델을 그린다
  const [appendices, discriminators, boxes] =
    gid || tab === "special" ? await Promise.all([services.document.listAppendices(), services.catalog.list(), services.document.listBoxes()]) : [[], [], []];
  const booklet = bookletResult?.ok ? bookletResult.value : undefined;
  const bookletNote = bookletResult && !bookletResult.ok ? `조립할 수 없다 — ${rejectionMessage(bookletResult)}` : undefined;

  // 보통약관 문면의 함수조항 참조 자리(block · inline 둘 다 노드 id 로 오버라이드된다) = 고를 수 있는 자리 (리뷰 #7).
  // 오버라이드는 이제 그 자리의 괘선 박스에서 고친다 — 별도 섹션은 없다 (기능/상품 §3.6).
  const overrideTargets: OverrideTarget[] = [];
  if (gid) {
    const refs = await services.document.refs(gid);
    const clauseByCode = new Map(clauses.map((c) => [c.code, c]));
    for (const ref of refs) {
      if (ref.kind !== "clause") continue;
      const nodeId = ref.at.nodePath?.at(-1);
      if (!nodeId) continue;
      const clause = clauseByCode.get(ref.clauseCode);
      const n = ref.at.articleId ? generalNumbers.get(ref.at.articleId) : undefined;
      const where = n && ref.at.articleTitle ? articleRefLabel(n.n, ref.at.articleTitle) : (ref.at.articleTitle ?? "보통약관");
      overrideTargets.push({
        nodeId,
        clauseCode: ref.clauseCode,
        label: `${where} › 함수조항 ${clause?.label ?? ref.clauseCode}(${ref.clauseCode})`,
        options: (clause?.options ?? []).map((o) => ({ code: o.code, label: o.label, values: o.values.map((v) => ({ code: v.code, label: v.label })) })),
      });
    }
  }

  // ── 특별약관 탭의 재료 (기능/상품 §4.7) ─────────────────────────
  // 특약 상품담보를 담보별로 묶고, `?cov=` · `?pc=` 는 **특약 절**의 것일 때만 믿는다 (`resolveSpecialSelection` — 기본계약 · 없는 id 는 무시).
  // 고른 담보의 담보약관 템플릿(가운데) + 그 담보의 상품담보 **전부**의 조립 결과(오른쪽 선택기가 서버 없이 바꿔 붙인다).
  const specialGroups = tab === "special" ? specialCoverageGroups(specialCoverages, (cid) => coverageName.get(cid)) : [];
  const specialSelected = tab === "special" ? resolveSpecialSelection(specialGroups, { cov: sp.cov, pc: sp.pc }) : undefined;
  const [specialTemplate, specialPreviewList] = specialSelected
    ? await Promise.all([
        services.document.findByCoverage(specialSelected.group.coverageId),
        Promise.all(specialSelected.group.productCoverages.map(async (pc) => [pc.id, await services.assembly.previewSpecial(id, pc.id)] as const)),
      ])
    : [undefined, []];

  let confirmNode: ReactNode = null;
  const c = sp.confirm;
  if (c === "product") {
    const outcome = previewOutcome(await services.product.deleteProduct(actor, id));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={deleteProductAction.bind(null, id)} targetLabel={`상품 ${product.name}`} actionLabel={`${product.name} 삭제`} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("pc:")) {
    const pcId = c.slice(3);
    const pc = productCoverages.find((p) => p.id === pcId);
    const outcome = previewOutcome(await services.product.unmount(actor, pcId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={unmountAction.bind(null, id, "coverages", pcId)} targetLabel={`상품담보 ${pc?.name ?? pcId}`} actionLabel={`${pc?.name ?? "상품담보"} 탑재 해제`} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("planOption:")) {
    const optionId = c.slice(11);
    const option = planOptions.find((o) => o.id === optionId);
    const outcome = previewOutcome(await services.product.removePlanOption(actor, optionId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm
          impact={outcome.impact}
          action={removePlanOptionAction.bind(null, id, optionId)}
          targetLabel={`세목 선택지 ${option ? planOptionLabel(option) : optionId}`}
          actionLabel={`${option ? planOptionLabel(option) : "선택지"} 삭제`}
        />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("plan:")) {
    const planId = c.slice(5);
    const plan = plans.find((p) => p.id === planId);
    const planName = plan ? plan.options.map(planOptionLabel).join(" · ") : planId;
    const outcome = previewOutcome(await services.product.removePlan(actor, planId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={removePlanAction.bind(null, id, planId)} targetLabel={`상품세목 ${planName}`} actionLabel={`${planName} 삭제`} />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("detach:")) {
    const [, pcId, planId] = c.split(":");
    const pc = productCoverages.find((p) => p.id === pcId);
    const outcome = previewOutcome(await services.product.detachPlan(actor, pcId, planId));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm impact={outcome.impact} action={detachPlanAction.bind(null, id, "coverages", pcId, planId)} targetLabel={`${pc?.name ?? pcId} 의 세목 부착`} actionLabel="세목 부착 해제" />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("template:")) {
    // 템플릿 교체 — 조 노출·오버라이드는 템플릿의 노드에 매달린 설정이라 함께 초기화된다 (기능/상품 §3 「보통약관」).
    // `dryRun` 으로 묻는다: 확인 주소를 그리는 GET 이 템플릿을 바꿔서는 안 되는데 (뒤로가기 · 다른 창),
    // 「잃을 것이 있는가」를 화면이 다시 계산하면 서비스와 갈라진다 — 판정은 서비스가 한다 (코덱스 리뷰 후속).
    const newId = c.slice(9) || undefined;
    const title = newId ? (generals.find((g) => g.id === newId)?.title ?? newId) : "미지정";
    const outcome = previewOutcome(await services.product.setGeneralDocument(actor, id, newId, { dryRun: true }));
    confirmNode =
      outcome.kind === "confirm" ? (
        <Confirm
          impact={outcome.impact}
          action={confirmProductGeneralDocumentAction.bind(null, id, newId)}
          title={newId ? `템플릿을 「${title}」로 바꾸면 아래 설정이 초기화된다` : "보통약관 템플릿을 해제하면 아래 설정이 초기화된다"}
          actionLabel={newId ? `「${title}」로 교체` : "템플릿 해제"}
          cancelHref={productDetailPath(id, "general")}
        />
      ) : outcome.kind === "error" ? (
        <p className="ts-error-banner">{outcome.message}</p>
      ) : null;
  } else if (c?.startsWith("group:")) {
    // 그룹 삭제도 다른 파괴 조작과 같은 확인 경로를 탄다 (리뷰 #34). 값은 안 사라지고 소속만 풀린다 —
    // 잃는 것을 계산된 대로만 적는다 (디자인원칙 §9.5).
    const groupId = c.slice(6);
    const group = groups.find((g) => g.id === groupId);
    confirmNode = group ? (
      <Confirm
        impact={{ valueRowsLost: 0, cascade: group.members.map((m) => `상품담보 ${m.name} 의 배치 (미배치로 돌아간다)`), brokenRefs: [] }}
        action={deleteGroupAction.bind(null, id, groupId)}
        targetLabel={`특약 그룹 ${group.title}`}
        actionLabel={`${group.title} 삭제 · 상품담보 ${group.members.length}건 미배치로`}
      />
    ) : (
      <p className="ts-error-banner">그룹을 찾을 수 없습니다.</p>
    );
  }

  return (
    <ProductEditProvider canEdit={tab === "basic"}>
      <div className="ts-page-head ts-product-head">
        <ProductPath name={product.name} />
        <ProductHeadActions
          menu={[
            { label: "미리보기", href: `/products/${id}/preview` },
            { label: "상품 삭제", href: `?tab=${tab}&confirm=product`, danger: true },
          ]}
        />
      </div>
      <ErrorBanner message={sp.error} />
      {c === "product" && confirmNode}

      <ProductTabs productId={id} current={tab} />

      {tab === "basic" && (
        <BasicTab
          productId={id}
          productName={product.name}
          productForm={productForm}
          productHighlight={productHighlight}
          planOptions={planOptions}
          planTypeForms={planTypes.map((t) => ({ ...t, model: buildForm("plan", enumLookup, new Map(), undefined, [findForm(t.code)!]) }))}
          plans={plans}
          planOptionForms={planOptionForms}
          highlightOption={highlightOption}
          highlightField={sp.field}
        />
      )}

      {tab === "coverages" && (
        <CoveragesTab
          productId={id}
          baseCoverages={baseCoverages}
          specialCoverages={specialCoverages}
          coverages={coverages}
          attributeKinds={attributeKinds}
          plans={plans}
          mountSearch={{ base: { query: sp.bq, page: sp.bpage }, special: { query: sp.mq, page: sp.mpage } }}
          wouldBeName={wouldBeName}
          baseCheck={baseCheck}
          standalone={isStandaloneContract(productValues.get(CONTRACT_KIND_PATH))}
          groups={groups}
          unplaced={unplaced}
          confirm={c}
          confirmNode={confirmNode}
        />
      )}

      {tab === "general" && (
        <GeneralTab
          productId={id}
          generalDocumentId={product.generalDocumentId}
          generals={generals}
          baseCoverages={baseCoverages}
          overrides={overrides}
          overrideTargets={overrideTargets}
          clauses={clauses}
          appendices={appendices.map((a) => ({ code: a.code, name: a.name }))}
          boxes={boxes}
          enums={enumsList}
          discriminators={discriminators.map((d) => ({ code: d.code, label: d.label }))}
          generalTree={generalDoc?.tree}
          generalNumbers={generalNumbers}
          hiddenArticles={hiddenArticles}
          booklet={booklet}
          bookletNote={bookletNote}
          articleId={sp.art}
          confirm={c}
          confirmNode={confirmNode}
        />
      )}

      {tab === "special" && (
        <SpecialPreviewTab
          productId={id}
          groups={specialGroups}
          selected={specialSelected}
          template={specialTemplate ? { id: specialTemplate.id, tree: specialTemplate.tree } : undefined}
          previews={new Map(specialPreviewList)}
          clauses={clauses}
          appendices={appendices.map((a) => ({ code: a.code, name: a.name }))}
          boxes={boxes}
          enums={enumsList}
          discriminators={discriminators.map((d) => ({ code: d.code, label: d.label }))}
        />
      )}
    </ProductEditProvider>
  );
}
