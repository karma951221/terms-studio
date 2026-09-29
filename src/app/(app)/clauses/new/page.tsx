import { redirect } from "next/navigation";

import { queryOf } from "@/app/_lib/list";

/** 옛 주소 — 함수조항 생성은 `/functions/new` (기능/함수조항 §4.2). `?type=` 은 그대로 넘긴다. */
export default async function LegacyNewClausePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(`/functions/new${queryOf(await searchParams)}`);
}
