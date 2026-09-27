import Link from "next/link";
import type { ReactNode } from "react";

import { ListFilterBar } from "@/app/_components/ListFilters";
import { ListShell } from "@/app/_components/ListShell";
import { IconButton, IconCheck, IconPlus, IconRevert, IconTrash } from "@/app/_components/icons";
import { paginate, todayInSeoul } from "@/app/_lib/list";
import { planOptionLabel, type AttributeKind, type ProductCoverage, type ProductPlan } from "@/domain/product";
import type { Id } from "@/domain/types";

import { attachPlanAction, mountAction, regenerateNameAction, renameProductCoverageAction } from "../../actions";
import { filterMountRows, mountRows, type ProductTab } from "../../lib";

/**
 * 기본계약 · 특약 두 절의 구조는 같다 (ADR-0021) — 탭만 다르다. 제목은 옛 상품모델링 화면의 말을 따른다
 * (「보통약관 기본계약」 · 「특별약관」, 2026-09-27).
 */
export const SECTION_TITLE = { base: "보통약관 기본계약", special: "특별약관" } as const;
const SECTION_TAB: Record<keyof typeof SECTION_TITLE, ProductTab> = { base: "general", special: "special" };

/** 탑재 표의 검색어 · 페이지 쿼리 — 탭 하나에 절 하나라 두 절이 같은 이름을 써도 겹치지 않는다. */
export const MOUNT_QUERY_KEY = "mq";
export const MOUNT_PAGE_KEY = "mpage";
const PAGE_SIZE = 50;

export interface CoverageMountSectionProps {
  productId: Id;
  section: keyof typeof SECTION_TITLE;
  items: ProductCoverage[];
  /** 담보 마스터 — 탑재 폼의 선택지이자 행의 담보코드 · 담보명 출처. */
  coverages: { id: Id; code?: string; name: string }[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 작명 규칙이 지금 지어 줄 이름 — 누르기 전에 결과를 보여준다 (리뷰 #27 · §9.3). */
  wouldBeName: (pc: ProductCoverage) => string;
  /** 행마다의 「미리보기」 좌표 — 특약 절만 준다 (기본계약은 보통약관 탭의 세 패널이 미리보기다 · 기능/상품 §4.5). */
  previewPath?: (pcId: Id) => string;
  /** 지금 미리보고 있는 상품담보 — 그 행이 `aria-current`. */
  selectedId?: Id;
  /** 주면 탑재 폼 대신 이 한 줄 — 기본계약 절은 이미 기본계약이 있으면 탑재(=지정)를 서비스가 거부한다 (MVP 정확히 1개). */
  mountBlockedHint?: string;
  /** `?mq=` 담보 검색어 · `?mpage=` 페이지. */
  query?: string;
  page?: string;
  confirm: string | undefined;
  confirmNode: ReactNode;
}

/**
 * 탑재 표 + 탑재 폼 한 절. 기본계약은 보통약관 탭이, 특약은 특별약관 탭이 그린다 (기능/상품 §3.8).
 * 표는 **상품담보 한 건 = 한 행** — 담보코드 · 담보속성 조합 · 상품담보명 (옛 상품모델링 화면의 세 열, 기능/상품 §4.6).
 * 「담보 검색」은 코드 · 이름 · 속성 값을 거른다(`?mq=`). 표 위 검색 · 아래 페이저는 L1 목록과 같은 부품이다.
 * `?confirm=pc:…` · `?confirm=detach:…` 확인 카드는 **그 상품담보를 가진 절**에서만 뜬다 — 검색에 가려져도.
 */
export function CoverageMountSection({ productId, section, items, coverages, attributeKinds, plans, wouldBeName, previewPath, selectedId, mountBlockedHint, query = "", page, confirm, confirmNode }: CoverageMountSectionProps) {
  const title = SECTION_TITLE[section];
  const tab = SECTION_TAB[section];
  const owns = (pcId: string) => items.some((pc) => pc.id === pcId);
  const ownsConfirm = confirm?.startsWith("pc:") ? owns(confirm.slice(3)) : confirm?.startsWith("detach:") ? owns(confirm.split(":")[1] ?? "") : false;
  const q = query.trim();
  const filtered = filterMountRows(mountRows(items, coverages, attributeKinds), q);
  const slice = paginate(filtered, page, PAGE_SIZE);

  return (
    <section className="ts-section ts-mount-section" aria-label={title}>
      <h2 className="ts-section-title">{title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: "0 32px", alignItems: "start" }}>
        <ListShell
          filters={<ListFilterBar placeholder="담보 검색 — 코드 · 상품담보명 · 담보속성" filters={[]} today={todayInSeoul()} queryKey={MOUNT_QUERY_KEY} />}
          interactiveFilters
          total={slice.total}
          page={slice.page}
          pageSize={PAGE_SIZE}
          basePath={`/products/${productId}`}
          query={{ tab, [MOUNT_QUERY_KEY]: q || undefined }}
          pageParam={MOUNT_PAGE_KEY}
          empty={
            items.length === 0 ? (
              <p className="ts-muted">아직 {title} 담보가 없다. 오른쪽에서 담보를 골라 탑재한다.</p>
            ) : (
              <p className="ts-empty-what">「{q}」에 맞는 상품담보가 없습니다.</p>
            )
          }
        >
          <table className="ts-table">
            <thead>
              <tr>
                <th className="col-code">담보코드</th>
                <th className="col-fixed-md">담보속성 조합</th>
                <th className="col-flex">상품담보명</th>
                <th className="col-fixed-md">세목 부착</th>
                <th className="col-act">조작</th>
              </tr>
            </thead>
            <tbody>
              {slice.rows.map(({ pc, coverageCode, coverageName, attributes }) => {
                const suggested = wouldBeName(pc);
                return (
                  <tr key={pc.id} aria-current={pc.id === selectedId ? "true" : undefined}>
                    <td className="col-code">
                      {coverageCode ? (
                        <Link href={`/coverages/${pc.coverageId}`} title={`담보 마스터 열기 · ${coverageName ?? "담보"}`}>
                          <code>{coverageCode}</code>
                        </Link>
                      ) : (
                        <span className="ts-muted" title="담보 마스터가 없어졌다">—</span>
                      )}
                    </td>
                    <td className="col-fixed-md">{attributes === "—" ? <span className="ts-muted">—</span> : attributes}</td>
                    <td className="col-flex">
                      <form action={renameProductCoverageAction.bind(null, productId, tab, pc.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <input type="text" name="name" defaultValue={pc.name} aria-label={`상품담보명 · ${pc.name}`} style={{ width: 220 }} />
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
                      <form action={attachPlanAction.bind(null, productId, tab, pc.id)} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <select name="planId" style={{ maxWidth: 150 }} aria-label={`세목 조합 · ${pc.name}`}>
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
            </tbody>
          </table>
        </ListShell>

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
