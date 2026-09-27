/**
 * 구분자 조회 (L1) — 화면은 컬럼만 적고, 조립은 ListPage 가 한다.
 *
 * 2026-09-12 — 구분자가 식 하나가 되면서 「유형」 컬럼·필터가 사라졌다 (ADR-0037).
 * 남는 것은 코드 · 구분자명 · 레벨 · 최종수정 · 수정자다.
 * 2026-09-17 — 「결과 타입」 열이 붙었다 (기능/구분자 §3.1) — 명시한 것만 보이고 미지정은 `—` 다 (추론은 상세에서).
 * 2026-09-17 — 「경고」 열 + 필터 「경고 있는 구분자」 (기능/구분자 §3.3). 목록의 경고는 별칭뿐이다.
 *
 * 2026-09-27 — 5층 모양 트리(ADR-0070 결정 8)를 같은 날 다시 평면 표로 되돌렸다 — 가지가 다섯 겹이라 훑기 어렵다(UI 검토).
 * 레벨은 맨 앞 컬럼이고 헤더가 곧 필터다(다른 목록과 같은 문법). 행은 레벨 깊이(상품 → 급부) 순, 같은 레벨 안은 코드 순.
 */
import { EmptyState } from "@/app/_components/EmptyState";
import type { ColumnFilterSpec } from "@/app/_components/ListFilters";
import { ListPage, codeCol, nameCol, type ListColumn } from "@/app/_components/ListPage";
import { ENTITY_LABEL, FIELD_LABEL, LEVEL_LABEL, NAME_LABEL, newLabel, searchPlaceholder } from "@/app/_lib/labels";
import { formatDate, includesQuery, paginate } from "@/app/_lib/list";
import { DISCRIMINATORS_MENU } from "@/app/_lib/menu";
import type { Discriminator } from "@/domain/catalog/types";
import { levelDepth } from "@/domain/master";
import { ATTACH_LEVELS } from "@/domain/types";
import { getServices } from "@/lib/services";

import { resultTypeLabel, warningBadges } from "./lib";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const FILTERS = [
  { key: "level", label: "레벨", options: ATTACH_LEVELS.map((value) => ({ value, label: LEVEL_LABEL[value] })) },
  // 「경고 있는 구분자」 — 경고는 저장되고 배지로 남으니 모아 볼 자리가 있어야 한다 (기능/구분자 §3.3)
  { key: "warning", label: "경고", options: [{ value: "yes", label: "있음" }, { value: "no", label: "없음" }] },
] as const satisfies readonly ColumnFilterSpec[];

interface SearchParams {
  error?: string;
  q?: string;
  level?: string;
  warning?: string;
  page?: string;
}

export default async function CatalogListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const services = getServices();
  // 목록의 경고는 별칭뿐이다 — 「깨질 사용처」는 구분자마다 그래프를 봐야 해서 상세에서만 (services.catalog.listWarnings)
  const [defs, audits, users, enums, warnings] = await Promise.all([services.catalog.list(), services.catalog.audits(), services.auth.listUsers(), services.catalog.listEnums(), services.catalog.listWarnings()]);
  const userName = new Map(users.map((u) => [u.id, u.name] as const));
  const enumName = new Map(enums.map((e) => [e.code, e.label] as const));
  const q = (sp.q ?? "").trim();
  const level = sp.level ?? "";
  const warning = sp.warning ?? "";
  const filtered = defs
    .filter((d) => {
      if (!includesQuery(q, [d.code, d.label])) return false;
      if (level && d.level !== level) return false;
      if (warning === "yes" && !warnings.has(d.code)) return false;
      if (warning === "no" && warnings.has(d.code)) return false;
      return true;
    })
    .sort((a, b) => levelDepth(a.level) - levelDepth(b.level) || a.code.localeCompare(b.code));
  const { rows, total, page } = paginate(filtered, sp.page, PAGE_SIZE);
  const createParams = new URLSearchParams();
  if (level) createParams.set("level", level);

  const columns: readonly ListColumn<Discriminator>[] = [
    { filter: FILTERS[0], width: "sm", cell: (d) => LEVEL_LABEL[d.level] },
    codeCol((d) => d.code),
    nameCol(NAME_LABEL.discriminator, (d) => d.label, (d) => `/catalog/${d.code}`),
    { header: FIELD_LABEL.resultType, width: "sm", cell: (d) => (d.resultType ? resultTypeLabel(d.resultType, (code) => enumName.get(code)) : "—") },
    { filter: FILTERS[1], width: "sm", cell: (d) => { const badges = warningBadges(warnings.get(d.code) ?? []); return badges.length === 0 ? "—" : badges.map((b) => <span key={b.label} className="ts-badge warning" title={b.title}>{b.label}</span>); } },
    { header: FIELD_LABEL.updatedAt, width: "md", mono: true, cell: (d) => { const audit = audits.get(d.code); return audit ? formatDate(audit.updatedAt) : "—"; } },
    { header: FIELD_LABEL.updatedBy, width: "md", cell: (d) => { const by = audits.get(d.code)?.updatedBy; return (by && userName.get(by)) ?? "—"; } },
  ];

  return (
    <ListPage
      title={DISCRIMINATORS_MENU.label}
      create={{ href: `/catalog/new${createParams.size ? `?${createParams}` : ""}`, label: newLabel(ENTITY_LABEL.discriminator) }}
      search={{ placeholder: searchPlaceholder(FIELD_LABEL.code, NAME_LABEL.discriminator) }}
      filters={FILTERS}
      columns={columns}
      rows={rows}
      rowKey={(d) => d.code}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      basePath="/catalog"
      query={{ q, level, warning }}
      error={sp.error}
      empty={defs.length === 0 ? (
        <EmptyState
          what="구분자는 조문이 묻는 개념 하나에 이름을 붙인 식이다 — 입력 항목에 연산을 걸어 조문에 내보낸다."
          example="보험금명 = 담보.담보 기본.보험금명 · 면책구분 = any(급부.보험금지급.면책여부)"
          actionHref="/catalog/new"
          actionLabel="새 구분자 만들기"
        />
      ) : <p className="ts-empty-what">이 조건에 맞는 구분자가 없습니다.</p>}
    />
  );
}
