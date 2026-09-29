import { describe, expect, it, vi } from "vitest";

import type { MenuItem, MenuSections } from "@/app/(app)/documents/[id]/_components/menus";
import { CLAUSE_LINE_ID, clauseBodyToTree, indexTree, sequentialIds } from "@/domain/document";

import { REFUSE, clauseBlockMenu, clauseBodyMenu, clauseInlineMenu, type ClauseMenuEnv } from "./clauseMenus";

const labels = (sections: MenuSections) => sections.flat().map((item) => item.label);
const find = (sections: MenuSections, label: string): MenuItem | undefined => sections.flat().find((item) => item.label === label);

function env(mode: "inline" | "block", onRefuse = vi.fn()): ClauseMenuEnv {
  const tree =
    mode === "block"
      ? clauseBodyToTree("block", [{ id: "p1", kind: "paragraph", children: [{ id: "t", kind: "text", text: "항" }], items: [{ id: "i1", kind: "item", children: [] }] }])
      : clauseBodyToTree("inline", [{ id: "t", kind: "text", text: "문구" }]);
  return { tree, ix: indexTree(tree), docKind: "special", newId: sequentialIds("n"), mode, options: [{ code: "O01", label: "기일" }], onRefuse };
}

describe("함수조항 에디터 메뉴 — 문면 메뉴를 함수조항 자리로 거른다 (기능/함수조항 §4.3)", () => {
  it("문장 속: 문면의 넣기 도구 + 옵션 자리, 함수조항 참조는 누르면 거부 배너", () => {
    const onRefuse = vi.fn();
    const e = env("block", onRefuse);
    const sections = clauseInlineMenu(e, { parentId: "p1" }, [{ text: "항" }, { caret: true }]);
    expect(labels(sections)).toEqual(expect.arrayContaining(["치환 슬롯…", "조 참조…", "별표 참조…", "문장 안 조건", "옵션 자리 — 기일", "아래에 항 추가", "호 추가"]));
    const clauseRef = find(sections, "함수조항(문장 안)…")!;
    expect(clauseRef.refusal).toBe(REFUSE.clauseRef); // 툴바는 잠그고 이 사유를 tooltip 으로
    expect(clauseRef.action.do).toBe("ops");
    if (clauseRef.action.do === "ops" && typeof clauseRef.action.ops === "function") expect(clauseRef.action.ops(e.tree)).toEqual([]);
    expect(onRefuse).toHaveBeenCalledWith(REFUSE.clauseRef);
  });

  it("옵션 자리 넣기는 커서 자리에 옵션 운반체를 끼운다", () => {
    const e = env("inline");
    const item = find(clauseInlineMenu(e, { parentId: CLAUSE_LINE_ID }, [{ caret: true }, { text: "문구" }]), "옵션 자리 — 기일")!;
    const ops = item.action.do === "ops" && typeof item.action.ops === "function" ? item.action.ops(e.tree) : [];
    expect(ops[0]).toMatchObject({ type: "setInlines", at: { parentId: CLAUSE_LINE_ID }, runs: [{ node: { kind: "clauseInlineRef", clauseCode: "option:O01" } }, { id: "t", text: "문구" }] });
  });

  it("「문구」 유형은 문장 한 줄 — 블록 조작이 없다", () => {
    const sections = clauseInlineMenu(env("inline"), { parentId: CLAUSE_LINE_ID }, [{ caret: true }]);
    expect(labels(sections)).not.toContain("아래에 항 추가");
    expect(clauseBodyMenu(env("inline"))).toEqual([]);
  });

  it("블록 메뉴: 표 · 함수조항(조 단위)은 싣지 않거나 거부, 정적 마스터 박스는 넣는다(잎), 호에는 조건으로 감싸기가 없다", () => {
    const e = env("block");
    const paragraph = labels(clauseBlockMenu(e, "p1"));
    expect(paragraph).toContain("조건으로 감싸기");
    expect(paragraph.some((l) => l.includes("표") || l.includes("박스 함수조항"))).toBe(false);
    expect(paragraph).toContain("아래에 박스 추가…");
    expect(labels(clauseBlockMenu(e, "i1"))).toContain("아래에 박스 추가…");
    expect(labels(clauseBlockMenu(e, "i1"))).not.toContain("조건으로 감싸기");
  });

  it("본문 빈 자리: 항 추가 · 조건 블록 넣기 + 조 · 관 추가는 거부 배너", () => {
    const onRefuse = vi.fn();
    const e = env("block", onRefuse);
    const sections = clauseBodyMenu(e);
    expect(labels(sections)).toEqual(["항 추가", "박스 추가…", "조건 블록 넣기", "조 추가", "관 추가", "함수조항 참조 추가…"]);
    const article = find(sections, "조 추가")!;
    if (article.action.do === "ops" && typeof article.action.ops === "function") article.action.ops(e.tree);
    expect(onRefuse).toHaveBeenCalledWith(REFUSE.article);
  });
});
