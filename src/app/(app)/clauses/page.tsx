import { redirect } from "next/navigation";

import { queryOf } from "@/app/_lib/list";

/** 옛 주소 — 공용조항은 함수조항이 됐다. 조회는 `/functions` (기능/함수조항 §4.1). 검색어 등 쿼리는 그대로 넘긴다. */
export default async function LegacyClausesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(`/functions${queryOf(await searchParams)}`);
}
