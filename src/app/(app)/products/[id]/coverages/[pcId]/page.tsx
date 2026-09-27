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
  const [product, values, enumsList, preview, completeness, masterValues, baseContractIds] = await Promise.all([
    services.product.getProduct(id),
    services.product.getSnapshotValues(pcId),
    services.catalog.listEnums(),
    services.assembly.previewSpecial(id, pcId),
    services.product.coverageCompleteness(pcId),
    services.product.getSnapshotMasterValues(pcId),
    services.product.listBaseContractIds(id),
  ]);
  /** 돌아갈 탭 — 이 상품담보가 사는 절이다: 기본계약은 보통약관, 나머지는 특별약관 (기능/상품 §3.8). */
  const backTab: ProductTab = baseContractIds.includes(pcId) ? "general" : "special";
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);
  /** owner 하나의 스냅샷 문맥 — 마스터 값을 못 얻으면(빈 맵) undefined 로 빠져 direct 로 보인다. */
  const snapshotContextOf = (ownerId: string, masterLabel: string): SnapshotContext | undefined => {
    const own = masterValues.get(ownerId);
    return own && own.size > 0 ? { masterLabel, masterValues: own } : undefined;
  };

  /** 값 자리 하나로 가는 앵커 — 미입력 목록의 「고치러 가기」. */
  const slotAnchor = (ownerId: string) => `#own-${ownerId}-values`;

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

      <section className="ts-section">
        <h2 className="ts-section-title">담보 레벨 값</h2>
        <div id={`own-${pc.id}-values`}>
          <ValueForm
            model={buildForm("coverage", enumLookup, values.get(pc.id) ?? new Map(), snapshotContextOf(pc.id, `${pc.coverageName} (마스터)`))}
            action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productCoverage", id: pc.id })}
          />
        </div>
      </section>

      {pc.subCoverages.map((s) => (
        <section key={s.id} className="ts-section">
          <h2 className="ts-section-title">세부보장 — {s.name}</h2>
          <div id={`own-${s.id}-values`}>
            <ValueForm
              model={buildForm("subCoverage", enumLookup, values.get(s.id) ?? new Map(), snapshotContextOf(s.id, `${s.name} (마스터)`))}
              action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productSubCoverage", id: s.id })}
            />
          </div>
          {s.benefits.map((b) => (
            <div key={b.id} style={{ paddingLeft: 16 }}>
              <h3 className="ts-form-title">급부 — {b.name}</h3>
              <div id={`own-${b.id}-values`}>
                <ValueForm
                  model={buildForm("benefit", enumLookup, values.get(b.id) ?? new Map(), snapshotContextOf(b.id, `${b.name} (마스터)`))}
                  action={writeSnapshotValuesAction.bind(null, pcId, { kind: "productBenefit", id: b.id })}
                />
              </div>
            </div>
          ))}
        </section>
      ))}

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
