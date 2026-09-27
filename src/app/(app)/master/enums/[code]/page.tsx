import { redirect } from "next/navigation";

/** 옛 주소 — 열거형변수 상세는 `/enums/<code>` (기능/열거형 §4.3). */
export default async function LegacyMasterEnumPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/enums/${encodeURIComponent(code)}`);
}
