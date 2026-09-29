import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, sequentialIds, type DocumentNode } from "@/domain/document";

import { articleMenu, blockMenu, boxPickItems, chipMenu, clausePickItems, condMenu, inlineInsertItems, type MenuSections } from "./menus";

const labels = (s: MenuSections) => s.flat().map((i) => `${i.label}${i.disabled ? "(잠김)" : ""}`);

function env(tree: DocumentNode, docKind: "special" | "general" = "general") {
  return { tree, ix: indexTree(tree), docKind, newId: sequentialIds("m") };
}

/** 관 › 조(항 › 호 › 목) — subitem n1 · item n2 · paragraph n3 · article n4 · section n5 · document n6. */
function tree(): DocumentNode {
  const b = nodeBuilders(sequentialIds("n"));
  return b.document("D", [b.section("관", [b.article("가", [b.paragraph([], [b.item([], [b.subitem([])])])])])]);
}

describe("오른쪽 클릭 메뉴 — 허용 자식 규칙대로 (기능/문면 §3.2 · §4.3)", () => {
  it("항 — 아래에 항 · 호 추가 · 표 · 공용조항(조 단위) · 박스(정적 마스터) · 감싸기 · 이동(맨 위 · 맨 아래 잠김) · 복제 · 삭제", () => {
    expect(labels(blockMenu(env(tree()), "n3"))).toEqual([
      "아래에 항 추가",
      "호 추가",
      "아래에 표 추가…",
      "아래에 글머리 목록 추가",
      "아래에 공용조항(조 단위) 추가…",
      "아래에 박스 추가…",
      "조건으로 감싸기",
      "위로(잠김)",
      "아래로(잠김)",
      "복제",
      "삭제",
    ]);
  });

  it("호 — 항 목록 자리라 호 · 표 · 글머리 목록 · 박스 공용조항 · 박스, 공용조항(조 단위)은 없다 · 목 뒤는 목 · 글머리 목록(박스 없음)", () => {
    expect(labels(blockMenu(env(tree()), "n2")).slice(0, 6)).toEqual(["아래에 호 추가", "목 추가", "아래에 표 추가…", "아래에 글머리 목록 추가", "아래에 박스 공용조항 추가…", "아래에 박스 추가…"]);
    expect(labels(blockMenu(env(tree()), "n1")).slice(0, 3)).toEqual(["아래에 목 추가", "아래에 글머리 목록 추가", "조건으로 감싸기"]);
  });

  it("조 제목이면 그 조를 감싸고, 조 본문(고른 블록 없음)이면 새 조건 블록을 넣는다", () => {
    expect(labels(articleMenu(env(tree()), "n4"))).toContain("조건으로 감싸기");
    const body = labels(articleMenu(env(tree()), "n4", false));
    expect(body).toContain("조건 블록 넣기");
    expect(body).not.toContain("조건으로 감싸기");
  });

  it("조 제목 — 관 안이면 관 추가가 없고, 담보약관이면 조연결", () => {
    expect(labels(articleMenu(env(tree()), "n4"))).not.toContain("아래에 관 추가");
    expect(labels(articleMenu(env(tree(), "special"), "n4"))).toContain("조연결…");
    const b = nodeBuilders(sequentialIds("n"));
    const top = b.document("D", [b.article("가", [])]);
    expect(labels(articleMenu(env(top), top.children[0].id)).slice(0, 5)).toEqual(["아래에 조 추가", "아래에 관 추가", "항 추가", "공용조항 참조 추가…", "박스 추가…"]);
  });

  it("조 제목 — 조 끝에 공용조항(조 단위)을 넣는 팝업 (첫 자리가 공용조항인 조 · 2026-09-28)", () => {
    const item = articleMenu(env(tree(), "special"), "n4").flat().find((i) => i.label === "공용조항 참조 추가…");
    expect(item?.action).toEqual({ do: "popup", popup: { kind: "clauseBlock", at: { parentId: "n4" } } });
  });

  it("조건 머리 · 칩 · 문장 속 넣기 — 가지가 하나면 가지 삭제 잠김, 문장 안 조건 가지 안이면 문장 안 조건 없음", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const cond = b.condBlock([b.branch("D0001 = true", [b.paragraph([b.slot("D0002")])])]); // slot n1 · p n2 · br n3 · cond n4
    const d = b.document("D", [b.article("가", [cond])]);
    expect(labels(condMenu(env(d), "n3"))).toEqual([
      "가지 추가(ELIF)",
      "ELSE 가지 추가",
      "이 가지 삭제(잠김)",
      "이 가지에 항 추가",
      "이 가지에 글머리 목록 추가",
      "이 가지에 표 추가…",
      "이 가지에 박스 추가…",
      "조건 풀기 — 이 가지 내용만 남긴다",
      "조건 블록 삭제",
    ]);
    expect(labels(chipMenu(env(d), "n1"))).toEqual(["고치기…", "삭제"]);
    // 조 자리 조건 블록은 켜고 끄기만 — 가지 추가 · ELSE 가 없다
    const top = b.condBlock([b.branch("D0001 = true", [b.article("나", [])])]);
    const d2 = b.document("D", [top]);
    expect(labels(condMenu(env(d2), top.branches[0].id)).slice(0, 3)).toEqual(["이 가지 삭제(잠김)", "이 가지에 조 추가", "조건 풀기 — 이 가지 내용만 남긴다"]);
    expect(inlineInsertItems({ parentId: "n2" }, [], { inInlineCond: true, newId: sequentialIds("x") }).map((i) => i.label)).toEqual(["치환 슬롯…", "조 참조…", "별표 참조…", "공용조항(문장 안)…"]);
    expect(inlineInsertItems({ tableId: "t", row: 1, col: 0 }, [], { inInlineCond: false, newId: sequentialIds("x"), structLevels: ["subCoverage"] }).map((i) => i.label)).toContain("구조 표기…");
  });

  it("툴바 「공용조항」 — 공용조항마다 한 줄, 고르면 그 자리에 공용조항 블록(옵션 없음)을 곧바로 넣는다", () => {
    const items = clausePickItems([{ code: "C0001", label: "보험기간" }], { parentId: "n4", index: 1 }, sequentialIds("k"));
    expect(items.map((i) => i.label)).toEqual(["보험기간(C0001)"]);
    expect(items[0].action).toMatchObject({ do: "ops", ops: [{ type: "insert", node: { kind: "clauseBlockRef", clauseCode: "C0001", options: {} }, at: { parentId: "n4", index: 1 } }] });
  });

  it("공용조항 고르기는 자리를 따른다 — 호 목록 자리는 「박스」만, 조 자리는 「항」 · 「박스」(「문구」는 없다)", () => {
    const clauses = [
      { code: "C0001", label: "소멸", mode: "block" },
      { code: "C0002", label: "용어풀이", mode: "box" },
      { code: "C0003", label: "제3자", mode: "inline" },
    ];
    const at = (slot?: "items") => clausePickItems(clauses, { parentId: "p", ...(slot ? { slot } : {}) }, sequentialIds("k")).map((i) => i.label);
    expect(at()).toEqual(["소멸(C0001)", "용어풀이(C0002)"]);
    expect(at("items")).toEqual(["용어풀이(C0002)"]);
  });

  it("툴바 「박스」 — 정적 마스터 박스마다 한 줄, 고르면 그 자리에 박스 참조를 곧바로 넣는다 · 조 제목의 「박스 추가…」는 조 끝 고르기 팝업", () => {
    const items = boxPickItems([{ code: "BX000001", name: "보험연도" }], { parentId: "n3", slot: "items", index: 1 }, sequentialIds("k"));
    expect(items.map((i) => i.label)).toEqual(["보험연도(BX000001)"]);
    expect(items[0].action).toMatchObject({ do: "ops", ops: [{ type: "insert", node: { kind: "boxRef", boxCode: "BX000001" }, at: { parentId: "n3", slot: "items", index: 1 } }] });
    const item = articleMenu(env(tree()), "n4").flat().find((i) => i.label === "박스 추가…");
    expect(item?.action).toEqual({ do: "popup", popup: { kind: "boxPick", at: { parentId: "n4" } } });
  });
});
