/**
 * 문면 화면의 작은 순수 함수 — 목록 경로 · 폼 글자 · 이동 자리 · 줄 목록. `*.test.ts` 로 검증.
 * (커맨드 자체의 검증은 도메인 `applyCommand` 몫 — 여기는 입력 → 커맨드 인자 변환만.)
 */
import type { Position } from "@/domain/document";
import { indexTree, type DocumentNode } from "@/domain/document";
import type { Id } from "@/domain/types";

/** 사이드바·목록이 종류를 가르는 쿼리 값 (`/documents?kind=`). 도메인 `kind` 의 special 은 화면에서 「담보약관 템플릿」이다. */
export type DocListKind = "general" | "coverage";

/** 문서 종류 → 그 종류의 목록 경로. 사이드바(`layout.tsx`)와 같은 쿼리를 쓴다. */
export function docListHref(kind: "general" | "special" | DocListKind): string {
  return `/documents?kind=${kind === "special" || kind === "coverage" ? "coverage" : "general"}`;
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** 노드(또는 가지) 하나 위/아래로 옮긴 새 Position — 형제가 없거나 경계면 undefined(이동 없음). */
export function moveTarget(tree: DocumentNode, nodeId: Id, dir: -1 | 1): Position | undefined {
  const ix = indexTree(tree);
  const e = ix.nodes.get(nodeId);
  if (!e || e.parentId === undefined) return undefined;
  const total = [...ix.nodes.values()].filter((o) => o.parentId === e.parentId && o.slot === e.slot).length;
  const next = e.index + dir;
  if (next < 0 || next >= total) return undefined;
  return { parentId: e.parentId, slot: e.slot, index: next };
}

/** textarea 줄 목록 — 줄마다 하나, 앞뒤 공백 정리, 빈 줄 제거. */
export function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}
