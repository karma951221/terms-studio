import { describe, expect, it } from "vitest";

import type { Binding } from "../clause/params";
import type { Clause } from "../clause/types";
import type { DocumentNode } from "../document/nodes";
import type { Code } from "../types";
import { assemble } from "./booklet";
import { authoredEmptyArticleIds, dropEmptyArticles } from "./emptyArticle";
import { buildContexts, specialContext } from "./context";
import { alphaPlusFixture, coverageEntry } from "./fixture";
import { collectAppendices, numberDocument, renderDocument } from "./render";
import { resolveDocument } from "./resolve";
import { substituteSlots } from "./substitute";
import type { AssemblyCoverage, AssemblyInput, RenderedInline, SubstitutedDoc } from "./types";

/** 픽스처를 한 객체로 다루는 테스트 진입 — 조립 서명 `assemble(master, product)` 에 같은 객체를 두 번 넘긴다 (AssemblyInput = MasterBundle & ProductInput). */
const assembleInput = (input: AssemblyInput) => assemble(input, input);

const text = (id: string, value: string) => ({ kind: "text" as const, id, text: value });
const at = { document: "special" as const, ownerId: "pc" };

function general(): SubstitutedDoc {
  return {
    kind: "document",
    id: "g",
    title: "보통약관",
    children: [
      {
        kind: "article",
        id: "g-a",
        title: "해약환급금",
        children: [
          { kind: "paragraph", id: "g-p1", key: "P0100", children: [text("g-t1", "첫째")] },
          { kind: "paragraph", id: "g-p2", key: "P0200", children: [text("g-t2", "둘째")] },
        ],
      },
    ],
  };
}

describe("참조 슬롯 렌더", () => {
  it("보통약관 항 다중 참조는 접두·조명을 한 번만 쓰고 마지막 앞 연결어를 쓴다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "s-a", title: "준용", children: [{ kind: "paragraph", id: "s-p", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "g-a", code: "P0100" }, { articleId: "g-a", code: "P0200" }], connector: "및", scope: "general", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", general: numberDocument(general()), appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
    expect(article.children[0].children[0]).toMatchObject({ label: "보통약관 제1조(해약환급금) 제1항 및 제2항" });
  });

  it("같은 문서의 호·항·다른 조 항은 현재 위치와 직전 대상 기준으로 상위 번호를 생략한다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [
        {
          kind: "article",
          id: "a1",
          title: "첫 조",
          children: [
            { kind: "paragraph", id: "p1", key: "P0100", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "a1", code: "P0400" }, { articleId: "a1", code: "P0200" }, { articleId: "a2", code: "P0100" }], connector: "또는", scope: "self", at }], items: [{ kind: "item", id: "i1", key: "P0300", children: [] }, { kind: "item", id: "i2", key: "P0400", children: [] }] },
            { kind: "paragraph", id: "p2", key: "P0200", children: [] },
          ],
        },
        { kind: "article", id: "a2", title: "둘째 조", children: [{ kind: "paragraph", id: "p3", key: "P0100", children: [] }] },
      ],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
    expect(article.children[0].children[0]).toMatchObject({ label: "제2호, 제2항 또는 제2조(둘째 조) 제1항" });
  });

  it("대상 전부가 사라지면 대상마다 issue 를 내되 슬롯 자리에는 오류 마커 하나만 둔다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "paragraph", id: "p", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "gone-1" }, { articleId: "gone-2" }], connector: "및", scope: "self", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
    expect(result.issues.map((issue) => [issue.kind, issue.at.refPath])).toEqual([["articleGone", "gone-1"], ["articleGone", "gone-2"]]); // refPath = 대상 열쇠
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected structural error");
    expect(article.children[0].children).toHaveLength(1);
    expect(article.children[0].children[0].kind).toBe("error");
  });

  describe("분기로 사라진 대상은 덩어리에서 빼고 남은 대상을 계산 번호로 표기한다 (기능/문면 §3.5)", () => {
    /** 조 a1…a6 중 `present` 만 남은 조립 결과 — 참조 슬롯은 a1 첫 항에 둔다. */
    function docWith(present: readonly string[], targets: readonly string[], connector: "및" | "또는"): SubstitutedDoc {
      return {
        kind: "document",
        id: "s",
        title: "특약",
        children: present.map((id, i) => ({
          kind: "article" as const,
          id,
          title: `조${id.slice(1)}`,
          children: [{ kind: "paragraph" as const, id: `${id}-p`, children: i === 0 ? [{ kind: "articleRef" as const, id: "ref", targets: targets.map((articleId) => ({ articleId })), connector, scope: "self" as const, at }] : [] }],
        })),
      };
    }
    const refOf = (doc: SubstitutedDoc) => {
      const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
      const article = result.doc.children[0];
      if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
      return { node: article.children[0].children[0], issues: result.issues };
    };

    it("3 · 4조를 참조했는데 4조가 빠지면 「제3조」만 — 오류 아님", () => {
      const { node, issues } = refOf(docWith(["a1", "a2", "a3", "a5", "a6"], ["a3", "a4"], "및"));
      expect(issues).toEqual([]);
      expect(node).toMatchObject({ kind: "articleRef", label: "제3조(조3)", dropped: ["a4"] });
    });

    it("3 · 4 · 5조를 참조했는데 4조가 빠지면 남은 둘은 계산 번호로 제3조 · 제4조가 되어 연결어로 잇는다", () => {
      const { node } = refOf(docWith(["a1", "a2", "a3", "a5", "a6"], ["a3", "a4", "a5"], "또는"));
      expect(node).toMatchObject({ label: "제3조(조3) 또는 제4조(조5)", dropped: ["a4"] });
    });

    it("3 · 4 · 5 · 6조를 참조했는데 4조가 빠지면 남은 셋이 계산 번호로 연속이라 「제3조부터 제5조까지」", () => {
      const { node } = refOf(docWith(["a1", "a2", "a3", "a5", "a6"], ["a3", "a4", "a5", "a6"], "및"));
      expect(node).toMatchObject({ label: "제3조(조3)부터 제5조(조6)까지", dropped: ["a4"] });
    });

    it("아무것도 빠지지 않으면 dropped 없이 범위 표기", () => {
      const { node } = refOf(docWith(["a1", "a2", "a3", "a4", "a5", "a6"], ["a3", "a4", "a5"], "및"));
      expect(node).toMatchObject({ label: "제3조(조3)부터 제5조(조5)까지" });
      expect((node as { dropped?: string[] }).dropped).toBeUndefined();
    });

    it("같은 조 안의 항 참조도 같다 — 제1 · 2 · 3항 참조에 2항이 빠지면 「제1항 및 제2항」", () => {
      const doc: SubstitutedDoc = {
        kind: "document",
        id: "s",
        title: "특약",
        children: [
          {
            kind: "article",
            id: "a1",
            title: "조",
            children: [
              { kind: "paragraph", id: "p1", key: "P0100", children: [] },
              { kind: "paragraph", id: "p3", key: "P0300", children: [] },
              { kind: "paragraph", id: "p4", key: "P0400", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "a1", code: "P0100" }, { articleId: "a1", code: "P0200" }, { articleId: "a1", code: "P0300" }], connector: "및", scope: "self", at }] },
            ],
          },
        ],
      };
      const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
      const article = result.doc.children[0];
      if (article.kind !== "article" || article.children[2].kind !== "paragraph") throw new Error("unexpected error");
      expect(article.children[2].children[0]).toMatchObject({ label: "제1항 및 제2항", dropped: ["a1#P0200"] });
    });
  });

  describe("조건식을 실제로 태운 참조 — 분기 결과에 따라 같은 슬롯이 다르게 찍힌다", () => {
    /** 제1조 참조 슬롯 → [a2, a3, a4, a5]. a3 는 `D0005 = true`(면책여부합) 가지 안에 있다. */
    function source(): DocumentNode {
      const article = (id: string, title: string): DocumentNode["children"][number] => ({ kind: "article", id, title, children: [{ kind: "paragraph", id: `${id}-p`, children: [{ kind: "text", id: `${id}-t`, text: "본문" }] }] });
      return {
        kind: "document",
        id: "s",
        title: "특약",
        children: [
          { kind: "article", id: "a1", title: "준용", children: [{ kind: "paragraph", id: "a1-p", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "a2" }, { articleId: "a3" }, { articleId: "a4" }, { articleId: "a5" }], connector: "및", scope: "self" }] }] },
          article("a2", "둘"),
          { kind: "condBlock", id: "cond", branches: [{ id: "cond-if", when: "D0005 = true", children: [article("a3", "면책")] }] },
          article("a4", "넷"),
          article("a5", "다섯"),
        ],
      };
    }
    function refLabel(coverage: AssemblyCoverage): RenderedInline {
      const input = alphaPlusFixture();
      const ctx = specialContext(input, coverage);
      const resolved = resolveDocument(source(), ctx, { clauses: new Map(), overrides: new Map(), coordinate: at });
      const substituted = substituteSlots(resolved.doc, ctx, { catalog: new Map(input.catalog.map((d) => [d.code, d])), enums: new Map(input.enums.map((e) => [e.code, e])), master: input.master });
      const result = renderDocument(numberDocument(substituted.doc), { document: "special", ownerId: coverage.snapshot.id, appendices: [] });
      expect([...resolved.issues, ...substituted.issues, ...result.issues]).toEqual([]);
      const article = result.doc.children[0];
      if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
      return article.children[0].children[0];
    }
    const exempt = (id: string, exempt: boolean) =>
      coverageEntry({
        id,
        name: id,
        coverageId: "cov-death",
        coverageName: "일반상해사망",
        attributes: [],
        subCoverages: [{ id: `${id}-sub`, masterNodeId: "sub-death", name: "일반상해사망", benefits: [{ id: `${id}-ben`, masterNodeId: "ben-death", name: "사망보험금" }] }],
        values: { [id]: { "coverage_basic.renewal": false, "coverage_basic.reduction_months": 24, "coverage_basic.reduction_text": "24개월" }, [`${id}-ben`]: { "pay.exempt": exempt, "pay.rate": 100 } },
      });

    it("면책이면 a3 가 살아 제2조부터 제5조까지", () => {
      expect(refLabel(exempt("pc-x", true))).toMatchObject({ label: "제2조(둘)부터 제5조(다섯)까지" });
    });

    it("면책이 아니면 a3 가 빠지고 뒤 조가 당겨져 제2조부터 제4조까지", () => {
      expect(refLabel(exempt("pc-y", false))).toMatchObject({ label: "제2조(둘)부터 제4조(다섯)까지", dropped: ["a3"] });
    });

    it("buildContexts 로 만든 탑재분 문맥에서도 같다 (pc-basic 은 면책 true)", () => {
      const input = alphaPlusFixture();
      const ctx = buildContexts(input).specials.get("pc-basic")!;
      const resolved = resolveDocument(source(), ctx, { clauses: new Map(), overrides: new Map(), coordinate: at });
      const substituted = substituteSlots(resolved.doc, ctx, { catalog: new Map(input.catalog.map((d) => [d.code, d])), enums: new Map(input.enums.map((e) => [e.code, e])), master: input.master });
      const result = renderDocument(numberDocument(substituted.doc), { document: "special", ownerId: "pc-basic", appendices: [] });
      const article = result.doc.children[0];
      if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
      expect(article.children[0].children[0]).toMatchObject({ label: "제2조(둘)부터 제5조(다섯)까지" });
    });
  });

  describe("함수조항 인자 연결 — 같은 함수조항을 사용처마다 다른 값으로 (최종 결정 2 · 기능/함수조항 §3.7)", () => {
    /** 인자 조건(boolean) · 이름(string, 기본 연결 D0007 감액기간문구) — 조건이면 「참」 아니면 「거짓」, 뒤에 이름. */
    const 판정: Clause = {
      code: "C0100",
      label: "판정",
      mode: "block",
      body: [
        {
          id: "p",
          kind: "paragraph",
          children: [
            { id: "c", kind: "inlineCond", branches: [{ id: "c-if", when: "arg.조건", children: [text("t1", "참")] }, { id: "c-else", children: [text("t2", "거짓")] }] },
            text("t3", " · "),
            { id: "s", kind: "slot", ref: "arg.이름" },
          ],
        },
      ],
      options: [],
      params: [
        { name: "조건", type: { kind: "boolean" } },
        { name: "이름", type: { kind: "string" }, default: { kind: "discriminator", code: "D0007" } },
      ],
      required: { discriminators: [], attributes: [] },
    };
    function lines(bindings: readonly Record<string, Binding>[]): string[] {
      const input = alphaPlusFixture();
      const coverage = coverageEntry({
        id: "pc-z",
        name: "pc-z",
        coverageId: "cov-death",
        coverageName: "일반상해사망",
        attributes: [],
        subCoverages: [{ id: "pc-z-sub", masterNodeId: "sub-death", name: "일반상해사망", benefits: [{ id: "pc-z-ben", masterNodeId: "ben-death", name: "사망보험금" }] }],
        values: { "pc-z": { "coverage_basic.renewal": false, "coverage_basic.reduction_months": 24, "coverage_basic.reduction_text": "24개월" }, "pc-z-ben": { "pay.exempt": true, "pay.rate": 100 } },
      });
      const ctx = specialContext(input, coverage);
      const doc: DocumentNode = { kind: "document", id: "s", title: "특약", children: [{ kind: "article", id: "a", title: "조", children: bindings.map((b, i) => ({ kind: "clauseBlockRef", id: `r${i}`, clauseCode: "C0100", options: {}, bindings: b })) }] };
      const enums = new Map(input.enums.map((e) => [e.code, e]));
      const resolved = resolveDocument(doc, ctx, { clauses: new Map([["C0100", 판정]]), overrides: new Map(), coordinate: at, enums });
      const substituted = substituteSlots(resolved.doc, ctx, { catalog: new Map(input.catalog.map((d) => [d.code, d])), enums, master: input.master });
      expect([...resolved.issues, ...substituted.issues]).toEqual([]);
      const article = substituted.doc.children[0];
      if (article.kind !== "article") throw new Error("unexpected");
      return article.children.map((p) => (p.kind === "paragraph" ? p.children.map((c) => (c.kind === "text" ? c.text : "?")).join("") : "?"));
    }

    it("두 사용처가 다른 구분자로 연결하면 각자 값대로 — 갱신여부(거짓) · 면책여부합(참)", () => {
      expect(lines([{ 조건: { kind: "discriminator", code: "D0001" } }, { 조건: { kind: "discriminator", code: "D0005" } }])).toEqual(["거짓 · 24개월", "참 · 24개월"]);
    });

    it("상수 연결 — 조건은 그 값으로, 이름은 그 글로(기본 연결을 바꾼다)", () => {
      expect(lines([{ 조건: { kind: "const", value: true }, 이름: { kind: "const", value: "골절진단비" } }])).toEqual(["참 · 골절진단비"]);
    });

    it("연결이 빠지면 그 자리가 argUnbound 오류 마커다", () => {
      const input = alphaPlusFixture();
      const ctx = buildContexts(input).specials.get("pc-basic")!;
      const doc: DocumentNode = { kind: "document", id: "s", title: "특약", children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "clauseBlockRef", id: "r", clauseCode: "C0100", options: {} }] }] };
      const resolved = resolveDocument(doc, ctx, { clauses: new Map([["C0100", 판정]]), overrides: new Map(), coordinate: at });
      expect(resolved.issues.map((i) => [i.kind, i.at.refPath])).toEqual([["argUnbound", "arg.조건"]]);
    });
  });

  describe("함수조항 내부 변수 — 원천(적용 납입면제종)의 사유 합치기로 가지를 고른다 (최종 결정 2 · 기능/함수조항 §3.7)", () => {
    /** 종들(원천: 적용여부 = 예) → 모든사유 = 종들.합치기(waiver.reasons) → 암있음 = 모든사유.있음('V01'). 암있음이면 암 항, 뒤에 첫 사유 표시명(필드). */
    const 부가항: Clause = {
      code: "C0200",
      label: "면제 부가항",
      mode: "block",
      body: [
        { id: "p", kind: "paragraph", children: [{ id: "c", kind: "inlineCond", branches: [{ id: "c-if", when: "var.암있음", children: [text("t1", "암보장개시일")] }, { id: "c-else", children: [text("t2", "없음")] }] }] },
        { id: "q", kind: "paragraph", children: [{ id: "s", kind: "slot", ref: "arg.대표사유.F01" }] },
      ],
      options: [],
      params: [
        { name: "종들", type: { kind: "planOptions", form: "waiver" }, default: { kind: "source", source: { form: "waiver", filter: "waiver.applies = true" } } },
        { name: "대표사유", type: { kind: "enum", enumCode: "E0009" }, default: { kind: "const", value: "V02" } },
      ],
      locals: [
        { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
        { name: "암있음", expr: "var.모든사유.있음('V01')" },
      ],
      required: { discriminators: [], attributes: [] },
    };
    function run(reasons: Record<string, string[]>): { lines: string[]; issues: unknown[] } {
      const base = alphaPlusFixture();
      const input: AssemblyInput = {
        ...base,
        master: base.master!.map((f) => (f.key === "waiver" ? { ...f, fields: [...f.fields, { key: "reasons", label: "사유", type: { kind: "list<enum>", enumCode: "E0009" } }] } : f)),
        enums: [
          ...base.enums,
          {
            code: "E0009",
            label: "사유",
            fields: [{ key: "F01", label: "약관표시명", type: "string", order: 1 }],
            values: [
              { code: "V01", label: "암", order: 0, fields: { F01: "암" } },
              { code: "V02", label: "뇌졸중", order: 1, fields: { F01: "뇌졸중(뇌출혈 포함)" } },
            ],
          },
        ],
        product: {
          ...base.product,
          planOptions: base.product.planOptions.map((o) => (reasons[o.id] ? { ...o, values: new Map([...o.values, ["waiver.reasons", { entered: true as const, value: reasons[o.id] }]]) } : o)),
        },
      };
      const ctx = buildContexts(input).general;
      const doc: DocumentNode = { kind: "document", id: "g", title: "보통약관", children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "clauseBlockRef", id: "r", clauseCode: "C0200", options: {} }] }] };
      const enums = new Map(input.enums.map((e) => [e.code, e]));
      const resolved = resolveDocument(doc, ctx, { clauses: new Map([["C0200", 부가항]]), overrides: new Map(), coordinate: at, enums, master: input.master });
      const article = resolved.doc.children[0];
      if (article.kind !== "article") return { lines: [], issues: resolved.issues };
      return { lines: article.children.map((p) => (p.kind === "paragraph" ? p.children.map((c) => (c.kind === "text" ? c.text : "?")).join("") : "?")), issues: resolved.issues };
    }

    it("적용 종(1종)의 사유에 암이 있으면 암 가지 · 필드 슬롯은 대표 사유의 약관표시명", () => {
      expect(run({ "opt-type-1": ["V02", "V01"], "opt-type-2": [] })).toEqual({ lines: ["암보장개시일", "뇌졸중(뇌출혈 포함)"], issues: [] });
    });

    it("암은 적용 안 되는 종(2종)에만 있으면 거름에 걸려 없음 가지", () => {
      expect(run({ "opt-type-1": ["V02"], "opt-type-2": ["V01"] }).lines).toEqual(["없음", "뇌졸중(뇌출혈 포함)"]);
    });
  });

  describe("값별 분기(switch) — 인자 값의 칸을 펼친다 (최종 결정 5 · 기능/함수조항 §3.7)", () => {
    const item = (id: string, value: string) => ({ id, kind: "item" as const, children: [text(`${id}t`, value)] });
    /** 납입면제 호(사유) — 호 유형. V01 암 호 하나 · V02 「문구 없음」 · V03 상해 · 질병 호 둘. V04 는 칸이 없다(열거값 추가로 생긴 미배정). */
    const 면제호: Clause = {
      code: "C0300",
      label: "납입면제 호",
      mode: "item",
      body: [
        {
          id: "sw",
          kind: "switchBlock",
          on: "arg.사유",
          cases: [
            { id: "k1", values: ["V01"], children: [item("i1", "암으로 진단확정")] },
            { id: "k2", values: ["V02"], empty: true, children: [] },
            { id: "k3", values: ["V03"], children: [item("i3a", "상해로 80% 이상 장해"), item("i3b", "질병으로 80% 이상 장해")] },
          ],
        },
      ],
      options: [],
      params: [{ name: "사유", type: { kind: "enum", enumCode: "E0009" } }],
      required: { discriminators: [], attributes: [] },
    };
    /** 문구 유형 — 문장 안 분기. */
    const 사유말: Clause = {
      code: "C0301",
      label: "사유 말",
      mode: "inline",
      body: [
        { id: "is", kind: "inlineSwitch", on: "arg.사유", cases: [{ id: "a", values: ["V01", "V02"], children: [text("ta", "진단")] }, { id: "b", values: ["V03"], children: [text("tb", "장해")] }] },
        text("tz", "시"),
      ],
      options: [],
      params: [{ name: "사유", type: { kind: "enum", enumCode: "E0009" } }],
      required: { discriminators: [], attributes: [] },
    };
    function run(reasons: readonly string[], build: (r: string, i: number) => DocumentNode["children"][number]) {
      const input = alphaPlusFixture();
      const ctx = buildContexts(input).general;
      const doc: DocumentNode = { kind: "document", id: "g", title: "보통약관", children: reasons.map(build) };
      const resolved = resolveDocument(doc, ctx, { clauses: new Map([["C0300", 면제호], ["C0301", 사유말]]), overrides: new Map(), coordinate: at });
      return resolved;
    }
    const withItems = (r: string, i: number): DocumentNode["children"][number] => ({
      kind: "article",
      id: `a${i}`,
      title: "조",
      children: [{ kind: "paragraph", id: `p${i}`, children: [text(`t${i}`, "다음의 경우")], items: [{ kind: "clauseBlockRef", id: `r${i}`, clauseCode: "C0300", options: {}, bindings: { 사유: { kind: "const", value: r } } }] as never }],
    });
    const itemTexts = (doc: ReturnType<typeof run>["doc"]) =>
      doc.children.map((a) => (a.kind === "article" && a.children[0]?.kind === "paragraph" ? (a.children[0].items ?? []).map((x) => (x.kind === "item" ? x.children.map((c) => (c.kind === "text" ? c.text : "?")).join("") : x.kind)) : []));

    it("인자 사유 = V03 이면 V03 칸의 호 둘 · V01 이면 암 호 하나", () => {
      const r = run(["V03", "V01"], withItems);
      expect(r.issues).toEqual([]);
      expect(itemTexts(r.doc)).toEqual([["상해로 80% 이상 장해", "질병으로 80% 이상 장해"], ["암으로 진단확정"]]);
    });

    it("「문구 없음」 칸 = 호 0개", () => {
      const r = run(["V02"], withItems);
      expect(r.issues).toEqual([]);
      expect(itemTexts(r.doc)).toEqual([[]]);
    });

    it("미배정 값이 조립에 닿으면 오류(좌표 = 분기 · 값 · 함수조항) · 안 닿는 사용처는 영향 없음", () => {
      const r = run(["V01", "V04"], withItems);
      expect(r.issues).toEqual([
        expect.objectContaining({
          kind: "unassignedValue",
          message: expect.stringContaining("C0300"),
          at: expect.objectContaining({ articleId: "a1", nodePath: ["g", "a1", "p1", "r1", "r1/sw"], refPath: "V04" }),
        }),
      ]);
      expect(itemTexts(r.doc)[0]).toEqual(["암으로 진단확정"]);
    });

    it("문장 안 분기 — 값의 칸 조각을 문장에 끼운다", () => {
      const r = run(["V02", "V03"], (v, i) => ({
        kind: "article",
        id: `a${i}`,
        title: "조",
        children: [{ kind: "paragraph", id: `p${i}`, children: [{ kind: "clauseInlineRef", id: `r${i}`, clauseCode: "C0301", options: {}, bindings: { 사유: { kind: "const", value: v } } }] }],
      }));
      expect(r.issues).toEqual([]);
      expect(r.doc.children.map((a) => (a.kind === "article" && a.children[0]?.kind === "paragraph" ? a.children[0].children.map((c) => (c.kind === "text" ? c.text : "?")).join("") : ""))).toEqual(["진단시", "장해시"]);
    });

    it("분기가 조의 본문을 모두 비우면 빈 조 빼기가 조째 뺀다 (결정 15)", () => {
      const 항분기: Clause = {
        ...면제호,
        code: "C0302",
        mode: "block",
        body: [{ id: "sw", kind: "switchBlock", on: "arg.사유", cases: [{ id: "k1", values: ["V01", "V02", "V03", "V04"], empty: true, children: [] }] }],
      };
      const input = alphaPlusFixture();
      const ctx = buildContexts(input).general;
      const doc: DocumentNode = { kind: "document", id: "g", title: "보통약관", children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "clauseBlockRef", id: "r", clauseCode: "C0302", options: {}, bindings: { 사유: { kind: "const", value: "V01" } } }] }] };
      const resolved = resolveDocument(doc, ctx, { clauses: new Map([["C0302", 항분기]]), overrides: new Map(), coordinate: at });
      expect(resolved.issues).toEqual([]);
      expect(dropEmptyArticles(resolved.doc as unknown as SubstitutedDoc, authoredEmptyArticleIds(doc)).dropped).toEqual(["a"]);
    });
  });

  it("생략된 특약 조 참조는 연결된 보통약관 조로 해소한다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "paragraph", id: "p", children: [{ kind: "articleRef", id: "ref", targets: [{ articleId: "omitted" }], connector: "및", scope: "self", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", general: numberDocument(general()), aliases: new Map([["omitted", "g-a"]]), appendices: [] });
    const article = result.doc.children[0];
    if (article.kind !== "article" || article.children[0].kind !== "paragraph") throw new Error("unexpected error");
    expect(article.children[0].children[0]).toMatchObject({ label: "보통약관 제1조(해약환급금)" });
  });
});

describe("별표는 책자 등장 순으로 자동 수집한다 (ADR-0063)", () => {
  const master = [
    { code: "APX_A", name: "A", description: "" },
    { code: "APX_B", name: "B", description: "" },
  ];
  /** 별표 참조만 담은 한 조짜리 문서 — 마지막 코드는 표 셀 안에 둔다 (표 속 참조도 수집 대상). */
  const refs = (id: string, codes: readonly Code[]) =>
    numberDocument({
      kind: "document",
      id,
      title: "문서",
      children: [
        {
          kind: "article",
          id: `${id}-a`,
          title: "조",
          children: [
            { kind: "paragraph", id: `${id}-p`, children: codes.slice(0, -1).map((code, n) => ({ kind: "appendixRef" as const, id: `${id}-x${n}`, appendixCode: code, at })) },
            ...codes.slice(-1).map((code) => ({
              kind: "table" as const,
              id: `${id}-tbl`,
              columns: [{ width: 100 }],
              rows: [{ cells: [[{ kind: "appendixRef" as const, id: `${id}-cell`, appendixCode: code, at }]] }],
            })),
          ],
        },
      ],
    });

  it("책자 순으로 처음 등장한 순서대로 1..n — 두 번째 참조는 번호를 새로 먹지 않는다", () => {
    const docs = [refs("g", ["APX_B"]), refs("s", ["APX_B", "APX_A"])];
    expect(collectAppendices(docs, master).map((a) => [a.code, a.number, a.name])).toEqual([
      ["APX_B", 1, "B"],
      ["APX_A", 2, "A"],
    ]);
  });

  it("참조되지 않은 별표는 책자에 나오지 않는다", () => {
    expect(collectAppendices([refs("g", [])], master)).toEqual([]);
  });

  it("마스터에 없는 코드는 번호는 차지하되 이름이 「(없는 별표)」다", () => {
    expect(collectAppendices([refs("g", ["APX_X"])], [])).toEqual([{ code: "APX_X", name: "(없는 별표)", number: 1 }]);
  });

  it("마스터에 없는 별표를 참조하면 brokenRef 오류 마커", () => {
    const input = alphaPlusFixture();
    const booklet = assembleInput({ ...input, appendices: [] });
    expect(booklet.issues.map((i) => i.kind)).toContain("brokenRef");
    expect(booklet.issues[0].message).toMatch(/별표 마스터에 없습니다/);
    expect(booklet.appendices).toEqual([{ code: "APX_DISABILITY", name: "(없는 별표)", number: 1 }]);
  });
});
