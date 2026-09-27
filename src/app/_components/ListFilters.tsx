"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { IconCalendar, IconClose, IconSearch } from "./icons";
import { changedQuery } from "../_lib/list";

export interface FilterOption {
  value: string;
  label: string;
}

export interface ColumnFilterSpec {
  key: string;
  label: string;
  options: readonly FilterOption[];
}

function useListQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const replace = useCallback((changes: Record<string, string | undefined>) => {
    const query = changedQuery(searchParams.toString(), changes);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  return { searchParams, replace };
}

export function ListFilterBar({
  placeholder,
  filters,
  today,
  queryKey = "q",
}: {
  placeholder: string;
  filters: readonly ColumnFilterSpec[];
  today: string;
  /** 검색어를 실을 쿼리 파라미터. 한 화면에 목록이 둘이면(문면) 서로 다른 이름을 준다. */
  queryKey?: string;
}) {
  const { searchParams, replace } = useListQuery();
  const urlQuery = searchParams.get(queryKey) ?? "";
  const composing = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  const schedule = (value: string) => {
    window.clearTimeout(timer.current);
    if (value === urlQuery) return;
    timer.current = window.setTimeout(() => replace({ [queryKey]: value.trim() || undefined }), 300);
  };

  const active = filters.flatMap((filter) => {
    const value = searchParams.get(filter.key);
    const option = filter.options.find((item) => item.value === value);
    return option ? [{ filter, option }] : [];
  });

  return (
    <div className="ts-filterbar-stack">
      <div className="ts-filterbar">
        <label className="ts-searchbox">
          <IconSearch />
          <span className="sr-only">검색</span>
          <input
            type="search"
            key={urlQuery}
            defaultValue={urlQuery}
            placeholder={placeholder}
            onChange={(event) => {
              if (!composing.current) schedule(event.target.value);
            }}
            onCompositionStart={() => {
              composing.current = true;
              window.clearTimeout(timer.current);
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              schedule(event.currentTarget.value);
            }}
          />
        </label>
        <span className="ts-filterbar-spacer" />
        {active.length > 1 ? (
          <button type="button" className="ts-filter-clear" onClick={() => replace(Object.fromEntries(filters.map((f) => [f.key, undefined])))}>
            모두 지우기
          </button>
        ) : null}
        {/* 이력(ADR-0026)은 아직 없다. 화면 자리는 잡되 **입력으로 보이면 안 된다** —
            테두리 있는 disabled 입력은 「잠긴 칸」이 아니라 「고장난 칸」으로 읽힌다 (§1.2). */}
        <span className="ts-filter-locked" title="기준일 — 이력 기능이 붙으면 여기서 고른다. 지금은 늘 오늘이다">
          <IconCalendar /> <span className="ts-mono" aria-label={`기준일 ${today}`}>{today}</span>
        </span>
        <span className="ts-filter-locked" title="미확정 포함 — 이력 기능이 붙으면 여기서 켠다">
          미확정 포함 <span className="ts-mono">꺼짐</span>
        </span>
      </div>
      {active.length > 0 ? (
        <div className="ts-chips" aria-label="적용된 필터">
          {active.map(({ filter, option }) => (
            <span className="ts-chip" key={filter.key}>
              {filter.label}: {option.label}
              <button type="button" title={`${filter.label} 필터 해제`} aria-label={`${filter.label} 필터 해제`} onClick={() => replace({ [filter.key]: undefined })}>
                <IconClose />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ColumnFilter({ spec }: { spec: ColumnFilterSpec }) {
  const { searchParams, replace } = useListQuery();
  const details = useRef<HTMLDetailsElement>(null);
  const active = Boolean(searchParams.get(spec.key));
  return (
    <details className="ts-colfilter" ref={details}>
      <summary aria-label={`${spec.label} 필터`}>{spec.label} {active ? "▼" : "▾"}</summary>
      <div className="ts-colfilter-popover">
        {spec.options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={searchParams.get(spec.key) === option.value}
            onClick={() => {
              replace({ [spec.key]: option.value });
              details.current?.removeAttribute("open");
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}
