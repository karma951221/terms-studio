import { describe, expect, it } from "vitest";

import type { DocumentNode } from "../document/nodes";
import type { Code } from "../types";
import { assemble } from "./booklet";
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
          { kind: "paragraph", id: "g-p1", children: [text("g-t1", "첫째")] },
          { kind: "paragraph", id: "g-p2", children: [text("g-t2", "둘째")] },
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
      children: [{ kind: "article", id: "s-a", title: "준용", children: [{ kind: "paragraph", id: "s-p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "g-p1" }, { nodeId: "g-p2" }], connector: "및", scope: "general", at }] }] }],
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
            { kind: "paragraph", id: "p1", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "i2" }, { nodeId: "p2" }, { nodeId: "p3" }], connector: "또는", scope: "self", at }], items: [{ kind: "item", id: "i1", children: [] }, { kind: "item", id: "i2", children: [] }] },
            { kind: "paragraph", id: "p2", children: [] },
          ],
        },
        { kind: "article", id: "a2", title: "둘째 조", children: [{ kind: "paragraph", id: "p3", children: [] }] },
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
      children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "paragraph", id: "p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "gone-1" }, { nodeId: "gone-2" }], connector: "및", scope: "self", at }] }] }],
    };
    const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
    expect(result.issues.map((issue) => [issue.kind, issue.at.refPath])).toEqual([["articleGone", "gone-1"], ["articleGone", "gone-2"]]);
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
          children: [{ kind: "paragraph" as const, id: `${id}-p`, children: i === 0 ? [{ kind: "articleRef" as const, id: "ref", targets: targets.map((nodeId) => ({ nodeId })), connector, scope: "self" as const, at }] : [] }],
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
              { kind: "paragraph", id: "p1", children: [] },
              { kind: "paragraph", id: "p3", children: [] },
              { kind: "paragraph", id: "p4", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "p1" }, { nodeId: "p2" }, { nodeId: "p3" }], connector: "및", scope: "self", at }] },
            ],
          },
        ],
      };
      const result = renderDocument(numberDocument(doc), { document: "special", ownerId: "pc", appendices: [] });
      const article = result.doc.children[0];
      if (article.kind !== "article" || article.children[2].kind !== "paragraph") throw new Error("unexpected error");
      expect(article.children[2].children[0]).toMatchObject({ label: "제1항 및 제2항", dropped: ["p2"] });
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
          { kind: "article", id: "a1", title: "준용", children: [{ kind: "paragraph", id: "a1-p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "a2" }, { nodeId: "a3" }, { nodeId: "a4" }, { nodeId: "a5" }], connector: "및", scope: "self" }] }] },
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

  it("생략된 특약 조 참조는 연결된 보통약관 조로 해소한다", () => {
    const doc: SubstitutedDoc = {
      kind: "document",
      id: "s",
      title: "특약",
      children: [{ kind: "article", id: "a", title: "조", children: [{ kind: "paragraph", id: "p", children: [{ kind: "articleRef", id: "ref", targets: [{ nodeId: "omitted" }], connector: "및", scope: "self", at }] }] }],
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
