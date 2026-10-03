import { describe, expect, it } from "vitest";

import type { Clause } from "../clause/types";
import { surgeryFixture } from "../document/fixture";
import type { ArticleNode, DocumentNode, ParagraphNode } from "../document/nodes";
import type { MissingSlot } from "../coverage/values";
import type { EnumDef } from "../catalog/types";
import type { Code, Id, Issue } from "../types";
import { formatCoordinate } from "../coordinate";
import { assemble, assembleSpecial, executionBasedFilter } from "./booklet";
import { alphaPlusFixture, alphaGeneralDocument, baseDeathCoverage, coverageEntry, deathCoverage, waiverFixture, waiverTemplate } from "./fixture";
import type { AssemblyCoverage, AssemblyInput, RenderedDoc, RenderedInline } from "./types";

/** 픽스처를 한 객체로 다루는 테스트 진입 — 조립 서명 `assemble(master, product)` 에 같은 객체를 두 번 넘긴다 (AssemblyInput = MasterBundle & ProductInput). */
const assembleInput = (input: AssemblyInput) => assemble(input, input);
const assembleSpecialInput = (input: AssemblyInput, pcId: Id) => assembleSpecial(input, input, pcId);

// ───────────────────────────── 헬퍼 ─────────────────────────────

function lines(doc: RenderedDoc): string[] {
  const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const out: string[] = [];
  for (const a of doc.children) {
    if (a.kind === "error") {
      out.push(`⟦${a.issue.kind}⟧`);
      continue;
    }
    out.push(`${a.label}(${a.title})`);
    for (const p of a.children) out.push(p.kind === "error" ? `  ⟦${p.issue.kind}⟧` : p.kind !== "paragraph" ? `  [${p.kind}]` : `  ${p.label} ${inline(p.children)}`);
  }
  return out;
}

function docsOf(input: AssemblyInput) {
  const b = assembleInput(input);
  const docs = new Map<Id, RenderedDoc>();
  for (const g of b.specials) for (const d of g.docs) docs.set(d.ownerId, d);
  return { booklet: b, docs, doc: (pcId: Id) => docs.get(pcId)! };
}

const kinds = (issues: Issue[]) => issues.map((i) => i.kind);

/** 렌더된 문서에서 처음 나오는 별표 참조의 표기. */
function firstAppendixLabel(doc: RenderedDoc): string | undefined {
  for (const a of doc.children) {
    if (a.kind !== "article") continue;
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      for (const c of p.children) if (c.kind === "appendixRef") return c.label;
    }
  }
  return undefined;
}

/** 수술비 탑재분 — surgeryFixture 의 문서를 쓴다. 급부 값: 면책 false · 지급률 50. */
function surgeryCoverage(id: Id, name: string, opts: { renew: boolean; exempt?: boolean; attributes?: { kindCode: Code; valueCode: Code }[] }): AssemblyCoverage {
  return coverageEntry({
    id,
    name,
    coverageId: "cov-surgery",
    coverageName: "수술비",
    attributes: opts.attributes ?? [],
    subCoverages: [{ id: `${id}-sub`, masterNodeId: "sub-surgery", name: "1종수술", benefits: [{ id: `${id}-ben`, masterNodeId: "ben-surgery", name: "수술보험금" }] }],
    values: {
      [id]: { "coverage_basic.renewal": opts.renew },
      [`${id}-ben`]: { "pay.exempt": opts.exempt ?? false, "pay.rate": 50 },
    },
  });
}

/** surgeryFixture 의 함수조항 — C001 block(옵션 tone: death · general) · C002 inline(갱신형 문구 인라인 조건). */
const surgeryClauses: Clause[] = [
  {
    code: "C001",
    label: "특별약관의 소멸",
    mode: "block",
    body: [{ id: "c1-p", kind: "paragraph", children: [{ id: "c1-t1", kind: "text", text: "이 특별약관은 " }, { id: "c1-o", kind: "optionSlot", optionCode: "tone" }, { id: "c1-t2", kind: "text", text: " 소멸합니다." }] }],
    options: [
      {
        code: "tone",
        label: "소멸 사유",
        order: 0,
        values: [
          { code: "death", label: "사망", order: 0, body: [{ id: "c1-death", kind: "text", text: "피보험자가 사망한 때" }] },
          { code: "general", label: "일반", order: 1, body: [{ id: "c1-gen", kind: "text", text: "보험기간이 끝난 때" }] },
        ],
      },
    ],
    required: { discriminators: [], attributes: [] },
  },
  {
    code: "C002",
    label: "준용 문구",
    mode: "inline",
    body: [
      { id: "c2-t1", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관을 따릅니다." },
      { id: "c2-cond", kind: "inlineCond", branches: [{ id: "c2-if", when: "D0001 = true", children: [{ id: "c2-t2", kind: "text", text: " 갱신형 계약은 갱신 특칙을 우선합니다." }] }] },
    ],
    options: [],
    required: { discriminators: ["D0001"], attributes: [] },
  },
];

/** 알파Plus 재료 + 수술비 문서(surgeryFixture) 를 합친 입력. */
function withSurgery(coverages: AssemblyCoverage[], patch: Partial<AssemblyInput> = {}, special: DocumentNode = surgeryFixture().special): AssemblyInput {
  const base = alphaPlusFixture();
  return {
    ...base,
    generalDocuments: new Map([["g-doc-surgery", surgeryFixture().general]]),
    product: { ...base.product, generalDocumentId: "g-doc-surgery" },
    coverages: [baseDeathCoverage(), ...coverages],
    specialDocuments: new Map([["cov-surgery", special]]),
    clauses: surgeryClauses,
    ...patch,
  };
}

function tinyDoc(id: Id, title: string, text: string, appendixCode?: Code): DocumentNode {
  const par: ParagraphNode = { id: `${id}-p`, kind: "paragraph", children: [{ id: `${id}-t`, kind: "text", text }, ...(appendixCode ? [{ id: `${id}-x`, kind: "appendixRef" as const, appendixCode }] : [])] };
  return { id, kind: "document", title, children: [{ id: `${id}-a`, kind: "article", title: "보장", children: [par] }] };
}

// ───────────────────────────── 조립오류 시나리오 ─────────────────────────────

describe("조립오류 S2 — 미입력 값 참조 → 오류 마커 + 좌표 + 「완성본 아님」", () => {
  const input = alphaPlusFixture();
  const basic = input.coverages.find((coverage) => coverage.snapshot.id === "pc-basic")!;
  (basic.values.get("pc-basic") as Map<string, unknown>).delete("coverage_basic.reduction_text"); // 문면용 감액기간 미입력 (자리는 있다 — 부착됨)
  const { booklet, doc } = docsOf(input);

  it("조립은 중단되지 않는다 — 슬롯 자리에 notEntered 마커, 나머지는 끝까지 조립", () => {
    expect(lines(doc("pc-basic"))[5]).toBe("  ③ 계약일부터 ⟦notEntered⟧ 이내에는 감액 지급하며, 보통약관 제6조(해약환급금) 제1항 및 제2항을 확인합니다.");
    expect(lines(doc("pc-basic"))).toHaveLength(10);
  });

  it("패널 항목 — 좌표(상품담보 → 조 → 노드 경로 · 참조 경로)와 원인 · complete=false", () => {
    expect(booklet.issues).toHaveLength(1);
    expect(booklet.issues[0]).toMatchObject({
      kind: "notEntered",
      message: "D0007 가 미입력입니다",
      at: {
        document: "special",
        ownerId: "pc-basic",
        ownerName: "일반상해사망",
        articleId: "s-art-reduce",
        articleTitle: "보험금의 감액지급",
        nodePath: ["s-doc-death", "s-art-reduce", "s-par-reduce-extra", "s-slot-reduce"],
        refPath: "D0007",
      },
    });
    expect(formatCoordinate(booklet.issues[0].at)).toBe("특약 › 일반상해사망 › 제2조(보험금의 감액지급) › ③ › 슬롯:D0007");
    expect(formatCoordinate(booklet.issues[0].source!, { source: true })).toBe("상품모델링 › 알파Plus(축약) › 일반상해사망 › D0007");
    expect(booklet.complete).toBe(false);
  });

  it("값 차이는 탑재분별 — 「추가」 쪽은 그대로 완성", () => {
    expect(lines(doc("pc-addon"))[4]).toContain("24개월");
  });

  it("값 입력 후 재조립하면 오류 소멸 (S1 상태로 복귀)", () => {
    expect(assembleInput(alphaPlusFixture()).complete).toBe(true);
  });

  it("구분자 식이 깨져 슬롯이 못 풀리면 원천은 구분자 편집기, 그 구분자 — 값 입력칸이 아니다 (ADR-0049 §4)", () => {
    const input = alphaPlusFixture();
    const death = input.specialDocuments.get("cov-death")!;
    const swapped = JSON.parse(JSON.stringify(death).replace('"ref":"D0007"', '"ref":"D0090"')) as typeof death;
    const b = assembleInput({
      ...input,
      catalog: [...input.catalog, { code: "D0090", label: "깨진식", description: "", level: "coverage", expression: "coverage_basic.reduction_text =" }],
      specialDocuments: new Map([...input.specialDocuments, ["cov-death", swapped]]),
    });
    const broken = b.issues.filter((i) => i.kind === "brokenRef" && i.at.refPath === "D0090");
    expect(broken.length).toBeGreaterThan(0);
    for (const issue of broken) {
      expect(issue.source).toEqual({ document: "catalog", ownerId: "D0090", ownerName: "깨진식" });
      expect(formatCoordinate(issue.source!, { source: true })).toBe("구분자 › 깨진식");
    }
  });
});

describe("조립오류 S3 — 미사용 담보속성 참조 (exist 가드 없음) 는 오류, 가드하면 건너뛴다", () => {
  const attrDoc = (when: string): DocumentNode => ({
    id: "a-doc",
    kind: "document",
    title: "수술비 특별약관",
    children: [
      {
        id: "a-art",
        kind: "article",
        title: "보험금의 지급사유",
        children: [
          {
            id: "a-par",
            kind: "paragraph",
            children: [
              { id: "a-t1", kind: "text", text: "회사는 " },
              { id: "a-cond", kind: "inlineCond", branches: [{ id: "a-if", when, children: [{ id: "a-t2", kind: "text", text: "최초계약일" }] }, { id: "a-else", children: [{ id: "a-t3", kind: "text", text: "계약일" }] }] },
              { id: "a-t4", kind: "text", text: " 이후 수술을 보장합니다." },
            ],
          },
        ],
      },
    ],
  });
  const coverages = () => [surgeryCoverage("pc-surgery", "수술비", { renew: false }), surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true, attributes: [{ kindCode: "A0001", valueCode: "2" }] })];

  it("가드 없는 `attr.A0001 = '2'` — 「갱신형 수술비」는 true, 「수술비」(미사용)는 unusedAttribute 오류 + 좌표", () => {
    const { booklet, doc } = docsOf(withSurgery(coverages(), {}, attrDoc("attr.A0001 = '2'")));
    expect(lines(doc("pc-renew"))[1]).toBe("   회사는 최초계약일 이후 수술을 보장합니다.");
    expect(lines(doc("pc-surgery"))[1]).toBe("   회사는 ⟦unusedAttribute⟧ 이후 수술을 보장합니다.");
    expect(booklet.issues).toHaveLength(1);
    expect(booklet.issues[0]).toMatchObject({ kind: "unusedAttribute", at: { ownerId: "pc-surgery", articleId: "a-art", nodePath: ["a-doc", "a-art", "a-par", "a-cond", "a-if"], refPath: "attr.A0001" } });
    // 원천은 담보 마스터 — ownerId 는 담보 id, 문서 id 는 documentId 에 (고치러 가기가 그 문서의 그 노드로 간다)
    expect(booklet.issues[0].source).toMatchObject({ document: "coverageMaster", ownerId: "cov-surgery", documentId: "a-doc", ownerName: "수술비", articleId: "a-art", nodePath: ["a-doc", "a-art", "a-par", "a-cond", "a-if"] });
    expect(booklet.complete).toBe(false);
  });

  it("`exist(attr.A0001) and attr.A0001 = '2'` 로 고치면 「수술비」는 분기를 건너뛰고 오류 없음", () => {
    const { booklet, doc } = docsOf(withSurgery(coverages(), {}, attrDoc("exist(attr.A0001) and attr.A0001 = '2'")));
    expect(lines(doc("pc-surgery"))[1]).toBe("   회사는 계약일 이후 수술을 보장합니다.");
    expect(lines(doc("pc-renew"))[1]).toBe("   회사는 최초계약일 이후 수술을 보장합니다.");
    expect(booklet.issues).toEqual([]);
  });
});

describe("조립오류 S4 — 분기로 사라진 조를 가리키는 조 참조 (surgeryFixture: 갱신형 전용 「보험기간」 조)", () => {
  /** 제1조 ① 끝에 「보험기간」 조 참조 슬롯을 단다. */
  const special = surgeryFixture().special;
  const art = special.children[0] as ArticleNode;
  (art.children[0] as ParagraphNode).children.push({ id: "s-txt-ref", kind: "text", text: " 보험기간은 " }, { id: "s-aref-term", kind: "articleRef", targets: [{ articleId: "s-art-term" }], connector: "및", scope: "self" });
  const { booklet, doc } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false }), surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true })], {}, special));

  it("「갱신형 수술비」 — 보험기간 조가 살아 제2조가 되고 참조는 「제2조(보험기간)」, 이후 조 번호가 밀린다", () => {
    expect(lines(doc("pc-renew"))).toEqual([
      "제1조(보험금의 지급사유)",
      "   회사는 피보험자가 최초계약일 이후 수술을 받은 경우 평균공시이율 2.5% 를 적용하여 보험금을 지급합니다. 보험기간은 제2조(보험기간)",
      "제2조(보험기간)",
      "   이 특별약관의 보험기간은 갱신형입니다.",
      "제3조(특별약관의 소멸)",
      "  ① 이 특별약관은 다음의 경우 소멸합니다.",
      "  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.",
      "제4조(준용규정)",
      "   이 특별약관에서 정하지 않은 사항은 보통약관 제2조(보험금의 지급사유) 및 이 특별약관 제1조(보험금의 지급사유) · 【별표2(화상 분류표)】 을 따릅니다. 이 약관에서 정하지 않은 사항은 보통약관을 따릅니다. 갱신형 계약은 갱신 특칙을 우선합니다.",
    ]);
  });

  it("「수술비」 — 대상 조가 분기로 꺼져 articleGone 마커 + 좌표, 나머지 참조는 어긋나지 않는다", () => {
    expect(lines(doc("pc-surgery"))[1]).toBe("   회사는 피보험자가 계약일 이후 수술을 받은 경우 평균공시이율 2.5% 를 적용하여 보험금을 지급합니다. 보험기간은 ⟦articleGone⟧");
    expect(lines(doc("pc-surgery"))[2]).toBe("제2조(특별약관의 소멸)");
    expect(lines(doc("pc-surgery"))[6]).toContain("보통약관 제2조(보험금의 지급사유) 및 이 특별약관 제1조(보험금의 지급사유) · 【별표2(화상 분류표)】");
    expect(kinds(booklet.issues)).toEqual(["articleGone"]);
    expect(booklet.issues[0].at).toMatchObject({ ownerId: "pc-surgery", ownerName: "수술비", articleId: "s-art-pay", refPath: "s-art-term" });
  });

  it("별표 — 등장 순으로 장해분류표 1 · 화상 분류표 2 (ADR-0063)", () => {
    expect(booklet.appendices.map((a) => [a.code, a.number])).toEqual([
      ["APX_DISABILITY", 1],
      ["APX_BURN", 2],
    ]);
  });
});

describe("조립오류 S5 — 밟지 않은 분기 안의 깨질 참조는 오류 아님", () => {
  // surgeryFixture 의 제2조(D0005 = true 안)는 급부 레벨 구분자 D0003(지급률)을 담보 문맥에서 읽는다 —
  // B1 규칙상 값 자리 없음(notAttached)이라 밟으면 오류다. 면책이 false 면 밟지 않으므로 오류가 아니다.
  it("면책여부 false → 제2조 분기를 밟지 않아 오류 0건", () => {
    const { booklet } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false })]));
    expect(booklet.issues).toEqual([]);
    expect(booklet.complete).toBe(true);
  });

  it("면책여부 true 인 탑재분이 처음 생기면 그때 드러난다 (잠복은 감수한 비용)", () => {
    const { booklet, doc } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false, exempt: true })]));
    expect(lines(doc("pc-surgery"))[2]).toBe("제2조(보험금을 지급하지 않는 사유)");
    expect(kinds(booklet.issues)).toEqual(["notAttached"]);
    expect(booklet.issues[0].at.refPath).toBe("D0003");
  });
});

describe("조립오류 S6 — 생략 자동 판정: 리터럴 비교 · 탑재분별", () => {
  const general: DocumentNode = {
    id: "g6",
    kind: "document",
    title: "보통약관",
    children: [{ id: "g6-apply", kind: "article", title: "준용규정", children: [{ id: "g6-p", kind: "paragraph", children: [{ id: "g6-c", kind: "clauseInlineRef", clauseCode: "C002", options: {} }] }] }],
  };
  const special = (body: ParagraphNode["children"]): DocumentNode => ({
    id: "s6",
    kind: "document",
    title: "수술비 특별약관",
    children: [
      { id: "s6-pay", kind: "article", title: "보험금의 지급사유", children: [{ id: "s6-p1", kind: "paragraph", children: [{ id: "s6-t1", kind: "text", text: "수술을 보장합니다." }] }] },
      { id: "s6-apply", kind: "article", title: "준용규정", linkedArticleId: "g6-apply", children: [{ id: "s6-p2", kind: "paragraph", children: body }] },
    ],
  });
  const viaClause: ParagraphNode["children"] = [{ id: "s6-c", kind: "clauseInlineRef", clauseCode: "C002", options: {} }];
  const coverages = [surgeryCoverage("pc-surgery", "수술비", { renew: false }), surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true })];
  const build = (body: ParagraphNode["children"]) => docsOf(withSurgery(coverages, { generalDocuments: new Map([["g6", general]]), product: { ...alphaPlusFixture().product, generalDocumentId: "g6", baseContractIds: ["pc-base"] } }, special(body)));

  it("같은 함수조항을 참조 → 「수술비」는 보통약관 조와 동일해 생략, 「갱신형 수술비」는 갱신 문구가 붙어 유지 (탑재분별 판정)", () => {
    const { booklet, doc } = build(viaClause);
    expect(lines(doc("pc-surgery")).map((l) => l.split("(")[0])).toEqual(["제1조", "   수술을 보장합니다."]);
    expect(lines(doc("pc-renew"))).toEqual(["제1조(보험금의 지급사유)", "   수술을 보장합니다.", "제2조(준용규정)", "   이 약관에서 정하지 않은 사항은 보통약관을 따릅니다. 갱신형 계약은 갱신 특칙을 우선합니다."]);
    expect(booklet.omitted.map((record) => [record.productCoverageId, record.disposition]).sort()).toEqual([
      ["pc-renew", "full"],
      ["pc-surgery", "omitted"],
    ]);
  });

  it("띄어쓰기 하나만 달라도 생략되지 않는다 — 유사도·정규화 없음", () => {
    const { booklet, doc } = build([{ id: "s6-t2", kind: "text", text: "이 약관에서 정하지 않은 사항은  보통약관을 따릅니다." }]);
    expect(lines(doc("pc-surgery"))).toHaveLength(4);
    expect(booklet.omitted.map((record) => record.disposition)).toEqual(["full", "full"]);
  });

  it("직접 쓴 문장이 리터럴 동일하면 생략된다 — 동일성의 근거는 결과 문자열뿐 (보통약관 쪽은 기본계약=비갱신 값으로 렌더되므로 둘 다 동일)", () => {
    const { booklet } = build([{ id: "s6-t2", kind: "text", text: "이 약관에서 정하지 않은 사항은 보통약관을 따릅니다." }]);
    expect(booklet.omitted.map((o) => o.productCoverageId).sort()).toEqual(["pc-renew", "pc-surgery"]);
  });

  it("항 순서만 다른 조는 통째로 남고 omissionUndecided warning — complete 는 깨지지 않는다 · 좌표는 담보 조 (기능/조립산출 §3.5)", () => {
    const twoParagraphs: DocumentNode = {
      ...general,
      children: [
        {
          id: "g6-apply",
          kind: "article",
          title: "준용규정",
          children: [
            { id: "g6-p1", kind: "paragraph", children: [{ id: "g6-t1", kind: "text", text: "첫째 항." }] },
            { id: "g6-p2", kind: "paragraph", children: [{ id: "g6-t2", kind: "text", text: "둘째 항." }] },
          ],
        },
      ],
    };
    const reversed: DocumentNode = {
      ...special([]),
      children: [
        special([]).children[0],
        {
          id: "s6-apply",
          kind: "article",
          title: "준용규정",
          linkedArticleId: "g6-apply",
          children: [
            { id: "s6-p1", kind: "paragraph", children: [{ id: "s6-t1", kind: "text", text: "둘째 항." }] },
            { id: "s6-p2", kind: "paragraph", children: [{ id: "s6-t2", kind: "text", text: "첫째 항." }] },
          ],
        },
      ],
    };
    const { booklet, doc } = docsOf(withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false })], { generalDocuments: new Map([["g6", twoParagraphs]]), product: { ...alphaPlusFixture().product, generalDocumentId: "g6", baseContractIds: ["pc-base"] } }, reversed));
    expect(lines(doc("pc-surgery")).slice(2)).toEqual(["제2조(준용규정)", "  ① 둘째 항.", "  ② 첫째 항."]);
    expect(booklet.complete).toBe(true);
    const warning = booklet.issues.filter((i) => i.kind === "omissionUndecided");
    expect(warning.map((i) => [i.severity, i.message, i.at.document, i.at.ownerId, i.at.articleId, i.at.articleNumber])).toEqual([["warning", "항 순서가 달라 자동 판정하지 않았습니다", "special", "pc-surgery", "s6-apply", 2]]);
    expect(booklet.omitted).toEqual([
      {
        productCoverageId: "pc-surgery",
        productCoverageName: "수술비",
        articleId: "s6-apply",
        articleTitle: "준용규정",
        linkedArticleId: "g6-apply",
        disposition: "full",
        reason: "항 순서가 달라 자동 판정하지 않았습니다",
        pairs: [
          { special: 1, general: 1, matched: false },
          { special: 2, general: 2, matched: false },
        ],
        excludedClauseNodeIds: [],
      },
    ]);
  });
});

// ───────────────────────────── 그룹핑·별표 시나리오 ─────────────────────────────

describe("그룹핑별표 S1·S2 — 그룹은 담보의 「특약 그룹」 열거값 · 그룹 순서 = 열거값 순서 · 그룹 안 자동 정렬(담보 → 속성 종류 → 값) (ADR-0080)", () => {
  // 열거값 순서가 코드 순과 다르다 — 책자 순서는 열거값 순서(수술 → 상해)
  const groupEnum: EnumDef = {
    code: "E0008",
    label: "특약 그룹",
    values: [
      { code: "V02", label: "수술 관련 특별약관", order: 0 },
      { code: "V01", label: "상해 관련 특별약관", order: 1 },
      { code: "V03", label: "쓰이지 않는 그룹", order: 2 },
    ],
  } as EnumDef;
  const base = alphaPlusFixture();
  const input: AssemblyInput = {
    ...base,
    enums: [...base.enums.filter((e) => e.code !== "E0008"), groupEnum],
    // 기본계약 담보에도 그룹이 있지만 기본계약은 특약 그룹에 들지 않는다
    coverageGroups: new Map([
      ["cov-death", "V01"],
      ["cov-surgery", "V02"],
      ["cov-base-death", "V01"],
    ]),
    specialDocuments: new Map([...base.specialDocuments, ["cov-surgery", tinyDoc("t-surgery", "수술비", "수술을 보장합니다.")]]),
    coverages: [
      baseDeathCoverage(),
      surgeryCoverage("pc-renew", "갱신형 수술비", { renew: true, attributes: [{ kindCode: "A0001", valueCode: "2" }] }),
      deathCoverage("pc-addon", "일반상해사망보장 추가", [{ kindCode: "A0002", valueCode: "2" }]),
      surgeryCoverage("pc-surgery", "수술비", { renew: false, attributes: [{ kindCode: "A0001", valueCode: "1" }] }),
      deathCoverage("pc-basic", "일반상해사망보장", [{ kindCode: "A0002", valueCode: "1" }]),
    ],
  };
  const booklet = assembleInput(input);

  it("책자 = 보통약관 → 그룹(열거값 순서) → 별표. 그룹 제목 = 열거값 이름, 상품담보가 없는 그룹은 찍지 않는다", () => {
    expect(booklet.specials.map((g) => [g.id, g.title, g.docs.map((d) => d.title)])).toEqual([
      ["V02", "수술 관련 특별약관", ["수술비 특별약관", "갱신형 수술비 특별약관"]],
      ["V01", "상해 관련 특별약관", ["일반상해사망보장 특별약관", "일반상해사망보장 추가 특별약관"]],
    ]);
    expect(booklet.complete).toBe(true);
  });

  it("같은 담보의 탑재분은 뭉치고 속성 값 order 오름차순 — 정렬의 귀결", () => {
    expect(booklet.specials[0].docs.map((d) => d.ownerId)).toEqual(["pc-surgery", "pc-renew"]);
    expect(booklet.specials[1].docs.map((d) => d.ownerId)).toEqual(["pc-basic", "pc-addon"]);
  });

  it("기본계약은 담보에 그룹이 있어도 특약 그룹에 들지 않는다", () => {
    expect(booklet.specials.flatMap((g) => g.docs.map((d) => d.ownerId))).not.toContain("pc-base");
  });

  it("그룹 없는 담보의 상품담보 — 오류가 아니다. 그룹들 뒤에 그룹 제목 없이 찍힌다", () => {
    const b = assembleInput({ ...input, coverageGroups: new Map([["cov-surgery", "V02"]]) });
    expect(b.issues).toEqual([]);
    expect(b.specials.map((g) => [g.title, g.docs.map((d) => d.ownerId)])).toEqual([
      ["수술 관련 특별약관", ["pc-surgery", "pc-renew"]],
      [undefined, ["pc-basic", "pc-addon"]],
    ]);
    expect(b.complete).toBe(true);
  });

  it("열거형에서 지워진 그룹 값 — 「없는 값」 brokenRef(좌표 = 그 상품담보) + 그룹 제목 없이 찍힌다", () => {
    const b = assembleInput({ ...input, coverageGroups: new Map([["cov-surgery", "V02"], ["cov-death", "V09"]]) });
    expect(b.issues).toEqual([
      { kind: "brokenRef", message: "없는 값 V09 — 특약 그룹(E0008)에서 지워진 값입니다 · 담보 「일반상해사망」의 특약 그룹", at: { document: "special", ownerId: "pc-basic", ownerName: "일반상해사망보장" } },
      { kind: "brokenRef", message: "없는 값 V09 — 특약 그룹(E0008)에서 지워진 값입니다 · 담보 「일반상해사망」의 특약 그룹", at: { document: "special", ownerId: "pc-addon", ownerName: "일반상해사망보장 추가" } },
    ]);
    expect(b.specials.at(-1)!.title).toBeUndefined();
    expect(b.specials.at(-1)!.docs.map((d) => d.ownerId)).toEqual(["pc-basic", "pc-addon"]);
  });

  it("문면 없는 담보의 탑재분은 오류가 아니라 「미산출 탑재분」 (D-P6-9)", () => {
    const b = assembleInput({ ...input, specialDocuments: base.specialDocuments });
    expect(b.undocumented).toEqual([
      { productCoverageId: "pc-renew", name: "갱신형 수술비", coverageId: "cov-surgery" },
      { productCoverageId: "pc-surgery", name: "수술비", coverageId: "cov-surgery" },
    ]);
    expect(b.complete).toBe(true);
  });
});

describe("그룹핑별표 S3·S4 — 별표 번호는 등장 순 자동 (ADR-0063)", () => {
  const groupEnum: EnumDef = { code: "E0008", label: "특약 그룹", values: [{ code: "V01", label: "A", order: 0 }, { code: "V02", label: "B", order: 1 }] } as EnumDef;
  /** 보통약관이 장해분류표를, 그룹 A 특약이 `burn` 을, 그룹 B 특약이 다시 장해분류표를 참조한다. */
  const make = (burn: Code): AssemblyInput => {
    const base = alphaPlusFixture();
    return {
      ...base,
      generalDocuments: new Map([["g-plain", tinyDoc("g-plain", "보통약관", "장해의 분류는 ", "APX_DISABILITY")]]),
      product: { ...base.product, generalDocumentId: "g-plain" },
      enums: [...base.enums.filter((e) => e.code !== "E0008"), groupEnum],
      coverageGroups: new Map([["cov-burn", "V01"], ["cov-dis", "V02"]]),
      specialDocuments: new Map([
        ["cov-burn", tinyDoc("t-burn", "화상", "화상의 분류는 ", burn)],
        ["cov-dis", tinyDoc("t-dis", "장해", "장해의 분류는 ", "APX_DISABILITY")],
      ]),
      coverages: [
        baseDeathCoverage(),
        coverageEntry({ id: "pc-burn", name: "화상", coverageId: "cov-burn", coverageName: "화상", attributes: [], subCoverages: [], values: {} }),
        coverageEntry({ id: "pc-dis", name: "장해", coverageId: "cov-dis", coverageName: "장해", attributes: [], subCoverages: [], values: {} }),
      ],
      appendices: [...base.appendices, { code: "APX_UNUSED", name: "쓰이지 않는 표", description: "" }],
    };
  };

  it("보통약관 → 특약 그룹 순으로 처음 등장한 별표부터 1, 2, … · 본문 슬롯도 그 번호를 찍는다", () => {
    const b = assembleInput(make("APX_BURN"));
    expect(b.issues).toEqual([]);
    expect(b.appendices.map((a) => [a.code, a.number])).toEqual([
      ["APX_DISABILITY", 1],
      ["APX_BURN", 2],
    ]);
    expect(firstAppendixLabel(b.general!)).toBe("【별표1(장해분류표)】");
    expect(lines(b.specials[0].docs[0])[1]).toBe("   화상의 분류는 【별표2(화상 분류표)】");
    expect(lines(b.specials[1].docs[0])[1]).toBe("   장해의 분류는 【별표1(장해분류표)】");
  });

  it("참조되지 않은 별표는 책자에 나오지 않는다 — 마스터에 있어도", () => {
    const b = assembleInput(make("APX_BURN"));
    expect(b.appendices.some((a) => a.code === "APX_UNUSED")).toBe(false);
  });

  it("마스터에 없는 별표 코드를 참조하면 그 자리에 brokenRef · 번호는 차지한다", () => {
    const b = assembleInput(make("APX_MISSING"));
    expect(b.issues.some((i) => i.kind === "brokenRef" && i.message.includes("별표 마스터에 없습니다"))).toBe(true);
    expect(b.appendices.find((a) => a.code === "APX_MISSING")?.name).toBe("(없는 별표)");
  });
});

// ───────────────────────────── 기본계약 · 함수조항 옵션 · 반복 자리 ─────────────────────────────

describe("기능/조립산출 §3.2 — 기본계약을 지정하지 않아도 오류를 남기고 부분 조립", () => {
  it("기본계약 없음 — noBaseContract 를 알리고 특약은 정상 조립 (기본계약이던 상품담보는 제 담보 그룹대로 — 그룹이 없으면 제목 없이)", () => {
    const input = alphaPlusFixture();
    const b = assembleInput({ ...input, product: { ...input.product, baseContractIds: [] } });
    expect(kinds(b.issues)).toEqual(["noBaseContract"]);
    expect(b.specials.at(-1)!.title).toBeUndefined();
    expect(b.specials.at(-1)!.docs.map((d) => d.ownerId)).toEqual(["pc-base"]);
    expect(b.issues[0]).toMatchObject({ kind: "noBaseContract", severity: "error", at: { document: "product", ownerId: "prod-alpha", refPath: "baseContract" } });
    expect(b.general!.children.find((node) => node.id === "g-art-pay")).toMatchObject({ kind: "article", children: [] });
    expect(b.specials[0].docs).toHaveLength(2);
    expect(b.complete).toBe(false);
  });

  it("독립특약 상품(계약형태 V02)은 기본계약 0개가 정상 — noBaseContract 를 내지 않는다 (기능/상품 §3.1 · 2026-10-01)", () => {
    const input = alphaPlusFixture();
    const values = new Map(input.product.values);
    values.set("feature.contract_kind", { entered: true, value: "V02" });
    const b = assembleInput({ ...input, product: { ...input.product, values, baseContractIds: [] } });
    expect(kinds(b.issues)).not.toContain("noBaseContract");
    // 기본계약이던 상품담보는 제 담보에 그룹이 없어 그룹 제목 없이 찍힌다 — 오류가 아니다 (ADR-0080)
    expect(b.specials.flatMap((g) => g.docs.map((d) => d.ownerId))).toContain("pc-base");
  });

  it("기본계약 문면을 바꾸면 연결된 보통약관 조 본문도 따라간다", () => {
    const input = alphaPlusFixture();
    const baseDoc = input.specialDocuments.get("cov-base-death")!;
    const basePay = baseDoc.children.find((node) => node.kind === "article" && node.id === "b-art-pay") as ArticleNode;
    const paragraph = basePay.children[0] as ParagraphNode;
    paragraph.children = [{ id: "changed", kind: "text", text: "변경된 기본계약 지급사유입니다." }];
    const b = assembleInput(input);
    expect(lines(b.general!)[3]).toBe("   변경된 기본계약 지급사유입니다.");
    expect(b.complete).toBe(true);
  });

  it("보통약관 템플릿 미선택 — brokenRef 오류, general 없음, 담보약관의 보통약관 조 참조도 오류", () => {
    const input = withSurgery([surgeryCoverage("pc-surgery", "수술비", { renew: false })]);
    const b = assembleInput({ ...input, product: { ...input.product, generalDocumentId: undefined } });
    expect(b.general).toBeUndefined();
    expect(kinds(b.issues)).toEqual(["brokenRef", "brokenRef"]);
    expect(b.issues[1].message).toContain("보통약관 템플릿이 없어");
  });

  it("기본계약 2개 이상 — unsupported 오류를 남기고 기본계약들은 특약·미산출 목록에서 제외한다", () => {
    const input = alphaPlusFixture();
    const b = assembleInput({ ...input, product: { ...input.product, baseContractIds: ["pc-base", "pc-basic"] } });
    expect(b.issues[0]).toMatchObject({ kind: "unsupported", severity: "error", message: "기본계약이 2개입니다 — 하나만 남기고 해제하세요 (MVP 는 1개)", at: { document: "product", ownerId: "prod-alpha", refPath: "baseContract" } });
    expect(b.specials.flatMap((group) => group.docs.map((doc) => doc.ownerId))).toEqual(["pc-addon"]);
    expect(b.baseContracts.map((record) => record.productCoverageId)).toEqual(["pc-base", "pc-basic"]);
    expect(b.undocumented).toEqual([]);
    expect(b.complete).toBe(false);
  });
});

describe("기본계약 대치 — 대치될 보통약관 본문은 실행하지 않는다 (코덱스 리뷰 2026-09-15 Important-4)", () => {
  /** 대치 대상 조를 「참인 조건 블록」 안에 넣고, 그 안에 미입력 값을 읽는 슬롯을 둔다. */
  const inCondBlock = (): AssemblyInput => {
    const input = alphaPlusFixture();
    const flat = alphaGeneralDocument();
    const [def, pay, ...rest] = flat.children as ArticleNode[];
    const payWithSlot: ArticleNode = {
      ...pay,
      children: [{ id: "g-par-pay", kind: "paragraph", children: [{ id: "g-txt-pay", kind: "text", text: "고지유형 " }, { id: "g-slot-pay", kind: "slot", ref: "D0002" }] }],
    };
    // 조건 없는 가지(else)라 언제나 펴진다 — 조는 실제로 조립에 들어가고, 기본계약 조가 대치한다
    const general: DocumentNode = { ...flat, children: [def, { id: "g-cond-pay", kind: "condBlock", branches: [{ id: "g-cond-pay-else", children: [payWithSlot] }] }, ...rest] };
    return { ...input, generalDocuments: new Map([["g-doc", general]]), product: { ...input.product, values: new Map() } }; // D0002(product_basic.notice) 미입력
  };

  it("조건 블록 안의 대치 대상도 미리 비운다 — 출력은 기본계약 본문이고 사라진 슬롯의 notEntered 도 없다", () => {
    const b = assembleInput(inCondBlock());
    expect(lines(b.general!)[3]).toBe("   피보험자가 보험기간 중 상해로 사망한 경우 보험금을 지급합니다.");
    expect(lines(b.general!).join("\n")).not.toContain("notEntered");
    expect(b.issues.filter((i) => i.kind === "notEntered")).toEqual([]);
    expect(b.complete).toBe(true);
  });
});

describe("기능/상품 §3.6 — 함수조항 옵션 해소: 오버라이드 > 마스터, 미선택·무효는 오류 마커", () => {
  /** 특약 소멸 조의 함수조항 참조 마스터 선택만 바꾼다 — 담보약관에는 오버라이드가 없다 (기능/상품 §3.6). */
  const withMaster = (options: Record<string, string>) => {
    const input = alphaPlusFixture();
    const doc = input.specialDocuments.get("cov-death")!;
    const lapse = doc.children.find((a) => a.kind === "article" && a.id === "s-art-lapse") as ArticleNode;
    (lapse.children[0] as { options: Record<string, string> }).options = options;
    return docsOf(input);
  };

  /** 보통약관 면책 조의 함수조항 참조를 옵션 있는 C0001 로 바꾸고 상품 스코프 오버라이드를 얹는다 — 오버라이드가 사는 유일한 자리. */
  const withGeneralOverride = (master: Record<string, string>, override?: Record<string, string>) => {
    const input = alphaPlusFixture();
    const exempt = input.generalDocuments.get("g-doc")!.children.find((a) => a.kind === "article" && a.id === "g-art-exempt") as ArticleNode;
    const ref = exempt.children[1] as { clauseCode: Code; options: Record<string, string> };
    ref.clauseCode = "C0001";
    ref.options = master;
    return assembleInput({
      ...input,
      product: {
        ...input.product,
        ...(override ? { overrides: [{ id: "ov-1", scope: { kind: "product" as const, id: input.product.id }, nodeId: "g-clause-exempt-extra", clauseCode: "C0001", options: override }] } : {}),
      },
    });
  };

  it("상품 오버라이드가 마스터 선택을 이긴다 — 보통약관 자리만 (기능/상품 §3.6)", () => {
    expect(lines(withGeneralOverride({ O01: "V02" }).general!)[8]).toBe("  ② 이 특별약관은 피보험자가 사망한 때 소멸합니다.");
    const overridden = withGeneralOverride({ O01: "V02" }, { O01: "V01" });
    expect(lines(overridden.general!)[8]).toBe("  ② 이 특별약관은 보험기간이 끝난 때 소멸합니다.");
    expect(overridden.complete).toBe(true);
    // 담보약관은 마스터 선택 그대로 — 상품담보별 오버라이드는 없다
    expect(lines(withMaster({ O01: "V02" }).doc("pc-basic"))[6]).toBe("   이 특별약관은 피보험자가 사망한 때 소멸합니다.");
  });

  it("옵션 미선택 → optionUnselected 마커 (항 자리) · 유효 집합 밖 오버라이드 → optionInvalid", () => {
    const unselected = withMaster({});
    expect(lines(unselected.doc("pc-basic"))[6]).toBe("  ⟦optionUnselected⟧");
    expect(unselected.booklet.issues.map((i) => [i.kind, i.at.ownerId])).toEqual([
      ["optionUnselected", "pc-basic"],
      ["optionUnselected", "pc-addon"],
    ]);
    const invalid = withGeneralOverride({ O01: "V02" }, { O01: "V99" });
    expect(kinds(invalid.issues)).toEqual(["optionInvalid"]);
    expect(invalid.issues[0].at).toMatchObject({ document: "general", ownerId: "g-doc", articleId: "g-art-exempt", refPath: "O01" });
  });

  it("없는 함수조항 참조는 brokenRef 마커", () => {
    const input = alphaPlusFixture();
    const b = assembleInput({ ...input, clauses: input.clauses.filter((c) => c.code !== "C0001") });
    expect(kinds(b.issues)).toEqual(["brokenRef", "brokenRef"]);
  });
});

describe("블록 반복 · 밟은 자리 원칙", () => {
  it("원천이 없는(옛 글자) 반복 블록은 structure 마커 — 조립은 계속된다", () => {
    const input = alphaPlusFixture();
    const doc = input.specialDocuments.get("cov-death")!;
    (doc.children[0] as ArticleNode).children.push({ id: "s-for", kind: "forBlock", source: "subCoverage" as never, children: [] });
    const { booklet, doc: d } = docsOf(input);
    expect(lines(d("pc-basic"))[2]).toBe("  ⟦structure⟧");
    expect(booklet.issues.map((i) => i.message)).toEqual(["반복 블록의 원천이 없습니다 — 편집기에서 원천을 고른다", "반복 블록의 원천이 없습니다 — 편집기에서 원천을 고른다"]);
  });

  it("납입면제 시나리오 — 2종 · 3사유: 납입면제종마다 항 › 사유마다 호 · 부가항 · 정의 조(합집합 ∩ 정의조대상) (결정 11 · 23)", () => {
    const input = waiverFixture(waiverTemplate(), { "opt-type-1": { applies: true, reasons: ["V01", "V03"] }, "opt-type-2": { applies: true, reasons: ["V02", "V01"] } });
    const booklet = assembleInput(input);
    expect(booklet.issues.filter((i) => i.at.document === "general")).toEqual([]);
    const inline = (list: RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
    const out = booklet.general!.children.flatMap((a) =>
      a.kind !== "article"
        ? []
        : [`${a.label}(${a.title})`, ...a.children.flatMap((p) => (p.kind !== "paragraph" ? [] : [`  ${p.label} ${inline(p.children)}`, ...(p.items ?? []).map((i) => (i.kind === "item" ? `    ${i.label} ${inline(i.children)}` : `    [${i.kind}]`))]))],
    );
    expect(out).toMatchSnapshot();
  });

  it("실행 기반 완결성 필터 — 책자가 실제로 읽은 자리의 미입력만 남긴다", () => {
    const filter = executionBasedFilter(assembleInput(alphaPlusFixture()));
    const item = (id: Id, level: MissingSlot["owner"]["level"], path: string): MissingSlot => ({ owner: { level, id }, ownerName: "", label: "", path, at: {} });
    const items = [
      item("cov-death", "coverage", "coverage_basic.reduction_text"),
      item("ben-death", "benefit", "pay.rate"),
      item("ben-death", "benefit", "pay.exempt"),
      item("cov-death", "coverage", "coverage_basic.renewal"),
    ];
    const tree = { id: "cov-death", name: "일반상해사망", description: "", subCoverages: [] };
    // 지급률은 어떤 문서도 읽지 않았고, 갱신여부는 보통약관 문맥(기본계약)에서만 읽힌다
    expect(filter(items, tree).map((m) => m.path)).toEqual(["coverage_basic.reduction_text", "pay.exempt"]);
    expect(filter(items, { ...tree, id: "cov-other" })).toEqual([]);
  });

  it("상품담보 미리보기는 그룹과 무관 — 그룹 없는 담보의 탑재분도 미리보기 가능, 문면 없는 담보는 notFound", () => {
    const input = alphaPlusFixture();
    const r = assembleSpecialInput({ ...input, coverageGroups: new Map() }, "pc-basic");
    expect(r.ok && r.value.complete).toBe(true);
    const none = assembleSpecialInput({ ...input, specialDocuments: new Map() }, "pc-basic");
    expect(!none.ok && none.rejection.reason).toBe("notFound");
    expect(alphaGeneralDocument().children).toHaveLength(6);
  });
});

describe("조 사본 (ADR-0079 · 기능/상품 §3.10) — 고친 조는 이 상품의 사본, 나머지는 템플릿", () => {
  const copyOf = (id: Id, text: string, title?: string): ArticleNode => {
    const original = alphaGeneralDocument().children.find((c) => c.kind === "article" && c.id === id) as ArticleNode;
    return { ...original, ...(title ? { title } : {}), children: [{ id: `${id}-copy-par`, kind: "paragraph", children: [{ id: `${id}-copy-txt`, kind: "text", text }] }] };
  };
  const withCopies = (...copies: ArticleNode[]) => {
    const input = alphaPlusFixture();
    return assembleInput({ ...input, product: { ...input.product, articleCopies: new Map(copies.map((a) => [a.id, a])) } });
  };
  const generalText = (doc: RenderedDoc) => lines(doc).join("\n");

  it("보통약관 조립은 사본이 있는 조만 사본 본문 · 제목, 번호 · 순서는 템플릿 그대로", () => {
    const plain = withCopies();
    const booklet = withCopies(copyOf("g-art-def", "이 상품에서 쓰는 용어는 다음과 같습니다.", "용어의 정의(상품)"));
    expect(generalText(booklet.general!)).toContain("제1조(용어의 정의(상품))");
    expect(generalText(booklet.general!)).toContain("이 상품에서 쓰는 용어는 다음과 같습니다.");
    expect(generalText(booklet.general!)).not.toContain("이 계약에서 사용하는 용어의 정의는");
    // 다른 조는 템플릿 그대로 — 사본 하나가 바꾼 것은 그 조뿐
    expect(lines(booklet.general!).slice(2)).toEqual(lines(plain.general!).slice(2));
  });

  it("특약의 준용 판정도 사본을 본다 — 보통약관 조 본문이 달라지면 같은 문장의 특약 조는 더는 준용되지 않는다", () => {
    const before = withCopies().omitted.find((r) => r.articleId === "s-art-exempt" && r.productCoverageId === "pc-basic");
    const after = withCopies(copyOf("g-art-exempt", "중대한 과실로 사고를 일으킨 경우에는 보험금을 지급하지 않습니다.")).omitted.find((r) => r.articleId === "s-art-exempt" && r.productCoverageId === "pc-basic");
    expect(before?.disposition).toBe("omitted");
    expect(after?.disposition).not.toBe("omitted");
  });

  it("템플릿에 없는 조의 사본은 쓰이지 않는다 · 숨긴 조의 사본도 빠진다", () => {
    const orphan: ArticleNode = { id: "g-art-gone", kind: "article", title: "사라진 조", children: [] };
    expect(generalText(withCopies(orphan).general!)).not.toContain("사라진 조");
    const input = alphaPlusFixture();
    const hidden = assembleInput({ ...input, product: { ...input.product, hiddenArticleIds: new Set(["g-art-def"]), articleCopies: new Map([["g-art-def", copyOf("g-art-def", "숨긴 사본")]]) } });
    expect(generalText(hidden.general!)).not.toContain("숨긴 사본");
  });
});

describe("조 노출 토글 (기능/상품 §3.6) — 숨긴 조는 빠지고 번호가 순연되며 참조하면 오류", () => {
  /** 보통약관 조 몇 개를 이 상품에서 「노출 끔」 한 책자. */
  const withHidden = (...ids: Id[]) => {
    const input = alphaPlusFixture();
    return assembleInput({ ...input, product: { ...input.product, hiddenArticleIds: new Set(ids) } });
  };

  const articles = (doc: RenderedDoc) => doc.children.flatMap((c) => (c.kind === "article" ? [[c.label, c.title]] : []));
  const hiddenIssues = (booklet: ReturnType<typeof withHidden>) => booklet.issues.filter((i) => i.kind === "articleHidden");

  it("보통약관 6조 중 제1조를 숨기면 5조가 되고 뒤 조 번호가 순연된다", () => {
    const booklet = withHidden("g-art-def");
    expect(articles(booklet.general!)).toEqual([
      ["제1조", "보험금의 지급사유"],
      ["제2조", "보험금 지급에 관한 세부규정"],
      ["제3조", "보험금을 지급하지 않는 사유"],
      ["제4조", "장해의 분류"],
      ["제5조", "해약환급금"],
    ]);
    expect(booklet.issues).toEqual([]);
    expect(booklet.complete).toBe(true);
  });

  it("숨긴 조를 조참조하는 조 → articleHidden 오류 · 메시지에 「노출을 껐습니다」 · 좌표는 보통약관", () => {
    const input = alphaPlusFixture();
    const def = input.generalDocuments.get("g-doc")!.children.find((c) => c.kind === "article" && c.id === "g-art-def") as ArticleNode;
    (def.children[0] as ParagraphNode).children.push({ id: "g-aref-dis", kind: "articleRef", targets: [{ articleId: "g-art-disability" }], connector: "및", scope: "self" });
    const booklet = assembleInput({ ...input, product: { ...input.product, hiddenArticleIds: new Set(["g-art-disability"]) } });
    const issue = hiddenIssues(booklet)[0];
    expect(issue?.message).toBe("보통약관 조 「장해의 분류」 은(는) 상품에서 노출을 껐습니다");
    expect(issue?.message).toContain("노출을 껐습니다");
    expect(issue?.at).toMatchObject({ document: "general", articleId: "g-art-def", refPath: "g-art-disability" });
    expect(booklet.complete).toBe(false);
  });

  it("숨긴 조에 조연결된 특약 조 → articleHidden 오류 (준용 대상 없음) · 문면은 통째로 남는다", () => {
    const booklet = withHidden("g-art-exempt");
    const issues = hiddenIssues(booklet);
    expect(issues.map((i) => i.at.ownerId)).toEqual(["pc-basic", "pc-addon"]);
    expect(issues[0].message).toBe("준용할 보통약관 조 「보험금을 지급하지 않는 사유」 은(는) 상품에서 노출을 껐습니다");
    expect(issues[0].at).toMatchObject({ document: "special", ownerId: "pc-basic", articleId: "s-art-exempt" });
    expect(booklet.omitted.find((r) => r.articleId === "s-art-exempt")?.disposition).toBe("full");
    expect(booklet.complete).toBe(false);
  });

  /** 트리를 갈아끼운 책자 — 관 · 조건 블록 안의 조를 숨기는 경우. */
  const withTree = (general: DocumentNode, ...ids: Id[]) => {
    const input = alphaPlusFixture();
    return assembleInput({ ...input, generalDocuments: new Map([["g-doc", general]]), product: { ...input.product, hiddenArticleIds: new Set(ids) } });
  };
  /** 관을 투명하게 편 조 목록 — 렌더 결과는 관 구조를 남긴다. */
  const allArticles = (doc: RenderedDoc): [string, string][] =>
    doc.children.flatMap((c) => (c.kind === "article" ? [[c.label, c.title] as [string, string]] : c.kind === "section" ? c.children.flatMap((a) => (a.kind === "article" ? [[a.label, a.title] as [string, string]] : [])) : []));

  it("관 안의 조도 숨길 수 있다 — 빠지고 뒤 조 번호가 순연된다", () => {
    const flat = alphaGeneralDocument();
    const [def, pay, detail, exempt, disability, refund] = flat.children as ArticleNode[];
    const general: DocumentNode = { ...flat, children: [def, pay, detail, exempt, { id: "g-sec-tail", kind: "section", title: "제2관 장해와 환급", children: [disability, refund] }] };
    expect(allArticles(withTree(general).general!).map(([, title]) => title)).toContain("장해의 분류");
    const booklet = withTree(general, "g-art-disability");
    expect(allArticles(booklet.general!)).toEqual([
      ["제1조", "용어의 정의"],
      ["제2조", "보험금의 지급사유"],
      ["제3조", "보험금 지급에 관한 세부규정"],
      ["제4조", "보험금을 지급하지 않는 사유"],
      ["제5조", "해약환급금"],
    ]);
    expect(booklet.issues).toEqual([]);
  });

  it("조건 블록 가지 안의 조도 숨길 수 있다 (목차에 뜨는 조는 모두 끌 수 있어야 한다)", () => {
    const flat = alphaGeneralDocument();
    const [def, pay, detail, exempt, disability, refund] = flat.children as ArticleNode[];
    // 조 자리의 조건 블록 — 조건 없는 가지(else)라 언제나 펴진다
    const general: DocumentNode = { ...flat, children: [def, pay, detail, exempt, { id: "g-cond-tail", kind: "condBlock", branches: [{ id: "g-cond-tail-else", children: [disability, refund] }] }] };
    expect(allArticles(withTree(general).general!).map(([, title]) => title)).toContain("장해의 분류");
    const booklet = withTree(general, "g-art-disability");
    expect(allArticles(booklet.general!)).toEqual([
      ["제1조", "용어의 정의"],
      ["제2조", "보험금의 지급사유"],
      ["제3조", "보험금 지급에 관한 세부규정"],
      ["제4조", "보험금을 지급하지 않는 사유"],
      ["제5조", "해약환급금"],
    ]);
    expect(booklet.issues).toEqual([]);
  });

  it("숨긴 조에 조연결된 기본계약 조 → articleHidden 오류", () => {
    const booklet = withHidden("g-art-pay");
    const issue = hiddenIssues(booklet).find((i) => i.message.startsWith("기본계약 조"));
    expect(issue?.message).toBe("기본계약 조 「보험금의 지급사유」 이(가) 연결된 보통약관 조 「보험금의 지급사유」 은(는) 상품에서 노출을 껐습니다");
    expect(issue?.at).toMatchObject({ document: "special", ownerId: "pc-base", articleId: "b-art-pay" });
    // 원천은 기본계약 담보의 문면 — ownerId 는 담보 id, documentId 는 그 문서
    expect(issue?.source).toMatchObject({ document: "coverageMaster", ownerId: "cov-base-death", documentId: "b-doc-death", articleId: "b-art-pay", nodePath: ["b-doc-death", "b-art-pay"] });
    expect(booklet.complete).toBe(false);
  });
});
