import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Discriminator } from "@/domain/catalog";
import type { Clause } from "@/domain/clause";
import { indexTree, nodeBuilders, numberTree, sequentialIds, type DocumentNode } from "@/domain/document";

import { buildConditionContext } from "./condition/conditionContext";
import { refLabelOf } from "./condition/display";
import type { DocCtx, EditHandlers } from "./ctx";
import { Block } from "./DocBody";
import { condMenu, type MenuItem } from "./menus";

const defs: Discriminator[] = [
  { code: "D0009", label: "감액여부", level: "coverage", expression: "any(D0002)", description: "" },
  { code: "D0001", label: "담보명", level: "coverage", expression: "coverage_basic.claim_name", description: "" },
];
const condition = buildConditionContext({ discriminators: defs, enums: [] });

const clause: Clause = {
  code: "C0001",
  label: "보험기간",
  mode: "block",
  options: [],
  required: { discriminators: [], attributes: [] },
  body: [{ id: "cp1", kind: "paragraph", children: [{ id: "ct1", kind: "text", text: "회사는 다음에 정한 기간 중에 보장합니다." }] }],
};

function build(when: string) {
  const b = nodeBuilders(sequentialIds("n"));
  const cond = b.condBlock([b.branch(when, [b.paragraph([b.text("조건 안 항")])])]);
  const ref = b.clauseBlock("C0001", {});
  const tree: DocumentNode = b.document("D", [b.article("가", [cond, ref])]);
  return { tree, cond, ref, article: tree.children[0] as { children: DocumentNode["children"] } };
}

function ctxOf(tree: DocumentNode, edit: boolean): DocCtx {
  const ix = indexTree(tree);
  const handlers: EditHandlers = {
    apply: () => true,
    commitInline: () => undefined,
    enter: () => undefined,
    removeEmpty: () => false,
    pasteGrid: () => false,
    setTitle: () => undefined,
    setBox: () => undefined,
    popup: () => undefined,
    focusInline: () => undefined,
    setActiveCell: () => undefined,
    focusDone: () => undefined,
    contextMenu: () => undefined,
    headItems: (branchId): MenuItem[] => condMenu({ tree, ix, docKind: "general", newId: sequentialIds("m") }, branchId).flat(),
    run: () => undefined,
  };
  return {
    documentId: "d",
    docKind: "general",
    mode: edit ? "edit" : "read",
    numbers: numberTree(tree),
    appendixName: new Map(),
    clauseLabel: new Map([["C0001", "보험기간"]]),
    optionText: () => "옵션 없음",
    references: { self: new Map(), general: new Map() },
    clauses: [clause],
    conditionFor: () => condition,
    refLabel: refLabelOf(condition),
    ...(edit ? { edit: handlers } : {}),
  };
}

const render = (when: string, edit: boolean) => {
  const s = build(when);
  return renderToStaticMarkup(<Block nodes={s.article.children} ctx={ctxOf(s.tree, edit)} />);
};

describe("조건 블록 — 머리 줄은 그 자리 편집, 팝업 없음 (기능/문면 §4.3, 2026-09-28)", () => {
  it("툴바 「조건식」 직후의 블록 — 빈 IF 줄(변수 · 연산자 · 값 칸, ⊕ ⊖)과 가지 조작 버튼, 다이얼로그는 없다", () => {
    const html = render("", true);
    expect(html).toContain('class="ts-doc-cond"');
    expect(html).toMatch(/data-cond-head="[^"]+"/);
    expect(html).toContain('<span class="ts-cond-badge">IF</span>');
    expect(html).toContain('aria-label="IF 1번 줄 변수"');
    expect(html).toContain('aria-label="IF 1번 줄 연산자"');
    expect(html).toContain('aria-label="IF 1번 줄 값"');
    expect(html).toContain('aria-label="IF 1번 줄 뒤에 조건 줄 추가"');
    expect(html).toContain("+ELIF");
    expect(html).toContain("+ELSE");
    expect(html).toContain("풀기");
    expect(html).toContain('aria-label="조건 블록 삭제"');
    expect(html).not.toContain("<dialog");
    // 변수는 검색 입력(콤보박스) — 빈 줄이면 값 없이 찾기 안내만
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*aria-label="IF 1번 줄 변수"[^>]*placeholder="변수 · 구분자 찾기"[^>]*value=""/);
  });

  it("저장된 식은 줄로 풀려 칸에 선다 — AND 줄은 결합 칸", () => {
    const html = render("D0009 = true and D0001 = '수술비'", true);
    expect(html).toContain('aria-label="IF 2번 줄 결합"');
    // 고른 변수는 검색 입력에 이름으로 선다
    expect(html).toMatch(/aria-label="IF 1번 줄 변수"[^>]*value="감액여부"/);
    expect(html).toContain('value="수술비"');
  });

  it("줄로 풀 수 없는 식은 원문 읽기 전용 + 「줄로 다시 만들기」", () => {
    const html = render("not D0009 = true", true);
    expect(html).toMatch(/readOnly=""[^>]*aria-label="IF 조건식 원문"|aria-label="IF 조건식 원문"[^>]*readOnly=""/);
    expect(html).toContain("줄로 다시 만들기");
  });

  it("읽기 모드 — 초록 상자 안 머리는 글자 한 줄(IF 식), 입력칸 · 버튼 없음", () => {
    const html = render("D0009 = true", false);
    expect(html).toContain('<p class="ts-doc-cond-head"');
    expect(html).toContain('<span class="ts-cond-badge">IF</span> 감액여부 = true');
    expect(html).not.toContain("data-cond-head");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("+ELIF");
  });
});

describe("함수조항 블록 — 머리 띠 「함수조항 (이름)」 + 🗑, 그 아래 본문", () => {
  it("편집 모드 — 이름 · 삭제 버튼 · 함수조항 본문(읽기 전용)", () => {
    const html = render("D0009 = true", true);
    expect(html).toContain('class="ts-doc-clause"');
    expect(html).toContain("함수조항 (보험기간)");
    expect(html).toContain('aria-label="함수조항 보험기간 삭제"');
    expect(html).toContain("회사는 다음에 정한 기간 중에 보장합니다.");
    expect(html).toMatch(/data-clause-ref="[^"]+"/);
    // 본문은 읽기 전용 — 문장 칸이 아니다
    expect(html.slice(html.indexOf("ts-doc-clause-body"))).not.toContain('role="textbox"');
  });

  it("읽기 모드 — 머리 띠 · 본문만, 삭제 버튼 없음", () => {
    const html = render("D0009 = true", false);
    expect(html).toContain("함수조항 (보험기간)");
    expect(html).not.toContain("삭제");
  });
});

describe("함수조항 블록 안 — 가운데는 모델, 미리보기는 문장 (2026-09-28)", () => {
  const optionClause: Clause = {
    code: "C0002",
    label: "대표자의 지정",
    mode: "block",
    required: { discriminators: ["D0009"], attributes: [] },
    options: [
      {
        code: "O01",
        label: "지정 주체",
        order: 0,
        values: [
          { code: "V01", label: "계약자", body: [{ id: "v1", kind: "text", text: "계약자는" }], order: 0 },
          { code: "V02", label: "피보험자", body: [{ id: "v2", kind: "text", text: "피보험자는" }], order: 1 },
        ],
      },
    ],
    body: [
      { id: "q1", kind: "paragraph", children: [{ id: "o1", kind: "optionSlot", optionCode: "O01" }, { id: "q2", kind: "text", text: " 대표자를 지정합니다 " }, { id: "q3", kind: "slot", ref: "D0001" }] },
      { id: "qc", kind: "condBlock", branches: [{ id: "qb", when: "D0009 = true", children: [{ id: "q4", kind: "paragraph", children: [{ id: "q5", kind: "text", text: "감액 조건 항" }] }] }] },
    ],
  };
  function renderClause(edit: boolean, view?: "text") {
    const b = nodeBuilders(sequentialIds("k"));
    const tree: DocumentNode = b.document("D", [b.article("가", [b.clauseBlock("C0002", { O01: "V02" })])]);
    const base = ctxOf(tree, edit);
    const ctx: DocCtx = { ...base, clauses: [clause, optionClause], clauseLabel: new Map([["C0002", "대표자의 지정"]]), ...(view ? { clauseView: view } : {}) };
    return renderToStaticMarkup(<Block nodes={(tree.children[0] as { children: DocumentNode["children"] }).children} ctx={ctx} />);
  }

  it("편집 · 읽기 모두 — 옵션 자리(선택지 전부 + 고른 것 ✓) · 슬롯 칩 · IF 머리 · 「함수조항에서 고치기 →」", () => {
    for (const edit of [true, false]) {
      const html = renderClause(edit);
      expect(html).toContain("함수조항 (대표자의 지정)");
      expect(html).toContain('class="ts-clause-model"');
      expect(html).toContain("지정 주체");
      expect(html).toContain("계약자");
      expect(html).toContain("✓피보험자");
      expect(html).toContain("〔담보명〕");
      expect(html).toContain('<span class="ts-cond-badge">IF</span> 감액여부 = true');
      expect(html).toContain('href="/functions/C0002"');
      // 모델은 이 문서의 자리가 아니다 — 문장 칸 · 블록 표지가 없다
      const body = html.slice(html.indexOf("ts-doc-clause-body"));
      expect(body).not.toContain("data-block");
      expect(body).not.toContain("data-inline");
    }
  });

  it("미리보기(clauseView: text) — 고른 선택지 문구를 끼운 문장, 모델 · 고치기 링크 없음", () => {
    const html = renderClause(false, "text");
    expect(html).toContain("피보험자는");
    expect(html).not.toContain("ts-clause-model");
    expect(html).not.toContain("함수조항에서 고치기");
  });
});

describe("항 번호를 생략한 항 — 편집기도 내어쓰기 없음 (기능/문면 §3.2, 2026-09-28)", () => {
  const b = nodeBuilders(sequentialIds("h"));
  it("조에 항이 하나면 번호도 is-bare 도 — 둘이면 번호 ①② 와 매달린 들여쓰기", () => {
    const one = b.document("D", [b.article("가", [b.paragraph([b.text("하나뿐인 항")])])]);
    const html1 = renderToStaticMarkup(<Block nodes={(one.children[0] as { children: DocumentNode["children"] }).children} ctx={ctxOf(one, true)} />);
    expect(html1).toMatch(/class="ts-doc-paragraph is-bare"/);
    const two = b.document("D", [b.article("가", [b.paragraph([b.text("첫")]), b.paragraph([b.text("둘")])])]);
    const html2 = renderToStaticMarkup(<Block nodes={(two.children[0] as { children: DocumentNode["children"] }).children} ctx={ctxOf(two, false)} />);
    expect(html2).not.toContain("is-bare");
    expect(html2).toContain("①");
  });

  it("빈 항 · 호 · 목의 자리 글은 단계 이름 한 낱말 — 「문장을 쓴다」 류 없음", () => {
    const t = b.document("D", [b.article("가", [b.paragraph([], [b.item([], [b.subitem([])])])])]);
    const html = renderToStaticMarkup(<Block nodes={(t.children[0] as { children: DocumentNode["children"] }).children} ctx={ctxOf(t, true)} />);
    expect(html).toContain('data-placeholder="항"');
    expect(html).toContain('data-placeholder="호"');
    expect(html).toContain('data-placeholder="목"');
    expect(html).not.toContain("쓴다");
  });
});

describe("블록 손잡이 — 편집 모드에서 끌어 옮기기 · 고르기 (기능/문면 §4.3, 2026-09-28)", () => {
  const b = nodeBuilders(sequentialIds("g"));
  const t = b.document("D", [b.article("가", [b.paragraph([b.text("첫")]), b.paragraph([b.text("둘")])])]);
  const nodes = (t.children[0] as { children: DocumentNode["children"] }).children;
  it("손잡이는 편집 모드(고르기 입구가 있을 때)만 — 읽기에는 없다", () => {
    expect(renderToStaticMarkup(<Block nodes={nodes} ctx={ctxOf(t, false)} />)).not.toContain("data-drag");
    const base = ctxOf(t, true);
    const ctx = { ...base, edit: { ...base.edit!, blockSel: [nodes[1].id], selectBlock: () => undefined } };
    const html = renderToStaticMarkup(<Block nodes={nodes} ctx={ctx} />);
    expect(html.match(/data-drag=/g)).toHaveLength(2);
    expect(html).toContain('aria-label="제1항 끌어 옮기기"');
    expect(html).toMatch(/class="ts-doc-paragraph is-block-sel"/);
  });
});

describe("글머리 목록 — 편집기 (기능/문면 §3.2 · §4.3, 2026-09-28)", () => {
  const b = nodeBuilders(sequentialIds("l"));
  const t = b.document("D", [b.article("가", [b.paragraph([b.text("다음과 같습니다.")]), b.bulletList([b.bullet([b.text("가")]), b.bullet([])])])]);
  const nodes = (t.children[0] as { children: DocumentNode["children"] }).children;
  it("번호 없는 「-」 목록 — 항목마다 문장 칸(자리 글 「항목」), 항 번호는 세지 않는다(항 하나면 번호 없음)", () => {
    const html = renderToStaticMarkup(<Block nodes={nodes} ctx={ctxOf(t, true)} />);
    expect(html).toContain('class="ts-doc-bullets"');
    expect(html.match(/class="ts-doc-bullet"/g)).toHaveLength(2);
    expect(html).toContain('data-placeholder="항목"');
    expect(html).toContain("is-bare");
  });
});
