import { describe, expect, it } from "vitest";

import { analyzeBody, collectExpressions, allNodeIds, orderSwitchCases } from "./body";
import type { Block, Inline } from "./nodes";
import type { OptionDef } from "./types";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function issuesOf(r: { ok: true } | { ok: false; rejection: { reason: string; issues?: { kind: string; message: string; at?: { nodePath?: string[]; refPath?: string } }[] } }) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  expect(r.rejection.reason).toBe("invalid");
  return r.rejection.issues ?? [];
}

/** 본문이 읽는 인자 — 함수조항은 구분자를 직접 읽지 않고 인자의 기본 연결로 댄다 (최종 결정 2). */
const 갱신 = { name: "갱신", type: { kind: "boolean" as const }, default: { kind: "discriminator" as const, code: "D0001" } };
const 담보명 = { name: "담보명", type: { kind: "string" as const }, default: { kind: "discriminator" as const, code: "D0001" } };
const 고지 = { name: "고지", type: { kind: "string" as const }, default: { kind: "discriminator" as const, code: "D0002" } };
const 유형 = { name: "유형", type: { kind: "string" as const }, default: { kind: "discriminator" as const, code: "D0003" } };

const 옵션: OptionDef[] = [
  {
    code: "O01",
    label: "소멸 사유",
    order: 0,
    values: [
      { code: "V01", label: "사망형", order: 0, body: [{ id: "v1t", kind: "text", text: "사망보험금 지급사유 발생" }] },
      { code: "V02", label: "일반형", order: 1, body: [{ id: "v2t", kind: "text", text: "피보험자 사망" }] },
    ],
  },
];

describe("함수조항 S1 — 본문 노드 규칙 (inline)", () => {
  it("함수조항 값 슬롯도 string·enum 외 타입은 거부한다", () => {
    const resolveType = () => undefined;
    const body: Inline[] = [
      { id: "s1", kind: "slot", ref: "arg.문자" },
      { id: "s2", kind: "slot", ref: "arg.숫자" },
    ];

    const issues = issuesOf(analyzeBody("inline", body, [], { resolveType }, [{ name: "문자", type: { kind: "string" } }, { name: "숫자", type: { kind: "number" } }]));
    expect(issues.map((issue) => issue.kind)).toEqual(["typeMismatch"]);
  });

  it("텍스트·슬롯·인라인 조건·조 참조·별표 참조·옵션 자리로 된 inline 본문은 통과한다", () => {
    const body: Inline[] = [
      { id: "t1", kind: "text", text: "이 특별약관은 " },
      { id: "c1", kind: "inlineCond", branches: [
        { id: "b1", when: "attr.A0001 = '2'", children: [{ id: "t2", kind: "text", text: "최초계약일" }] },
        { id: "b2", children: [{ id: "t3", kind: "text", text: "계약일" }] },
      ] },
      { id: "s1", kind: "slot", ref: "arg.담보명" },
      { id: "a1", kind: "articleRef", targets: [{ nodeId: "art-1" }], connector: "및" },
      { id: "x1", kind: "appendixRef", appendixCode: "X0001" },
      { id: "o1", kind: "optionSlot", optionCode: "O01" },
    ];
    expect(unwrap(analyzeBody("inline", body, 옵션, {}, [담보명]))).toEqual({ discriminators: ["D0001"], attributes: ["A0001"] });
  });

  it("inline 본문에 항(paragraph)이 오면 거부한다 — 항·조 노드는 inline 에 없다", () => {
    const body = [{ id: "p1", kind: "paragraph", children: [] }] as unknown as Inline[];
    const issues = issuesOf(analyzeBody("inline", body, []));
    expect(issues[0]?.kind).toBe("typeMismatch");
  });

  it("함수조항 안의 함수조항 참조(clauseInlineRef)는 거부한다 — 중첩 금지(MVP)", () => {
    const body = [{ id: "r1", kind: "clauseInlineRef", clauseCode: "C0002" }] as unknown as Inline[];
    const issues = issuesOf(analyzeBody("inline", body, []));
    expect(issues[0]?.kind).toBe("typeMismatch");
    expect(issues[0]?.message).toContain("중첩");
  });

  it("인라인 조건 안에 다시 인라인 조건을 두면 거부한다 — 인라인 중첩 금지", () => {
    const body: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [
        { id: "b1", when: "arg.갱신", children: [
          { id: "c2", kind: "inlineCond", branches: [{ id: "b2", children: [] }] },
        ] },
      ] },
    ];
    const issues = issuesOf(analyzeBody("inline", body, [], {}, [갱신]));
    expect(issues.map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("else 가지는 마지막에만 올 수 있고, 가지가 없는 조건은 거부한다", () => {
    const elseFirst: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [
        { id: "b1", children: [] },
        { id: "b2", when: "arg.갱신", children: [] },
      ] },
    ];
    expect(issuesOf(analyzeBody("inline", elseFirst, [], {}, [갱신])).length).toBe(1);
    const empty: Inline[] = [{ id: "c1", kind: "inlineCond", branches: [] }];
    expect(issuesOf(analyzeBody("inline", empty, [])).length).toBe(1);
  });

  it("식 문법 오류는 저장 거부(invalid · syntax) — 좌표에 노드 경로가 실린다", () => {
    const body: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "D0001 = ", children: [] }] },
      { id: "s1", kind: "slot", ref: "D0001." },
    ];
    const r = analyzeBody("inline", body, []);
    const issues = issuesOf(r);
    expect(issues.map((i) => i.kind)).toEqual(["syntax", "syntax"]);
    if (!r.ok && r.rejection.reason === "invalid") {
      expect(r.rejection.issues[0].at.nodePath).toEqual(["c1", "b1"]);
      expect(r.rejection.issues[1].at.nodePath).toEqual(["s1"]);
    }
  });

  it("슬롯 ref 는 참조 하나여야 한다 — 비교식·리터럴은 거부", () => {
    const body: Inline[] = [{ id: "s1", kind: "slot", ref: "D0001 = true" }];
    expect(issuesOf(analyzeBody("inline", body, []))[0]?.kind).toBe("typeMismatch");
  });

  it("정의에 없는 옵션을 가리키는 옵션 자리는 거부한다 (brokenRef)", () => {
    const body: Inline[] = [{ id: "o1", kind: "optionSlot", optionCode: "O09" }];
    expect(issuesOf(analyzeBody("inline", body, 옵션))[0]?.kind).toBe("brokenRef");
  });

  it("노드 id 는 본문과 선택지 본문을 통틀어 유일해야 한다", () => {
    const body: Inline[] = [{ id: "v1t", kind: "text", text: "중복 id" }];
    const issues = issuesOf(analyzeBody("inline", body, 옵션));
    expect(issues[0]?.message).toContain("v1t");
  });

  it("요구 구분자(인자 기본 연결)는 선택지 본문이 읽는 인자에서도 — 등장 순 · 중복 없이", () => {
    const opts: OptionDef[] = [
      { code: "O01", label: "x", order: 0, values: [
        { code: "V01", label: "a", order: 0, body: [{ id: "a", kind: "slot", ref: "arg.고지" }] },
        { code: "V02", label: "b", order: 1, body: [{ id: "b", kind: "slot", ref: "arg.유형" }] },
      ] },
    ];
    const body: Inline[] = [{ id: "o", kind: "optionSlot", optionCode: "O01" }];
    expect(unwrap(analyzeBody("inline", body, opts, {}, [유형, 고지]))).toEqual({ discriminators: ["D0002", "D0003"], attributes: [] });
  });

  it("구분자를 직접 읽으면 검사 ① 오류 — 인자를 선언하고 기본 연결로 댄다 (최종 결정 2)", () => {
    const body: Inline[] = [{ id: "s1", kind: "slot", ref: "D0001" }];
    expect(issuesOf(analyzeBody("inline", body, []))).toEqual([expect.objectContaining({ kind: "typeMismatch", message: expect.stringContaining("직접 읽을 수 없습니다"), at: expect.objectContaining({ nodePath: ["s1"], refPath: "D0001" }) })]);
  });

  it("식이 없는 본문의 요구 구분자는 빈 목록이다", () => {
    const body: Inline[] = [{ id: "t", kind: "text", text: "고정 문구" }];
    expect(unwrap(analyzeBody("inline", body, []))).toEqual({ discriminators: [], attributes: [] });
  });
});

describe("함수조항 S1 — 본문 노드 규칙 (block)", () => {
  const 준용규정: Block[] = [
    { id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 보통약관을 따릅니다." }] },
    { id: "cb", kind: "condBlock", branches: [
      { id: "cb1", when: "arg.유형 = 'V02'", children: [
        { id: "p2", kind: "paragraph", children: [{ id: "t2", kind: "text", text: "최초계약일 기준 문구" }],
          items: [{ id: "i1", kind: "item", children: [{ id: "t3", kind: "text", text: "호" }],
            subitems: [{ id: "si1", kind: "subitem", children: [{ id: "t4", kind: "text", text: "목" }] }] }] },
        { id: "cb-in", kind: "condBlock", branches: [{ id: "cb-in-1", when: "any(pay.exempt)", children: [] }] },
      ] },
      { id: "cb2", children: [] },
    ] },
  ];

  it("항 목록 + 조건 블록(중첩 허용) + 호·목 으로 된 block 본문은 통과하고 요구 구분자가 추출된다", () => {
    expect(unwrap(analyzeBody("block", 준용규정, [], {}, [유형]))).toEqual({ discriminators: ["D0003"], attributes: [] });
  });

  it("block 본문에 조(article) 노드가 오면 거부한다 — 조는 항상 사용처 소유", () => {
    const body = [{ id: "a1", kind: "article", title: "준용규정", children: [] }] as unknown as Block[];
    const issues = issuesOf(analyzeBody("block", body, []));
    expect(issues[0]?.kind).toBe("typeMismatch");
  });

  it("block 본문에 인라인 노드가 직접 오면 거부한다", () => {
    const body = [{ id: "t1", kind: "text", text: "x" }] as unknown as Block[];
    expect(issuesOf(analyzeBody("block", body, [])).length).toBe(1);
  });

  it("함수조항 block 참조(clauseBlockRef)는 거부한다 — 중첩 금지(MVP)", () => {
    const body = [{ id: "r1", kind: "clauseBlockRef", clauseCode: "C0002" }] as unknown as Block[];
    expect(issuesOf(analyzeBody("block", body, []))[0]?.message).toContain("중첩");
  });

  it("식 수집: 모든 slot ref · when 을 노드 경로와 함께 돌려준다", () => {
    const exprs = collectExpressions(준용규정);
    expect(exprs.map((e) => [e.source, e.nodePath.join("/")])).toEqual([
      ["arg.유형 = 'V02'", "cb/cb1"],
      ["any(pay.exempt)", "cb/cb1/cb-in/cb-in-1"],
    ]);
  });

  it("id 수집: 본문의 모든 노드 id (가지 포함)", () => {
    expect(allNodeIds(준용규정)).toEqual(["p1", "t1", "cb", "cb1", "p2", "t2", "i1", "t3", "si1", "t4", "cb-in", "cb-in-1", "cb2"]);
  });
});

describe("함수조항 S1 — 조 참조 · 별표 참조 검사 (기능/함수조항 §3.5)", () => {
  /** connector `null` = 연결어 안 고름. */
  const 조참조 = (targets: { nodeId: string }[], connector: string | null = "및"): Inline =>
    ({ id: "a1", kind: "articleRef", targets, ...(connector === null ? {} : { connector }) } as Inline);
  const 별표참조 = (appendixCode: string): Inline => ({ id: "x1", kind: "appendixRef", appendixCode });

  it("조 참조 슬롯에 대상이 없으면 거부한다 (structure)", () => {
    const issues = issuesOf(analyzeBody("inline", [조참조([])], []));
    expect(issues.map((i) => i.kind)).toEqual(["structure"]);
    expect(issues[0]!.message).toContain("대상이 하나 이상");
  });

  it("조 참조 연결어가 「및」·「또는」이 아니면 거부한다 (structure)", () => {
    const issues = issuesOf(analyzeBody("inline", [조참조([{ nodeId: "g-art-1" }], "그리고")], []));
    expect(issues.map((i) => i.kind)).toEqual(["structure"]);
    expect(issues[0]!.message).toContain("연결어");
  });

  it("대상이 둘 이상인데 연결어가 없으면 거부한다 — 문서와 같은 규칙 (결정 14)", () => {
    const issues = issuesOf(analyzeBody("inline", [조참조([{ nodeId: "g-art-1" }, { nodeId: "g-art-2" }], null)], []));
    expect(issues.map((i) => i.kind)).toEqual(["structure"]);
    expect(issues[0]!.message).toContain("연결어를 고르세요");
  });

  it("대상이 하나면 연결어가 없어도 통과한다", () => {
    expect(analyzeBody("inline", [조참조([{ nodeId: "g-art-1" }], null)], []).ok).toBe(true);
  });

  it("별표 코드가 비어 있으면 거부한다 (structure)", () => {
    const issues = issuesOf(analyzeBody("inline", [별표참조("")], []));
    expect(issues.map((i) => i.kind)).toEqual(["structure"]);
  });

  it("보통약관 조 집합·별표 조회를 주지 않으면 존재 검사는 건너뛴다", () => {
    const body: Inline[] = [조참조([{ nodeId: "누구도-모르는-id" }]), 별표참조("X9999")];
    expect(unwrap(analyzeBody("inline", body, []))).toEqual({ discriminators: [], attributes: [] });
  });

  it("보통약관에 없는 조·항·호·목을 가리키면 거부한다 (brokenRef · refPath = 대상 id)", () => {
    const generalReferenceIds = new Set(["g-art-1", "g-par-1"]);
    const body: Inline[] = [조참조([{ nodeId: "g-art-1" }, { nodeId: "g-art-9" }])];

    const issues = issuesOf(analyzeBody("inline", body, [], { generalReferenceIds }));
    expect(issues.map((i) => i.kind)).toEqual(["brokenRef"]);
    expect(issues[0]!.message).toContain("g-art-9");
    expect(issues[0]!.at).toEqual({ nodePath: ["a1"], refPath: "g-art-9" });
  });

  it("별표 마스터에 없는 별표를 가리키면 거부한다 (brokenRef · refPath = 별표 코드)", () => {
    const appendixExists = (code: string) => code === "X0001";
    const body: Inline[] = [별표참조("X0002")];

    const issues = issuesOf(analyzeBody("inline", body, [], { appendixExists }));
    expect(issues.map((i) => i.kind)).toEqual(["brokenRef"]);
    expect(issues[0]!.at).toEqual({ nodePath: ["x1"], refPath: "X0002" });
  });

  it("존재하는 보통약관 조와 별표를 가리키면 통과한다 — block 본문의 항 안과 옵션 선택지 본문도 검사한다", () => {
    const generalReferenceIds = new Set(["g-art-1"]);
    const appendixExists = (code: string) => code === "X0001";
    const block: Block[] = [{ id: "p1", kind: "paragraph", children: [조참조([{ nodeId: "g-art-1" }]), 별표참조("X0001")] }];
    expect(unwrap(analyzeBody("block", block, [], { generalReferenceIds, appendixExists }))).toEqual({ discriminators: [], attributes: [] });

    const 깨진옵션: OptionDef[] = [{
      code: "O01", label: "별표", order: 0,
      values: [{ code: "V01", label: "A", order: 0, body: [{ id: "v1x", kind: "appendixRef", appendixCode: "X0002" }] }],
    }];
    const issues = issuesOf(analyzeBody("inline", [{ id: "t1", kind: "text", text: "별표 " }], 깨진옵션, { appendixExists }));
    expect(issues.map((i) => i.kind)).toEqual(["brokenRef"]);
  });
});

describe("함수조항 조 참조 범위 — 제 항 · 사용처 위치 (§3.5)", () => {
  const 소멸: Block[] = [
    { id: "p1", kind: "paragraph", children: [
      { id: "r1", kind: "articleRef", targets: [{ nodeId: "1" }], connector: "및", scope: "host" },
      { id: "t1", kind: "text", text: "에서 정한 지급사유가 발생한 경우에는 소멸됩니다." },
    ] },
    { id: "p2", kind: "paragraph", children: [
      { id: "r2", kind: "articleRef", targets: [{ nodeId: "p1" }], connector: "및", scope: "clause" },
      { id: "t2", kind: "text", text: "에 따라 소멸된 경우에는 해약환급금을 지급하지 않습니다." },
    ] },
  ];

  it("제 항(`clause`)과 사용처 위치(`host`)를 가리키는 조 참조는 보통약관 대상 검사를 받지 않고 통과한다", () => {
    unwrap(analyzeBody("block", 소멸, [], { generalReferenceIds: new Set(["g-a1"]) }));
  });

  it("제 항 참조는 본문의 항 · 호 · 목만 — 없는 id · 선택지 문구 안은 거부", () => {
    const bad: Block[] = [{ ...소멸[1], children: [{ id: "r2", kind: "articleRef", targets: [{ nodeId: "p9" }], connector: "및", scope: "clause" }] } as Block];
    expect(issuesOf(analyzeBody("block", bad, [])).map((i) => i.kind)).toEqual(["brokenRef"]);
    const inline: Inline[] = [{ id: "r", kind: "articleRef", targets: [{ nodeId: "p1" }], connector: "및", scope: "clause" }];
    expect(issuesOf(analyzeBody("inline", inline, [])).map((i) => i.kind)).toEqual(["brokenRef"]);
  });

  it("사용처 위치는 「조[.항[.호[.목]]]」 순번 경로여야 한다", () => {
    const bad: Block[] = [{ id: "p", kind: "paragraph", children: [{ id: "r", kind: "articleRef", targets: [{ nodeId: "0.1" }], connector: "및", scope: "host" }] }];
    expect(issuesOf(analyzeBody("block", bad, [])).map((i) => i.kind)).toEqual(["structure"]);
    const ok: Block[] = [{ id: "p", kind: "paragraph", children: [{ id: "r", kind: "articleRef", targets: [{ nodeId: "2.1.3" }], connector: "및", scope: "host" }] }];
    unwrap(analyzeBody("block", ok, []));
  });
});

describe("박스 참조 — 정적 마스터 박스는 잎이라 함수조항 본문에도 놓는다 (최종 결정 6 · 9)", () => {
  const paragraph = (items?: unknown[]): Block => ({ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "본문" }], ...(items ? { items } : {}) }) as Block;

  it("함수조항 본문에 boxRef를 둘 수 있다 — 항 자리 · 호 뒤 자리 · 조건 가지 안, 함수조항 참조 중첩 금지에 걸리지 않는다", () => {
    const body = [
      paragraph([{ id: "i1", kind: "item", children: [{ id: "t2", kind: "text", text: "호" }] }, { id: "bx1", kind: "boxRef", boxCode: "BX000002" }]),
      { id: "bx2", kind: "boxRef", boxCode: "BX000001" },
      { id: "c1", kind: "condBlock", branches: [{ id: "br1", when: "arg.갱신", children: [{ id: "bx3", kind: "boxRef", boxCode: "BX000001" }] }] },
    ] as Block[];
    expect(unwrap(analyzeBody("block", body, [], {}, [갱신]))).toEqual({ discriminators: ["D0001"], attributes: [] });
    expect(allNodeIds(body)).toContain("bx1");
  });

  it("없는 박스면 brokenRef — 박스 조회를 줬을 때만 본다 · 코드가 비면 구조 오류", () => {
    const body = [paragraph(), { id: "bx1", kind: "boxRef", boxCode: "BX000009" }, { id: "bx2", kind: "boxRef", boxCode: "" }] as Block[];
    const issues = issuesOf(analyzeBody("block", body, [], { boxExists: (c) => c === "BX000001" }));
    expect(issues.map((i) => [i.kind, i.at?.nodePath])).toEqual([
      ["brokenRef", ["bx1"]],
      ["structure", ["bx2"]],
    ]);
  });

  it("문구(문장 안) 본문에는 boxRef를 둘 수 없다", () => {
    const issues = issuesOf(analyzeBody("inline", [{ id: "bx1", kind: "boxRef", boxCode: "BX000001" }] as unknown as Inline[], []));
    expect(issues.map((i) => i.kind)).toEqual(["typeMismatch"]);
  });
});

describe("호 · 목 유형 본문 — 목록 자리 규칙 · 식 수집 · 제 호 참조 (최종 결정 4)", () => {
  const 호 = (id: string, children: Inline[] = []) => ({ id, kind: "item" as const, children });

  it("호 목록의 조건 가지 식 · 슬롯을 모으고, 제 호를 「이 함수조항」 참조로 가리킬 수 있다", () => {
    const body = [
      호("i1", [{ id: "s1", kind: "slot", ref: "arg.담보명" }]),
      { id: "c1", kind: "condBlock" as const, branches: [{ id: "b1", when: "arg.유형 = 'V02'", children: [호("i2", [{ id: "r1", kind: "articleRef", targets: [{ nodeId: "i1" }], scope: "clause" }])] }] },
    ];
    expect(collectExpressions(body).map((e) => e.source)).toEqual(["arg.담보명", "arg.유형 = 'V02'"]);
    const r = analyzeBody("item", body, [], {}, [담보명, 유형]);
    expect(r.ok && r.value.discriminators).toEqual(["D0001", "D0003"]);
  });

  it("목 목록 자리에 호 · 인라인 노드가 오면 거부", () => {
    const r = analyzeBody("subitem", [호("i1") as never, { id: "t1", kind: "text", text: "글" } as never], []);
    expect(r.ok).toBe(false);
  });
});

describe("검사 ① — 인자 (최종 결정 2 · 기능/함수조항 §3.7)", () => {
  const params = [
    { name: "갱신형", type: { kind: "boolean" as const } },
    { name: "사유", type: { kind: "enum" as const, enumCode: "E0001" } },
    { name: "담보명", type: { kind: "string" as const }, default: { kind: "discriminator" as const, code: "D0001" } },
  ];
  const resolveType = (ref: { kind: string; code?: string }) => (ref.kind === "discriminator" && ref.code === "D0001" ? ({ kind: "string" } as const) : undefined);

  it("본문이 선언되지 않은 인자를 읽으면 오류 — 타입 조회가 없어도 잡는다", () => {
    const body: Inline[] = [{ id: "s1", kind: "slot", ref: "arg.없는인자" }];
    const issues = issuesOf(analyzeBody("inline", body, [], {}, params));
    expect(issues).toEqual([expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("선언되지 않은 인자"), at: expect.objectContaining({ nodePath: ["s1"], refPath: "arg.없는인자" }) })]);
  });

  it("선언된 인자는 선언 타입으로 검사한다 — enum 인자와 코드 비교 · string 인자 슬롯", () => {
    const body: Inline[] = [
      { id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "arg.사유 = 'V01' and arg.갱신형", children: [{ id: "t1", kind: "text", text: "암" }] }] },
      { id: "s1", kind: "slot", ref: "arg.담보명" },
    ];
    // 요구 구분자 = 인자 기본 연결(담보명 → D0001)
    expect(unwrap(analyzeBody("inline", body, [], { resolveType }, params))).toEqual({ discriminators: ["D0001"], attributes: [] });
  });

  it("boolean 인자를 슬롯에 찍으면 슬롯 타입 오류", () => {
    const body: Inline[] = [{ id: "s1", kind: "slot", ref: "arg.갱신형" }];
    expect(issuesOf(analyzeBody("inline", body, [], { resolveType }, params)).map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("인자 표의 잘못(기본 연결 구분자가 없음)도 검사 ① 이다", () => {
    const bad = [{ name: "담보명", type: { kind: "string" as const }, default: { kind: "discriminator" as const, code: "D0099" } }];
    expect(issuesOf(analyzeBody("inline", [], [], { resolveType }, bad))).toEqual([expect.objectContaining({ kind: "brokenRef", at: expect.objectContaining({ refPath: "D0099" }) })]);
  });
});

describe("검사 ① — 값별 분기(switch) (최종 결정 5 · 기능/함수조항 §3.7)", () => {
  const params = [
    { name: "사유", type: { kind: "enum" as const, enumCode: "E0001" } },
    { name: "사유들", type: { kind: "list<enum>" as const, enumCode: "E0001" } },
    { name: "갱신형", type: { kind: "boolean" as const } },
  ];
  const enums = (code: string) => (code === "E0001" ? { values: ["V01", "V02", "V03"], fields: [] } : undefined);
  const resolveType = () => undefined;
  const opts = { resolveType, enums };
  const p = (id: string, text: string): Block => ({ id, kind: "paragraph", children: [{ id: `${id}t`, kind: "text", text }] });
  const sw = (cases: { id: string; values: string[]; empty?: true; children: Block[] }[], on = "arg.사유"): Block => ({ id: "sw", kind: "switchBlock", on, cases }) as Block;

  it("모든 값이 한 칸 — 통과, 대상 인자의 기본 연결도 요구 참조에 든다", () => {
    const body = [sw([{ id: "k1", values: ["V01", "V02"], children: [p("p1", "암")] }, { id: "k2", values: ["V03"], empty: true, children: [] }])];
    expect(unwrap(analyzeBody("block", body, [], opts, params))).toEqual({ discriminators: [], attributes: [] });
  });

  it("미배정 값 = 오류 (unassignedValue · refPath = 값 코드)", () => {
    const body = [sw([{ id: "k1", values: ["V01"], children: [p("p1", "암")] }, { id: "k2", values: ["V03"], empty: true, children: [] }])];
    expect(issuesOf(analyzeBody("block", body, [], opts, params))).toEqual([
      expect.objectContaining({ kind: "unassignedValue", message: expect.stringContaining("V02"), at: expect.objectContaining({ nodePath: ["sw"], refPath: "V02" }) }),
    ]);
  });

  it("두 칸에 같은 값 = 오류", () => {
    const body = [sw([{ id: "k1", values: ["V01", "V02"], children: [p("p1", "암")] }, { id: "k2", values: ["V02", "V03"], children: [p("p2", "장해")] }])];
    const issues = issuesOf(analyzeBody("block", body, [], opts, params));
    expect(issues).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("두 칸"), at: expect.objectContaining({ nodePath: ["sw", "k2"], refPath: "V02" }) })]);
  });

  it("지운 열거값 코드가 칸에 남으면 「없는 값」 오류 (brokenRef)", () => {
    const body = [sw([{ id: "k1", values: ["V01", "V02", "V09"], children: [p("p1", "암")] }, { id: "k2", values: ["V03"], empty: true, children: [] }])];
    expect(issuesOf(analyzeBody("block", body, [], opts, params))).toEqual([
      expect.objectContaining({ kind: "brokenRef", message: expect.stringContaining("없는 값 V09"), at: expect.objectContaining({ nodePath: ["sw", "k1"], refPath: "V09" }) }),
    ]);
  });

  it("목록값(복수) 대상 = 오류 — 목록은 내부 변수 + 조건으로", () => {
    const body = [sw([{ id: "k1", values: ["V01", "V02", "V03"], children: [p("p1", "암")] }], "arg.사유들")];
    expect(issuesOf(analyzeBody("block", body, [], opts, params))).toEqual([expect.objectContaining({ kind: "typeMismatch", message: expect.stringContaining("목록값(복수)") })]);
  });

  it("대상이 목록값이 아니거나 인자 · 내부 변수 하나가 아니면 오류", () => {
    const notEnum = [sw([{ id: "k1", values: ["V01"], children: [p("p1", "암")] }], "arg.갱신형")];
    expect(issuesOf(analyzeBody("block", notEnum, [], opts, params)).map((i) => i.kind)).toEqual(["typeMismatch"]);
    const expr = [sw([{ id: "k1", values: ["V01"], children: [p("p1", "암")] }], "arg.사유 = 'V01'")];
    expect(issuesOf(analyzeBody("block", expr, [], opts, params))).toEqual([expect.objectContaining({ message: expect.stringContaining("인자 · 내부 변수 하나") })]);
  });

  it("문구 없음 칸은 본문을 가질 수 없고, 문구 없음이 아닌 칸은 본문이 있어야 한다 · 값 없는 칸도 오류", () => {
    const body = [
      sw([
        { id: "k1", values: ["V01"], empty: true, children: [p("p1", "암")] },
        { id: "k2", values: ["V02"], children: [] },
        { id: "k3", values: [], children: [p("p3", "기타")] },
        { id: "k4", values: ["V03"], children: [p("p4", "질병")] },
      ]),
    ];
    const messages = issuesOf(analyzeBody("block", body, [], opts, params)).map((i) => i.message);
    expect(messages).toEqual([expect.stringContaining("「문구 없음」 칸은 본문을"), expect.stringContaining("본문을 쓰거나 「문구 없음」"), expect.stringContaining("값이 없는 칸")]);
  });

  it("문장 안 switch 안에 문장 안 조건 = 오류, 문장 안 조건 안에 문장 안 switch 도 오류", () => {
    const inner: Inline = { id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신형", children: [{ id: "t1", kind: "text", text: "갱신" }] }] };
    const body: Inline[] = [{ id: "s1", kind: "inlineSwitch", on: "arg.사유", cases: [{ id: "k1", values: ["V01", "V02", "V03"], children: [inner] }] }];
    expect(issuesOf(analyzeBody("inline", body, [], opts, params))).toEqual([expect.objectContaining({ message: expect.stringContaining("중첩 금지"), at: expect.objectContaining({ nodePath: ["s1", "k1", "c1"] }) })]);
    const reverse: Inline[] = [{ id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신형", children: [{ id: "s1", kind: "inlineSwitch", on: "arg.사유", cases: [{ id: "k1", values: ["V01", "V02", "V03"], children: [] , empty: true }] }] }] }];
    expect(issuesOf(analyzeBody("inline", reverse, [], opts, params)).map((i) => i.message)).toEqual([expect.stringContaining("중첩 금지")]);
  });

  it("호 · 목 유형 본문의 목록 자리에도 switch 가 선다 — 칸 본문도 그 목록", () => {
    const item = (id: string) => ({ id, kind: "item" as const, children: [{ id: `${id}t`, kind: "text" as const, text: "호" }] });
    const body = [{ id: "sw", kind: "switchBlock" as const, on: "arg.사유", cases: [{ id: "k1", values: ["V01", "V02"], children: [item("i1"), item("i2")] }, { id: "k2", values: ["V03"], children: [item("i3")] }] }];
    expect(analyzeBody("item", body, [], opts, params).ok).toBe(true);
    const bad = [{ ...body[0], cases: [{ id: "k1", values: ["V01", "V02", "V03"], children: [p("p1", "항")] }] }];
    expect(analyzeBody("item", bad as never, [], opts, params).ok).toBe(false);
  });

  it("식 수집 · id 수집 · 제 항 대상이 칸 안까지 걷는다", () => {
    const body = [sw([{ id: "k1", values: ["V01", "V02"], children: [p("p1", "암")] }, { id: "k2", values: ["V03"], children: [p("p2", "질병")] }])];
    expect(collectExpressions(body)).toEqual([{ source: "arg.사유", role: "switch", nodePath: ["sw"] }]);
    expect(allNodeIds(body)).toEqual(["sw", "k1", "p1", "p1t", "k2", "p2", "p2t"]);
  });

  it("타입 조회가 없으면 대상 타입 · 값 배정 검사는 건너뛴다(구조만)", () => {
    const body = [sw([{ id: "k1", values: ["V01"], children: [p("p1", "암")] }])];
    expect(analyzeBody("block", body, [], {}, params).ok).toBe(true);
  });
});

describe("칸 순서 = 열거형 순서 — 저장 때 맞춘다 (최종 결정 5)", () => {
  const params = [{ name: "사유", type: { kind: "enum" as const, enumCode: "E0001" } }];
  const enums = (code: string) => (code === "E0001" ? { values: ["V01", "V02", "V03"], fields: [] } : undefined);
  it("칸은 첫 값 기준 열거형 순서로, 칸 안 값도 열거형 순서로", () => {
    const body: Block[] = [
      {
        id: "sw",
        kind: "switchBlock",
        on: "arg.사유",
        cases: [
          { id: "k2", values: ["V03", "V02"], children: [{ id: "p2", kind: "paragraph", children: [] }] },
          { id: "k1", values: ["V01"], empty: true, children: [] },
        ],
      },
    ];
    const out = orderSwitchCases(body, params, [], { resolveType: () => undefined, enums }) as Block[];
    expect((out[0] as { cases: { id: string; values: string[] }[] }).cases.map((k) => [k.id, k.values])).toEqual([
      ["k1", ["V01"]],
      ["k2", ["V02", "V03"]],
    ]);
  });
});
