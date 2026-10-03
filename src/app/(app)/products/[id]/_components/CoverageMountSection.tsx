"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Combobox } from "@/app/_components/Combobox";
import { ListFilterBar } from "@/app/_components/ListFilters";
import { ListShell } from "@/app/_components/ListShell";
import { IconButton, IconClose, IconPlus, IconRevert, IconTrash } from "@/app/_components/icons";
import { paginate, todayInSeoul } from "@/app/_lib/list";
import { defaultCoverageName, planCombinationLabel, type AttributeKind, type AttributeSelection, type ProductCoverage, type ProductPlan } from "@/domain/product";
import type { Id } from "@/domain/types";

import { filterMountRows, mountRows, withGroupStarts, type ProductTab } from "../../lib";
import { addRowProblem, rowStatus, type CoverageDraftRow, type CoveragesDraft, type CoveragesDraftAction } from "./coveragesDraft";

/**
 * 기본계약 · 특약 두 절의 구조는 같다 (ADR-0021) — 둘 다 상품담보 탭에 선다. 제목은 옛 상품모델링 화면의 말을 따른다
 * (「기본계약」 · 「특별약관」, 2026-10-01 — 옛 「보통약관 기본계약」).
 */
export const SECTION_TITLE = { base: "기본계약", special: "특별약관" } as const;
const TAB: ProductTab = "coverages";

/** 탑재 표의 검색어 · 페이지 쿼리 — 두 절이 한 탭에 있어 절마다 이름이 다르다. */
export const MOUNT_QUERY_KEYS = { base: { query: "bq", page: "bpage" }, special: { query: "mq", page: "mpage" } } as const;
const PAGE_SIZE = 50;

/** 담보 마스터 한 줄 — 행의 담보코드 · 담보명 · 특약 그룹 이름(그 담보의 「특약 그룹」 값, ADR-0080). */
export interface CoverageRef {
  id: Id;
  code?: string;
  name: string;
  group?: string;
}

/** 편집 상태 — 편집 중일 때만 준다. 초안 · 저장본(「변경」 판정) · 행별 저장 거부 문구. */
export interface MountSectionEdit {
  draft: CoveragesDraft;
  saved: CoveragesDraft;
  dispatch: (action: CoveragesDraftAction) => void;
  errors: ReadonlyMap<string, string[]>;
  namingTemplate: string;
  /** 독립특약 상품 — 기본계약 표에 더하지 못한다 (계약형태 E0007 · 기능/상품 §3.1). */
  standalone: boolean;
}

export interface CoverageMountSectionProps {
  productId: Id;
  section: keyof typeof SECTION_TITLE;
  /** 저장된 이 절의 상품담보 — 읽기 표. */
  items: ProductCoverage[];
  coverages: CoverageRef[];
  attributeKinds: AttributeKind[];
  plans: ProductPlan[];
  /** 상품담보 id → 부착한 조합 id (저장본). */
  attachedPlans: Readonly<Record<Id, readonly Id[]>>;
  /** 저장된 상품담보마다 작명 규칙이 지금 지어 줄 이름 — 편집 중 「작명: …」 · ↺ (리뷰 #27 · §9.3). */
  suggestedNames: Readonly<Record<Id, string>>;
  /** 이 절의 담보 검색어 · 페이지 (`MOUNT_QUERY_KEYS`) — 읽기에만 쓴다. */
  query?: string;
  page?: string;
  /** 페이저 링크에 같이 실을 다른 절의 검색 쿼리 — 한 절을 넘겨도 다른 절 검색이 풀리지 않게. */
  keepQuery?: Record<string, string | undefined>;
  edit?: MountSectionEdit;
  /** 처음부터 「+ 담보 추가」 줄을 펼쳐 둔다 — 렌더 검사용. */
  initialAddOpen?: boolean;
}

const planLabel = (plans: readonly ProductPlan[], id: Id) => {
  const plan = plans.find((p) => p.id === id);
  return plan ? planCombinationLabel(plan.options) : id;
};

/**
 * 탑재 표 한 절 (기능/상품 §4.5). 표는 **상품담보 한 건 = 한 행** — 담보코드 · 담보명 · 담보속성 · 상품담보명 · (특별약관만) 그룹 · 세목 부착.
 * 담보 : 상품담보 = 1 : N 이라 같은 담보의 상품담보를 이어 놓고 담보코드 · 담보명은 그 묶음 첫 행에만 찍는다 (2026-09-28 사용자 확정).
 *
 * - **읽기**: 글자만 — 입력 · 아이콘이 없다. 위 「담보 검색」(`?mq=` · `?bq=`) · 아래 페이저는 L1 목록과 같은 부품.
 * - **편집** (2026-10-04): 초안의 행 전부(검색 · 페이저 없음) — 상품담보명 입력 · 세목 부착 칩(✕) + select ＋ · 「작명: …」 ↺ · 🗑(기존 행은 「삭제」 표시 +
 *   되돌리기, 더한 행은 빠진다). 바뀐 행에 「추가」 · 「변경」 · 「삭제」. 표 아래 「+ 담보 추가」 → 그 자리에 펼쳐지는 줄(담보 찾기 · 담보속성 → 추가 · 닫기).
 *   저장 거부는 그 행 아래에. 오른쪽에 떠 있던 탑재 폼은 없다 — 표와 겹쳤다(2026-10-04 사용자 QA).
 */
export function CoverageMountSection({ productId, section, items, coverages, attributeKinds, plans, attachedPlans, suggestedNames, query = "", page, keepQuery = {}, edit, initialAddOpen = false }: CoverageMountSectionProps) {
  const title = SECTION_TITLE[section];
  const keys = MOUNT_QUERY_KEYS[section];
  const withGroup = section === "special";
  const byId = new Map(coverages.map((c) => [c.id, c]));

  const head = (
    <tr>
      <th className="col-code">담보코드</th>
      <th className="col-fixed-md">담보명</th>
      <th className="col-fixed-md">담보속성</th>
      <th className="col-flex">상품담보명</th>
      {withGroup && <th className="col-fixed-md">그룹</th>}
      <th className="col-fixed-md">세목 부착</th>
      {edit && <th className="col-act">조작</th>}
    </tr>
  );
  // 그룹은 담보 마스터의 것 — 읽기 전용, 상품에서 못 바꾼다 (ADR-0080). 없으면 책자에서 그룹 제목 없이 찍힌다
  const groupCell = (coverageId: Id) =>
    withGroup ? (
      <td className="col-fixed-md" title={byId.get(coverageId)?.group ? undefined : "그룹 없음 — 책자에서 그룹 제목 없이 찍힌다 (담보 화면에서 고른다)"}>
        {byId.get(coverageId)?.group ?? <span className="ts-muted">—</span>}
      </td>
    ) : null;
  const codeCell = (groupStart: boolean, coverageId: Id, code: string | undefined, name: string | undefined) => (
    <>
      <td className="col-code">
        {!groupStart ? null : code ? (
          <Link href={`/coverages/${coverageId}`} title={`담보 마스터 열기 · ${name ?? "담보"}`}>
            <code>{code}</code>
          </Link>
        ) : (
          <span className="ts-muted" title="담보 마스터가 없어졌다">
            —
          </span>
        )}
      </td>
      <td className="col-fixed-md">{groupStart ? (name ?? <span className="ts-muted">—</span>) : null}</td>
    </>
  );

  if (!edit) {
    const q = query.trim();
    const filtered = filterMountRows(mountRows(items, coverages, attributeKinds), q);
    const slice = paginate(filtered, page, PAGE_SIZE);
    const rows = withGroupStarts(slice.rows);
    return (
      <section className="ts-section ts-mount-section" aria-label={title}>
        <h2 className="ts-section-title">{title}</h2>
        <ListShell
          filters={<ListFilterBar placeholder="담보 검색 — 코드 · 담보명 · 상품담보명 · 담보속성" filters={[]} today={todayInSeoul()} queryKey={keys.query} />}
          interactiveFilters
          total={slice.total}
          page={slice.page}
          pageSize={PAGE_SIZE}
          basePath={`/products/${productId}`}
          query={{ ...keepQuery, tab: TAB, [keys.query]: q || undefined }}
          pageParam={keys.page}
          empty={
            items.length === 0 ? (
              <p className="ts-muted">아직 {title} 담보가 없다. 편집을 눌러 표 아래 「+ 담보 추가」로 탑재한다.</p>
            ) : (
              <p className="ts-empty-what">「{q}」에 맞는 상품담보가 없습니다.</p>
            )
          }
        >
          <table className="ts-table">
            <thead>{head}</thead>
            <tbody>
              {rows.map(({ pc, coverageCode, coverageName, attributes, groupStart }) => {
                const attached = attachedPlans[pc.id] ?? [];
                return (
                  <tr key={pc.id} className={groupStart ? undefined : "is-group-cont"} data-row={pc.id}>
                    {codeCell(groupStart, pc.coverageId, coverageCode, coverageName)}
                    <td className="col-fixed-md">{attributes === "—" ? <span className="ts-muted">—</span> : attributes}</td>
                    <td className="col-flex">{pc.name}</td>
                    {groupCell(pc.coverageId)}
                    <td className="col-fixed-md">{attached.length ? attached.map((id) => planLabel(plans, id)).join(" · ") : <span className="ts-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListShell>
      </section>
    );
  }

  // ── 편집 — 초안의 이 절 행 전부. 더한 행은 담보 찾기에서 고른 코드 · 이름을 쓴다
  const draftRows = edit.draft.rows.filter((r) => r.section === section);
  const asItems: ProductCoverage[] = draftRows.map((r) => ({ id: r.key, productId, coverageId: r.coverageId, name: r.name, attributes: r.attributes }));
  const refs: CoverageRef[] = [...coverages, ...draftRows.filter((r) => !byId.has(r.coverageId)).map((r) => ({ id: r.coverageId, code: r.coverageCode, name: r.coverageName ?? r.coverageId }))];
  const rows = withGroupStarts(mountRows(asItems, refs, attributeKinds));
  const rowOf = new Map(draftRows.map((r) => [r.key, r]));
  const cols = withGroup ? 7 : 6;
  const hasBase = edit.draft.rows.some((r) => r.section === "base" && !r.removed);
  const blocked = section === "base" ? (edit.standalone ? "독립특약 상품은 기본계약을 두지 않습니다" : hasBase ? "기본계약은 하나만 둘 수 있다 (MVP) — 바꾸려면 지금 기본계약을 탑재 해제(휴지통)한 뒤 추가한다" : undefined) : undefined;

  return (
    <section className="ts-section ts-mount-section" aria-label={title}>
      <h2 className="ts-section-title">{title}</h2>
      <table className="ts-table">
        <thead>{head}</thead>
        <tbody>
          {rows.map(({ pc, coverageCode, coverageName, attributes, groupStart }) => (
            <EditRow
              key={pc.id}
              row={rowOf.get(pc.id)!}
              status={rowStatus(edit.saved, edit.draft, pc.id)}
              groupStart={groupStart}
              codeCell={codeCell(groupStart, pc.coverageId, coverageCode, coverageName)}
              attributes={attributes}
              groupCell={groupCell(pc.coverageId)}
              plans={plans}
              suggested={rowOf.get(pc.id)!.status === "added" ? undefined : suggestedNames[pc.id]}
              errors={edit.errors.get(pc.id) ?? []}
              cols={cols}
              dispatch={edit.dispatch}
            />
          ))}
          {draftRows.length === 0 && (
            <tr>
              <td colSpan={cols} className="ts-muted">
                아직 {title} 담보가 없다.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="ts-mount-add">
            <td colSpan={cols}>
              {blocked ? (
                <span className="ts-muted">{blocked}</span>
              ) : (
                <AddRow section={section} title={title} kinds={attributeKinds} edit={edit} coverages={byId} initialOpen={initialAddOpen} />
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

const STATUS_LABEL = { added: "추가", removed: "삭제", changed: "변경" } as const;

function EditRow({ row, status, groupStart, codeCell, attributes, groupCell, plans, suggested, errors, cols, dispatch }: {
  row: CoverageDraftRow;
  status: ReturnType<typeof rowStatus>;
  groupStart: boolean;
  codeCell: ReactNode;
  attributes: string;
  groupCell: ReactNode;
  plans: ProductPlan[];
  suggested: string | undefined;
  errors: string[];
  cols: number;
  dispatch: (action: CoveragesDraftAction) => void;
}) {
  const [pick, setPick] = useState("");
  const removed = row.removed;
  const label = row.name || "(빈 이름)";
  const free = plans.filter((p) => !row.plans.includes(p.id));
  return (
    <>
      <tr className={[groupStart ? "" : "is-group-cont", removed ? "is-removed" : ""].filter(Boolean).join(" ") || undefined} data-row={row.key}>
        {codeCell}
        <td className="col-fixed-md">{attributes === "—" ? <span className="ts-muted">—</span> : attributes}</td>
        <td className="col-flex">
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              value={row.name}
              disabled={removed}
              onChange={(e) => dispatch({ type: "rename", key: row.key, name: e.target.value })}
              aria-label={`상품담보명 · ${row.name}`}
              aria-invalid={errors.length > 0 ? true : undefined}
              style={{ width: 220 }}
            />
            {status !== "saved" && <span className="ts-badge ts-changed-mark">{STATUS_LABEL[status]}</span>}
          </span>
        </td>
        {groupCell}
        <td className="col-fixed-md">
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {row.plans.map((id) => (
              <span key={id} className="ts-badge">
                {planLabel(plans, id)}
                {!removed && <IconButton danger label={`세목 부착 해제 · ${label} · ${planLabel(plans, id)}`} icon={<IconClose />} onClick={() => dispatch({ type: "detach", key: row.key, planId: id })} />}
              </span>
            ))}
            {!removed && (
              <>
                <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 150 }} aria-label={`세목 조합 · ${label}`} disabled={free.length === 0}>
                  <option value="">{plans.length === 0 ? "조합 없음" : free.length === 0 ? "모두 부착됨" : "— 조합 —"}</option>
                  {free.map((p) => (
                    <option key={p.id} value={p.id}>
                      {planCombinationLabel(p.options)}
                    </option>
                  ))}
                </select>
                <IconButton
                  label={`세목 부착 · ${label}`}
                  icon={<IconPlus />}
                  disabled={!pick}
                  onClick={() => {
                    dispatch({ type: "attach", key: row.key, planId: pick });
                    setPick("");
                  }}
                />
              </>
            )}
          </span>
        </td>
        <td className="col-act">
          <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
            {!removed && suggested !== undefined && suggested !== "" && suggested !== row.name && (
              <>
                <span className="ts-muted">작명: {suggested}</span>
                <IconButton label={`작명 규칙으로 다시 짓기 · ${label} → ${suggested}`} icon={<IconRevert />} onClick={() => dispatch({ type: "rename", key: row.key, name: suggested })} />
              </>
            )}
            {removed ? (
              <button type="button" className="ts-linklike" onClick={() => dispatch({ type: "restore", key: row.key })} aria-label={`탑재 해제 되돌리기 · ${label}`}>
                <IconRevert /> 되돌리기
              </button>
            ) : (
              <IconButton danger label={`탑재 해제 · ${label}`} icon={<IconTrash />} onClick={() => dispatch({ type: "remove", key: row.key })} />
            )}
          </span>
        </td>
      </tr>
      {errors.length > 0 && (
        <tr className="ts-row-error">
          <td colSpan={cols}>
            {errors.map((m, i) => (
              <p key={i} className="ts-form-error" role="alert">
                {m}
              </p>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

/** 「+ 담보 추가」 — 누르면 그 자리에 펼쳐지는 한 줄: 담보 찾기(서버 조회) · 담보속성 · 지어질 상품담보명 · 추가 / 닫기. */
function AddRow({ section, title, kinds, edit, coverages, initialOpen }: { section: "base" | "special"; title: string; kinds: AttributeKind[]; edit: MountSectionEdit; coverages: ReadonlyMap<Id, CoverageRef>; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [coverage, setCoverage] = useState<{ id: Id; code?: string; name: string }>();
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const close = () => {
    setOpen(false);
    setCoverage(undefined);
    setAttrs({});
    setTried(false);
  };
  if (!open) {
    return (
      <button type="button" className="ts-linklike" onClick={() => setOpen(true)} aria-label={`${title}에 담보 추가`}>
        <IconPlus /> 담보 추가
      </button>
    );
  }
  const attributes: AttributeSelection[] = Object.entries(attrs)
    .filter(([, v]) => v)
    .map(([kindCode, valueCode]) => ({ kindCode, valueCode }));
  const problem = addRowProblem(edit.draft, { section, coverageId: coverage?.id ?? "", attributes }, { kinds, standalone: edit.standalone });
  const name = coverage ? defaultCoverageName(coverage.name, attributes, kinds, edit.namingTemplate) : "";
  return (
    <div className="ts-mount-add-row" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {/* 담보 마스터는 상품을 가리지 않고 는다 — 전부 싣지 않고 친 글로 서버에서 찾는다 (디자인원칙 §1.8) */}
      <Combobox
        lookupUrl="/api/lookup/coverages"
        ariaLabel={`담보 · ${title}에 추가`}
        placeholder="담보 이름 · 코드로 찾기"
        value={coverage?.id ?? ""}
        valueLabel={coverage?.name}
        autoFocus
        onChange={(value, option) => setCoverage(value ? { id: value, code: option?.hint ?? coverages.get(value)?.code, name: option?.label ?? coverages.get(value)?.name ?? value } : undefined)}
      />
      {kinds.map((k) => (
        <select key={k.code} aria-label={`${k.label} · ${title}에 추가`} value={attrs[k.code] ?? ""} onChange={(e) => setAttrs((cur) => ({ ...cur, [k.code]: e.target.value }))}>
          <option value="">{k.label} —</option>
          {k.values.map((v) => (
            <option key={v.code} value={v.code}>
              {v.label}
            </option>
          ))}
        </select>
      ))}
      {name && <span className="ts-muted">상품담보명: {name}</span>}
      <button
        type="button"
        className="primary"
        onClick={() => {
          setTried(true);
          if (problem || !coverage) return;
          edit.dispatch({ type: "add", row: { section, coverageId: coverage.id, coverageCode: coverage.code, coverageName: coverage.name, attributes, name } });
          close();
        }}
      >
        추가
      </button>
      <button type="button" onClick={close}>
        닫기
      </button>
      {(tried || (coverage && problem && problem !== "담보를 고르세요")) && problem && (
        <span className="ts-form-error" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}
