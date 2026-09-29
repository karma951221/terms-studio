import { redirect } from "next/navigation";

import { queryOf } from "@/app/_lib/list";

/** 옛 주소 — 함수조항 상세는 `/functions/<code>` (기능/함수조항 §4.3). `?node=` 등 쿼리는 그대로 넘긴다. */
export default async function LegacyClausePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  redirect(`/functions/${encodeURIComponent(code)}${queryOf(await searchParams)}`);
}
