import Link from "next/link";
import type { ReactNode } from "react";

import { IconButton, IconCheck, IconPlus, IconRevert, IconTrash } from "@/app/_components/icons";
import { planOptionLabel, type AttributeKind, type ProductCoverage, type ProductPlan } from "@/domain/product";
import type { Id } from "@/domain/types";

import { attachPlanAction, mountAction, regenerateNameAction, renameProductCoverageAction } from "../../actions";
import type { ProductTab } from "../../lib";

/** 기본계약 · 특약 두 절의 구조는 같다 (ADR-0021) — 탭만 다르다. */
const SECTION_TITLE = { base: "기본계약 담보", special: "특약 담보" } as const;
const SECTION_TAB: Record<keyof typeof SECTION_TITLE, ProductTab> = { base: "general", special: "special" };

export interface CoverageMountSectionProps {
  productId: Id;
  section: keyof typeof SECTION_TITLE;
  items: ProductCoverage[];
  coverages: { id: Id; name: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  coverageName: Map<Id, string>;
  /** 작명 규칙이 지금 지어 줄 이름 — 누르기 전에 결과를 보여준다 (리뷰 #27 · §9.3). */
  wouldBeName: (pc: ProductCoverage) => string;
  /** 행마다의 「미리보기」 좌표 — 특약 절만 준다 (기본계약은 보통약관 탭의 세 패널이 미리보기다 · 기능/상품 §4.5). */
  previewPath?: (pcId: Id) => string;
  /** 지금 미리보고 있는 상품담보 — 그 행이 `aria-current`. */
  selectedId?: Id;
  /** 주면 탑재 폼 대신 이 한 줄 — 기본계약 절은 이미 기본계약이 있으면 탑재(=지정)를 서비스가 거부한다 (MVP 정확히 1개). */
  mountBlockedHint?: string;
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 탑재 표 + 탑재 폼 한 절. 기본계약은 보통약관 탭이, 특약은 특별약관 탭이 그린다 (기능/상품 §3.8).
 * `?confirm=pc:…` · `?confirm=detach:…` 확인 카드는 **그 상품담보를 가진 절**에서만 뜬다.
 */
export function CoverageMountSection({ productId, section, items, coverages, attributeKinds, plans, coverageName, wouldBeName, previewPath, selectedId, mountBlockedHint, confirm, confirmNode }: CoverageMountSectionProps) {
  const title = SECTION_TITLE[section];
  const tab = SECTION_TAB[section];
  const owns = (pcId: string) => items.some((pc) => pc.id === pcId);
  const ownsConfirm = confirm?.startsWith("pc:") ? owns(confirm.slice(3)) : confirm?.startsWith("detach:") ? owns(confirm.split(":")[1] ?? "") : false;

  return (
    <section className="ts-section">
      <h2 className="ts-section-title">
        {title} <span className="ts-count">{items.length}건</span>
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "0 32px", alignItems: "start" }}>
        <table className="ts-table">
          <thead>
            <tr>
              <th className="col-flex">상품담보명</th>
              <th className="col-fixed-md">담보</th>
              <th className="col-fixed-md">세목 부착</th>
              <th className="col-act">조작</th>
            </tr>
          </thead>
          <tbody>
            {items.map((pc) => {
              const suggested = wouldBeName(pc);
              return (
                <tr key={pc.id} aria-current={pc.id === selectedId ? "true" : undefined}>
                  <td className="col-flex">
                    <form action={renameProductCoverageAction.bind(null, productId, tab, pc.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <input type="text" name="name" defaultValue={pc.name} style={{ width: 200 }} />
                      <IconButton type="submit" label={`이름 저장 · ${pc.name}`} icon={<IconCheck />} />
                    </form>{" "}
                    <Link href={`/products/${productId}/coverages/${pc.id}`} title={`상품담보 값 열기 · ${pc.name}`}>
                      값 →
                    </Link>
                    {previewPath && (
                      <>
                        {" "}
                        <Link href={previewPath(pc.id)} title={`미리보기 · ${pc.name}`}>
                          미리보기
                        </Link>
                      </>
                    )}
                  </td>
                  <td className="col-fixed-md">
                    <Link href={`/coverages/${pc.coverageId}`} title={`담보 마스터 열기 · ${coverageName.get(pc.coverageId) ?? "담보"}`}>
                      {coverageName.get(pc.coverageId) ?? "(삭제된 담보)"}
                    </Link>
                  </td>
                  <td className="col-fixed-md">
                    <form action={attachPlanAction.bind(null, productId, tab, pc.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <select name="planId" style={{ maxWidth: 150 }}>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.options.map(planOptionLabel).join(",")}
                          </option>
                        ))}
                      </select>
                      <IconButton type="submit" label={`세목 부착 · ${pc.name}`} icon={<IconPlus />} disabled={plans.length === 0} />
                    </form>
                  </td>
                  <td className="col-act">
                    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                      {suggested !== pc.name && suggested !== "" && <span className="ts-muted">작명: {suggested}</span>}
                      <form action={regenerateNameAction.bind(null, productId, tab, pc.id)} style={{ display: "inline" }}>
                        <IconButton type="submit" label={`작명 규칙으로 다시 짓기 · ${pc.name} → ${suggested || "(빈 이름)"}`} icon={<IconRevert />} />
                      </form>
                      <Link href={`?tab=${tab}&confirm=pc:${pc.id}`} className="ts-iconbtn danger" title={`탑재 해제 · ${pc.name}`} aria-label={`탑재 해제 · ${pc.name}`}>
                        <IconTrash />
                      </Link>
                    </span>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td className="col-flex ts-muted" colSpan={4}>
                  아직 {title}가 없다. 아래에서 담보를 골라 탑재한다.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {mountBlockedHint ? (
          <p className="ts-muted">{mountBlockedHint}</p>
        ) : (
          <form action={mountAction.bind(null, productId)} className="ts-form" style={{ borderTop: 0, marginTop: 0 }}>
            <input type="hidden" name="section" value={section} />
            <label className="ts-field">
              <span>담보</span>
              <select name="coverageId" required>
                {coverages.map((cov) => (
                  <option key={cov.id} value={cov.id}>
                    {cov.name}
                  </option>
                ))}
              </select>
            </label>
            {attributeKinds.map((k) => (
              <label key={k.code} className="ts-field">
                <span>{k.label}</span>
                <select name={`attr:${k.code}`} defaultValue="">
                  <option value="">—</option>
                  {k.values.map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div className="ts-form-actions">
              <button type="submit" className="primary">
                {title}에 탑재
              </button>
            </div>
          </form>
        )}
      </div>
      {ownsConfirm && confirmNode}
    </section>
  );
}
