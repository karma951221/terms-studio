import { describe, expect, it } from "vitest";

import type { Discriminator, EnumDef } from "../catalog";
import type { Clause } from "../clause";
import type { MasterForm } from "../master";
import { surgeryFixture } from "../document";
import { buildGraph, nodeKey, type DocumentInput } from "./graph";
import { affectedProducts, brokenEdges, cycles, dependentDiscriminators, describeKey, enumValueListers, orphans, refStats, relationView, transitiveUsages, usagesOf } from "./queries";

/** 픽스처 마스터 — 담보 기본{갱신여부} · 급부 보험금지급{면책여부 · 지급률}. 경로는 `폼키.필드키`. */
const master: MasterForm[] = [
  { key: "coverage_basic", label: "담보 기본", level: "coverage", fields: [{ key: "renewal", label: "갱신여부", type: { kind: "boolean" } }] },
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    fields: [
      { key: "exempt", label: "면책여부", type: { kind: "boolean" } },
      { key: "rate", label: "지급률", type: { kind: "number" } },
    ],
  },
];

const D = (code: string, label = code): Discriminator => ({ code, label, description: "", level: "coverage", expression: "coverage_basic.renewal" });
const 지급률: Discriminator = { code: "D0003", label: "지급률", description: "", level: "benefit", expression: "pay.rate" };
const konst: Discriminator = { code: "D0004", label: "평균공시이율", description: "", level: "product", expression: "'2.5%'" };
const derived: Discriminator = { code: "D0005", label: "면책여부합", description: "", level: "coverage", expression: "any(pay.exempt)" };
const clause = (code: string, label: string, body: Clause["body"] = [{ id: `${code}-p`, kind: "paragraph", children: [] }]): Clause => ({ code, label, mode: "block", body: body as never, options: [], required: { discriminators: [], attributes: [] } });

const fx = surgeryFixture();
const special: DocumentInput = { id: "doc-s", kind: "special", ownerId: fx.coverageId, title: fx.special.title, generalDocumentId: "doc-g", tree: fx.special };
const general: DocumentInput = { id: "doc-g", kind: "general", title: fx.general.title, tree: fx.general };

function surgeryGraph() {
  return buildGraph({
    discriminators: [D("D0001", "갱신여부"), 지급률, konst, derived, D("D0099", "아무도 안 쓰는 것")],
    clauses: [clause("C001", "특별약관의 소멸"), clause("C002", "준용규정"), clause("C003", "고아 조항")],
    documents: [special, general],
    appendices: [...fx.appendices, { code: "APX_ORPHAN", name: "고아 별표", description: "" }],
    coverages: [{ id: fx.coverageId, name: "수술비", description: "", documentId: "doc-s", subCoverages: [{ id: "sub-1", name: "1종수술", order: 0, benefits: [{ id: "ben-1", name: "수술보험금", order: 0 }] }] }],
    master,
  });
}

describe("usagesOf — 역방향 조회 (구분자정의 S6 · 관계정보 뷰)", () => {
  it("구분자 사용처 = 문면 조건식·슬롯·함수조항 식 — 좌표 목록으로", () => {
    const g = surgeryGraph();
    const u = usagesOf(g, { kind: "discriminator", code: "D0001" });
    expect(u.map((e) => e.via)).toEqual(["when", "when"]); // 인라인 조건(제1조) · 조 자리 조건 블록
    expect(u.every((e) => e.at.document === "special" && e.at.ownerId === "cov-surgery")).toBe(true);
  });

  it("역인덱스 2단 — 마스터 필드 사용처는 구분자, 구분자 사용처는 문면이다 (기능/마스터 §4.3 사용처)", () => {
    const g = surgeryGraph();
    expect(usagesOf(g, { kind: "masterField", path: "pay.exempt" }).map((e) => [e.via, nodeKey(e.from)])).toEqual([
      ["expression", "discriminator:D0005"],
    ]);
    expect(usagesOf(g, { kind: "discriminator", code: "D0003" }).map((e) => [e.via, e.at.refPath])).toEqual([
      ["slot", "D0003"],
    ]);
  });

  it("via 필터 — 아무도 읽지 않는 구분자는 사용처가 없다", () => {
    const g = surgeryGraph();
    expect(usagesOf(g, { kind: "discriminator", code: "D0099" })).toEqual([]);
    expect(usagesOf(g, { kind: "discriminator", code: "D0099" }, { via: ["when", "slot", "expression"] })).toEqual([]);
  });

  it("함수조항·조·별표 사용처", () => {
    const g = surgeryGraph();
    expect(usagesOf(g, { kind: "clause", code: "C001" }).map((e) => [e.via, e.at.articleTitle])).toEqual([
      ["clauseRef", "특별약관의 소멸"],
      ["optionSelect", "특별약관의 소멸"],
    ]);
    expect(usagesOf(g, { kind: "article", documentId: "doc-g", articleId: "g-art-apply" }).map((e) => e.via)).toEqual(["link"]);
    expect(usagesOf(g, { kind: "document", id: "doc-g" }).map((e) => e.via).sort()).toEqual(["articleRef", "generalDocument", "link"]);
    expect(usagesOf(g, { kind: "appendix", code: "APX_BURN" })).toHaveLength(1);
  });
});

describe("orphans — 어디서도 참조되지 않는 구분자·함수조항·별표", () => {
  it("식·문면이 읽지 않는 구분자, 참조 없는 함수조항·별표가 고아다", () => {
    const g = surgeryGraph();
    expect(orphans(g).map((n) => nodeKey(n.key))).toEqual(["discriminator:D0099", "clause:C003", "appendix:APX_ORPHAN"]);
  });

  it("마스터 필드를 읽어도 그 구분자 자신을 읽는 곳이 없으면 고아다", () => {
    const g = buildGraph({ discriminators: [지급률, derived], master });
    expect(orphans(g).map((n) => nodeKey(n.key))).toEqual(["discriminator:D0003", "discriminator:D0005"]);
  });
});

describe("cycles — 파생식 순환 · 조 참조 순환", () => {
  it("구분자가 서로를 맞물려 읽으면 순환 (MVP 는 구분자 → 구분자 참조 자체를 거부하지만 저장 구조는 검증 가능해야 한다)", () => {
    const g = buildGraph({
      discriminators: [
        { code: "D0010", label: "a", description: "", level: "coverage", expression: "D0011 = true" },
        { code: "D0011", label: "b", description: "", level: "coverage", expression: "D0010 = true" },
      ],
    });
    const cs = cycles(g);
    expect(cs).toHaveLength(1);
    expect(cs[0].nodes.map(nodeKey).sort()).toEqual(["discriminator:D0010", "discriminator:D0011"]);
    expect(cs[0].edges.every((e) => e.via === "expression")).toBe(true);
  });

  it("조 참조가 서로를 가리키면 순환 · 자기 참조도 순환", () => {
    const tree = (id: string, refs: [string, string][]) => ({
      id: `${id}-root`,
      kind: "document" as const,
      title: id,
      children: refs.map(([art, target]) => ({ id: art, kind: "article" as const, title: art, children: [{ id: `${art}-p`, kind: "paragraph" as const, children: [{ id: `${art}-r`, kind: "articleRef" as const, targets: [{ articleId: target }], connector: "및" as const, scope: "self" as const }] }] })),
    });
    const g = buildGraph({ documents: [{ id: "d", kind: "general", title: "d", tree: tree("d", [["a1", "a2"], ["a2", "a1"], ["a3", "a3"]]) }] });
    expect(cycles(g).map((c) => c.nodes.map((n) => (n.kind === "article" ? n.articleId : "?")).sort())).toEqual([["a1", "a2"], ["a3"]]);
  });

  it("순환 없는 그래프는 빈 목록", () => {
    expect(cycles(surgeryGraph())).toEqual([]);
  });
});

describe("brokenEdges — 대상이 없는 참조 (삭제 후 남은 오류 상태)", () => {
  it("픽스처의 깨진 참조: 정의에 없는 옵션 선택(tone) 뿐", () => {
    const g = surgeryGraph();
    expect(brokenEdges(g).map((e) => nodeKey(e.to))).toEqual(["clauseOptionValue:C001/tone/death"]);
  });

  it("구분자를 지우면 그 구분자와 필드를 읽던 간선 전부가 깨진다 — 좌표는 그대로 남는다", () => {
    const g = buildGraph({ discriminators: [D("D0001"), konst, derived], documents: [special, general], clauses: [clause("C001", "x"), clause("C002", "y")], appendices: fx.appendices, master });
    const broken = brokenEdges(g);
    expect(broken.map((e) => e.at.refPath).sort()).toEqual(["C001.tone", "D0003"]);
    expect(broken.find((e) => e.at.refPath === "D0003")?.at).toMatchObject({ document: "special", articleId: "s-art-exempt" });
  });

  it("대응 보통약관이 없는 담보약관의 조연결·보통약관 조 참조는 깨진다", () => {
    const g = buildGraph({ documents: [{ ...special, generalDocumentId: undefined }], master: [] });
    // 자기 문서 조 참조(self)만 성립하고 나머지는 전부 깨진다
    expect(brokenEdges(g).map((e) => e.via).sort()).toEqual(["appendixRef", "articleRef", "clauseRef", "clauseRef", "link", "optionSelect", "slot", "slot", "when", "when", "when"]);
  });
});

describe("relationView — 관계정보 뷰 (정방향 · 역방향 · 옵션 오버라이드 사용처)", () => {
  it("함수조항: 정방향(본문이 읽는 것) · 역방향(참조 문서) · 오버라이드(기능/함수조항 §3.2) · 깨진 것", () => {
    const g = buildGraph({
      discriminators: [D("D0001")],
      master,
      clauses: [
        {
          code: "C001",
          label: "소멸",
          mode: "block",
          options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "death", label: "사망", body: [], order: 0 }] }],
          body: [{ id: "cb", kind: "condBlock", branches: [{ id: "br", when: "D0001 = true", children: [] }] }],
          required: { discriminators: ["D0001"], attributes: [] },
        },
      ],
      documents: [{ ...special, generalDocumentId: undefined }],
      products: [{ id: "p", name: "알파", coverages: [{ id: "pc", productId: "p", coverageId: fx.coverageId, name: "수술비", attributes: [] }], overrides: [{ id: "o", scope: { kind: "product", id: "p" }, nodeId: "s-clause-lapse", clauseCode: "C001", options: { O01: "death" } }] }],
    });
    const v = relationView(g, { kind: "clause", code: "C001" });
    expect(v.node?.label).toBe("소멸");
    expect(v.outgoing.map((e) => [e.via, nodeKey(e.to)])).toEqual([["when", "discriminator:D0001"]]);
    expect(v.incoming.map((e) => [e.via, e.at.articleTitle])).toEqual([
      ["clauseRef", "특별약관의 소멸"],
      ["optionSelect", "특별약관의 소멸"],
    ]);
    expect(v.overrides.map((e) => [nodeKey(e.from), e.at.refPath])).toEqual([["product:p", "C001.O01"]]);
    expect(v.broken).toEqual([]);
  });

  it("문서: 정방향에 조 안 참조가 다 들어오고, 깨진 대상은 broken 으로 갈린다", () => {
    const g = buildGraph({ documents: [{ ...special, generalDocumentId: undefined }], master: [] });
    const v = relationView(g, { kind: "document", id: "doc-s" });
    expect(v.outgoing.length).toBeGreaterThan(5);
    expect(v.broken.length).toBe(v.outgoing.length - 1); // 자기 문서 조 참조(self) 하나만 성립, 나머지는 전부 깨짐
    expect(v.incoming.map((e) => [e.via, nodeKey(e.from)])).toEqual([["articleRef", "article:doc-s/s-art-apply"]]); // 문서 안 자기 조 참조
  });

  it("없는 대상은 node 없이 (참조만 남은 상태)", () => {
    const g = surgeryGraph();
    const v = relationView(g, { kind: "clauseOption", clauseCode: "C001", optionCode: "tone" });
    expect(v.node).toBeUndefined();
    expect(v.incoming.map((e) => e.via)).toEqual(["optionSelect"]);
  });
});

describe("describeKey — 표시명 표기 (기능/조립산출 §3.4 · 리뷰 #24)", () => {
  it("그래프를 주면 조를 「문서 › 제N조(조 명)」 으로 부른다", () => {
    const g = surgeryGraph();
    const key = { kind: "article", documentId: "doc-s", articleId: "s-art-lapse" } as const;
    expect(describeKey(key, g)).toBe(`${fx.special.title} › 제4조(특별약관의 소멸)`);
    expect(describeKey(key)).toBe("조 s-art-lapse (문서 doc-s)");
  });

  it("코드로 부르는 실체는 「표시명(코드)」, 마스터 필드는 레벨·그룹까지 이어 부른다", () => {
    const g = surgeryGraph();
    expect(describeKey({ kind: "clause", code: "C001" }, g)).toBe("특별약관의 소멸(C001)");
    expect(describeKey({ kind: "discriminator", code: "D0003" }, g)).toBe("지급률(D0003)");
    expect(describeKey({ kind: "masterField", path: "pay.exempt" }, g)).toBe("급부 · 보험금지급 › 면책여부");
  });

  it("담보 노드는 담보 › 세부보장 › 급부 로 이어 부른다", () => {
    const g = surgeryGraph();
    expect(describeKey({ kind: "coverageNode", level: "benefit", id: "ben-1" }, g)).toBe("수술비 › 1종수술 › 수술보험금");
  });

  it("선언되지 않은 대상(깨진 참조)은 상위 이름 아래 「…(없음)」으로, 상위도 없으면 id 표기로 돌아간다", () => {
    const g = surgeryGraph();
    expect(describeKey({ kind: "clause", code: "C999" }, g)).toBe("함수조항 C999");
    expect(describeKey({ kind: "article", documentId: "doc-g", articleId: "g-gone" }, g)).toBe(`${fx.general.title} › 조 g-gone(없음)`);
  });
});

describe("refStats — 문제 개수에 붙일 분모 (§9.6)", () => {
  it("고아 분모는 고아가 될 수 있는 종류(구분자·함수조항·별표)만 센다", () => {
    const g = surgeryGraph();
    const s = refStats(g);
    expect(s.edges).toBe(g.edges.length);
    expect(s.nodes).toBe(g.nodes.size);
    expect(s.orphanCandidates).toBe([...g.nodes.values()].filter((n) => ["discriminator", "clause", "appendix"].includes(n.key.kind)).length);
    expect(orphans(g).length).toBeLessThanOrEqual(s.orphanCandidates);
  });
});

// ───────────────────────────── 다단 사용처 (ADR-0049 §2 · 기능/구분자 §4.4) ─────────────────────────────

/**
 * 체인 픽스처 — D1 ← D2 ← D3 (D2 가 D1 을, D3 가 D2 를 읽는다) · D8 은 D1 을 직접 읽는다.
 *   - doc-g(보통약관) 조 g1 조건식 `D1` — 직접 사용처.
 *   - doc-s(담보약관 · cov-1 소유 · 보통약관 doc-g) 조 s1 조건식 `D3` — D2 → D3 를 거친 사용처.
 *   - 공용조항 C001 본문 조건식 `D3` · doc-s2(담보약관 · cov-2 소유) 조 s2 가 C001 을 참조.
 *   - 상품 p1 이 cov-1 탑재 · p2 는 보통약관 doc-g 만 · p3 가 cov-2 탑재.
 */
function chainDocument(id: string, title: string, article: { id: string; when?: string; clause?: string }): DocumentInput["tree"] {
  const children = article.when
    ? [{ id: `${article.id}-cb`, kind: "condBlock" as const, branches: [{ id: `${article.id}-br`, when: article.when, children: [{ id: `${article.id}-p`, kind: "paragraph" as const, children: [] }] }] }]
    : [{ id: `${article.id}-cr`, kind: "clauseBlockRef" as const, clauseCode: article.clause!, options: {} }];
  return { id: `${id}-root`, kind: "document", title, children: [{ id: article.id, kind: "article", title: `${article.id} 조`, children }] };
}

function chainGraph(opts: { brokenMount?: boolean } = {}) {
  const chain: Discriminator[] = [
    D("D1", "갱신여부"),
    { code: "D2", label: "갱신참", description: "", level: "coverage", expression: "D1 = true" },
    { code: "D3", label: "갱신거짓", description: "", level: "coverage", expression: "not D2" },
    { code: "D8", label: "직접참조", description: "", level: "coverage", expression: "D1 and D1" },
  ];
  return buildGraph({
    discriminators: chain,
    master,
    clauses: [clause("C001", "공용 조건", [{ id: "c-cb", kind: "condBlock", branches: [{ id: "c-br", when: "D3", children: [] }] }])],
    documents: [
      { id: "doc-g", kind: "general", title: "보통약관", tree: chainDocument("doc-g", "보통약관", { id: "g1", when: "D1" }) },
      { id: "doc-s", kind: "special", ownerId: "cov-1", title: "담보약관 1", generalDocumentId: "doc-g", tree: chainDocument("doc-s", "담보약관 1", { id: "s1", when: "D3" }) },
      { id: "doc-s2", kind: "special", ownerId: "cov-2", title: "담보약관 2", tree: chainDocument("doc-s2", "담보약관 2", { id: "s2", clause: "C001" }) },
    ],
    coverages: [
      { id: "cov-1", name: "담보 1", description: "", documentId: "doc-s", subCoverages: [] },
      { id: "cov-2", name: "담보 2", description: "", documentId: "doc-s2", subCoverages: [] },
    ],
    products: [
      { id: "p1", name: "상품 1", coverages: [{ id: "pc1", productId: "p1", coverageId: opts.brokenMount ? "cov-gone" : "cov-1", name: "상품담보 1", attributes: [] }], overrides: [] },
      { id: "p2", name: "상품 2", generalDocumentId: "doc-g", coverages: [], overrides: [] },
      { id: "p3", name: "상품 3", coverages: [{ id: "pc3", productId: "p3", coverageId: "cov-2", name: "상품담보 3", attributes: [] }], overrides: [] },
    ],
  });
}

describe("dependentDiscriminators — 이 구분자를 (전이적으로) 읽는 구분자 (기능/구분자 §4.4)", () => {
  it("expression 간선을 거꾸로 따라 모은다 — path 는 [직접 참조자, …, 최종] · 등장 순 · 중복 없음", () => {
    const g = chainGraph();
    expect(dependentDiscriminators(g, "D1")).toEqual([
      { code: "D2", path: ["D2"] },
      { code: "D8", path: ["D8"] }, // D8 은 D1 을 두 번 읽지만 한 번
      { code: "D3", path: ["D2", "D3"] },
    ]);
    expect(dependentDiscriminators(g, "D3")).toEqual([]);
  });

  it("순환(D1 ↔ D2)은 방문 집합으로 끊는다", () => {
    const g = buildGraph({
      discriminators: [
        { code: "D0010", label: "a", description: "", level: "coverage", expression: "D0011 = true" },
        { code: "D0011", label: "b", description: "", level: "coverage", expression: "D0010 = true" },
      ],
    });
    expect(dependentDiscriminators(g, "D0010")).toEqual([{ code: "D0011", path: ["D0011"] }]);
  });
});

describe("transitiveUsages — 이 구분자와 의존 구분자들의 문면 사용처 (ADR-0049 §2)", () => {
  it("직접 사용처는 via [] · 거쳐 온 사용처는 구분자 체인 · 같은 간선은 한 번", () => {
    const g = chainGraph();
    const u = transitiveUsages(g, "D1");
    expect(u.map((x) => [nodeKey(x.edge.from), x.edge.at.refPath, x.via])).toEqual([
      ["article:doc-g/g1", "D1", []],
      ["clause:C001", "D3", ["D2", "D3"]],
      ["article:doc-s/s1", "D3", ["D2", "D3"]],
    ]);
    // 자기 사용처만 있는 구분자 — usagesOf(when·slot) 와 같다
    expect(transitiveUsages(g, "D3").map((x) => x.edge)).toEqual(usagesOf(g, { kind: "discriminator", code: "D3" }, { via: ["when", "slot"] }));
    expect(transitiveUsages(g, "D3").every((x) => x.via.length === 0)).toBe(true);
  });
});

describe("affectedProducts — 사용처 문면이 들어가는 상품 (ADR-0049 §3 「영향 받는 상품 m건」)", () => {
  it("담보약관 경로 · 보통약관 직접 · 함수조항 경유 각 1건 — 상품별로 한 번, 대표 경로 하나", () => {
    const g = chainGraph();
    const a = affectedProducts(g, "D1");
    expect(a.map((x) => [nodeKey(x.product), x.productName])).toEqual([
      ["product:p1", "상품 1"], // doc-g ← doc-s(generalDocument) ← cov-1 ← pc1 ← p1 · doc-s 직접 사용처로도 닿지만 한 번
      ["product:p2", "상품 2"], // doc-g ← p2(generalDocument)
      ["product:p3", "상품 3"], // C001 ← doc-s2(clauseRef) ← cov-2 ← pc3 ← p3
    ]);
    expect(a[1].through.map(nodeKey)).toEqual(["article:doc-g/g1", "document:doc-g"]);
    expect(a[2].through.map(nodeKey)).toEqual(["clause:C001", "article:doc-s2/s2", "document:doc-s2", "coverageNode:coverage/cov-2", "productCoverage:pc3"]);
    // D3 만 보면 보통약관 직접 사용처가 없어 p2 는 빠진다 — 공용조항 간선이 문서 간선보다 먼저라 p3 가 앞
    expect(affectedProducts(g, "D3").map((x) => nodeKey(x.product))).toEqual(["product:p3", "product:p1"]);
  });

  it("그래프에 없는 노드(깨진 간선)는 건너뛴다 — 없는 담보를 탑재한 상품담보는 상품에 닿지 않는다", () => {
    const g = chainGraph({ brokenMount: true });
    expect(affectedProducts(g, "D3").map((x) => nodeKey(x.product))).toEqual(["product:p3"]);
  });

  it("구분자 키를 줘도 코드를 준 것과 같다", () => {
    const g = chainGraph();
    expect(affectedProducts(g, { kind: "discriminator", code: "D1" })).toEqual(affectedProducts(g, "D1"));
  });

  describe("함수조항 → 사용처 문서 → 상품 (기능/함수조항 §3.4 검사 ③ 「영향 받는 상품」 · ADR-0049 §3)", () => {
    it("함수조항 → 담보약관 → 담보 → 상품담보 → 상품 · through 는 사용처 조부터", () => {
      const g = chainGraph();
      const a = affectedProducts(g, { kind: "clause", code: "C001" });
      expect(a.map((x) => [nodeKey(x.product), x.productName])).toEqual([["product:p3", "상품 3"]]);
      expect(a[0].through.map(nodeKey)).toEqual(["article:doc-s2/s2", "document:doc-s2", "coverageNode:coverage/cov-2", "productCoverage:pc3"]);
    });

    it("함수조항 → 보통약관 → 상품(직접) · 보통약관 → 담보약관 → 상품 — 상품별 한 번", () => {
      const g = buildGraph({
        clauses: [clause("C002", "공용 문구", [{ id: "c2-p", kind: "paragraph", children: [{ id: "c2-t", kind: "text", text: "문구" }] }])],
        documents: [
          { id: "doc-g", kind: "general", title: "보통약관", tree: chainDocument("doc-g", "보통약관", { id: "g1", clause: "C002" }) },
          { id: "doc-s", kind: "special", ownerId: "cov-1", title: "담보약관 1", generalDocumentId: "doc-g", tree: chainDocument("doc-s", "담보약관 1", { id: "s1", when: "true" }) },
        ],
        coverages: [{ id: "cov-1", name: "담보 1", description: "", documentId: "doc-s", subCoverages: [] }],
        products: [
          { id: "p1", name: "상품 1", coverages: [{ id: "pc1", productId: "p1", coverageId: "cov-1", name: "상품담보 1", attributes: [] }], overrides: [] },
          { id: "p2", name: "상품 2", generalDocumentId: "doc-g", coverages: [], overrides: [] },
        ],
      });
      const a = affectedProducts(g, { kind: "clause", code: "C002" });
      expect(a.map((x) => nodeKey(x.product))).toEqual(["product:p1", "product:p2"]);
      expect(a[0].through.map(nodeKey)).toEqual(["article:doc-g/g1", "document:doc-g", "document:doc-s", "coverageNode:coverage/cov-1", "productCoverage:pc1"]);
      expect(a[1].through.map(nodeKey)).toEqual(["article:doc-g/g1", "document:doc-g"]);
    });

    it("아무 문서도 참조하지 않는 함수조항 · 선언되지 않은 함수조항은 빈 목록", () => {
      const g = chainGraph();
      expect(affectedProducts(g, { kind: "clause", code: "C999" })).toEqual([]);
    });
  });
});

describe("enumValueListers — 열거값 추가의 재검사 목록 (ADR-0078 결정 4)", () => {
  const enumMaster: MasterForm[] = [
    { key: "product_basic", label: "상품 기본", level: "product", fields: [{ key: "notice", label: "고지유형", type: { kind: "enum", enumCode: "E0001" } }] },
    { key: "no_surrender", label: "무저해지", level: "plan", fields: [{ key: "type", label: "유형", type: { kind: "enum", enumCode: "E0002" } }] },
  ];
  const enums: EnumDef[] = [
    { code: "E0001", label: "고지유형", values: [{ code: "V01", label: "일반심사", order: 0 }, { code: "V02", label: "간편심사", order: 1 }] },
    { code: "E0002", label: "무저해지유형", values: [{ code: "V01", label: "지급형", order: 0 }, { code: "V02", label: "무저해지형", order: 1 }] },
  ];
  const 고지유형: Discriminator = { code: "D0002", label: "고지유형", description: "", level: "product", expression: "product_basic.notice" };
  const 간편여부: Discriminator = { code: "D0010", label: "간편여부", description: "", level: "product", expression: "product_basic.notice = 'V02'" };
  const 무저해지: Discriminator = { code: "D0009", label: "무저해지형", description: "", level: "plan", expression: "no_surrender.type = 'V02'" };

  function graph() {
    return buildGraph({
      discriminators: [고지유형, 간편여부, 무저해지],
      enums,
      documents: [
        {
          id: "d",
          kind: "general",
          title: "g",
          tree: {
            id: "root",
            kind: "document",
            title: "g",
            children: [
              { id: "cb", kind: "condBlock", branches: [{ id: "b1", when: "D0002 = 'V01'", children: [] }, { id: "b2", when: "any(D0009)", children: [] }] },
            ],
          },
        },
      ],
      master: enumMaster,
    });
  }

  it("그 열거형 값 코드와 비교하는 조건식 · 구분자 식 간선만 — 다른 열거형 · 값을 비교하지 않는 참조는 뺀다", () => {
    const edges = enumValueListers(graph(), "E0001");
    expect(edges.map((e) => [e.via, nodeKey(e.from), nodeKey(e.to)])).toEqual([
      ["expression", "discriminator:D0010", "enumValue:E0001/V02"],
      ["when", "document:d", "enumValue:E0001/V01"],
    ]);
    expect(enumValueListers(graph(), "E0002").map((e) => nodeKey(e.from))).toEqual(["discriminator:D0009"]);
  });

  it("같은 자리가 값을 여럿 비교해도 좌표 하나로 모은다", () => {
    const g = buildGraph({
      discriminators: [고지유형],
      enums,
      documents: [{ id: "d", kind: "general", title: "g", tree: { id: "root", kind: "document", title: "g", children: [{ id: "cb", kind: "condBlock", branches: [{ id: "b1", when: "D0002 = 'V01' or D0002 = 'V02'", children: [] }] }] } }],
      master: enumMaster,
    });
    expect(enumValueListers(g, "E0001")).toHaveLength(1);
  });
});

describe("함수조항 인자 · 내부 변수의 열거값 읽기 — 값 나열 · 필드 읽기 간선 (ADR-0078 결정 2 · 4 · 최종 결정 20)", () => {
  const waiverMaster: MasterForm[] = [{ key: "waiver", label: "납입면제", level: "plan", fields: [{ key: "reasons", label: "사유", type: { kind: "list<enum>", enumCode: "E0001" } }] }];
  const 사유: EnumDef = {
    code: "E0001",
    label: "납입면제사유",
    fields: [{ key: "F01", label: "약관표시명", type: "string", order: 1 }],
    values: [{ code: "V01", label: "암", order: 0 }, { code: "V02", label: "뇌졸중", order: 1 }],
  };
  const 부가항: Clause = {
    code: "C0001",
    label: "면제 부가항",
    mode: "block",
    options: [],
    params: [
      { name: "종들", type: { kind: "planOptions", form: "waiver" } },
      { name: "사유", type: { kind: "enum", enumCode: "E0001" } },
    ],
    locals: [
      { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
      { name: "암있음", expr: "var.모든사유.있음('V01')" },
      { name: "표시명있음", expr: "var.모든사유.거르기(F02 = true).비었음" },
    ],
    body: [
      {
        id: "p",
        kind: "paragraph",
        children: [
          { id: "c", kind: "inlineCond", branches: [{ id: "b1", when: "arg.사유 = 'V02'", children: [] }] },
          { id: "s", kind: "slot", ref: "arg.사유.F01" },
        ],
      },
    ],
    required: { discriminators: [], attributes: [] },
  } as Clause;
  const graph = () => buildGraph({ enums: [사유], clauses: [부가항], master: waiverMaster });

  it("있음(값…) 으로 나열한 내부 변수 · 인자 = 값 비교가 열거값 추가 재검사 목록에 오른다", () => {
    expect(enumValueListers(graph(), "E0001").map((e) => [e.via, nodeKey(e.to), e.at.refPath ?? e.at.nodePath?.join("/")])).toEqual([
      ["local", "enumValue:E0001/V01", "var.암있음"],
      ["when", "enumValue:E0001/V02", "p/c/b1"],
    ]);
  });

  it("필드 읽기(.필드 · 거르기) → enumField 간선 — 지운 필드(F02)를 읽는 곳은 깨진 참조로 남는다", () => {
    const g = graph();
    expect(usagesOf(g, { kind: "enumField", enumCode: "E0001", key: "F01" }).map((e) => e.via)).toEqual(["slot"]);
    expect(usagesOf(g, { kind: "enumField", enumCode: "E0001", key: "F02" }).map((e) => [e.via, e.at.refPath])).toEqual([["local", "var.표시명있음"]]);
    expect(brokenEdges(g).some((e) => nodeKey(e.to) === "enumField:E0001/F02")).toBe(true);
  });

  it("내부 변수의 합치기(폼.필드)는 그 마스터 필드를 읽는 간선이다", () => {
    expect(usagesOf(graph(), { kind: "masterField", path: "waiver.reasons" }).map((e) => [e.via, nodeKey(e.from)])).toEqual([["local", "clause:C0001"]]);
  });
});

describe("값별 분기(switch) 칸의 값 — switchCase 간선 (최종 결정 5 · 20 · 21)", () => {
  const 사유: EnumDef = { code: "E0001", label: "납입면제사유", values: [{ code: "V01", label: "암", order: 0 }, { code: "V02", label: "뇌졸중", order: 1 }] };
  const 면제호: Clause = {
    code: "C0001",
    label: "납입면제 호",
    mode: "item",
    options: [],
    params: [{ name: "사유", type: { kind: "enum", enumCode: "E0001" } }],
    body: [
      {
        id: "sw",
        kind: "switchBlock",
        on: "arg.사유",
        cases: [
          { id: "k1", values: ["V01"], children: [{ id: "i1", kind: "item", children: [] }] },
          { id: "k2", values: ["V02", "V09"], empty: true, children: [] },
        ],
      },
    ],
    required: { discriminators: [], attributes: [] },
  } as Clause;
  const graph = () => buildGraph({ enums: [사유], clauses: [면제호] });

  it("분기 하나가 열거값 추가 재검사 목록에 한 번 선다 — 새 값은 그 분기에서 미배정이다", () => {
    expect(enumValueListers(graph(), "E0001").map((e) => [e.via, nodeKey(e.from), e.at.nodePath?.join("/"), e.at.refPath])).toEqual([["switchCase", "clause:C0001", "sw", "arg.사유"]]);
  });

  it("칸에 남은 지운 값(V09)은 깨진 참조 — 값 삭제 영향 · 「없는 값」 의 재료", () => {
    const g = graph();
    expect(usagesOf(g, { kind: "enumValue", enumCode: "E0001", valueCode: "V02" }).map((e) => e.via)).toEqual(["switchCase"]);
    expect(brokenEdges(g).some((e) => nodeKey(e.to) === "enumValue:E0001/V09")).toBe(true);
  });
});
