/**
 * 새 공용조항 — 이 화면 자체가 상세와 같은 에디터다 (기능/함수조항 §4.2).
 * 유형은 목록 `+` 메뉴의 고름(`?type=inline|block|item|subitem`)이 처음 값이고, 본문을 쓰기 전까지 화면에서 바꿀 수 있다.
 * 이름 · 유형만 받는 중간 화면은 없고, 저장하는 순간 검사 ① 을 통과해야 만들어진다.
 */
import { randomUUID } from "node:crypto";

import { CLAUSE_MODES, type ClauseMode } from "@/domain/clause/types";

import { ClauseAuthoring } from "../_components/ClauseAuthoring";
import { loadClauseEditorData } from "../editorData";

export const dynamic = "force-dynamic";

export default async function NewClausePage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const mode: ClauseMode = CLAUSE_MODES.find((m) => m === type) ?? "inline";
  const data = await loadClauseEditorData();
  return <ClauseAuthoring key={mode} label="" mode={mode} body={[]} options={[]} params={[]} locals={[]} data={data} startId={randomUUID()} />;
}
