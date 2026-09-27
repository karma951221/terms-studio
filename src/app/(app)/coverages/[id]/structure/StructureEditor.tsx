"use client";

/**
 * 「구조 편집」 화면 (ADR-0052 결정 2 · 기능/담보 §4 「구조 편집」) — 위에 영향 블록, 아래에 상세 화면과 같은 구조 편집기.
 *
 * - 편집으로 바로 열린다 (읽기 모드가 할 일이 없다). ✕ 는 상세로, 저장 뒤에도 상세로 돌아간다.
 * - 저장 한 번 — 추가 · 순서는 편집자도 바로 저장(비파괴). 삭제(✕)가 섞이면 저장 직전 confirm 대화상자에 영향(마스터 값 행 · 깨질 참조 ·
 *   연쇄 · 탑재 상품담보별 스냅샷 소실 행)이 뜨고 관리자만 저장된다. 편집자가 시도하면 서버 거부 배너 「세부보장 · 급부 삭제는 관리자만 할 수 있다」.
 * - 영향 블록은 지금 탑재 상황만 고정 표시 — 초안이 바뀔 때마다 서버를 부르지 않는다.
 */
import Link from "next/link";

import { EditShell, useEditField } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { savedStructureOf, structureIssues, type StructureDraftSub } from "@/domain/coverage";
import type { MountImpact } from "@/domain/types";

import { StructureTree } from "../../_components/StructureTree";
import { saveCoverageStructureAction } from "../../structure-actions";
import type { CoverageStructureData } from "../../structure-types";

const TIP = "탑재된 담보의 구조는 상품에 영향을 준다 — 영향을 확인하고 고친다. 추가 노드는 탑재분에 미입력 자리로 생기고(ADR-0002), 순서는 조문 수록 순서가 따라 바뀌며, 삭제는 탑재 스냅샷의 값 행까지 지운다 (관리자).";

function ImpactBlock({ coverageId, documentId, mounts }: { coverageId: string; documentId?: string; mounts: MountImpact[] }) {
  return (
    <section className="ts-section">
      <h2 className="ts-h2">
        영향
        <InfoTip text="이 담보를 탑재한 상품담보 — 구조를 바꾸면 이 스냅샷들이 따라 바뀐다. 값 행은 그 스냅샷에 입력된 값 자리 수 (전체)." />
        <span className="ts-count">탑재 상품담보 <b>{mounts.length}</b></span>
      </h2>
      {mounts.length === 0 ? (
        <div className="ts-empty">
          <p className="ts-empty-what">이 담보를 탑재한 상품담보가 없다 — 미탑재 담보의 구조는 상세 화면 편집 모드에서 고친다.</p>
          <p className="ts-empty-action"><Link href={`/coverages/${coverageId}`}>담보 상세로 →</Link></p>
        </div>
      ) : (
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-fixed-md">상품</th>
              <th className="col-flex">상품담보</th>
              <th className="col-num">값 행</th>
            </tr>
          </thead>
          <tbody>
            {mounts.map((m) => (
              <tr key={m.productCoverageId}>
                <td><Link href={`/products/${m.productId}`}>{m.productName}</Link></td>
                <td><Link href={`/products/${m.productId}/coverages/${m.productCoverageId}`}>{m.productCoverageName}</Link></td>
                <td className="col-num">{m.snapshotValueRows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {documentId ? (
        <p className="ts-muted">
          {ENTITY_LABEL.coverageTemplate}이 있다 — 사라진 노드를 가리키는 반복 · 슬롯은 저장 뒤 오류 상태로 드러난다. <Link href={`/documents/${documentId}`}>{ENTITY_LABEL.coverageTemplate} 열기 →</Link>
        </p>
      ) : null}
    </section>
  );
}

function Body({ coverageId, name, documentId, mounts, original }: { coverageId: string; name: string; documentId?: string; mounts: MountImpact[]; original: StructureDraftSub[] }) {
  const structure = useEditField<StructureDraftSub[]>("structure");
  return (
    <>
      <ImpactBlock coverageId={coverageId} documentId={documentId} mounts={mounts} />
      <StructureTree
        mode={structure.mode}
        label={name}
        value={structure.value}
        onChange={structure.setValue}
        structural
        original={savedStructureOf(original)}
        tip={TIP}
      />
    </>
  );
}

export function StructureEditor({ id, name, documentId, initial, mounts }: { id: string; name: string; documentId?: string; initial: CoverageStructureData; mounts: MountImpact[] }) {
  const detail = `/coverages/${id}`;
  return (
    <EditShell
      initial={initial}
      title="구조 편집"
      path={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }, { label: name, href: detail }]}
      initialMode="edit"
      cancelHref={detail}
      saveSuccessHref={detail}
      saveAction={saveCoverageStructureAction.bind(null, id)}
      saveDisabled={(data) => structureIssues(data.structure).length > 0}
      headerMeta={<span className="ts-count">탑재 상품담보 <b>{mounts.length}</b></span>}
    >
      <Body coverageId={id} name={name} documentId={documentId} mounts={mounts} original={initial.structure} />
    </EditShell>
  );
}
