import Link from "next/link";

import { AssemblyCheckLine } from "@/app/_components/AssemblyCheckLine";
import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { IssueList } from "@/app/_components/IssueList";
import { RenderedDoc } from "@/app/_components/RenderedDoc";
import { ValueForm } from "@/app/_components/ValueForm";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { buildForm, type SnapshotContext } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { writeSnapshotValuesAction } from "../../../actions";
import { productDetailPath, type ProductTab } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function ProductCoverageDetailPage({ params }: { params: Promise<{ id: string; pcId: string }> }) {
  const { id, pcId } = await params;
  const services = getServices();
  await currentActor();

  const snap = await services.product.getSnapshot(pcId);
  if (!snap.ok) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.product, href: "/products" }, { label: id, href: productDetailPath(id) }, { label: pcId }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }
  const pc = snap.value;
  const [product, values, enumsList, preview, completeness, masterValues] = await Promise.all([
    services.product.getProduct(id),
    services.product.getSnapshotValues(pcId),
    services.catalog.listEnums(),
    services.assembly.previewSpecial(id, pcId),
    services.product.coverageCompleteness(pcId),
    services.product.getSnapshotMasterValues(pcId),
  ]);
  /** 돌아갈 탭 — 기본계약이든 특약이든 상품담보 탭이다 (기능/상품 §3.8 · 2026-09-28). */
  const backTab: ProductTab = "coverages";
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  /** owner 하나의 스냅샷 문맥 — 마스터 값을 못 얻으면(빈 맵) undefined 로 빠져 direct 로 보인다. */
  const snapshotContextOf = (ownerId: string, masterLabel: string): SnapshotContext | undefined => {
    const own = masterValues.get(ownerId);
    return own && own.size > 0 ? { masterLabel, masterValues: own } : undefined;
  };

  /** 값 자리 하나로 가는 앵커 — 미입력 목록의 「고치러 가기」. */
  const slotAnchor = (ownerId: string) => `#own-${ownerId}-values`;

  /** 노드 하나의 값 폼 — 앵커 자리 포함. 필드가 없는 레벨(지금 세부보장)은 폼 자리 없이 이름만. */
  const valueForm = (level: "coverage" | "subCoverage" | "benefit", ownerId: string, kind: "productCoverage" | "productSubCoverage" | "productBenefit", masterLabel: string) => {
    const model = buildForm(level, enumLookup, values.get(ownerId) ?? new Map(), snapshotContextOf(ownerId, masterLabel));
    if (model.fields.length === 0) return null;
    return (
      <div id={`own-${ownerId}-values`}>
        <ValueForm model={model} flat action={writeSnapshotValuesAction.bind(null, pcId, { kind, id: ownerId })} />
      </div>
    );
  };

  return (
    <div>
      <div className="ts-page-head">
        <Breadcrumb items={[{ label: ENTITY_LABEL.product, href: "/products" }, { label: product?.name ?? id, href: productDetailPath(id, backTab) }, { label: pc.name }]} />
      </div>
      <p className="ts-muted">
        담보 마스터: <Link href={`/coverages/${pc.coverageId}`}>{pc.coverageName}</Link>
      </p>

      {completeness.missing.length > 0 && (
        <section className="ts-section">
          <h2 className="ts-section-title">미입력</h2>
          <ul>
            {completeness.missing.map((m, i) => (
              <li key={i}>
                {m.ownerName} › {m.path} · <Link href={slotAnchor(m.owner.id)}>고치러 가기</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 담보 ⊃ 세부보장(그리드) ⊃ 급부 — 담보 상세와 같은 중첩 카드 (기능/담보 §3.6). 값 폼은 카드마다 제 저장 버튼이다. */}
      <section className="ts-cov-card" data-level="coverage" aria-label={`담보 ${pc.name}`}>
        <div className="ts-cov-card-head">
          <span className="ts-cov-card-level">담보</span>
          <span className="ts-cov-card-name">{pc.name}</span>
        </div>
        <div className="ts-cov-card-body">
          {valueForm("coverage", pc.id, "productCoverage", `${pc.coverageName} (마스터)`)}
          <div className="ts-cov-grid">
            {pc.subCoverages.map((s, subIndex) => (
              <section key={s.id} className="ts-cov-card" data-level="subCoverage" aria-label={`세부보장 ${s.name}`}>
                <div className="ts-cov-card-head">
                  <span className="ts-cov-card-level">세부보장 {subIndex + 1}</span>
                  <span className="ts-cov-card-name">{s.name}</span>
                </div>
                <div className="ts-cov-card-body">
                  {valueForm("subCoverage", s.id, "productSubCoverage", `${s.name} (마스터)`)}
                  <div className="ts-cov-benefits">
                    {s.benefits.map((b, benefitIndex) => (
                      <section key={b.id} className="ts-cov-card" data-level="benefit" aria-label={`급부 ${b.name}`}>
                        <div className="ts-cov-card-head">
                          <span className="ts-cov-card-level">급부 {benefitIndex + 1}</span>
                          <span className="ts-cov-card-name">{b.name}</span>
                        </div>
                        <div className="ts-cov-card-body">{valueForm("benefit", b.id, "productBenefit", `${b.name} (마스터)`)}</div>
                      </section>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="ts-section">
        <h2 className="ts-section-title">
          상품담보 미리보기
          {preview.ok && <span className="ts-count">조 {preview.value.doc.children.flatMap((n) => (n.kind === "section" ? n.children : [n])).filter((n) => n.kind === "article").length}</span>}
        </h2>
        {/* 상품 미리보기(저장본)와 달리 이 절은 매 요청 실시간 계산이다 — 저장하지 않는다 (기능/조립산출 §3.6). */}
        <p className="ts-muted">지금 계산한 결과 (저장하지 않음)</p>
        {preview.ok ? (
          <>
            <AssemblyCheckLine issues={preview.value.issues} />
            {!preview.value.complete && <p className="ts-error-banner">완성본 아님 — 아래 오류를 확인하세요.</p>}
            <IssueList issues={preview.value.issues} />
            <RenderedDoc doc={preview.value.doc} />
          </>
        ) : (
          <p className="ts-error-banner">{preview.rejection.reason}</p>
        )}
      </section>

    </div>
  );
}
