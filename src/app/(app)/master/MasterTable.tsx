/**
 * 마스터 표 — L1 목록 (2026-09-27 두 칸 → 목록 + 상세 화면 전환). 행 = 필드 (폼 › 필드를 코드 순서 그대로 평탄화), 읽기 전용 (기능/마스터 §4.1).
 *
 * - 컬럼: 폼(→ 폼 상세 `/master/{폼키}`) · 표시명 · 타입 · 코드(폼키.필드키 — 둘 다 → 필드 상세 `/master/{폼키.필드키}`).
 *   폼 셀은 같은 폼의 연속 행을 한 칸으로 묶는다(rowSpan) — 폼이 페이지 경계에 걸리면 다음 페이지에서 다시 한 번 선다.
 *   타입 칸은 타입만 — 어떤 목록인지는 툴팁과 상세가 말한다.
 * - 행 어디를 눌러도 필드 상세, 묶인 폼 칸은 폼 상세 (`RowLink` — 칸 안의 진짜 링크는 키보드 · 가운데 클릭용으로 남긴다).
 * - 검색은 다른 목록과 같은 GET `?q=` (`ListFilterBar` 대신 같은 모양의 GET 폼 — 이 화면은 기준일·미확정이 없다). 검색어를 바꾸면 페이지는 1 로.
 * - 페이저는 `ListShell` 의 것 · 파라미터는 다른 목록과 같은 `page`.
 */
import Link from "next/link";

import { IconSearch } from "@/app/_components/icons";
import { ListShell } from "@/app/_components/ListShell";
import { ENTITY_LABEL, FIELD_LABEL } from "@/app/_lib/labels";

import type { MasterRow } from "./filterRows";
import { fieldHref, formHref } from "./lib";
import { ClickCell, ClickRow } from "./RowLink";

export const MASTER_PAGE_SIZE = 20;

export interface MasterTableProps {
  /** 이 페이지에 보일 행 (필터 · 페이징 후). */
  rows: readonly MasterRow[];
  /** 필터 적용 후 전체 건수 — 페이저의 「총 N건」. */
  total: number;
  page: number;
  /** 코드에 정의된 필드가 하나라도 있는가 — 없으면 검색 결과 0 과 다른 문구. */
  defined: boolean;
  q: string;
}

/** 폼 칸의 rowSpan — 같은 폼 연속 행의 첫 행이면 그 길이, 이어지는 행이면 0(칸을 그리지 않는다). */
function formSpan(rows: readonly MasterRow[], i: number): number {
  const key = rows[i]!.formKey;
  if (i > 0 && rows[i - 1]!.formKey === key) return 0;
  let n = 1;
  while (i + n < rows.length && rows[i + n]!.formKey === key) n++;
  return n;
}

export function MasterTable({ rows, total, page, defined, q }: MasterTableProps) {
  return (
    <div className="ts-master-list">
      <ListShell
        filters={
          <>
            <label className="ts-searchbox">
              <IconSearch />
              <span className="sr-only">검색</span>
              <input type="search" name="q" defaultValue={q} placeholder="코드 · 표시명 · 폼" aria-label="코드 · 표시명 · 폼 검색" />
            </label>
            <button type="submit">검색</button>
          </>
        }
        total={total}
        page={page}
        pageSize={MASTER_PAGE_SIZE}
        basePath="/master"
        query={{ q }}
        empty={<p className="ts-master-empty">{defined ? "맞는 항목이 없습니다" : "정의된 입력 항목이 없습니다 — 코드에 폼을 더하면 여기 보입니다"}</p>}
      >
        <div className="ts-master-scroll">
          <table className="ts-table">
            <thead>
              <tr>
                <th className="col-fixed-md">{ENTITY_LABEL.form}</th>
                <th className="col-flex">표시명</th>
                <th className="col-fixed-md">{FIELD_LABEL.valueType}</th>
                <th className="col-fixed-md">{FIELD_LABEL.code}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const span = formSpan(rows, i);
                return (
                  <ClickRow key={row.path} href={fieldHref(row.path)}>
                    {span > 0 ? (
                      <ClickCell href={formHref(row.formKey)} rowSpan={span} className="col-fixed-md ts-master-nowrap ts-master-form">
                        <Link href={formHref(row.formKey)} title={`${row.formLabel} · ${row.levelLabel}`}>
                          {row.formLabel}
                        </Link>
                      </ClickCell>
                    ) : null}
                    <td className="col-flex ts-master-field">
                      <Link href={fieldHref(row.path)}>{row.label}</Link>
                    </td>
                    <td className="col-fixed-md ts-master-type" title={row.enumLabel ? `${row.typeLabel}: ${row.enumLabel}` : row.typeLabel}>
                      {row.typeLabel}
                    </td>
                    <td className="col-fixed-md ts-mono ts-master-nowrap">
                      <Link href={fieldHref(row.path)}>{row.path}</Link>
                    </td>
                  </ClickRow>
                );
              })}
            </tbody>
          </table>
        </div>
      </ListShell>
    </div>
  );
}
