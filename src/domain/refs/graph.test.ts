import { describe, expect, it } from "vitest";

import type { Discriminator, EnumDef } from "../catalog";
import type { Clause } from "../clause";
import type { Coverage } from "../coverage";
import { surgeryFixture } from "../document";
import type { MasterForm } from "../master";
import type { AttributeKind } from "../product";
import { buildGraph, nodeKey, type DocumentInput, type ProductInput } from "./graph";
import { brokenEdges } from "./queries";

// ───────── 픽스처 — 관통 1 축약 (공통/기술/아키텍처 「시드와 초기 데이터」) ─────────

/** 픽스처 마스터 — 상품 기본{고지유형(enum)} · 담보 기본{갱신여부} · 급부 보험금지급{면책여부 · 지급률}. 경로는 `폼키.필드키`. */
const master: MasterForm[] = [
  { key: "product_basic", label: "상품 기본", level: "product", fields: [{ key: "notice", label: "고지유형", type: { kind: "enum", enumCode: "E0001" } }] },
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

const 갱신여부: Discriminator = { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage_basic.renewal" };
const 고지유형: Discriminator = { code: "D0002", label: "고지유형", description: "", level: "product", expression: "product_basic.notice" };
const 지급률: Discriminator = { code: "D0003", label: "지급률", description: "", level: "benefit", expression: "pay.rate" };
const 평균공시이율: Discriminator = { code: "D0004", label: "평균공시이율", description: "", level: "product", expression: "'2.5%'" };
const 면책여부합: Discriminator = { code: "D0005", label: "면책여부합", description: "", level: "coverage", expression: "any(pay.exempt)" };
const 고지유형enum: EnumDef = { code: "E0001", label: "고지유형", values: [{ code: "V01", label: "일반심사", order: 0 }, { code: "V02", label: "간편심사", order: 1 }] };

const 소멸: Clause = {
  code: "C001",
  label: "특별약관의 소멸",
  mode: "block",
  body: [{ id: "c1-p1", kind: "paragraph", children: [{ id: "c1-t1", kind: "text", text: "소멸합니다. " }, { id: "c1-opt", kind: "optionSlot", optionCode: "O01" }] }],
  options: [{ code: "O01", label: "어조", order: 0, values: [{ code: "death", label: "사망", body: [{ id: "c1-v1", kind: "text", text: "사망 시" }], order: 0 }, { code: "lapse", label: "해지", body: [], order: 1 }] }],
  required: { discriminators: [], attributes: [] },
};
const 준용: Clause = {
  code: "C002",
  label: "준용규정",
  mode: "inline",
  body: [
    { id: "c2-cond", kind: "inlineCond", branches: [{ id: "c2-b1", when: "D0001 = true and attr.A0001 = '1'", children: [{ id: "c2-t1", kind: "text", text: "갱신형" }] }] },
    { id: "c2-apx", kind: "appendixRef", appendixCode: "APX_BURN" },
  ],
  options: [],
  required: { discriminators: ["D0001"], attributes: ["A0001"] },
};

const 갱신유형: AttributeKind = { code: "A0001", label: "갱신유형", order: 0, values: [{ code: "1", label: "갱신형", fragment: "" }, { code: "2", label: "비갱신형", fragment: "" }] };

const fx = surgeryFixture();
const 수술비: Coverage = { id: fx.coverageId, name: "수술비", description: "", documentId: "doc-s", subCoverages: [{ id: "sub-1", name: "1종수술", order: 0, benefits: [{ id: "ben-1", name: "수술보험금", order: 0 }] }] };
const 담보약관: DocumentInput = { id: "doc-s", kind: "special", ownerId: fx.coverageId, title: fx.special.title, generalDocumentId: "doc-g", tree: fx.special };
const 보통약관: DocumentInput = { id: "doc-g", kind: "general", title: fx.general.title, tree: fx.general };
const 상품: ProductInput = {
  id: "prod-1",
  name: "알파Plus",
  generalDocumentId: "doc-g",
  coverages: [{ id: "pc-1", productId: "prod-1", coverageId: fx.coverageId, name: "갱신형 수술비", attributes: [{ kindCode: "A0001", valueCode: "1" }] }],
  overrides: [{ id: "ov-1", scope: { kind: "product", id: "prod-1" }, nodeId: "s-clause-lapse", clauseCode: "C001", options: { O01: "lapse" } }],
};

function full() {
  return buildGraph({
    discriminators: [갱신여부, 고지유형, 지급률, 평균공시이율, 면책여부합],
    enums: [고지유형enum],
    clauses: [소멸, 준용],
    documents: [담보약관, 보통약관],
    appendices: fx.appendices,
    coverages: [수술비],
    attributeKinds: [갱신유형],
    products: [상품],
    master,
  });
}

const edgesTo = (g: ReturnType<typeof buildGraph>, key: string) => g.edges.filter((e) => nodeKey(e.to) === key);

describe("refs 그래프 — buildGraph (기능/관계정보 §3 「참조 그래프」)", () => {
  it("노드 = 실체: 구분자·마스터 필드·enum·enum 값·공용조항·옵션·문서·조·별표·담보 노드·담보속성·상품·상품담보", () => {
    const g = full();
    for (const k of [
      "discriminator:D0001",
      "masterField:pay.exempt",
      "enum:E0001",
      "enumValue:E0001/V02",
      "clause:C001",
      "clauseOption:C001/O01",
      "clauseOptionValue:C001/O01/death",
      "document:doc-s",
      "article:doc-s/s-art-pay",
      "article:doc-s/s-art-term", // 조 자리 조건 블록 안의 조도 노드다
      "appendix:APX_BURN",
      "coverageNode:coverage/cov-surgery",
      "coverageNode:benefit/ben-1",
      "attribute:A0001",
      "attributeValue:A0001/1",
      "product:prod-1",
      "productCoverage:pc-1",
    ]) {
      expect(g.nodes.has(k), k).toBe(true);
    }
    expect(g.nodes.get("masterField:pay.exempt")).toMatchObject({ label: "급부 · 보험금지급 › 면책여부", level: "benefit", detail: "boolean" });
    expect(g.nodes.get("coverageNode:benefit/ben-1")?.parent).toEqual({ kind: "coverageNode", level: "subCoverage", id: "sub-1" });
  });

  it("문서 노드 → 구분자 간선에 좌표(문서·소유자·조·노드 경로·refPath)가 실린다", () => {
    const g = full();
    const es = edgesTo(g, "discriminator:D0001");
    const when = es.find((e) => e.via === "when" && e.at.articleId === "s-art-pay");
    expect(when).toBeDefined();
    expect(when!.from).toEqual({ kind: "article", documentId: "doc-s", articleId: "s-art-pay" });
    expect(when!.at).toMatchObject({ document: "special", ownerId: "cov-surgery", ownerName: "수술비 특별약관", articleTitle: "보험금의 지급사유", refPath: "D0001" });
    expect(when!.at.nodePath).toContain("s-inl-renew-if");
    // 조 밖(조 자리 조건 블록 가지)의 조건식은 문서 노드에서 나간다
    const outside = es.find((e) => e.at.nodePath?.includes("s-cond-term-if"));
    expect(outside!.from).toEqual({ kind: "document", id: "doc-s" });
    // 슬롯 → const · 구조체 필드
    expect(edgesTo(g, "discriminator:D0004").map((e) => e.via)).toEqual(["slot"]);
    expect(edgesTo(g, "discriminator:D0003")[0]).toMatchObject({ via: "slot", at: { articleId: "s-art-exempt" } });
  });

  it("문서 → 공용조항 참조 + 옵션 선택, 조 참조(self·general), 조연결, 별표, 대응 보통약관", () => {
    const g = full();
    expect(edgesTo(g, "clause:C001")[0]).toMatchObject({ via: "clauseRef", options: { tone: "death" }, at: { articleId: "s-art-lapse", nodePath: ["s-doc", "s-art-lapse", "s-clause-lapse"] } });
    // 옵션 선택 — 정의에 없는 옵션 tone 은 깨진 대상이 된다 (재검사 목록 재료)
    expect(edgesTo(g, "clauseOptionValue:C001/tone/death")[0]?.via).toBe("optionSelect");
    expect(edgesTo(g, "clause:C002")[0]?.via).toBe("clauseRef");
    expect(edgesTo(g, "article:doc-s/s-art-pay")[0]).toMatchObject({ via: "articleRef", from: { kind: "article", documentId: "doc-s", articleId: "s-art-apply" } });
    const toGeneralPay = edgesTo(g, "article:doc-g/g-art-pay");
    expect(toGeneralPay.map((e) => e.via)).toEqual(["articleRef"]);
    expect(edgesTo(g, "article:doc-g/g-art-apply")).toEqual([expect.objectContaining({ via: "link", from: { kind: "article", documentId: "doc-s", articleId: "s-art-apply" } })]);
    expect(edgesTo(g, "appendix:APX_BURN").map((e) => e.from.kind).sort()).toEqual(["article", "clause"]);
    expect(edgesTo(g, "appendix:APX_DISABILITY")[0]?.at).toMatchObject({ document: "general", ownerId: "doc-g" });
    expect(edgesTo(g, "document:doc-g").map((e) => [e.from.kind, e.via])).toEqual([
      ["document", "generalDocument"],
      ["product", "generalDocument"],
    ]);
  });

  it("구분자 식 → 마스터 필드(집계 표시) · 공용조항 본문 → 구분자·담보속성(리터럴 유효값까지) · enum 타입 간선", () => {
    const g = full();
    const derived = edgesTo(g, "masterField:pay.exempt").find((e) => e.via === "expression");
    expect(derived).toMatchObject({ from: { kind: "discriminator", code: "D0005" }, aggregate: "any", at: { refPath: "pay.exempt", ownerName: "면책여부합" } });
    const clauseWhen = edgesTo(g, "discriminator:D0001").find((e) => e.from.kind === "clause");
    expect(clauseWhen).toMatchObject({ via: "when", at: { document: "clause", ownerId: "C002", ownerName: "준용규정", nodePath: ["c2-cond", "c2-b1"], refPath: "D0001" } });
    expect(edgesTo(g, "attribute:A0001")[0]?.from).toEqual({ kind: "clause", code: "C002" });
    expect(edgesTo(g, "attributeValue:A0001/1").map((e) => e.via).sort()).toEqual(["combination", "when"]);
    expect(edgesTo(g, "enum:E0001")).toEqual([
      expect.objectContaining({ from: { kind: "masterField", path: "product_basic.notice" }, via: "type", at: { refPath: "product_basic.notice", ownerName: "상품 · 상품 기본 › 고지유형" } }),
    ]);
  });

  it("담보 문서 연결, 상품담보 탑재·조합·옵션 오버라이드(기능/공용조항 §3.2 — 문서 노드를 매개로)", () => {
    const g = full();
    expect(edgesTo(g, "document:doc-s").map((e) => e.via)).toEqual(["document"]);
    expect(edgesTo(g, "coverageNode:coverage/cov-surgery")[0]).toMatchObject({ via: "mount", from: { kind: "productCoverage", id: "pc-1" }, at: { document: "special", ownerId: "pc-1", ownerName: "갱신형 수술비" } });
    const ov = edgesTo(g, "clauseOptionValue:C001/O01/lapse")[0];
    expect(ov).toMatchObject({ via: "override", from: { kind: "product", id: "prod-1" }, through: { kind: "article", documentId: "doc-s", articleId: "s-art-lapse" }, at: { document: "product", ownerId: "prod-1", ownerName: "알파Plus", nodePath: ["s-clause-lapse"], refPath: "C001.O01" } });
  });

  it("enum 타입 자리와 문자열 리터럴을 비교하는 식은 enum 값 간선을 낸다 (enum 값 삭제 영향 재료)", () => {
    const g = buildGraph({
      discriminators: [고지유형],
      enums: [고지유형enum],
      documents: [{ id: "d", kind: "general", title: "g", tree: { id: "root", kind: "document", title: "g", children: [{ id: "cb", kind: "condBlock", branches: [{ id: "br", when: "D0002 = 'V02'", children: [] }] }] } }],
      master,
    });
    expect(edgesTo(g, "enumValue:E0001/V02")).toEqual([expect.objectContaining({ via: "when", from: { kind: "document", id: "d" }, at: expect.objectContaining({ nodePath: ["root", "cb", "br"], refPath: "D0002" }) })]);
  });

  it("문법이 깨진 식은 간선을 내지 않는다 · 입력이 없는 종류는 노드도 간선도 없다", () => {
    const g = buildGraph({
      discriminators: [{ code: "D0009", label: "x", description: "", level: "coverage", expression: "D0001 = = true" }],
      master: [],
    });
    expect(g.edges).toEqual([]);
    expect(g.nodes.size).toBe(1);
  });
});

describe("refs 그래프 — 구분자 참조의 노드 한정자 `@노드` (ADR-0066)", () => {
  /** 급부 ben-1 을 가리키는 한정자 — 문서 조건식 · 공용조항 본문 · 구분자 식 세 자리. */
  const 담보약관_한정자: DocumentInput = {
    id: "doc-q",
    kind: "special",
    ownerId: fx.coverageId,
    title: "한정자 문서",
    tree: {
      id: "q-doc",
      kind: "document",
      title: "한정자 문서",
      children: [
        {
          id: "q-art",
          kind: "article",
          title: "지급",
          children: [{ id: "q-par", kind: "paragraph", children: [{ id: "q-cond", kind: "inlineCond", branches: [{ id: "q-if", when: "D0003@ben-1 > 0", children: [{ id: "q-t", kind: "text", text: "지급" }] }] }] }],
        },
      ],
    },
  };
  const 공용_한정자: Clause = {
    code: "C009",
    label: "한정자 문구",
    mode: "inline",
    body: [{ id: "c9-cond", kind: "inlineCond", branches: [{ id: "c9-b1", when: "D0003@ben-1 > 0", children: [{ id: "c9-t", kind: "text", text: "지급" }] }] }],
    options: [],
    required: { discriminators: ["D0003"], attributes: [] },
  };
  const 파생_한정자: Discriminator = { code: "D0010", label: "1종 지급률", description: "", level: "coverage", expression: "D0003@ben-1" };

  const withQualifiers = (coverages: Coverage[] = [수술비]) =>
    buildGraph({ discriminators: [지급률, 파생_한정자], clauses: [공용_한정자], documents: [담보약관_한정자], coverages, master });

  it("문서 조건식 · 공용조항 본문 · 구분자 식의 `D@노드` 는 구분자 간선에 더해 담보 노드로 가는 nodeQualifier 간선을 낸다", () => {
    const g = withQualifiers();
    const es = edgesTo(g, "coverageNode:benefit/ben-1").filter((e) => e.via === "nodeQualifier");
    expect(es.map((e) => nodeKey(e.from)).sort()).toEqual(["article:doc-q/q-art", "clause:C009", "discriminator:D0010"].sort());
    for (const e of es) expect(e.at.refPath).toBe("D0003@ben-1");
    // 구분자 간선은 그대로
    expect(edgesTo(g, "discriminator:D0003").map((e) => nodeKey(e.from)).sort()).toEqual(["article:doc-q/q-art", "clause:C009", "discriminator:D0010"].sort());
  });

  it("문서 한정자 간선의 좌표는 조건식 자리 그대로다 (문서·조·가지 경로)", () => {
    const g = withQualifiers();
    const e = edgesTo(g, "coverageNode:benefit/ben-1").find((x) => x.via === "nodeQualifier" && x.from.kind === "article")!;
    expect(e.at).toMatchObject({ document: "special", ownerId: fx.coverageId, articleId: "q-art", refPath: "D0003@ben-1" });
    expect(e.at.nodePath).toContain("q-if");
  });

  it("가리킨 노드가 사라지면 구분자 레벨로 키를 만들어 깨진 간선으로 남는다", () => {
    const 급부없음: Coverage = { ...수술비, subCoverages: [{ id: "sub-1", name: "1종수술", order: 0, benefits: [] }] };
    const g = withQualifiers([급부없음]);
    const es = edgesTo(g, "coverageNode:benefit/ben-1").filter((e) => e.via === "nodeQualifier");
    expect(es).toHaveLength(3);
    expect(g.nodes.has("coverageNode:benefit/ben-1")).toBe(false);
  });

  it("노드도 구분자도 모르면 한정자 간선을 내지 않는다 (구분자 간선이 이미 깨져서 드러난다)", () => {
    const g = buildGraph({ documents: [담보약관_한정자], master });
    expect(g.edges.filter((e) => e.via === "nodeQualifier")).toEqual([]);
    expect(edgesTo(g, "discriminator:D0003")).toHaveLength(1);
  });
});

describe("refs 그래프 — 조 참조(articleRef)를 속한 조로 잇는다", () => {
  /** 보통약관 조 g-art-pay 를 가리키는 인라인 공용조항. */
  const 공용_조참조: Clause = {
    code: "C010",
    label: "조 참조 문구",
    mode: "inline",
    body: [{ id: "c10-aref", kind: "articleRef", targets: [{ nodeId: "g-art-pay" }], connector: "및" }],
    options: [],
    required: { discriminators: [], attributes: [] },
  };
  /** 보통약관 조 g-art-pay **안의 항** g-par-pay-1 을 가리키는 인라인 공용조항 — 속한 조로 올라가야 한다. */
  const 공용_항참조: Clause = {
    code: "C011",
    label: "항 참조 문구",
    mode: "inline",
    body: [{ id: "c11-aref", kind: "articleRef", targets: [{ nodeId: "g-par-pay-1" }], connector: "및" }],
    options: [],
    required: { discriminators: [], attributes: [] },
  };
  /** 어디에도 없는 id 를 가리키는 인라인 공용조항 — 깨진 간선. */
  const 공용_깨진참조: Clause = {
    code: "C012",
    label: "깨진 참조 문구",
    mode: "inline",
    body: [{ id: "c12-aref", kind: "articleRef", targets: [{ nodeId: "no-such-node" }], connector: "및" }],
    options: [],
    required: { discriminators: [], attributes: [] },
  };

  it("공용조항 → 보통약관 조: articleRef 대상이 조 자신이면 그 조로 간선이 난다", () => {
    const g = buildGraph({ clauses: [공용_조참조], documents: [보통약관] });
    const es = edgesTo(g, "article:doc-g/g-art-pay");
    expect(es).toEqual([expect.objectContaining({ via: "articleRef", from: { kind: "clause", code: "C010" }, at: expect.objectContaining({ refPath: "g-art-pay" }) })]);
  });

  it("항 대상은 속한 조로 올린다 (공용조항) — 깨진 간선이 아니다", () => {
    const g = buildGraph({ clauses: [공용_항참조], documents: [보통약관] });
    const es = edgesTo(g, "article:doc-g/g-art-pay");
    const e = es.find((x) => x.from.kind === "clause");
    expect(e).toMatchObject({ via: "articleRef", from: { kind: "clause", code: "C011" }, at: { refPath: "g-par-pay-1" } });
    expect(g.nodes.has("article:doc-g/g-art-pay")).toBe(true); // 깨진 간선이 아니다 — 대상 조가 선언돼 있다
  });

  it("없는 대상은 깨진 간선으로 남는다 (documentId 없음, 문서 쪽 generalOf 와 같은 모양)", () => {
    const g = buildGraph({ clauses: [공용_깨진참조], documents: [보통약관] });
    const es = edgesTo(g, "article:/no-such-node");
    expect(es).toEqual([expect.objectContaining({ via: "articleRef", to: { kind: "article", documentId: "", articleId: "no-such-node" } })]);
    expect(brokenEdges(g)).toEqual(expect.arrayContaining(es));
  });

  it("문서 쪽 항 대상 (self) — 담보약관 자신의 항을 가리키면 속한 조로 올라간다", () => {
    const 자기항참조_문서: DocumentInput = {
      id: "doc-self-par",
      kind: "special",
      ownerId: "cov-x",
      title: "자기 항 참조 문서",
      tree: {
        id: "sp-doc",
        kind: "document",
        title: "자기 항 참조 문서",
        children: [
          { id: "sp-art-1", kind: "article", title: "1조", children: [{ id: "sp-par-1", kind: "paragraph", children: [{ id: "sp-txt-1", kind: "text", text: "본문" }] }] },
          {
            id: "sp-art-2",
            kind: "article",
            title: "2조",
            children: [{ id: "sp-par-2", kind: "paragraph", children: [{ id: "sp-aref", kind: "articleRef", targets: [{ nodeId: "sp-par-1" }], connector: "및", scope: "self" }] }],
          },
        ],
      },
    };
    const g = buildGraph({ documents: [자기항참조_문서] });
    const e = edgesTo(g, "article:doc-self-par/sp-art-1").find((x) => x.via === "articleRef");
    expect(e).toMatchObject({ from: { kind: "article", documentId: "doc-self-par", articleId: "sp-art-2" }, at: { refPath: "sp-par-1" } });
    expect(brokenEdges(g).some((x) => x.via === "articleRef")).toBe(false);
  });

  it("문서 쪽 항 대상 (general) — 보통약관의 항을 가리키면 그 항이 속한 조로 올라간다", () => {
    const 일반항참조_문서: DocumentInput = {
      id: "doc-gen-par",
      kind: "special",
      ownerId: "cov-y",
      title: "보통약관 항 참조 문서",
      generalDocumentId: "doc-g",
      tree: {
        id: "gp-doc",
        kind: "document",
        title: "보통약관 항 참조 문서",
        children: [
          {
            id: "gp-art-1",
            kind: "article",
            title: "1조",
            children: [{ id: "gp-par-1", kind: "paragraph", children: [{ id: "gp-aref", kind: "articleRef", targets: [{ nodeId: "g-par-pay-1" }], connector: "및", scope: "general" }] }],
          },
        ],
      },
    };
    const g = buildGraph({ documents: [일반항참조_문서, 보통약관] });
    const e = edgesTo(g, "article:doc-g/g-art-pay").find((x) => x.from.kind === "article" && x.from.documentId === "doc-gen-par");
    expect(e).toMatchObject({ via: "articleRef", at: { refPath: "g-par-pay-1" } });
    expect(brokenEdges(g).some((x) => x.via === "articleRef")).toBe(false);
  });
});

describe("refs 그래프 — 정적 마스터 박스 (최종 결정 9)", () => {
  const 박스조항: Clause = {
    code: "C0900",
    label: "암 정의",
    mode: "block",
    options: [],
    required: { discriminators: [], attributes: [] },
    body: [
      { id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "암이란" }], items: [{ id: "bx-in", kind: "boxRef", boxCode: "BX000001" }] },
      { id: "bx-top", kind: "boxRef", boxCode: "BX000002" },
    ],
  };
  const doc: DocumentInput = {
    id: "doc-b",
    kind: "general",
    title: "보통약관",
    tree: { id: "root", kind: "document", title: "보통약관", children: [{ id: "a1", kind: "article", title: "용어", children: [{ id: "p", kind: "paragraph", children: [] }, { id: "bx-doc", kind: "boxRef", boxCode: "BX000001" }] }] },
  };

  it("박스는 선언된 실체(box:코드)이고, 문서 · 공용조항 본문의 박스 참조가 boxRef 간선을 낸다", () => {
    const g = buildGraph({ boxes: [{ code: "BX000001", name: "암 정의 박스", title: "", lines: ["x"] }, { code: "BX000002", name: "예시", title: "", lines: ["y"] }], clauses: [박스조항], documents: [doc] });
    expect(g.nodes.get("box:BX000001")?.label).toBe("암 정의 박스");
    expect(edgesTo(g, "box:BX000001").map((e) => [e.from.kind, e.via, e.at.nodePath?.at(-1)])).toEqual([
      ["clause", "boxRef", "bx-in"],
      ["article", "boxRef", "bx-doc"],
    ]);
    expect(edgesTo(g, "box:BX000002")).toHaveLength(1);
    expect(brokenEdges(g).filter((e) => e.via === "boxRef")).toEqual([]);
  });

  it("없는 박스를 가리키면 깨진 간선이다", () => {
    const g = buildGraph({ boxes: [], documents: [doc] });
    expect(brokenEdges(g).filter((e) => e.via === "boxRef").map((e) => nodeKey(e.to))).toEqual(["box:BX000001"]);
  });
});
