import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";
import type { Clause } from "../clause/types";
import { checkParams } from "../clause/params";
import type { Coverage } from "../coverage/types";
import type { Issue } from "../types";
import { checkRepeatSource, clauseInnerCodes, cloneForElement, loopElementType, refTargetIssues, repeatLabel, treeLoopLevelsAt, treeLoopRefIssues, type RepeatSource } from "./blockRepeat";
import { lostInnerCodeEntries, type RecheckDocument } from "./refs";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand } from "./commands";
import { generalRefsOf } from "./edit";
import { numberTree, referenceAncestorIds, referenceChunkLabel, referenceOutline, referenceTargetIndex, referenceTargetLabel, refTargetOf } from "./numbering";
import type { DocumentNode, ForBlockNode, TreeEnv } from "./nodes";
import { indexTree, validateTree } from "./nodes";
import { catalogTypeResolver, clauseGateFrom, validateDocument } from "./validate";

/**
 * 블록 반복 저장 검사 (최종 결정 10 · 11 · 23 · ADR-0077 · 기능/문면 §3.7).
 * 원천 셋(세목 선택지 · 바깥 현재 원소의 목록 · 합집합) · 한 단계 중첩 · 현재 원소 연결 · 반복 안 대상의 연결어 · 사유 값 분기 경고 · 정의 조 교차 검사.
 */

const 종마다: RepeatSource = { kind: "planOptions", form: "waiver", filter: "waiver.applies = true" };
const 사유마다 = (loop: string): RepeatSource => ({ kind: "listOfCurrent", loop, field: "reasons" });
const 정의조대상마다: RepeatSource = { kind: "union", form: "waiver", filter: "waiver.applies = true", field: "reasons", where: { field: "F03", value: true } };

const E0001: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  fields: [
    { key: "F01", label: "약관표시명", type: "string", order: 1 },
    { key: "F03", label: "정의조대상", type: "boolean", order: 2 },
  ],
  values: [
    { code: "V01", label: "암", order: 0, fields: { F03: true } },
    { code: "V02", label: "뇌졸중", order: 1, fields: { F03: true } },
    { code: "V03", label: "장해", order: 2, fields: { F03: false } },
  ],
};

const item = (id: string, value: string) => ({ id, kind: "item" as const, children: [{ id: `${id}t`, kind: "text" as const, text: value }] });
const para = (id: string, value: string) => ({ id, kind: "paragraph" as const, children: [{ id: `${id}t`, kind: "text" as const, text: value }] });

/** 납입면제 호(사유) — 호 유형, 사유 enum 인자. */
const 면제호: Clause = {
  code: "C0300",
  label: "납입면제 호",
  mode: "item",
  body: [{ id: "sw", kind: "switchBlock", on: "arg.사유", cases: [{ id: "k1", values: ["V01", "V02", "V03"], children: [item("i1", "사유 호")] }] }],
  options: [],
  params: [{ name: "사유", type: { kind: "enum", enumCode: "E0001" } }],
  required: { discriminators: [], attributes: [] },
};

/** 면제 부가항(종들) — 항 유형, 세목 선택지 목록 인자. */
const 부가항: Clause = {
  code: "C0301",
  label: "면제 부가항",
  mode: "block",
  body: [para("p1", "부가항")],
  options: [],
  params: [{ name: "종들", type: { kind: "planOptions", form: "waiver" } }],
  required: { discriminators: [], attributes: [] },
};

/** 정의(사유) — 항 유형. V01 문장 · V02 「문구 없음」 · V03 문장. */
const 정의: Clause = {
  code: "C0302",
  label: "정의",
  mode: "block",
  body: [
    {
      id: "sw",
      kind: "switchBlock",
      on: "arg.사유",
      cases: [
        { id: "k1", values: ["V01"], children: [para("d1", "암의 정의")] },
        { id: "k2", values: ["V02"], empty: true, children: [] },
        { id: "k3", values: ["V03"], children: [para("d3", "장해의 정의")] },
      ],
    },
  ],
  options: [],
  params: [{ name: "사유", type: { kind: "enum", enumCode: "E0001" } }],
  required: { discriminators: [], attributes: [] },
};

const gate = clauseGateFrom([면제호, 부가항, 정의], [], undefined, [E0001]);
const env: TreeEnv = { clauseGate: gate, enumOf: (c) => (c === "E0001" ? E0001 : undefined) };

function make() {
  return nodeBuilders(sequentialIds("n"));
}

const errors = (issues: Issue[]) => issues.filter((i) => i.severity !== "warning");
const messages = (issues: Issue[]) => issues.map((i) => i.message);

/** 제27조의1 모양 — 조 자리 「납입면제종마다」 → 항 → 호 목록 「사유마다」 → 호 유형 함수조항(사유 ← 현재 사유). */
function 납입면제조(opts: { innerSource?: (outer: string) => RepeatSource; binding?: (outer: ForBlockNode, inner: ForBlockNode) => Record<string, unknown> } = {}) {
  const b = make();
  const ref = b.clauseBlock("C0300");
  const inner = b.forBlock({ kind: "listOfCurrent", loop: "?", field: "reasons" }, [ref]);
  const paragraph = b.paragraph([b.slot("builtin.plan.name"), b.text("으로 가입한 경우")], [inner]);
  const outer = b.forBlock(종마다, [paragraph]);
  inner.source = opts.innerSource ? opts.innerSource(outer.id) : 사유마다(outer.id);
  ref.bindings = (opts.binding ? opts.binding(outer, inner) : { 사유: { kind: "current", loop: inner.id } }) as ClauseBindings;
  const doc = b.document("보통약관", [b.article("보험료의 납입면제", [outer])]);
  return { doc, outer, inner, ref, paragraph, b };
}
type ClauseBindings = NonNullable<ReturnType<ReturnType<typeof make>["clauseBlock"]>["bindings"]>;

describe("블록 반복 — 자리 · 중첩 (결정 11 · ADR-0077 결정 2 · 4)", () => {
  it("조 자리 「납입면제종마다」 → 항 → 호 목록 「사유마다」 → 호 유형 함수조항(사유 ← 현재 사유) = 통과", () => {
    const { doc } = 납입면제조();
    expect(validateTree(doc, env)).toEqual([]);
  });

  it("반복 안 반복 한 단계 = 통과, 두 단계 = 오류", () => {
    const b = make();
    const third = b.forBlock({ kind: "listOfCurrent", loop: "x", field: "reasons" }, [b.item([b.text("셋째")])]);
    const second = b.forBlock({ kind: "listOfCurrent", loop: "x", field: "reasons" }, [b.paragraph([b.text("둘째")], [third])]);
    const first = b.forBlock(종마다, [second]);
    second.source = 사유마다(first.id);
    third.source = 사유마다(second.id);
    const doc = b.document("d", [b.article("a", [first])]);
    const issues = validateTree(doc, env);
    expect(issues.some((i) => i.message.includes("한 단계까지"))).toBe(true);
    expect(issues.every((i) => i.at.nodePath?.includes(third.id))).toBe(true);
  });

  it("반복 블록은 조 자리 · 항의 호 목록에 선다 — 목 목록 자리 · 반복 안 표는 오류", () => {
    const b = make();
    const bad = b.forBlock(종마다, [b.subitem([b.text("목")]) as never]);
    const withTable = b.forBlock(종마다, [b.textTable({ columns: [{}], rows: [{ cells: ["셀"] }] })]);
    const doc = b.document("d", [b.article("a", [b.paragraph([b.text("항")], [b.item([b.text("호")], [bad as never])]), withTable])]);
    const issues = validateTree(doc, env);
    expect(issues.map((i) => i.at.nodePath?.at(-1))).toEqual(expect.arrayContaining([bad.id]));
    expect(issues.some((i) => i.message.includes("table"))).toBe(true);
  });
});

describe("블록 반복 — 원천 (ADR-0077 결정 2)", () => {
  it("원천이 없는(옛 글자) 반복 블록 = 오류", () => {
    const b = make();
    const f = b.forBlock(종마다, [b.paragraph([b.text("x")])]);
    (f as unknown as { source: string }).source = "subCoverage";
    const doc = b.document("d", [b.article("a", [f])]);
    expect(messages(validateTree(doc, env))).toEqual([expect.stringContaining("원천")]);
  });

  it("세목 선택지 원천 — 세목 폼이 아니면 오류 · 거름이 다른 폼 필드를 읽으면 오류", () => {
    const b = make();
    const notPlan = b.forBlock({ kind: "planOptions", form: "feature" }, [b.paragraph([b.text("x")])]);
    const stray = b.forBlock({ kind: "planOptions", form: "waiver", filter: "no_surrender.type = 'V01'" }, [b.paragraph([b.text("y")])]);
    const doc = b.document("d", [b.article("a", [notPlan, stray])]);
    const issues = validateTree(doc, env);
    expect(issues.map((i) => i.at.nodePath?.at(-1))).toEqual([notPlan.id, stray.id]);
    expect(issues[0].message).toContain("세목 폼");
  });

  it("안쪽 반복의 원천은 바깥 현재 원소의 목록뿐 — 안쪽에 세목 선택지 원천 = 오류", () => {
    const { doc, inner } = 납입면제조({ innerSource: () => 종마다, binding: () => ({}) });
    const issues = validateTree(doc, { ...env, clauseGate: undefined });
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", at: expect.objectContaining({ nodePath: expect.arrayContaining([inner.id]) }) })]);
    expect(issues[0].message).toContain("바깥 반복");
  });

  it("바깥 현재 원소의 목록 — 바깥 반복이 아닌 반복 · 목록값(복수)이 아닌 필드 = 오류", () => {
    const wrongLoop = 납입면제조({ innerSource: () => 사유마다("elsewhere"), binding: () => ({}) });
    expect(messages(validateTree(wrongLoop.doc, { ...env, clauseGate: undefined }))).toEqual([expect.stringContaining("바깥 반복")]);
    const scalar = 납입면제조({ innerSource: (outer) => ({ kind: "listOfCurrent", loop: outer, field: "applies" }), binding: () => ({}) });
    expect(messages(validateTree(scalar.doc, { ...env, clauseGate: undefined }))).toEqual([expect.stringContaining("목록값")]);
  });

  it("합집합 원천 — 열거값 필드 거름의 필드가 열거형에 없으면 오류", () => {
    const b = make();
    const f = b.forBlock({ ...정의조대상마다, where: { field: "F09", value: true } }, [b.paragraph([b.text("x")])]);
    const doc = b.document("d", [b.article("a", [f])]);
    expect(messages(validateTree(doc, env))).toEqual([expect.stringContaining("F09")]);
  });

  it("반복 이름 — 「납입면제종마다」 · 「납입면제사유마다」 · 합집합(거름)", () => {
    expect(repeatLabel(종마다)).toBe("납입면제종마다");
    expect(repeatLabel(사유마다("x"), { outer: 종마다 })).toBe("납입면제사유마다");
    expect(repeatLabel(정의조대상마다, { enumOf: () => E0001 })).toBe("납입면제사유 합집합(정의조대상 = 예)마다");
  });
});

describe("반복의 현재 원소 — 함수조항 인자 연결 (최종 결정 2 · ADR-0077 결정 3)", () => {
  it("current 연결을 반복 밖에서 쓰면 오류", () => {
    const b = make();
    const ref = b.clauseBlock("C0301");
    ref.bindings = { 종들: { kind: "current", loop: "nowhere" } };
    const doc = b.document("d", [b.article("a", [ref])]);
    const issues = validateTree(doc, env);
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("반복 밖"), at: expect.objectContaining({ refPath: "arg.종들" }) })]);
  });

  it("타입이 다르면 오류 — 종 원소를 enum 인자에", () => {
    const { doc, ref } = 납입면제조({ binding: (outer) => ({ 사유: { kind: "current", loop: outer.id } }) });
    const issues = validateTree(doc, env);
    expect(issues).toEqual([expect.objectContaining({ kind: "typeMismatch", at: expect.objectContaining({ nodePath: expect.arrayContaining([ref.id]) }) })]);
  });

  it("종 원소는 세목 선택지 목록 인자에 댈 수 있다(종 하나짜리 목록)", () => {
    const b = make();
    const ref = b.clauseBlock("C0301");
    const f = b.forBlock(종마다, [ref]);
    ref.bindings = { 종들: { kind: "current", loop: f.id } };
    const doc = b.document("d", [b.article("a", [f])]);
    expect(validateTree(doc, env)).toEqual([]);
  });

  it("기본 연결에는 반복의 현재 원소를 둘 수 없다 (정의 검사 ①)", () => {
    const issues = checkParams([{ name: "사유", type: { kind: "enum", enumCode: "E0001" }, default: { kind: "current", loop: "f" } }]);
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("기본 연결") })]);
  });
});

describe("반복 안 대상 참조의 연결어 (결정 14 확장 · P3 빈틈)", () => {
  it("대상이 하나여도 반복 안 노드면 연결어 미선택 = 저장 오류 · 반복 밖 대상 하나는 통과", () => {
    const { doc, paragraph, b } = 납입면제조();
    paragraph.code = "P0100";
    const plain = b.paragraph([b.text("고정 항")]);
    plain.code = "P0200";
    const article = doc.children[0] as { id: string; children: unknown[] };
    const refIn = b.articleRef({ articleId: article.id, code: "P0100" });
    const refOut = b.articleRef({ articleId: article.id, code: "P0200" });
    article.children.push(plain, b.paragraph([refIn]), b.paragraph([refOut]));
    const issues = validateTree(doc, env);
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("반복"), at: expect.objectContaining({ nodePath: expect.arrayContaining([refIn.id]) }) })]);
    refIn.connector = "및";
    expect(validateTree(doc, env)).toEqual([]);
  });

  it("보통약관의 반복 안 대상(generalRepeatedKeys)도 같다", () => {
    const b = make();
    const ref = b.articleRef({ articleId: "g-a", code: "P0100" }, "general");
    const doc = b.document("특약", [b.article("준용", [b.paragraph([ref])])]);
    const generals = { kind: "special" as const, generalArticleIds: new Set(["g-a"]), generalReferenceKeys: new Set(["g-a", "g-a#P0100"]) };
    expect(validateTree(doc, generals)).toEqual([]);
    expect(messages(validateTree(doc, { ...generals, generalRepeatedKeys: new Set(["g-a#P0100"]) }))).toEqual([expect.stringContaining("반복")]);
  });
});

describe("템플릿은 사유 값으로 분기하지 않는다 — 경고 (결정 10)", () => {
  it("문면 조건식이 반복 원소 열거형(세목 목록값 E0001)의 값 코드와 비교하면 경고, 저장은 된다", () => {
    const b = make();
    const doc = b.document("d", [b.article("a", [b.condBlock([b.branch("D0100 = 'V01'", [b.paragraph([b.text("암이면")])])]), b.condBlock([b.branch("D0101", [b.paragraph([b.text("참이면")])])])])]);
    const resolve = catalogTypeResolver([
      { code: "D0100", label: "대표사유", level: "product", expression: "'V01'", resultType: { kind: "enum", enumCode: "E0001" } },
      { code: "D0101", label: "갱신", level: "product", expression: "true" },
    ] as never);
    const issues = validateDocument(doc, { env, resolve, scope: {} });
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("사유") })]);
    expect(errors(issues)).toEqual([]);
  });
});

describe("정의 조 교차 검사 — 합집합 ∩ 정의조대상 (결정 23 · ADR-0077 결정 10 · C15)", () => {
  function 정의조(clause: string) {
    const b = make();
    const ref = b.clauseBlock(clause);
    const f = b.forBlock(정의조대상마다, [ref]);
    ref.bindings = { 사유: { kind: "current", loop: f.id } };
    return { doc: b.document("d", [b.article("정의 및 진단확정", [f])]) as DocumentNode, ref };
  }

  it("정의조대상 = 예인 값이 「문구 없음」 칸에 닿으면 오류 · 아니오인 값의 칸에 문장이 있으면 경고", () => {
    const { doc, ref } = 정의조("C0302");
    const issues = validateDocument(doc, { env, resolve: catalogTypeResolver([]), scope: {} });
    expect(issues.map((i) => [i.severity ?? "error", i.at.refPath, i.at.nodePath?.at(-1)])).toEqual([
      ["error", "V02", ref.id],
      ["warning", "V03", ref.id],
    ]);
    expect(issues[0].message).toContain("C0302");
  });
});

describe("반복 복제 id · 코드 합성 (위험 4 — `@` × 중첩 × `/`)", () => {
  it("id 와 항 · 호 · 목 · 함수조항 참조의 코드에 원소를 붙인다 — 조 참조 대상 코드 · 연결 반복 id 는 그대로", () => {
    const b = make();
    const ref = b.clauseBlock("C0300");
    ref.code = "P0300";
    ref.bindings = { 사유: { kind: "current", loop: "inner" } };
    const p = b.paragraph([b.articleRef({ articleId: "a", code: "P0100" })], [ref]);
    p.code = "P0100";
    const [clone] = cloneForElement([p], "opt1");
    expect(clone).toMatchObject({ id: `${p.id}@opt1`, code: "P0100@opt1" });
    expect(clone.children[0]).toMatchObject({ id: `${p.children[0].id}@opt1`, targets: [{ articleId: "a", code: "P0100" }] });
    expect(clone.items?.[0]).toMatchObject({ id: `${ref.id}@opt1`, code: "P0300@opt1", bindings: { 사유: { kind: "current", loop: "inner" } } });
    const [twice] = cloneForElement([clone], "V01");
    expect(twice).toMatchObject({ id: `${p.id}@opt1@V01`, code: "P0100@opt1@V01" });
  });
});

describe("반복 명령 — setFor (편집기 원천 고르기)", () => {
  it("원천 · 이름을 바꾼다 — 세목 폼이 아닌 원천은 그 자리에서 거부 · 이름을 비우면 지운다(원천에서 짓는다)", () => {
    const b = make();
    const f = b.forBlock(종마다, [b.paragraph([b.text("x")])], "종마다");
    const doc = b.document("d", [b.article("a", [f])]);
    const renamed = applyCommand(doc, { type: "setFor", nodeId: f.id, source: 정의조대상마다, alias: "" }, { env });
    expect(renamed.ok && (renamed.value.children[0] as { children: ForBlockNode[] }).children[0]).toMatchObject({ source: 정의조대상마다 });
    expect(renamed.ok && "alias" in (renamed.value.children[0] as { children: ForBlockNode[] }).children[0]).toBe(false);
    const bad = applyCommand(doc, { type: "setFor", nodeId: f.id, source: { kind: "planOptions", form: "feature" } }, { env });
    expect(bad.ok).toBe(false);
  });

  it("반복 블록 안에 넣는다 — 본문 자리는 투명(호 목록 반복 안에 「호」 함수조항 · 조 자리 반복 안에 항), 표는 거부", () => {
    const { doc, inner, outer } = 납입면제조({ binding: () => ({}) });
    const b = nodeBuilders(sequentialIds("x"));
    const ref = b.clauseBlock("C0300");
    ref.bindings = { 사유: { kind: "current", loop: inner.id } };
    const r = applyCommand(doc, { type: "insert", node: ref, at: { parentId: inner.id } }, { env });
    expect(r.ok).toBe(true);
    expect(applyCommand(doc, { type: "insert", node: b.paragraph([b.text("항")]), at: { parentId: outer.id } }, { env }).ok).toBe(true);
    expect(applyCommand(doc, { type: "insert", node: b.textTable({ columns: [{}], rows: [{ cells: ["셀"] }] }), at: { parentId: outer.id } }, { env }).ok).toBe(false);
  });

  it("조 참조 고르기 색인은 반복 본문을 한 벌 원형으로 싣는다 — 반복 안 항 · 호도 고를 수 있다(연결어 필수 대상)", () => {
    const { doc, paragraph } = 납입면제조();
    const index = referenceTargetIndex(doc, numberTree(doc));
    expect(index.get(paragraph.id)).toMatchObject({ kind: "paragraph", paragraph: { n: 1 } });
  });
});

describe("조 참조 고르기 색인 — 반복 블록 · 함수조항 참조 · 그 안 코드 (결정 12 · 13 · 편집기는 원형 · 번호는 자리표시)", () => {
  it("반복 블록 줄 · 함수조항 참조 줄 · 펼칠 본문의 항 · 호 줄이 선다 — 저장 대상은 {조, 코드} · {조, 참조코드, 안쪽코드}", () => {
    const { doc, outer, inner, ref, paragraph } = 납입면제조();
    outer.code = "P0100";
    paragraph.code = "P0200";
    inner.code = "P0300";
    ref.code = "P0400";
    const index = referenceTargetIndex(doc, numberTree(doc), { clauseOf: (c) => [면제호, 부가항, 정의].find((x) => x.code === c), repeatCaption: () => "납입면제종마다" });
    const article = (doc.children[0] as { id: string }).id;
    expect(refTargetOf(index.get(outer.id)!)).toEqual({ articleId: article, code: "P0100" });
    expect(refTargetOf(index.get(ref.id)!)).toEqual({ articleId: article, code: "P0400" });
    const innerRow = [...index.entries()].find(([, t]) => t.via === "P0400");
    expect(innerRow && refTargetOf(innerRow[1])).toEqual({ articleId: article, code: "P0400", innerCode: "P0100" });
    // 트리 — 조 › 반복 블록 › 항 › 안쪽 반복 › 함수조항 참조 › 본문 호
    const [group] = referenceOutline(index);
    const rows = group.rows[0].children;
    expect(rows.map((r) => r.id)).toEqual([outer.id]);
    expect(rows[0].label).toContain("납입면제종마다");
    expect(rows[0].children.map((r) => r.id)).toEqual([paragraph.id]);
    const innerLoop = rows[0].children[0].children[0];
    expect(innerLoop.id).toBe(inner.id);
    expect(innerLoop.children[0].id).toBe(ref.id);
    expect(innerLoop.children[0].label).toContain("납입면제 호");
    expect(innerLoop.children[0].children.map((r) => r.target.item?.code)).toEqual(["P0100"]);
    expect(referenceAncestorIds(index, [innerRow![0]])).toEqual(new Set([article, outer.id, paragraph.id, inner.id, ref.id]));
  });

  it("반복 안 · 펼친 함수조항 안 줄은 가짜 번호 없이 머리 말 — 본문 칩 표기도 단계 + 코드(실제 번호는 미리보기 탭이 조립해 매긴다)", () => {
    const { doc, outer, inner, ref, paragraph } = 납입면제조();
    outer.code = "P0100";
    paragraph.code = "P0200";
    inner.code = "P0300";
    ref.code = "P0400";
    const index = referenceTargetIndex(doc, numberTree(doc), { clauseOf: (c) => [면제호, 부가항, 정의].find((x) => x.code === c), repeatCaption: () => "납입면제종마다" });
    const [group] = referenceOutline(index);
    const loopRow = group.rows[0].children[0];
    expect(loopRow.label).toBe("반복 — 납입면제종마다");
    const paraRow = loopRow.children[0];
    expect(paraRow.label).toBe("「으로 가입한 경우」");
    expect(paraRow.children[0].label).toBe("반복 — 납입면제종마다"); // 머리 말 함수가 고정 글
    expect(paraRow.children[0].children[0].label).toBe("함수조항 「납입면제 호」");
    expect(paraRow.children[0].children[0].children[0].label).toBe("「사유 호」");
    // 본문 칩 — 반복 블록 · 반복 안 대상은 번호 대신 단계 + 코드, 조가 다르면 조 표기 앞에
    expect(referenceTargetLabel(index.get(paragraph.id)!)).toBe("제1조(보험료의 납입면제) 항 P0200");
    expect(referenceTargetLabel(index.get(outer.id)!)).toBe("제1조(보험료의 납입면제) 반복 P0100");
    expect(referenceTargetLabel(index.get(ref.id)!, index.get(paragraph.id))).toBe("호 P0400");
    // 자리표시끼리는 구간을 만들지 않는다
    expect(referenceChunkLabel([index.get(outer.id)!, index.get(paragraph.id)!, index.get(inner.id)!], "및")).toBe("제1조(보험료의 납입면제) 반복 P0100, 항 P0200 및 반복 P0300");
  });

  it("반복 줄 머리는 바깥 반복을 알고 이름을 짓는다 — 안쪽 목록 반복은 「납입면제사유마다」(필드 키 「reasons마다」가 아니다)", () => {
    const { doc, outer, inner, paragraph } = 납입면제조();
    outer.code = "P0100";
    paragraph.code = "P0200";
    inner.code = "P0300";
    const caption = (n: ForBlockNode, around?: ForBlockNode) => repeatLabel(n.source, around ? { outer: around.source } : {});
    const index = referenceTargetIndex(doc, numberTree(doc), { repeatCaption: caption });
    expect(index.get(outer.id)?.caption).toBe("반복 — 납입면제종마다");
    expect(index.get(inner.id)?.caption).toBe("반복 — 납입면제사유마다");
  });
});

describe("반복 · 펼친 함수조항 안 · 값 한정 참조 저장 검사 (결정 12 · 13 · ADR-0077 결정 6 · 7)", () => {
  /** 코드를 매긴 납입면제조 + 뒤에 참조 항 하나. 바깥 반복 P0100 · 항 P0200 · 안쪽 반복 P0300 · 함수조항 참조 P0400, 반복 밖 항 P0500. */
  function 참조(target: Record<string, unknown>, connector?: "및") {
    const { doc, outer, inner, ref, paragraph, b } = 납입면제조();
    outer.code = "P0100";
    paragraph.code = "P0200";
    inner.code = "P0300";
    ref.code = "P0400";
    const plain = b.paragraph([b.text("고정 항")]);
    plain.code = "P0500";
    const article = doc.children[0] as { id: string; children: unknown[] };
    const r = b.articleRef({ articleId: article.id, ...target } as never);
    if (connector) r.connector = connector;
    else delete r.connector;
    article.children.push(plain, b.paragraph([r]));
    return { doc, r, article, outer, inner, b };
  }

  it("반복 블록 · 함수조항 참조도 대상이다 — 펼치면 여럿이라 하나여도 연결어", () => {
    expect(errors(validateTree(참조({ code: "P0100" }, "및").doc, env))).toEqual([]);
    expect(errors(validateTree(참조({ code: "P0400" }, "및").doc, env))).toEqual([]);
    expect(messages(validateTree(참조({ code: "P0100" }).doc, env))).toEqual([expect.stringContaining("연결어")]);
  });

  it("펼친 함수조항 안 노드 — 참조 노드의 코드 + 그 함수조항 본문의 코드. 없는 안쪽 코드 · 함수조항 참조가 아닌 노드 = 오류", () => {
    expect(errors(validateTree(참조({ code: "P0400", innerCode: "P0100" }, "및").doc, env))).toEqual([]);
    expect(validateTree(참조({ code: "P0400", innerCode: "P0900" }, "및").doc, env)).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("P0900") })]);
    expect(validateTree(참조({ code: "P0500", innerCode: "P0100" }, "및").doc, env)).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("함수조항") })]);
  });

  it("값 한정(해당 값들) — 열거값 반복 안 대상만 · 하나여도 연결어 · 없는 값 = 오류", () => {
    expect(errors(validateTree(참조({ code: "P0400", restrict: { values: ["V01"] } }, "및").doc, env))).toEqual([]);
    expect(messages(validateTree(참조({ code: "P0400", restrict: { values: ["V01"] } }).doc, env))).toEqual([expect.stringContaining("연결어")]);
    expect(validateTree(참조({ code: "P0400", restrict: { values: ["V09"] } }, "및").doc, env)).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("V09") })]);
    // 종 반복 안 항(열거값 반복 밖) · 반복 밖 항은 값으로 좁힐 수 없다
    expect(validateTree(참조({ code: "P0200", restrict: { values: ["V01"] } }, "및").doc, env)).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("값 한정") })]);
    expect(validateTree(참조({ code: "P0500", restrict: { values: ["V01"] } }, "및").doc, env)).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("값 한정") })]);
    expect(validateTree(참조({ code: "P0400", restrict: { values: [] } }, "및").doc, env)).toEqual([expect.objectContaining({ kind: "structure" })]);
  });

  it("값 한정(현재 값) — 참조 자리를 감싼 열거값 반복만. 감싸지 않은 반복 · 종 반복 = 오류", () => {
    const { doc, article, b } = 참조({ code: "P0400" }, "및");
    const refNow = b.articleRef({ articleId: article.id, code: "P0400" });
    refNow.connector = "및";
    const union = b.forBlock(정의조대상마다, [b.paragraph([refNow])]);
    union.code = "P0600";
    article.children.push(union);
    (refNow.targets[0] as { restrict?: unknown }).restrict = { current: union.id };
    expect(errors(validateTree(doc, env))).toEqual([]);
    (refNow.targets[0] as { restrict?: unknown }).restrict = { current: "없는-반복" };
    expect(validateTree(doc, env)).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("현재 값") })]);
    const outerId = (article.children[0] as { id: string }).id;
    (refNow.targets[0] as { restrict?: unknown }).restrict = { current: outerId };
    expect(validateTree(doc, env)).toEqual([expect.objectContaining({ message: expect.stringContaining("현재 값") })]);
  });

  it("값 한정(현재) — 감싼 반복이 담보 트리 반복인데 대상이 사유 반복 안 = 트리 반복 문구(종 반복 문구 아님)", () => {
    const { doc, article, b } = 참조({ code: "P0400" }, "및");
    const refNow = b.articleRef({ articleId: article.id, code: "P0400" });
    refNow.connector = "및";
    const holder = b.paragraph([refNow]);
    const tree = b.forBlock({ kind: "subCoverages" }, [holder]);
    article.children.push(tree);
    (refNow.targets[0] as { restrict?: unknown }).restrict = { current: tree.id };
    const ix = indexTree(doc);
    const issues = refTargetIssues(refNow.targets[0] as never, ix.nodes.get(holder.id)!, ix, {});
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("담보 트리 반복") })]);
    expect(issues[0].message).not.toContain("종 반복");
  });
});

describe("담보 트리 원천 (ADR-0087 결정 5)", () => {
  const forBlock = (id: string, source: unknown, children: unknown[] = []) => ({ kind: "forBlock", id, source, children }) as ForBlockNode;

  it("담보약관에서만 — 문맥 담보가 없으면 structure", () => {
    expect(checkRepeatSource(forBlock("f", { kind: "subCoverages" }), [], { hasCoverage: false }, {})[0]).toMatchObject({ kind: "structure", message: expect.stringContaining("담보약관") });
    expect(checkRepeatSource(forBlock("f", { kind: "subCoverages" }), [], { hasCoverage: true }, {})).toEqual([]);
  });

  it("안쪽은 「현재 세부보장의 급부마다」뿐 — 바로 바깥이 세부보장마다", () => {
    const outer = forBlock("o", { kind: "subCoverages" });
    expect(checkRepeatSource(forBlock("i", { kind: "benefitsOfCurrent", loop: "o" }), [outer], { hasCoverage: true }, {})).toEqual([]);
    expect(checkRepeatSource(forBlock("i", { kind: "benefits" }), [outer], { hasCoverage: true }, {})[0].kind).toBe("structure");
    expect(checkRepeatSource(forBlock("i", { kind: "benefitsOfCurrent", loop: "o" }), [], { hasCoverage: true }, {})[0].kind).toBe("structure");
  });

  it("세목 반복과 섞어 중첩하면 저장 오류 — 어느 쪽이 바깥이든", () => {
    const tree = forBlock("t", { kind: "subCoverages" });
    const plan = forBlock("p", { kind: "planOptions", form: "waiver" });
    const msg = expect.stringContaining("섞어 중첩하지 않습니다");
    expect(checkRepeatSource(forBlock("x", { kind: "listOfCurrent", loop: "t", field: "reasons" }), [tree], { hasCoverage: true }, {})[0]).toMatchObject({ kind: "structure", message: msg });
    expect(checkRepeatSource(forBlock("x", { kind: "benefitsOfCurrent", loop: "p" }), [plan], { hasCoverage: true }, {})[0]).toMatchObject({ kind: "structure", message: msg });
  });

  it("이름 · 원소 타입", () => {
    expect(repeatLabel({ kind: "subCoverages" })).toBe("세부보장마다");
    expect(repeatLabel({ kind: "benefits" })).toBe("세부보장 › 급부마다");
    expect(repeatLabel({ kind: "benefitsOfCurrent", loop: "o" })).toBe("현재 세부보장의 급부마다");
    expect(loopElementType({ kind: "benefits" }, undefined)).toEqual({ kind: "coverageNode", level: "benefit" });
  });

  it("반복 표는 「세부보장마다」 반복 블록 본문에 못 둔다 — 블록 반복 본문은 표를 허용하지 않는다 (사전 판정 ⑦)", () => {
    const b = make();
    const repeatTable = { ...b.textTable({ columns: [{}], rows: [{ cells: ["셀"] }] }), repeat: { depth: 1 as const } };
    const doc = b.document("d", [b.article("a", [b.forBlock({ kind: "subCoverages" } as never, [repeatTable])])]);
    const issues = validateTree(doc, { ...env, kind: "special" });
    expect(issues.some((i) => i.at.nodePath?.includes(repeatTable.id) && i.message.includes("table"))).toBe(true);
  });

  it("treeLoopLevelsAt — 담보 트리 반복만, 바깥 → 안쪽", () => {
    const b = make();
    const para = b.paragraph([b.text("항")]);
    const inner = b.forBlock({ kind: "benefitsOfCurrent", loop: "?" } as never, [para]);
    const outer = b.forBlock({ kind: "subCoverages" } as never, [inner]);
    (inner.source as { loop: string }).loop = outer.id;
    const doc = b.document("d", [b.article("a", [outer])]);
    const ix = indexTree(doc);
    expect(treeLoopLevelsAt(ix, ix.nodes.get(para.id)!)).toEqual([
      { loop: outer.id, level: "subCoverage" },
      { loop: inner.id, level: "benefit" },
    ]);
  });
});

describe("담보 트리 반복 안 — 반복 레벨보다 아래를 한정자 없이 읽으면 오류 (기능/문면 §3.7)", () => {
  const levelOf = (c: string) => (c === "D0002" ? "benefit" : c === "D0007" ? "subCoverage" : undefined);
  const tree = (source: unknown, when: string) => {
    const b = make();
    const f = b.forBlock(source as never, [b.condBlock([b.branch(when, [b.paragraph([b.text("x")])])])]);
    return b.document("d", [b.article("a", [f])]);
  };

  it("세부보장마다 안의 급부 레벨 D0002 = 오류 · 세부보장 레벨 D0007 · 키 경로 D0002@01.1 은 통과", () => {
    expect(treeLoopRefIssues(tree({ kind: "subCoverages" }, "D0002 = true"), levelOf)[0]).toMatchObject({ kind: "structure", message: expect.stringContaining("세부보장마다") });
    expect(treeLoopRefIssues(tree({ kind: "subCoverages" }, "D0007 = true"), levelOf)).toEqual([]);
    expect(treeLoopRefIssues(tree({ kind: "subCoverages" }, "D0002@01.1 = true"), levelOf)).toEqual([]);
    expect(treeLoopRefIssues(tree({ kind: "benefits" }, "D0002 = true and D0007 = true"), levelOf)).toEqual([]);
  });

  it("반복 밖 · 슬롯도 같은 규칙 — 반복 밖은 검사하지 않는다", () => {
    const b = make();
    const slot = b.slot("D0002");
    const f = b.forBlock({ kind: "subCoverages" } as never, [b.paragraph([slot])]);
    const outside = b.paragraph([b.slot("D0002")]);
    const doc = b.document("d", [b.article("a", [f, outside])]);
    const issues = treeLoopRefIssues(doc, levelOf);
    expect(issues).toHaveLength(1);
    expect(issues[0].at.nodePath).toContain(slot.id);
  });
});

describe("키 한정 (ADR-0087 결정 10)", () => {
  const coverage: Coverage = { id: "c", name: "암", description: "", subCoverages: [{ id: "s1", key: "01", name: "유사암", order: 0, benefits: [{ id: "b1", key: "1", name: "진단", order: 0 }] }] };
  const codedPara = (id: string, code: string, text: string) => ({ id, kind: "paragraph" as const, code, children: [{ id: `${id}t`, kind: "text" as const, text }] });
  const docOf = (children: unknown[]): DocumentNode => ({ id: "d", kind: "document", title: "특약", children: [{ id: "a1", kind: "article", title: "제1조", children }] }) as DocumentNode;
  const docWithLoop = (source: object) => docOf([{ kind: "forBlock", id: "f", code: "P0100", source, children: [codedPara("p", "P0200", "본문")] }, codedPara("q", "P0300", "참조 자리")]);

  it("트리 반복 안 대상에 있는 키 = 통과 · 없는 키 = 「없는 키」 · 빈 키 = 오류", () => {
    const ix = indexTree(docWithLoop({ kind: "subCoverages" }));
    const refEntry = ix.nodes.get("q")!;
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: ["01"] } }, refEntry, ix, { coverage })).toEqual([]);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: ["02"] } }, refEntry, ix, { coverage })[0]).toMatchObject({ kind: "brokenRef", message: expect.stringContaining("없는 키") });
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: [] } }, refEntry, ix, { coverage })[0].kind).toBe("structure");
    // 반복 블록 자신도 대상이다 · 문맥 담보가 없으면 키 존재는 건너뛴다
    expect(refTargetIssues({ articleId: "a1", code: "P0100", restrict: { keys: ["01"] } }, refEntry, ix, { coverage })).toEqual([]);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: ["02"] } }, refEntry, ix, {})).toEqual([]);
  });

  it("급부 반복 대상은 세부보장 키(그 아래 급부 전부) · 급부 키 경로 둘 다", () => {
    const ix = indexTree(docWithLoop({ kind: "benefits" }));
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: ["01", "01.1"] } }, ix.nodes.get("q")!, ix, { coverage })).toEqual([]);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: ["01.2"] } }, ix.nodes.get("q")!, ix, { coverage })[0]).toMatchObject({ kind: "brokenRef", message: expect.stringContaining("01.2") });
  });

  it("세부보장마다 대상에 급부 키 경로 · 트리 반복 밖 대상에 키 한정 = 오류", () => {
    const ix = indexTree(docWithLoop({ kind: "subCoverages" }));
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { keys: ["01.1"] } }, ix.nodes.get("q")!, ix, { coverage })[0].kind).toBe("structure");
    expect(refTargetIssues({ articleId: "a1", code: "P0300", restrict: { keys: ["01"] } }, ix.nodes.get("q")!, ix, { coverage })[0].kind).toBe("structure");
  });

  it("「현재」는 감싼 트리 반복이면 통과 · 감싸지 않으면 오류", () => {
    const d = docOf([{ kind: "forBlock", id: "f", code: "P0100", source: { kind: "subCoverages" }, children: [codedPara("p", "P0200", "본문"), codedPara("q", "P0300", "같은 회차")] }, codedPara("r", "P0400", "반복 밖")]);
    const ix = indexTree(d);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { current: "f" } }, ix.nodes.get("q")!, ix, { coverage })).toEqual([]);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { current: "f" } }, ix.nodes.get("r")!, ix, { coverage })[0]).toMatchObject({ kind: "structure", message: expect.stringContaining("현재") });
  });

  it("「현재」가 급부 반복인데 대상이 「세부보장마다」 = 오류 — 급부 키 경로는 세부보장 원소를 고르지 못한다(바깥 세부보장 반복의 「현재」는 통과)", () => {
    const inner = { kind: "forBlock", id: "g", code: "P0500", source: { kind: "benefitsOfCurrent", loop: "f" }, children: [codedPara("q", "P0600", "급부 회차")] };
    const d = docOf([{ kind: "forBlock", id: "f", code: "P0100", source: { kind: "subCoverages" }, children: [codedPara("p", "P0200", "본문"), inner] }]);
    const ix = indexTree(d);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { current: "f" } }, ix.nodes.get("q")!, ix, { coverage })).toEqual([]);
    expect(refTargetIssues({ articleId: "a1", code: "P0200", restrict: { current: "g" } }, ix.nodes.get("q")!, ix, { coverage })[0]).toMatchObject({ kind: "structure", message: expect.stringContaining("세부보장마다") });
    // 급부 반복 대상은 급부 「현재」 · 세부보장 「현재」 둘 다 통과
    expect(refTargetIssues({ articleId: "a1", code: "P0600", restrict: { current: "g" } }, ix.nodes.get("q")!, ix, { coverage })).toEqual([]);
    expect(refTargetIssues({ articleId: "a1", code: "P0600", restrict: { current: "f" } }, ix.nodes.get("q")!, ix, { coverage })).toEqual([]);
  });

  it("문서 저장 검사 — validateDocument 가 scope.coverage 로 없는 키를 잡는다 · 연결어 규칙은 그대로", () => {
    const ref = (restrict: unknown, connector?: string) => ({ id: "r", kind: "articleRef", scope: "self", targets: [{ articleId: "a1", code: "P0200", restrict }], ...(connector ? { connector } : {}) });
    const d = (restrict: unknown, connector?: string) => docOf([{ kind: "forBlock", id: "f", code: "P0100", source: { kind: "subCoverages" }, children: [codedPara("p", "P0200", "본문")] }, { id: "q", kind: "paragraph", code: "P0300", children: [ref(restrict, connector)] }]);
    const check = (tree: DocumentNode) => errors(validateDocument(tree, { env: { ...env, kind: "special" }, resolve: catalogTypeResolver([]), scope: { coverage } }));
    expect(check(d({ keys: ["01"] }, "및"))).toEqual([]);
    expect(check(d({ keys: ["02"] }, "및"))).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("없는 키 02") })]);
    expect(messages(check(d({ keys: ["01"] })))).toEqual([expect.stringContaining("연결어")]);
  });

  it("보통약관 대상 — 감싼 트리 반복의 「현재」 · 키 한정은 못 건다(보통약관에는 담보 트리 반복이 없다)", () => {
    const ref = (restrict: unknown) => ({ id: "r", kind: "articleRef", scope: "general", connector: "및", targets: [{ articleId: "g-a", code: "P0100", restrict }] });
    const d = (restrict: unknown, inLoop: boolean) => {
      const para = { id: "q", kind: "paragraph", children: [ref(restrict)] };
      return docOf(inLoop ? [{ kind: "forBlock", id: "f", source: { kind: "subCoverages" }, children: [para] }] : [para]);
    };
    const generals = { ...env, kind: "special" as const, generalArticleIds: new Set(["g-a"]), generalReferenceKeys: new Set(["g-a", "g-a#P0100"]), generalRepeatedKeys: new Set(["g-a#P0100"]) };
    expect(messages(validateTree(d({ current: "f" }, true), generals))).toEqual([expect.stringContaining("보통약관에는 담보 트리 반복이 없어")]);
    expect(messages(validateTree(d({ current: "f" }, false), generals))).toEqual([expect.stringContaining("현재 값")]);
    expect(messages(validateTree(d({ keys: ["01"] }, true), generals))).toEqual([expect.stringContaining("키 한정")]);
  });
});

describe("대응 보통약관 대상의 안쪽 코드 · 값 한정 열거형 — 담보약관 저장도 본다 (기능/문면 §3.7 ②)", () => {
  /** 보통약관 = 납입면제조(바깥 반복 P0100 · 항 P0200 · 사유 반복 P0300 · 함수조항 참조 P0400 — 본문 호 P0100), 담보약관 = 보통약관 참조 하나. */
  function 담보(target: Record<string, unknown>, inTree = false) {
    const general = 납입면제조();
    general.outer.code = "P0100";
    general.paragraph.code = "P0200";
    general.inner.code = "P0300";
    general.ref.code = "P0400";
    const generalArticle = (general.doc.children[0] as { id: string }).id;
    const refs = generalRefsOf(general.doc, { clauseOf: (c) => [면제호, 부가항, 정의].find((x) => x.code === c) });
    const b = nodeBuilders(sequentialIds("s"));
    const ref = b.articleRef({ articleId: generalArticle, ...target } as never, "general", "및");
    const tree = b.forBlock({ kind: "subCoverages" }, [b.paragraph([ref])]);
    if (inTree) (ref.targets[0] as { restrict?: unknown }).restrict = { current: tree.id };
    const doc = b.document("특약", [b.article("준용", [inTree ? tree : b.paragraph([ref])])]);
    const treeEnv: TreeEnv = { ...env, kind: "special", generalArticleIds: refs.articleIds, generalReferenceKeys: refs.referenceKeys, ...(refs.repeatedKeys ? { generalRepeatedKeys: refs.repeatedKeys } : {}), ...(refs.targets ? { generalTargets: refs.targets } : {}) };
    return validateTree(doc, treeEnv);
  }

  it("맞는 안쪽 코드 · 사유 반복 안 대상의 값 한정 = 통과", () => {
    expect(담보({ code: "P0400", innerCode: "P0100", restrict: { values: ["V01"] } })).toEqual([]);
  });

  it("함수조항 본문에 없는 안쪽 코드 = 깨진 참조", () => {
    expect(담보({ code: "P0400", innerCode: "P9900" })).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("P9900") })]);
  });

  it("함수조항 참조가 아닌 대상에 안쪽 코드 = 오류", () => {
    expect(messages(담보({ code: "P0200", innerCode: "P0100" }))).toEqual([expect.stringContaining("함수조항 블록 참조를 가리킬 때만")]);
  });

  it("값 한정 「현재」가 감싼 담보 트리 반복(세부보장마다) = 보통약관엔 트리 반복이 없다는 오류 — 종 반복 문구가 아니다", () => {
    const issues = 담보({ code: "P0400" }, true).filter((i) => i.severity !== "warning");
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("보통약관에는 담보 트리 반복이 없어")]);
    expect(issues[0].message).not.toContain("종 반복");
  });

  it("값 한정 — 종 반복(열거값 아님)만 감싼 대상 = 오류, 지운 값 = 「없는 값」", () => {
    expect(messages(담보({ code: "P0200", restrict: { values: ["V01"] } }))).toEqual([expect.stringContaining("열거값(사유)")]);
    expect(담보({ code: "P0400", restrict: { values: ["V99"] } })).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("없는 값 V99") })]);
  });
});

describe("함수조항 저장의 외부 참조 영향 — 사라진 안쪽 코드를 가리키는 문서 (관계정보 재검사 목록, ADR-0049)", () => {
  /** 보통약관(함수조항 참조 P0400 = C0300) 안 자기 참조 하나 + 담보약관의 보통약관 참조 하나 — 둘 다 안쪽 코드 P0100 을 가리킨다. */
  function 문서들() {
    const general = 납입면제조();
    general.outer.code = "P0100";
    general.paragraph.code = "P0200";
    general.inner.code = "P0300";
    general.ref.code = "P0400";
    const article = general.doc.children[0] as { id: string; children: unknown[] };
    const b = nodeBuilders(sequentialIds("z"));
    const own = b.articleRef({ articleId: article.id, code: "P0400", innerCode: "P0100" } as never, "self", "및");
    const ownPara = b.paragraph([own]);
    ownPara.code = "P0500";
    article.children.push(ownPara);
    const other = b.articleRef({ articleId: article.id, code: "P0400", innerCode: "P0100" } as never, "general", "및");
    const special = b.document("특약", [b.article("준용", [b.paragraph([other])])]);
    const docs: RecheckDocument[] = [
      { id: "g", title: "보통약관", kind: "general", ownerId: "g", tree: general.doc },
      { id: "s", title: "특약", kind: "special", ownerId: "cov", tree: special, generalDocumentId: "g" },
    ];
    const usages = [{ documentId: "g", ownerKind: "general" as const, ownerId: "g", refNodeId: general.ref.id }];
    return { docs, usages, own, other };
  }

  it("본문에 그 안쪽 코드가 있으면 항목 없음", () => {
    const { docs, usages } = 문서들();
    expect(clauseInnerCodes(면제호)).toEqual(new Set(["P0100"]));
    expect(lostInnerCodeEntries(면제호, usages, docs)).toEqual([]);
  });

  it("안쪽 코드가 사라지면 「안쪽 코드 P0100 사라짐 — 참조하는 문서 2곳」 — 같은 문서 · 담보약관(보통약관 참조) 두 자리로 고치러 간다", () => {
    const { docs, usages, own, other } = 문서들();
    const changed: Clause = { ...면제호, body: [{ id: "sw", kind: "switchBlock", on: "arg.사유", cases: [{ id: "k1", values: ["V01", "V02", "V03"], children: [{ ...item("i1", "사유 호"), code: "P0200" }] }] }] as never };
    const entries = lostInnerCodeEntries(changed, usages, docs);
    expect(entries).toHaveLength(1);
    expect(entries[0].usage).toMatchObject({ documentId: "g", refNodeId: usages[0].refNodeId });
    expect(entries[0].issues.map((i) => i.message)).toEqual([expect.stringContaining("안쪽 코드 P0100 사라짐 — 참조하는 문서 2곳"), expect.stringContaining("안쪽 코드 P0100 사라짐 — 참조하는 문서 2곳")]);
    expect(entries[0].issues.map((i) => [i.kind, i.at.documentId, i.at.nodePath?.at(-1)])).toEqual([
      ["brokenRef", "g", own.id],
      ["brokenRef", "s", other.id],
    ]);
  });
});
