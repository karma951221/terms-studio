/**
 * L1 조회 화면 하나 (디자인원칙 §2 L1) — 제목 줄 · 필터바 · 표 · 페이저 · 빈 상태를 통째로 그린다.
 *
 * 목록 화면 8개가 같은 조립을 손으로 반복하던 것을 여기로 모았다. 페이지가 하는 일은
 * **무엇을 보일지 기술하는 것**뿐이다 — 데이터를 고르고(`rows`), 컬럼을 적고(`columns`),
 * 빈 상태 문구를 준다. 조립 방식이 바뀌면 이 파일 하나만 고친다.
 *
 * 컬럼을 강제하지 않는다. §2 L1 은 「1열은 항상 코드」를 정했지만 담보·상품 마스터에는 코드가
 * 없다 — **도메인에 없는 값을 화면이 지어내지 않는다**(작업지시). 그래서 낼 수 있는 컬럼만
 * 각 화면이 적고, 이 컴포넌트는 그것을 같은 모양으로 그리는 데까지만 관여한다.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { ErrorBanner } from "./ErrorBanner";
import { ColumnFilter, ListFilterBar, type ColumnFilterSpec } from "./ListFilters";
import { ListShell } from "./ListShell";
import { IconPlus } from "./icons";
import { formatDate, todayInSeoul } from "../_lib/list";
import { FIELD_LABEL } from "../_lib/labels";

/** 컬럼 폭은 이름으로 고른다 — 화면마다 `col-fixed-md` 를 외우지 않게. */
const WIDTH_CLASS = {
  code: "col-code",
  flex: "col-flex",
  sm: "col-fixed-sm",
  md: "col-fixed-md",
  num: "col-num",
  act: "col-act",
  values: "col-values",
} as const;

export interface ListColumn<T> {
  /** 헤더 이름. `filter` 를 주면 그 자리에 필터 드롭다운이 서므로 생략한다. */
  header?: ReactNode;
  /** 이 컬럼 헤더가 곧 필터 — 거를 수 있는 것과 보이는 것을 어긋나지 않게 (§2 L1). */
  filter?: ColumnFilterSpec;
  /** 기본은 남는 폭을 먹는 `flex`. 남는 폭은 한 컬럼만 먹어야 한다 (§2 L1). */
  width?: keyof typeof WIDTH_CLASS;
  /** 코드 · 날짜처럼 세로줄이 맞아야 하는 칸. */
  mono?: boolean;
  cell: (row: T) => ReactNode;
}

function cellClass<T>(column: ListColumn<T>): string {
  return [WIDTH_CLASS[column.width ?? "flex"], column.mono ? "ts-mono" : null].filter(Boolean).join(" ");
}

export function ListPage<T>({
  title,
  heading: headingKind = "page",
  create,
  tabs,
  search,
  filters = [],
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  basePath,
  query,
  pageParam,
  empty,
  error,
  children,
}: {
  title: ReactNode;
  /**
   * 제목의 급. `page` 는 화면 제목(h1). 한 화면에 목록이 여럿이면 `section` — 위에 괘선을 그어
   * 구획을 만든다(문면). 탭이 이미 구획을 만든 자리는 `sub` — 괘선 없이 작은 제목만(유형).
   */
  heading?: "page" | "section" | "sub";
  /** 제목 줄 오른쪽 `+` 아이콘 버튼. 없으면 안 그린다. */
  create?: { href: string; label: string };
  /** 제목 줄 아래 하위 탭 줄 — 탭이 둘 이상일 때만 준다 (기본정보 `열거형 | 폼 | 구분자`). */
  tabs?: ReactNode;
  /** 검색창 안내 문구. 없으면 필터바 자체를 안 그린다. */
  search?: { placeholder: string; queryKey?: string };
  filters?: readonly ColumnFilterSpec[];
  columns: readonly ListColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  query?: Record<string, string | undefined>;
  pageParam?: string;
  empty?: ReactNode;
  error?: string;
  /** 표 아래 붙는 것 — 별표의 삭제 확인처럼 목록에 딸린 조각. */
  children?: ReactNode;
}) {
  const heading = (
    <div className="ts-list-head">
      {headingKind === "page" ? <h1 className="ts-h1">{title}</h1> : <h2 className={headingKind === "section" ? "ts-h2" : "ts-list-title"}>{title}</h2>}
      {create ? (
        <Link href={create.href} className="ts-iconbtn" title={create.label} aria-label={create.label}>
          <IconPlus />
        </Link>
      ) : null}
    </div>
  );

  return (
    <div>
      <ErrorBanner message={error} />
      <ListShell
        heading={heading}
        {...(tabs ? { toolbar: tabs } : {})}
        {...(search
          ? {
              filters: (
                <ListFilterBar
                  placeholder={search.placeholder}
                  filters={filters}
                  today={todayInSeoul()}
                  {...(search.queryKey ? { queryKey: search.queryKey } : {})}
                />
              ),
              interactiveFilters: true,
            }
          : {})}
        total={total}
        page={page}
        pageSize={pageSize}
        basePath={basePath}
        {...(query ? { query } : {})}
        {...(pageParam ? { pageParam } : {})}
        {...(empty !== undefined ? { empty } : {})}
      >
        <table className="ts-table">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={index} className={WIDTH_CLASS[column.width ?? "flex"]}>
                  {column.filter ? <ColumnFilter spec={column.filter} /> : column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column, index) => (
                  <td key={index} className={cellClass(column)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ListShell>
      {children}
    </div>
  );
}

/* ── 되풀이되는 컬럼 ──────────────────────────────────────────────────────── */

/** 1열의 코드 — mono 고정폭. 코드는 식별자이므로 코드처럼 보인다 (§2 L1). */
export function codeCol<T>(get: (row: T) => string): ListColumn<T> {
  return { header: FIELD_LABEL.code, width: "code", cell: (row) => <code>{get(row)}</code> };
}

/** 상세로 들어가는 이름 칸 — 남는 폭을 먹는 단 하나의 컬럼. */
export function nameCol<T>(header: string, get: (row: T) => string, href: (row: T) => string): ListColumn<T> {
  return { header, width: "flex", cell: (row) => <Link href={href(row)}>{get(row)}</Link> };
}

export function dateCol<T>(header: string, get: (row: T) => Date): ListColumn<T> {
  return { header, width: "md", mono: true, cell: (row) => formatDate(get(row)) };
}

/** 마지막으로 저장한 사람 — id 를 이름으로 바꿔 보인다 (§9.4 실체는 표시명으로 부른다). */
export function userCol<T>(header: string, get: (row: T) => string, names: Map<string, string>): ListColumn<T> {
  return { header, width: "md", cell: (row) => names.get(get(row)) ?? "—" };
}
