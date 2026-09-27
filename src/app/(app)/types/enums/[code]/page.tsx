import { redirect } from "next/navigation";

/** 옛 주소 — 열거형변수 상세는 `/master/enums/<code>` (기능/마스터 §4.4 ~ §4.6). */
export default async function LegacyTypeEnumPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/master/enums/${encodeURIComponent(code)}`);
}
