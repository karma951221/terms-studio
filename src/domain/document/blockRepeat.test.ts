import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";
import type { Clause } from "../clause/types";
import { checkParams } from "../clause/params";
import type { Issue } from "../types";
import { cloneForElement, repeatLabel, type RepeatSource } from "./blockRepeat";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand } from "./commands";
import { numberTree, referenceTargetIndex } from "./numbering";
import type { DocumentNode, ForBlockNode, TreeEnv } from "./nodes";
import { validateTree } from "./nodes";
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
