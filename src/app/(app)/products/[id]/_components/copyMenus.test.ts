/**
 * 조 편집 패널의 툴바 · 오른쪽 클릭 목록 (ADR-0079 · 기능/상품 §4.6) — 문면 저작 목록을 그대로 짓고, 조 밖을 바꾸는 항목을 잠근다.
 */
import { describe, expect, it } from "vitest";

import { placeMenu, type MenuEnv } from "@/app/(app)/documents/[id]/_components/menus";
import { indexTree, type DocumentNode } from "@/domain/document";

import { COPY_REFUSAL, copyScopeMenu } from "./copyMenus";

const tree: DocumentNode = {
  id: "doc",
  kind: "document",
  title: "보통약관",
  children: [
    { id: "a1", kind: "article", title: "목적", children: [{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "본문" }] }] },
    { id: "a2", kind: "article", title: "지급", children: [] },
  ],
};
let n = 0;
const env: MenuEnv = { tree, ix: indexTree(tree), docKind: "general", newId: () => `new-${++n}` };
const state = (sections: ReturnType<typeof copyScopeMenu>, label: string) => {
  const item = sections.flat().find((i) => i.label === label);
  return item ? (item.refusal ? "잠김" : "열림") : "없음";
};

describe("copyScopeMenu — 조 사본은 그 조 안만", () => {
  it("조 제목 자리 — 조 · 관 넣기 · 조 옮기기 · 복제 · 삭제 · 조 감싸기는 잠그고, 조 안에 넣기는 연다", () => {
    const place = { kind: "articleTitle", id: "a1" } as const;
    const sections = copyScopeMenu(placeMenu(env, place), place, "a1");
    for (const label of ["아래에 조 추가", "아래에 관 추가", "아래로", "복제", "삭제", "조건으로 감싸기"]) expect(state(sections, label)).toBe("잠김");
    for (const label of ["항 추가", "함수조항 참조 추가…", "박스 추가…"]) expect(state(sections, label)).toBe("열림");
    expect(sections.flat().find((i) => i.label === "삭제")?.refusal).toBe(COPY_REFUSAL);
  });

  it("조 안의 블록 — 블록 넣기 · 옮기기 · 복제 · 삭제 · 감싸기는 그대로", () => {
    const place = { kind: "block", id: "p1" } as const;
    const sections = copyScopeMenu(placeMenu(env, place), place, "a1");
    for (const label of ["아래에 항 추가", "삭제", "복제", "조건으로 감싸기"]) expect(state(sections, label)).toBe("열림");
  });
});
