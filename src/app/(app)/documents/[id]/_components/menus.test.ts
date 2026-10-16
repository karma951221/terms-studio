import { describe, expect, it } from "vitest";

import { indexTree, nodeBuilders, sequentialIds, type DocumentNode } from "@/domain/document";

import { DOCUMENT_TOOLS, toolFor, toolState } from "./tools";
import { articleMenu, blockMenu, boxPickItems, chipMenu, clausePickItems, clausesFitting, condMenu, inlineInsertItems, placeMenu, TITLE_REFUSAL, type MenuSections } from "./menus";

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
  it("항 — 아래에 항 · 호 추가 · 표 · 함수조항(조 단위) · 박스(정적 마스터) · 감싸기 · 이동(맨 위 · 맨 아래 잠김) · 복제 · 삭제", () => {
    expect(labels(blockMenu(env(tree()), "n3"))).toEqual([
      "아래에 항 추가",
      "호 추가",
      "함수조항(호) 추가…",
      "아래에 표 추가…",
      "아래에 글머리 목록 추가",
      "아래에 함수조항(조 단위) 추가…",
      "아래에 박스 추가…",
      "아래에 반복 블록 추가…",
      "반복 블록(호) 추가…",
      "코드 고치기…",
      "조건으로 감싸기",
      "위로(잠김)",
      "아래로(잠김)",
      "복제",
      "삭제",
    ]);
  });

  it("호 — 항 목록 자리라 호 · 표 · 글머리 목록 · 박스 · 「호」 함수조항 · 목 뒤는 목 · 글머리 목록 · 「목」 함수조항(박스 없음)", () => {
    expect(labels(blockMenu(env(tree()), "n2")).slice(0, 10)).toEqual([
      "아래에 호 추가",
      "목 추가",
      "함수조항(목) 추가…",
      "아래에 표 추가…",
      "아래에 글머리 목록 추가",
      "아래에 함수조항(호) 추가…",
      "아래에 박스 추가…",
      "아래에 반복 블록 추가…",
      "코드 고치기…",
      "조건으로 감싸기",
    ]);
    expect(labels(blockMenu(env(tree()), "n1")).slice(0, 5)).toEqual(["아래에 목 추가", "아래에 글머리 목록 추가", "아래에 함수조항(목) 추가…", "코드 고치기…", "조건으로 감싸기"]);
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
    expect(labels(articleMenu(env(top), top.children[0].id)).slice(0, 5)).toEqual(["아래에 조 추가", "아래에 관 추가", "항 추가", "함수조항 참조 추가…", "박스 추가…"]);
  });

  it("조 제목 — 조 끝에 함수조항(조 단위)을 넣는 팝업 (첫 자리가 함수조항인 조 · 2026-09-28)", () => {
    const item = articleMenu(env(tree(), "special"), "n4").flat().find((i) => i.label === "함수조항 참조 추가…");
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
    expect(inlineInsertItems({ parentId: "n2" }, [], { inInlineCond: true, newId: sequentialIds("x") }).map((i) => i.label).slice(0, 6)).toEqual(["치환 슬롯…", "조 참조…", "별표 참조…", "함수조항(문장 안)…", "문장 안 반복…", "조사 — 을/를"]);
    expect(inlineInsertItems({ tableId: "t", row: 1, col: 0 }, [], { inInlineCond: false, newId: sequentialIds("x"), structLevels: ["subCoverage"] }).map((i) => i.label)).toContain("구조 표기…");
  });

  it("툴바 「함수조항」 — 함수조항마다 한 줄, 고르면 그 자리에 함수조항 블록(옵션 없음)을 곧바로 넣는다", () => {
    const items = clausePickItems([{ code: "C0001", label: "보험기간" }], { parentId: "n4", index: 1 }, sequentialIds("k"));
    expect(items.map((i) => i.label)).toEqual(["보험기간(C0001)"]);
    expect(items[0].action).toMatchObject({ do: "ops", ops: [{ type: "insert", node: { kind: "clauseBlockRef", clauseCode: "C0001", options: {} }, at: { parentId: "n4", index: 1 } }] });
  });

  it("프리셋이 있으면 함수조항 줄 아래 프리셋마다 들인 한 줄 — 고르면 그 프리셋을 쓰는 블록 (ADR-0084 결정 8)", () => {
    const items = clausePickItems([{ code: "C0022", label: "납입면제 호", presets: [{ code: "S01", name: "상해" }, { code: "S02", name: "질병" }] }], { parentId: "p" }, sequentialIds("k"));
    expect(items.map((i) => [i.label, i.indent ?? false, i.name ?? i.label])).toEqual([
      ["납입면제 호(C0022)", false, "납입면제 호(C0022)"],
      ["· 상해", true, "납입면제 호(C0022) · 프리셋 상해"],
      ["· 질병", true, "납입면제 호(C0022) · 프리셋 질병"],
    ]);
    expect(items[1].action).toMatchObject({ do: "ops", ops: [{ type: "insert", node: { kind: "clauseBlockRef", clauseCode: "C0022", options: {}, preset: "S01" } }] });
  });

  it("함수조항 고르기는 조 자리의 「항」 함수조항만 (「문구」는 없다)", () => {
    const clauses = [
      { code: "C0001", label: "소멸", mode: "block" },
      { code: "C0003", label: "제3자", mode: "inline" },
    ];
    expect(clausePickItems(clauses, { parentId: "p" }, sequentialIds("k")).map((i) => i.label)).toEqual(["소멸(C0001)"]);
  });

  it("툴바 「박스」 — 정적 마스터 박스마다 한 줄, 고르면 그 자리에 박스 참조를 곧바로 넣는다 · 조 제목의 「박스 추가…」는 조 끝 고르기 팝업", () => {
    const items = boxPickItems([{ code: "BX000001", name: "보험연도" }], { parentId: "n3", slot: "items", index: 1 }, sequentialIds("k"));
    expect(items.map((i) => i.label)).toEqual(["보험연도(BX000001)"]);
    expect(items[0].action).toMatchObject({ do: "ops", ops: [{ type: "insert", node: { kind: "boxRef", boxCode: "BX000001" }, at: { parentId: "n3", slot: "items", index: 1 } }] });
    const item = articleMenu(env(tree()), "n4").flat().find((i) => i.label === "박스 추가…");
    expect(item?.action).toEqual({ do: "popup", popup: { kind: "boxPick", at: { parentId: "n4" } } });
  });
});

describe("함수조항 넣기는 자리 유형대로 — 조 자리 「항」 · 호 목록 「호」 · 목 목록 「목」 (최종 결정 4)", () => {
  const clauses = [
    { code: "C1", label: "문구", mode: "inline" },
    { code: "C2", label: "항", mode: "block" },
    { code: "C3", label: "호", mode: "item" },
    { code: "C4", label: "목", mode: "subitem" },
    { code: "C5", label: "옛 호출" },
  ];
  it("clausesFitting 은 자리 유형만 남긴다 — 유형을 모르면 조 자리", () => {
    expect(clausesFitting(clauses).map((c) => c.code)).toEqual(["C2", "C5"]);
    expect(clausesFitting(clauses, "item").map((c) => c.code)).toEqual(["C3"]);
    expect(clausesFitting(clauses, "subitem").map((c) => c.code)).toEqual(["C4"]);
  });

  it("항의 「함수조항(호) 추가…」는 그 항의 호 목록 자리 팝업", () => {
    const item = blockMenu(env(tree()), "n3").flat().find((i) => i.label === "함수조항(호) 추가…");
    expect(item?.action).toEqual({ do: "popup", popup: { kind: "clauseBlock", at: { parentId: "n3", slot: "items" }, fit: "item" } });
  });
});

describe("블록 반복 메뉴 (ADR-0077 — 조 자리 · 호 목록, 한 단계 중첩)", () => {
  /** 조 › 반복(종) › 항 › 호 목록 반복(사유) › 호. */
  function repeatTree() {
    const b = nodeBuilders(sequentialIds("r"));
    const item = b.item([]);
    const inner = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [item]);
    const paragraph = b.paragraph([], [inner]);
    const outer = b.forBlock({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" }, [paragraph]);
    inner.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    const doc = b.document("D", [b.article("가", [outer])]);
    return { doc, outer, inner, paragraph, item };
  }

  it("반복 블록 자리 — 이 반복에 항 · 함수조항 · 안쪽 반복 넣기 · 반복 원천, 모든 항목에 툴바 버튼", () => {
    const { doc, outer } = repeatTree();
    const got = labels(blockMenu(env(doc), outer.id));
    expect(got).toEqual(expect.arrayContaining(["이 반복에 항 추가", "이 반복에 함수조항(조 단위) 추가…", "이 반복에 반복 블록 추가…", "반복 원천…"]));
    for (const l of blockMenu(env(doc), outer.id).flat().map((i) => i.label)) expect(toolFor(DOCUMENT_TOOLS, l), l).toBeDefined();
    expect(labels(articleMenu(env(doc), doc.children[0].id))).toContain("반복 블록 추가…");
  });

  it("두 단계 안에서는 반복을 더 넣지 않는다 — 안쪽 반복 · 그 안 호", () => {
    const { doc, inner, item } = repeatTree();
    expect(labels(blockMenu(env(doc), inner.id))).toEqual(expect.arrayContaining(["이 반복에 호 추가", "이 반복에 함수조항(호) 추가…"]));
    expect(labels(blockMenu(env(doc), inner.id))).not.toContain("이 반복에 반복 블록 추가…");
    expect(labels(blockMenu(env(doc), item.id))).not.toContain("아래에 반복 블록 추가…");
  });
});

describe("블록 반복 「비었을 때」 칸 메뉴 (ADR-0088 결정 4)", () => {
  function fallbackTree() {
    const b = nodeBuilders(sequentialIds("f"));
    const inFallback = b.paragraph([]);
    const loop = b.forBlock({ kind: "planOptions", form: "waiver", filter: "waiver.applies = true" }, [b.paragraph([])], undefined, [inFallback]);
    const items = b.forBlock({ kind: "planOptions", form: "waiver" }, [b.item([])]);
    const doc = b.document("D", [b.article("가", [loop, b.paragraph([], [items])])]);
    return { doc, loop, inFallback, items };
  }

  it("반복 블록 자리 — 칸에 항 · 함수조항 넣기(호 목록 반복이면 호), 모든 항목에 툴바 버튼 · 툴바 「비었을 때」는 고른 반복 블록에서만", () => {
    const { doc, loop, items } = fallbackTree();
    const got = labels(blockMenu(env(doc), loop.id));
    expect(got).toEqual(expect.arrayContaining(["「비었을 때」 칸에 항 추가", "「비었을 때」 칸에 함수조항(조 단위) 추가…"]));
    expect(labels(blockMenu(env(doc), items.id))).toEqual(expect.arrayContaining(["「비었을 때」 칸에 호 추가", "「비었을 때」 칸에 함수조항(호) 추가…"]));
    for (const l of blockMenu(env(doc), loop.id).flat().map((i) => i.label)) expect(toolFor(DOCUMENT_TOOLS, l), l).toBeDefined();
    const tool = toolFor(DOCUMENT_TOOLS, "「비었을 때」 칸에 항 추가")!;
    expect(tool.at).toBe("context");
    expect(toolState(tool, blockMenu(env(doc), loop.id)).disabled).toBe(false);
    expect(toolState(tool, blockMenu(env(doc), doc.children[0].id)).disabled).toBe(true);
    const add = blockMenu(env(doc), loop.id).flat().find((i) => i.label === "「비었을 때」 칸에 항 추가")!;
    expect(add.action).toMatchObject({ do: "ops", ops: [{ type: "insert", at: { parentId: loop.id, slot: "fallback" } }] });
  });

  it("칸 안 항 — 아래에 항 추가는 칸 자리 안에서(같은 블록 편집)", () => {
    const { doc, loop, inFallback } = fallbackTree();
    const add = blockMenu(env(doc), inFallback.id).flat().find((i) => i.label === "아래에 항 추가")!;
    expect(add.action).toMatchObject({ do: "ops", ops: [{ type: "insert", at: { parentId: loop.id, slot: "fallback", index: 1 } }] });
  });
});

describe("조 제목 칸 — 제목도 문장 자리다 (ADR-0088 결정 5)", () => {
  it("넣기는 슬롯 · 문장 안 조건 · 조사만 켜지고 참조 · 함수조항은 잠긴다 — 조 제목 자리의 조작(아래에 조 · 항 추가)은 그대로", () => {
    const t = tree();
    const sections = placeMenu(env(t), { kind: "inline", at: { parentId: "n4", slot: "title" } });
    const items = sections.flat();
    const refusal = (label: string) => items.find((i) => i.label === label)?.refusal;
    expect(refusal("치환 슬롯…")).toBeUndefined();
    expect(refusal("조 참조…")).toBe(TITLE_REFUSAL);
    expect(refusal("별표 참조…")).toBe(TITLE_REFUSAL);
    expect(refusal("함수조항(문장 안)…")).toBe(TITLE_REFUSAL);
    expect(items.some((i) => i.label === "문장 안 조건")).toBe(true);
    expect(items.some((i) => i.label.startsWith("조사 — "))).toBe(true);
    expect(items.some((i) => i.label === "아래에 조 추가")).toBe(true);
    expect(toolState(toolFor(DOCUMENT_TOOLS, "조 참조…")!, sections).disabled).toBe(true);
    expect(toolState(toolFor(DOCUMENT_TOOLS, "치환 슬롯…")!, sections).disabled).toBe(false);
  });

  it("제목 안 문장 안 조건의 가지도 같은 집합이다", () => {
    const b = nodeBuilders(sequentialIds("x"));
    const cond = b.inlineCond([b.inlineBranch("D0001 = true", [b.text("등")])]);
    const t = b.document("D", [b.article([b.text("보험금 "), cond], [])]);
    const branchId = cond.branches[0].id;
    const items = placeMenu(env(t), { kind: "inline", at: { parentId: branchId } }).flat();
    expect(items.find((i) => i.label === "조 참조…")?.refusal).toBe(TITLE_REFUSAL);
    expect(items.some((i) => i.label === "문장 안 조건")).toBe(false);
  });
});

describe("문장 안 반복 넣기 (ADR-0088 결정 1 · 기능/문면 §4.3)", () => {
  it("문장 자리 · 조 제목에 「문장 안 반복…」 — 툴바 「문장 안 반복」이 맡고 팝업(원천 고르기)을 연다", () => {
    const t = tree();
    for (const at of [{ parentId: "n3" }, { parentId: "n4", slot: "title" as const }]) {
      const sections = placeMenu(env(t), { kind: "inline", at });
      const item = sections.flat().find((i) => i.label === "문장 안 반복…");
      expect(item?.refusal).toBeUndefined();
      expect(item?.action).toMatchObject({ do: "popup", popup: { kind: "repeatInline", at } });
      expect(toolState(toolFor(DOCUMENT_TOOLS, "문장 안 반복…")!, sections).disabled).toBe(false);
    }
  });

  it("문장 안 반복의 본문 · 「비었을 때」 칸 안이면 잠근다(한 겹) — 넣기 목록은 문장 자리 넣기만", () => {
    const b = nodeBuilders(sequentialIds("x"));
    const inline = b.inlineFor({ kind: "planOptions", form: "waiver" }, [b.text("a")], { connector: "및" });
    const t = b.document("D", [b.article("가", [b.paragraph([inline])])]);
    for (const at of [{ parentId: inline.id }, { parentId: inline.id, slot: "fallback" as const }]) {
      const items = placeMenu(env(t), { kind: "inline", at }).flat();
      expect(items.find((i) => i.label === "문장 안 반복…")?.refusal).toContain("한 겹");
      expect(items.some((i) => i.label === "치환 슬롯…")).toBe(true);
      expect(items.some((i) => i.label === "아래에 항 추가")).toBe(false);
    }
  });

  it("반복 안 반복 안(두 겹)의 문장이면 잠근다", () => {
    const b = nodeBuilders(sequentialIds("x"));
    const item = b.item([b.text("호")]);
    const inner = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [item]);
    const outer = b.forBlock({ kind: "planOptions", form: "waiver" }, [b.paragraph([b.text("항")], [inner])]);
    inner.source = { kind: "listOfCurrent", loop: outer.id, field: "reasons" };
    const t = b.document("D", [b.article("가", [outer])]);
    expect(placeMenu(env(t), { kind: "inline", at: { parentId: item.id } }).flat().find((i) => i.label === "문장 안 반복…")?.refusal).toContain("한 단계");
  });

  it("문장 안 반복 칩의 메뉴 — 고치기(팝업) · 삭제", () => {
    const b = nodeBuilders(sequentialIds("x"));
    const inline = b.inlineFor({ kind: "planOptions", form: "waiver" }, [b.text("a")], { connector: "및" });
    const t = b.document("D", [b.article("가", [b.paragraph([inline])])]);
    expect(labels(chipMenu(env(t), inline.id))).toEqual(["고치기…", "삭제"]);
  });
});
