/**
 * 새 공용조항 — 이 화면 자체가 상세와 같은 세 단 에디터다 (기능/공용조항 §4.2).
 * 유형은 목록 `+` 메뉴에서 골라 쿼리(`?type=inline|block`)로 들어온다 — 에디터 안에는 유형을 바꾸는 조작이 없다.
 * 이름 · 유형만 받는 중간 화면은 없고, 저장하는 순간 검사 ① 을 통과해야 만들어진다.
 */
import { ClauseAuthoring } from "../_components/ClauseAuthoring";
import { loadClauseEditorData } from "../editorData";

export const dynamic = "force-dynamic";

export default async function NewClausePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const mode = type === "block" ? "block" : "inline";
  const data = await loadClauseEditorData();
  return <ClauseAuthoring key={mode} label="" mode={mode} body={[]} options={[]} data={data} />;
}
