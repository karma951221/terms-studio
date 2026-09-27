import { describe, expect, it } from "vitest";

import type { ErrorNode, OmissionRecord, RenderedArticle, RenderedDoc, RenderedSection } from "@/domain/assembly";
import type { ArticleNode, CondBlockNode, DocumentNode, NodeNumber, SectionNode } from "@/domain/document";
import type { AttributeKind } from "@/domain/product";
import type { Issue } from "@/domain/types";
import type { MasterForm } from "@/domain/master";
import { buildForm, formReducer, initFormState } from "@/forms";

import {
  attributeComboLabel,
  filterMountRows,
  mountRows,
  articleCount,
  basicDraftDirty,
  type BasicDraft,
  currentGeneralArticle,
  excludedClauseLabel,
  generalArticlePath,
  generalIssueLink,
  generalReturnPath,
  generalSectionLabel,
  generalSections,
  generalTabIssues,
  omissionCounts,
  omissionPairLabel,
  parseOptionSelection,
  parseSelections,
  productDetailPath,
  productTabOf,
  renderedNodeIds,
  sectionOfArticle,
  sectionPreviewDoc,
  specialPreviewPath,
  str,
} from "./lib";

const kinds: AttributeKind[] = [
  { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "V01", label: "갱신형", order: 0, fragment: "" }] },
  { code: "A0002", label: "부가유형", order: 1, values: [{ code: "V01", label: "기본", order: 0, fragment: "" }] },
];

describe("products lib — 순수 파싱", () => {
  it("str — trim", () => {
    const fd = new FormData();
    fd.set("a", " x ");
    expect(str(fd, "a")).toBe("x");
  });

  it("parseSelections — attr:<kindCode> 이름의 값만 골라 담는다, 비어있으면 제외", () => {
    const fd = new FormData();
    fd.set("attr:A0001", "V01");
    fd.set("attr:A0002", "");
    expect(parseSelections(fd, kinds)).toEqual([{ kindCode: "A0001", valueCode: "V01" }]);
  });

  it("parseOptionSelection — 객체 JSON 은 그대로, 아니면 빈 객체", () => {
    expect(parseOptionSelection("")).toEqual({});
    expect(parseOptionSelection('{"O01":"V01"}')).toEqual({ O01: "V01" });
    expect(parseOptionSelection("not json")).toEqual({});
  });
});

describe("products lib — 상세 탭 좌표", () => {
  it("productTabOf — 아는 탭만 믿고 나머지는 기본정보", () => {
    expect(productTabOf("general")).toBe("general");
    expect(productTabOf("special")).toBe("special");
    expect(productTabOf("basic")).toBe("basic");
    expect(productTabOf(undefined)).toBe("basic");
    expect(productTabOf("없는탭")).toBe("basic");
  });

  it("productDetailPath — 탭이 있으면 ?tab= 을 싣는다", () => {
    expect(productDetailPath("p1")).toBe("/products/p1");
    expect(productDetailPath("p1", "general")).toBe("/products/p1?tab=general");
  });
});

// ───────────────────────────── 보통약관의 관 ─────────────────────────────

const art = (id: string, title = id): ArticleNode => ({ id, kind: "article", title, children: [] });
const sec = (id: string, title: string, children: SectionNode["children"]): SectionNode => ({ id, kind: "section", title, children });
const doc = (children: DocumentNode["children"]): DocumentNode => ({ id: "D", kind: "document", title: "보통약관", children });

describe("products lib — 보통약관의 관", () => {
  it("generalSections — 최상위 관이 한 묶음, 목차용 articles 는 조건 블록 안의 조까지 편다", () => {
    const cond: CondBlockNode = { id: "C1", kind: "condBlock", branches: [{ id: "B1", when: "x", children: [art("A2")] }] };
    const tree = doc([sec("S1", "목적 및 용어", [art("A1"), cond]), sec("S2", "보험금의 지급", [art("A3")])]);
    expect(generalSections(tree)).toEqual([
      { id: "S1", title: "목적 및 용어", articles: [art("A1"), art("A2")], nodes: [art("A1"), cond] },
      { id: "S2", title: "보험금의 지급", articles: [art("A3")], nodes: [art("A3")] },
    ]);
  });

  it("generalSections — 원문용 nodes 는 조를 감싼 조건 블록을 벗기지 않는다 (코덱스 리뷰 Important-3)", () => {
    const cond: CondBlockNode = { id: "C1", kind: "condBlock", branches: [{ id: "B1", when: "갱신형", children: [art("A1")] }] };
    const [loose] = generalSections(doc([cond]));
    expect(loose.articles).toEqual([art("A1")]);
    expect(loose.nodes).toEqual([cond]);
  });

  it("generalSections — 관이 없으면 문서 전체가 한 관이다 (id 없음)", () => {
    expect(generalSections(doc([art("A1"), art("A2")]))).toEqual([{ articles: [art("A1"), art("A2")], nodes: [art("A1"), art("A2")] }]);
    expect(generalSections(doc([]))).toEqual([]);
  });

  it("sectionOfArticle · currentGeneralArticle — 좌표가 없거나 없는 조면 첫 조의 관", () => {
    const sections = generalSections(doc([sec("S1", "가", [art("A1")]), sec("S2", "나", [art("A2")])]));
    expect(sectionOfArticle(sections, "A2")?.id).toBe("S2");
    expect(sectionOfArticle(sections, "없는조")?.id).toBe("S1");
    expect(sectionOfArticle(sections, undefined)?.id).toBe("S1");
    expect(currentGeneralArticle(sections, "A2")).toBe("A2");
    expect(currentGeneralArticle(sections, "없는조")).toBe("A1");
    expect(currentGeneralArticle([], undefined)).toBeUndefined();
  });

  it("sectionOfArticle — 조가 하나도 없는 관은 건너뛴다", () => {
    const sections = generalSections(doc([sec("S0", "빈 관", []), sec("S1", "가", [art("A1")])]));
    expect(sectionOfArticle(sections, undefined)?.id).toBe("S1");
  });

  it("generalSectionLabel — 관 없는 문서만 「전체」 · 섞인 문서의 관 밖 묶음은 「관 밖 조」 (코덱스 리뷰 후속)", () => {
    const numbers = new Map<string, NodeNumber>([
      ["SB", { kind: "section", n: 2, label: "제2관" }],
      ["A", { kind: "article", n: 1, label: "제1조" }],
      ["B", { kind: "article", n: 2, label: "제2조" }],
      ["C", { kind: "article", n: 3, label: "제3조" }],
    ]);
    // 관 없는 문서 — 조 전부가 한 묶음이니 「전체」가 맞다
    const flat = generalSections(doc([art("A"), art("C")]));
    expect(generalSectionLabel(flat, flat[0], numbers)).toBe("전체");
    // 관 밖 A → 관 B → 관 밖 C
    const mixedSections = generalSections(doc([art("A"), sec("SB", "관 B", [art("B")]), art("C")]));
    expect(generalSectionLabel(mixedSections, mixedSections[0], numbers)).toBe("관 밖 조 제1조");
    expect(generalSectionLabel(mixedSections, mixedSections[1], numbers)).toBe("제2관 관 B");
    // 번호를 모르면 범위 없이 — 관 제목만 있을 때의 「관」 과 같은 자리
    expect(generalSectionLabel(mixedSections, mixedSections[2], new Map())).toBe("관 밖 조");
    expect(generalSectionLabel(mixedSections, mixedSections[1], new Map())).toBe("관 관 B");
  });

  it("generalSectionLabel — 관 밖 묶음이 여러 조면 범위로 말한다", () => {
    const numbers = new Map<string, NodeNumber>([
      ["A", { kind: "article", n: 1, label: "제1조" }],
      ["C", { kind: "article", n: 2, label: "제2조" }],
      ["SB", { kind: "section", n: 1, label: "제1관" }],
    ]);
    const sections = generalSections(doc([art("A"), art("C"), sec("SB", "관 B", [art("B")])]));
    expect(generalSectionLabel(sections, sections[0], numbers)).toBe("관 밖 조 제1조 ~ 제2조");
    expect(generalSectionLabel(sections, undefined, numbers)).toBe("관 밖 조");
  });

  it("generalArticlePath — 탭을 잃지 않는다", () => {
    expect(generalArticlePath("p1", "A1")).toBe("/products/p1?tab=general&art=A1");
  });

  it("generalReturnPath — 옵션을 저장해도 고르던 조로 돌아온다 (조가 없으면 탭만)", () => {
    expect(generalReturnPath("p1", "A1")).toBe("/products/p1?tab=general&art=A1");
    expect(generalReturnPath("p1", undefined)).toBe("/products/p1?tab=general");
  });
});

describe("products lib — 오른쪽 미리보기의 관 자르기 (sectionPreviewDoc)", () => {
  const pArt = (id: string): RenderedArticle => ({ kind: "article", id, number: 1, label: "제1조", title: id, children: [] });
  const pSec = (id: string, children: RenderedSection["children"]): RenderedSection => ({ kind: "section", id, number: 1, label: "제1관", title: id, children });
  const gDoc = (children: RenderedDoc["children"]): RenderedDoc => ({ kind: "document", id: "D", document: "general", ownerId: "g-doc", title: "보통약관", children });

  // 관 밖 A → 관 B → 관 밖 C (코덱스 리뷰 Minor-4 의 재현 문서)
  const mixed = doc([art("A"), sec("SB", "관 B", [art("B")]), art("C")]);
  const rendered = gDoc([pArt("A"), pSec("SB", [pArt("B")]), pArt("C")]);

  it("관 밖 묶음을 고르면 그 묶음의 조만 남는다 — 예전엔 관 밖 A·C 와 관 B 가 다 보였다", () => {
    const sections = generalSections(mixed);
    expect(sectionPreviewDoc(rendered, sections[0])?.children.map((c) => c.id)).toEqual(["A"]);
    expect(sectionPreviewDoc(rendered, sections[2])?.children.map((c) => c.id)).toEqual(["C"]);
  });

  it("관을 고르면 그 관만 — 관 밖 조는 따라오지 않는다", () => {
    const sections = generalSections(mixed);
    expect(sectionPreviewDoc(rendered, sections[1])?.children.map((c) => c.id)).toEqual(["SB"]);
  });

  it("관이 없는 문서는 전체가 한 묶음이라 그대로 · 오류 마커는 남긴다 · 묶음이나 결과가 없으면 손대지 않는다", () => {
    const err: ErrorNode = { kind: "error", id: "E1", issue: { kind: "structure", message: "x", at: {} } };
    const flat = gDoc([pArt("A"), err, pArt("C")]);
    const [only] = generalSections(doc([art("A"), art("C")]));
    expect(sectionPreviewDoc(flat, only)?.children.map((c) => c.id)).toEqual(["A", "E1", "C"]);
    expect(sectionPreviewDoc(flat, undefined)).toBe(flat);
    expect(sectionPreviewDoc(undefined, only)).toBeUndefined();
  });
});

describe("products lib — 결과의 앵커 자리 (renderedNodeIds)", () => {
  it("조·항·호·목·표 셀의 인라인·오류 마커까지 — 화면에 없는 노드로는 링크를 걸지 않기 위해", () => {
    const doc: RenderedDoc = {
      kind: "document",
      id: "D",
      document: "general",
      ownerId: "g",
      title: "보통약관",
      children: [
        {
          kind: "article",
          id: "A1",
          number: 1,
          label: "제1조",
          title: "목적",
          children: [
            {
              kind: "paragraph",
              id: "P1",
              number: 1,
              label: "①",
              children: [{ kind: "articleRef", id: "REF1", targets: [], connector: "및", label: "제2조" }],
              items: [
                { kind: "item", id: "I1", number: 1, label: "1.", children: [], subitems: [{ kind: "subitem", id: "S1", number: 1, label: "가.", children: [] }] },
                { kind: "table", id: "T1", columns: [{}], rows: [{ cells: [[{ kind: "appendixRef", id: "REF2", appendixCode: "X0001", number: 1, label: "【별표1】" }]] }] },
              ],
            },
          ],
        },
      ],
    };
    expect([...renderedNodeIds(doc)].sort()).toEqual(["A1", "I1", "P1", "REF1", "REF2", "S1", "T1"]);
    expect(renderedNodeIds(undefined).size).toBe(0);
  });
});

describe("products lib — 보통약관 탭의 오류 (generalTabIssues)", () => {
  const issue = (kind: Issue["kind"], at: Issue["at"], severity?: "warning"): Issue => ({ kind, message: kind, at, ...(severity ? { severity } : {}) });
  const generalAt = (articleId?: string) => ({ document: "general" as const, ownerId: "g-doc", ...(articleId ? { articleId } : {}) });
  const specialAt = (ownerId: string, articleId: string) => ({ document: "special" as const, ownerId, articleId });

  it("준용·기본계약이 낸 articleHidden 오류(결과 좌표가 특약)도 센다 — 조를 끈 탭이 그 오류를 봐야 한다", () => {
    const issues = [issue("articleHidden", generalAt("A1")), issue("articleHidden", specialAt("pc-basic", "s-art-exempt")), issue("articleHidden", specialAt("pc-base", "b-art-pay"))];
    const r = generalTabIssues(issues, new Set(["A1"]));
    expect(r.errorCount).toBe(3);
    expect(r.section).toEqual(issues);
  });

  it("특약 좌표의 다른 종류 오류는 보통약관 탭에 오지 않는다 · 보통약관 경고는 세지 않는다", () => {
    const issues = [issue("notEntered", specialAt("pc-basic", "s-art-1")), issue("unusedAttribute", generalAt("A1"), "warning"), issue("brokenRef", generalAt("A1"))];
    const r = generalTabIssues(issues, new Set(["A1"]));
    expect(r.errorCount).toBe(1);
    expect(r.section.map((i) => i.kind)).toEqual(["unusedAttribute", "brokenRef"]);
  });

  it("관 필터는 보통약관 오류에만 건다 — 다른 관의 조 오류는 빠지고, 조가 없는 오류와 articleHidden 은 남는다", () => {
    const issues = [issue("brokenRef", generalAt("A2")), issue("noBaseContract", generalAt()), issue("articleHidden", specialAt("pc-basic", "s-art-exempt"))];
    const r = generalTabIssues(issues, new Set(["A1"]));
    expect(r.section.map((i) => i.kind)).toEqual(["noBaseContract", "articleHidden"]);
    expect(r.errorCount).toBe(3);
  });
});

describe("products lib — 오류의 이동 링크 (generalIssueLink)", () => {
  const nodes = new Set(["N1"]);
  const base = new Set(["pc-base"]);
  const issue = (at: Issue["at"]): Issue => ({ kind: "articleHidden", message: "숨김", at });

  it("특약 절의 상품담보는 특별약관 탭의 미리보기로 — 도착 못 하는 #node 앵커를 걸지 않는다", () => {
    const link = generalIssueLink("p1", nodes, base, issue({ document: "special", ownerId: "pc1", ownerName: "일반상해사망", nodePath: ["x"] }));
    expect(link).toEqual({ href: "/products/p1?tab=special&pc=pc1", label: "일반상해사망 에서 보기" });
    expect(generalIssueLink("p1", nodes, base, issue({ document: "special", nodePath: ["x"] }))).toBeUndefined();
  });

  it("기본계약 상품담보는 제 화면으로 — 특별약관 탭의 ?pc= 는 특약 절만 믿는다", () => {
    const link = generalIssueLink("p1", nodes, base, issue({ document: "special", ownerId: "pc-base", ownerName: "후유장해", nodePath: ["x"] }));
    expect(link).toEqual({ href: "/products/p1/coverages/pc-base", label: "후유장해 에서 보기" });
  });

  it("보통약관 오류는 지금 그린 결과에 그 노드가 있을 때만 앵커", () => {
    expect(generalIssueLink("p1", nodes, base, issue({ document: "general", nodePath: ["a", "N1"] }))).toEqual({ href: "#node-N1", label: "미리보기에서 보기" });
    expect(generalIssueLink("p1", nodes, base, issue({ document: "general", nodePath: ["N9"] }))).toBeUndefined();
    expect(generalIssueLink("p1", nodes, base, issue({ document: "general" }))).toBeUndefined();
  });
});

// ───────────────────────────── 특별약관 탭의 미리보기 ─────────────────────────────

const rArt = (id: string): RenderedArticle => ({ kind: "article", id, number: 1, label: "제1조", title: id, children: [] });
const rSec = (id: string, children: RenderedSection["children"]): RenderedSection => ({ kind: "section", id, number: 1, label: "제1관", title: id, children });
const rDoc = (children: RenderedDoc["children"]): RenderedDoc => ({ kind: "document", id: "D", document: "special", ownerId: "PC1", title: "특약", children });

describe("products lib — 특별약관 탭의 미리보기", () => {
  it("specialPreviewPath — 탭을 잃지 않는다", () => {
    expect(specialPreviewPath("p1", "pc1")).toBe("/products/p1?tab=special&pc=pc1");
  });

  it("articleCount — 관 안의 조까지 세고 오류 마커는 빼고 센다", () => {
    const err: ErrorNode = { kind: "error", id: "E1", issue: { kind: "structure", message: "x", at: {} } };
    expect(articleCount(undefined)).toBe(0);
    expect(articleCount(rDoc([]))).toBe(0);
    expect(articleCount(rDoc([rArt("A1"), rSec("S1", [rArt("A2"), err]), err]))).toBe(2);
  });
});

describe("products lib — 조립 미리보기의 조연결 판정 절 (기능/조립산출 §4.1)", () => {
  const record = (disposition: OmissionRecord["disposition"]): OmissionRecord => ({
    productCoverageId: "pc-1",
    productCoverageName: "수술비",
    articleId: "s-a",
    articleTitle: "조",
    linkedArticleId: "g-a",
    disposition,
    pairs: [],
    excludedClauseNodeIds: [],
  });

  it("omissionCounts — 생략 수는 omitted 만, 준용·통째는 따로 센다", () => {
    expect(omissionCounts([record("omitted"), record("full"), record("applied"), record("full")])).toEqual({ omitted: 1, applied: 1, full: 2 });
    expect(omissionCounts([])).toEqual({ omitted: 0, applied: 0, full: 0 });
  });

  it("omissionPairLabel — 항이면 「제N항」, 표·박스·오류 노드는 종류로 (항 번호를 먹지 않는다)", () => {
    expect(omissionPairLabel(2)).toBe("제2항");
    expect(omissionPairLabel(1, "table")).toBe("표 1");
    expect(omissionPairLabel(2, "box")).toBe("박스 2");
    expect(omissionPairLabel(1, "error")).toBe("오류 노드 1");
  });

  it("excludedClauseLabel — 보통약관 트리의 block 공용조항 참조 노드면 「공용조항 코드(라벨)」, 못 찾으면 노드 id", () => {
    const tree: DocumentNode = {
      id: "g",
      kind: "document",
      title: "보통약관",
      children: [{ id: "g-a", kind: "article", title: "조", children: [{ id: "g-clause", kind: "clauseBlockRef", clauseCode: "C0003", options: {}, excludeFromComparison: true }] }],
    };
    const labelOf = (code: string) => (code === "C0003" ? "면책 추가" : undefined);
    expect(excludedClauseLabel(tree, "g-clause", labelOf)).toBe("공용조항 C0003(면책 추가)");
    expect(excludedClauseLabel(tree, "g-clause", () => undefined)).toBe("공용조항 C0003");
    expect(excludedClauseLabel(tree, "g-a", labelOf)).toBe("g-a");
    expect(excludedClauseLabel(undefined, "g-clause", labelOf)).toBe("g-clause");
  });
});

describe("products lib — 기본정보 초안의 변경 여부 (basicDraftDirty · 점검 M21)", () => {
  const master: MasterForm[] = [{ key: "pay", label: "보험금지급", level: "benefit", fields: [{ key: "rate", label: "지급률", type: { kind: "number" } }] }];
  const model = buildForm("benefit", () => undefined, new Map(), undefined, master);
  const path = model.fields[0].path;
  const baseline = (): BasicDraft => ({
    name: "무배당 암보험",
    options: [{ id: "o1", isNew: false, axis: "type", number: 1, name: "일반형", planTypeCode: "P1" }],
    product: initFormState(model),
    forms: { o1: initFormState(model) },
    combinations: [["o1", "o2"], ["o3"]],
  });

  it("편집을 막 시작한 초안(= 서버 값)은 바뀐 것이 없다", () => {
    expect(basicDraftDirty(baseline(), baseline())).toBe(false);
  });

  it("상품명 · 보험종목 · 값 칸 · 조합 중 하나라도 바뀌면 바뀐 것이다", () => {
    expect(basicDraftDirty(baseline(), { ...baseline(), name: "무배당 암보험Ⅱ" })).toBe(true);
    expect(basicDraftDirty(baseline(), { ...baseline(), options: [] })).toBe(true);
    const typed = formReducer(initFormState(model), { type: "edit", path, draft: "80" });
    expect(basicDraftDirty(baseline(), { ...baseline(), forms: { o1: typed } })).toBe(true);
    expect(basicDraftDirty(baseline(), { ...baseline(), product: typed })).toBe(true);
    expect(basicDraftDirty(baseline(), { ...baseline(), combinations: [["o1", "o2"]] })).toBe(true);
  });

  it("입력했다 되돌리거나 조합을 껐다 켜 순서만 바뀌면 바뀐 것이 아니다", () => {
    const typed = formReducer(initFormState(model), { type: "edit", path, draft: "80" });
    const reverted = formReducer(typed, { type: "edit", path, draft: "" });
    expect(basicDraftDirty(baseline(), { ...baseline(), forms: { o1: reverted } })).toBe(false);
    expect(basicDraftDirty(baseline(), { ...baseline(), combinations: [["o3"], ["o2", "o1"]] })).toBe(false);
  });
});

describe("탑재 표 — 담보속성 조합 · 담보 검색 (기능/상품 §4.6)", () => {
  const kinds = [
    { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "V02", label: "갱신형", order: 1, fragment: "갱신형" }] },
    { code: "A0002", label: "부가유형", order: 1, values: [{ code: "V02", label: "추가", order: 1, fragment: "추가" }] },
  ] as AttributeKind[];

  it("attributeComboLabel — 종류 order 순 `종류=값` · 없으면 —", () => {
    expect(attributeComboLabel([{ kindCode: "A0002", valueCode: "V02" }, { kindCode: "A0001", valueCode: "V02" }], kinds)).toBe("갱신유형=갱신형 · 부가유형=추가");
    expect(attributeComboLabel([], kinds)).toBe("—");
    // 없어진 종류 · 값은 코드 그대로 (지어내지 않는다)
    expect(attributeComboLabel([{ kindCode: "A0009", valueCode: "V09" }], kinds)).toBe("A0009=V09");
  });

  it("mountRows · filterMountRows — 코드 · 상품담보명 · 담보명 · 속성, 「—」는 검색 대상이 아니다", () => {
    const rows = mountRows(
      [
        { id: "pc1", productId: "p", coverageId: "c1", name: "사망 추가", attributes: [{ kindCode: "A0002", valueCode: "V02" }] },
        { id: "pc2", productId: "p", coverageId: "gone", name: "고아", attributes: [] },
      ],
      [{ id: "c1", code: "COV000001", name: "일반상해사망보장" }],
      kinds,
    );
    expect(rows.map((r) => [r.coverageCode, r.attributes])).toEqual([["COV000001", "부가유형=추가"], [undefined, "—"]]);
    expect(filterMountRows(rows, "").map((r) => r.pc.id)).toEqual(["pc1", "pc2"]);
    expect(filterMountRows(rows, "COV000001").map((r) => r.pc.id)).toEqual(["pc1"]);
    expect(filterMountRows(rows, "일반상해").map((r) => r.pc.id)).toEqual(["pc1"]);
    expect(filterMountRows(rows, "부가유형").map((r) => r.pc.id)).toEqual(["pc1"]);
    expect(filterMountRows(rows, "—")).toEqual([]);
  });
});
