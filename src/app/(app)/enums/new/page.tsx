import { EnumCreator } from "./EnumCreator";

/** 열거형변수 생성 — 이름 · 필드 · 값을 한 번에 (기능/열거형 §4.2). 목록 검색어(`?q=`)는 이름 칸에 프리필한다. */
export default async function NewEnumPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  return <div><EnumCreator suggested={(sp.q ?? "").trim()} /></div>;
}
