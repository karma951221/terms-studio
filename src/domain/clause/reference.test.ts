import { describe, expect, it } from "vitest";

import type { Discriminator } from "../catalog/types";
import type { Block, Inline } from "./nodes";
import {
  checkAttachmentForReference,
  expandClause,
  lookupFrom,
  recheckUsages,
  resolveOptions,
  validateOptionSelection,
  type Usage,
} from "./reference";
import type { BlockClause, InlineClause } from "./types";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

// 카탈로그 픽스처
const catalog: Discriminator[] = [
  { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage.renewal" },
  { code: "D0002", label: "수술급여기준", description: "", level: "coverage", expression: "coverage.basis" },
  { code: "D0003", label: "면책여부", description: "", level: "benefit", expression: "pay.exempt" },
  { code: "D0004", label: "고지유형", description: "", level: "product", expression: "product.notice" },
  { code: "D0005", label: "평균공시이율", description: "", level: "product", expression: "'2.5%'" },
  { code: "D0006", label: "면책여부합", description: "", level: "coverage", expression: "any(pay.exempt)" },
];
const lookup = lookupFrom(catalog);

const 준용규정: BlockClause = {
  code: "C0001",
  label: "준용규정",
  mode: "block",
  body: [
    { id: "p1", kind: "paragraph", children: [
      { id: "t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 " },
      { id: "o1", kind: "optionSlot", optionCode: "O01" },
      { id: "t2", kind: "text", text: "을 따릅니다." },
    ] },
    { id: "cb", kind: "condBlock", branches: [
      { id: "b1", when: "arg.기준 = '기준A'", children: [{ id: "p2", kind: "paragraph", children: [{ id: "t3", kind: "text", text: "기준A 문구" }] }] },
    ] },
  ],
  options: [
    { code: "O01", label: "준용 대상", order: 0, values: [
      { code: "V01", label: "보통약관", order: 0, body: [{ id: "v1", kind: "text", text: "보통약관" }] },
      { code: "V02", label: "기본계약 약관", order: 1, body: [{ id: "v2", kind: "text", text: "기본계약 " }, { id: "v2s", kind: "slot", ref: "arg.이율" }] },
    ] },
  ],
  params: [
    { name: "기준", type: { kind: "string" }, default: { kind: "discriminator", code: "D0002" } },
    { name: "이율", type: { kind: "string" }, default: { kind: "discriminator", code: "D0005" } },
  ],
  required: { discriminators: ["D0002", "D0005"], attributes: [] },
};

describe("함수조항 S2 — 참조 추가 시 요구 구분자 존재 검사", () => {
  it("요구 구분자가 전부 카탈로그에 있으면 문제 없다 — 부착이 없어 미부착도 없다 (ADR-0037)", () => {
    const r = checkAttachmentForReference(준용규정, lookup);
    expect(r.missing).toEqual([]);
    expect(r.broken).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("레벨이 무엇이든 구분자는 값 자리를 묻지 않는다 — 식이라서", () => {
    const clause: InlineClause = {
      ...준용규정,
      mode: "inline",
      body: [],
      options: [],
      required: { discriminators: ["D0001", "D0003", "D0004", "D0005", "D0006"], attributes: ["A0001"] },
    };
    expect(checkAttachmentForReference(clause, lookup).issues).toEqual([]);
  });

  it("카탈로그에 없는 구분자는 깨진 참조로 보고한다 — at 은 사용처, source 는 함수조항 본문(고치면 사라지는 곳 · ADR-0049 §4)", () => {
    const clause: InlineClause = { ...준용규정, mode: "inline", body: [], options: [], required: { discriminators: ["D0099"], attributes: [] } };
    const r = checkAttachmentForReference(clause, lookup, { document: "coverageMaster", ownerId: "cov-1", nodePath: ["ref-1"] });
    expect(r.missing).toEqual([]);
    expect(r.broken).toEqual(["D0099"]);
    expect(r.issues).toEqual([
      {
        kind: "brokenRef",
        message: "함수조항 C0001 이(가) 읽는 구분자가 없습니다: D0099",
        at: { document: "coverageMaster", ownerId: "cov-1", nodePath: ["ref-1"], refPath: "D0099" },
        source: { document: "clause", ownerId: "C0001", ownerName: "준용규정", refPath: "D0099" },
      },
    ]);
  });
});

describe("함수조항 S5 · S7 — 옵션 선택 검증과 오버라이드 해소 (기능/함수조항 §3.2 · 기능/상품 §3.6)", () => {
  it("미선택 옵션은 optionUnselected, 유효 집합 밖 선택은 optionInvalid", () => {
    expect(validateOptionSelection(준용규정, {})).toMatchObject([{ kind: "optionUnselected", at: { refPath: "O01" } }]);
    expect(validateOptionSelection(준용규정, { O01: "V09" })).toMatchObject([{ kind: "optionInvalid" }]);
    expect(validateOptionSelection(준용규정, { O09: "V01", O01: "V01" })).toMatchObject([{ kind: "optionInvalid", at: { refPath: "O09" } }]);
    expect(validateOptionSelection(준용규정, { O01: "V02" })).toEqual([]);
  });

  it("좌표 기본값을 넘기면 Issue 좌표에 합쳐진다", () => {
    const [issue] = validateOptionSelection(준용규정, {}, { document: "coverageMaster", ownerId: "cov-1", nodePath: ["ref-1"] });
    expect(issue.at).toEqual({ document: "coverageMaster", ownerId: "cov-1", nodePath: ["ref-1"], refPath: "O01" });
  });

  it("오버라이드 > 마스터 기본. 결과는 항상 유효 집합 안에서만 — 밖이면 issue", () => {
    expect(resolveOptions(준용규정, { O01: "V01" }, { O01: "V02" })).toEqual({ selection: { O01: "V02" }, issues: [] });
    expect(resolveOptions(준용규정, { O01: "V01" })).toEqual({ selection: { O01: "V01" }, issues: [] });
    const bad = resolveOptions(준용규정, { O01: "V01" }, { O01: "V09" });
    expect(bad.selection).toEqual({ O01: "V09" });
    expect(bad.issues[0].kind).toBe("optionInvalid");
    expect(resolveOptions(준용규정, {}).issues[0].kind).toBe("optionUnselected");
  });
});

describe("함수조항 S6 — 인라인화 헬퍼 expandClause", () => {
  it("block: 옵션 자리를 선택지 본문으로 치환하고 모든 id 를 `${참조노드id}/${원노드id}` 로 유일화(선택지 본문은 `${참조노드id}/${옵션 자리 id}/${원노드id}`). 조건은 해소하지 않는다", () => {
    const out = unwrap(expandClause(준용규정, { O01: "V02" }, "ref-1")) as Block[];
    expect(out).toEqual([
      { id: "ref-1/p1", kind: "paragraph", children: [
        { id: "ref-1/t1", kind: "text", text: "이 특별약관에서 정하지 않은 사항은 " },
        { id: "ref-1/o1/v2", kind: "text", text: "기본계약 " },
        { id: "ref-1/o1/v2s", kind: "slot", ref: "arg.이율" },
        { id: "ref-1/t2", kind: "text", text: "을 따릅니다." },
      ] },
      { id: "ref-1/cb", kind: "condBlock", branches: [
        { id: "ref-1/b1", when: "arg.기준 = '기준A'", children: [
          { id: "ref-1/p2", kind: "paragraph", children: [{ id: "ref-1/t3", kind: "text", text: "기준A 문구" }] },
        ] },
      ] },
    ]);
    // 원본은 그대로
    expect(준용규정.body[0]).toMatchObject({ id: "p1" });
  });

  it("inline: 인라인 노드 열을 돌려주고 호·목·인라인 조건 안의 옵션 자리도 치환된다", () => {
    const clause: InlineClause = {
      ...준용규정,
      mode: "inline",
      body: [
        { id: "c", kind: "inlineCond", branches: [
          { id: "b", when: "D0001", children: [{ id: "o", kind: "optionSlot", optionCode: "O01" }] },
        ] },
      ],
    };
    const out = unwrap(expandClause(clause, { O01: "V01" }, "r")) as Inline[];
    expect(out).toEqual([
      { id: "r/c", kind: "inlineCond", branches: [{ id: "r/b", when: "D0001", children: [{ id: "r/o/v1", kind: "text", text: "보통약관" }] }] },
    ]);
  });

  it("같은 옵션 자리를 본문에 두 번 두어도 펼친 노드 id 가 겹치지 않는다 (옵션 자리 id 가 앞에 붙는다)", () => {
    const clause: InlineClause = {
      ...준용규정,
      mode: "inline",
      body: [
        { id: "o1", kind: "optionSlot", optionCode: "O01" },
        { id: "t", kind: "text", text: "부터 … " },
        { id: "o2", kind: "optionSlot", optionCode: "O01" },
      ],
    };
    const out = unwrap(expandClause(clause, { O01: "V01" }, "r")) as Inline[];
    expect(out.map((n) => n.id)).toEqual(["r/o1/v1", "r/t", "r/o2/v1"]);
  });

  it("미선택·유효 집합 밖 선택이면 거부 (invalid · optionUnselected / optionInvalid)", () => {
    const r = expandClause(준용규정, {}, "ref-1");
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].kind).toBe("optionUnselected");
    const r2 = expandClause(준용규정, { O01: "V09" }, "ref-1");
    if (!r2.ok && r2.rejection.reason === "invalid") expect(r2.rejection.issues[0].kind).toBe("optionInvalid");
  });

  it("같은 함수조항을 두 자리에서 참조해도 참조 노드 id 가 다르면 전개 결과의 id 가 겹치지 않는다 (D-P3-10)", () => {
    const a = unwrap(expandClause(준용규정, { O01: "V01" }, "ref-a")) as Block[];
    const b = unwrap(expandClause(준용규정, { O01: "V01" }, "ref-b")) as Block[];
    expect(a[0].id).toBe("ref-a/p1");
    expect(b[0].id).toBe("ref-b/p1");
  });
});

describe("함수조항 S3 — 수정 시 기존 사용처 재검사", () => {
  const usages: Usage[] = [
    { documentId: "doc-1", ownerKind: "coverage", ownerId: "cov-수술비", ownerName: "수술비", selection: { O01: "V01" } },
    { documentId: "doc-2", ownerKind: "coverage", ownerId: "cov-상해사망", ownerName: "일반상해사망", selection: { O01: "V01" } },
    { documentId: "doc-3", ownerKind: "general", ownerId: "gen-1", ownerName: "보통약관 A", selection: { O01: "V02" } },
  ];
  it("요구 구분자가 삭제된 코드를 가리키면 모든 사용처가 목록에 오른다", () => {
    const broken: BlockClause = { ...준용규정, params: [{ name: "기준", type: { kind: "string" }, default: { kind: "discriminator", code: "D0099" } }], required: { discriminators: ["D0099"], attributes: [] } };
    const entries = recheckUsages(broken, usages, lookup);
    expect(entries).toHaveLength(3);
    expect(entries[0].issues[0]).toMatchObject({
      kind: "brokenRef",
      at: { document: "coverageMaster", ownerId: "cov-수술비", documentId: "doc-1", ownerName: "수술비", refPath: "D0099" },
      source: { document: "clause", ownerId: "C0001", ownerName: "준용규정", refPath: "D0099" },
    });
    expect(entries[2].issues[0].at).toMatchObject({ document: "general", ownerId: "gen-1", documentId: "doc-3" });
  });

  it("요구 구분자가 살아 있으면 부착을 묻지 않는다 — 목록이 비어 있다 (ADR-0037)", () => {
    expect(recheckUsages(준용규정, usages, lookup)).toEqual([]);
  });

  it("옵션이 나중에 생기거나 삭제되면 미선택·깨진 선택을 가진 사용처가 목록에 오른다 (S5 · S7 경계)", () => {
    const withNewOption: BlockClause = {
      ...준용규정,
      required: { discriminators: [], attributes: [] },
      options: [
        ...준용규정.options,
        { code: "O02", label: "새 옵션", order: 1, values: [
          { code: "V01", label: "a", order: 0, body: [] },
          { code: "V02", label: "b", order: 1, body: [] },
        ] },
      ],
    };
    const entries = recheckUsages(withNewOption, usages, lookup);
    expect(entries.map((e) => e.usage.documentId)).toEqual(["doc-1", "doc-2", "doc-3"]);
    expect(entries[0].issues.map((i) => i.kind)).toEqual(["optionUnselected"]);

    const optionGone: BlockClause = { ...준용규정, required: { discriminators: [], attributes: [] }, options: [] };
    const gone = recheckUsages(optionGone, usages, lookup);
    expect(gone.every((e) => e.issues[0].kind === "optionInvalid")).toBe(true);
  });

  it("요구 구분자를 읽지 않게 되는 수정(제거)은 위반을 만들지 않는다 — 목록이 비어 있다", () => {
    const shrunk: BlockClause = { ...준용규정, required: { discriminators: [], attributes: [] } };
    expect(recheckUsages(shrunk, usages, lookup)).toEqual([]);
  });

  it("선택 정보가 없는 사용처는 옵션 검사를 건너뛴다 (존재 검사만 본다)", () => {
    const noSel: Usage[] = [{ documentId: "d", ownerKind: "coverage", ownerId: "cov-상해사망" }];
    expect(recheckUsages(준용규정, noSel, lookup)).toEqual([]);
  });
});

describe("expandClause — 제 항 · 사용처 위치 조 참조 (§3.5 · ADR-0072)", () => {
  const 소멸: BlockClause = {
    code: "C0009",
    label: "특별약관의 소멸",
    mode: "block",
    options: [],
    required: { discriminators: [], attributes: [] },
    body: [
      { id: "p1", kind: "paragraph", code: "P0100", children: [{ id: "r1", kind: "articleRef", targets: [{ host: "1" }], connector: "및", scope: "host" }] },
      { id: "p2", kind: "paragraph", code: "P0200", children: [{ id: "r2", kind: "articleRef", targets: [{ code: "P0100" }], connector: "및", scope: "clause" }] },
      { id: "p3", kind: "paragraph", code: "P0300", children: [{ id: "r3", kind: "articleRef", targets: [{ articleId: "g-a5" }], connector: "및" }] },
    ],
  };

  it("제 항 대상은 코드 그대로(사용처 조 · 참조 노드 코드와 짝짓는 것은 조립) · 사용처 위치는 사용처가 푼 대상 · 보통약관 대상은 그대로 · 항의 P코드는 남는다", () => {
    const body = unwrap(expandClause(소멸, {}, "ref", (path) => (path === "1" ? { articleId: "s-a1" } : undefined))) as Block[];
    const refOf = (b: Block) => (b.kind === "paragraph" ? b.children[0] : undefined);
    expect(refOf(body[0])).toMatchObject({ id: "ref/r1", scope: "host", targets: [{ articleId: "s-a1" }] });
    expect(refOf(body[1])).toMatchObject({ id: "ref/r2", scope: "clause", targets: [{ code: "P0100" }] });
    expect(body[0]).toMatchObject({ id: "ref/p1", code: "P0100" });
    expect(refOf(body[2])).toEqual({ id: "ref/r3", kind: "articleRef", targets: [{ articleId: "g-a5" }], connector: "및" });
  });

  it("사용처가 위치를 못 풀면 조 자리에 `host:<경로>` — 조립 렌더가 사라진 대상(articleGone)으로 알린다", () => {
    const body = unwrap(expandClause(소멸, {}, "ref")) as Block[];
    expect(body[0].kind === "paragraph" && body[0].children[0]).toMatchObject({ targets: [{ articleId: "host:1" }] });
  });
});

describe("expandClause — 호 · 목 유형 (최종 결정 4)", () => {
  it("호 유형은 호 목록을 조건째 펼치고 id 를 사용처 자리로 유일화한다", () => {
    const clause = {
      code: "C0300",
      label: "호",
      mode: "item" as const,
      options: [],
      required: { discriminators: [], attributes: [] },
      body: [
        { id: "i1", kind: "item" as const, children: [{ id: "t1", kind: "text" as const, text: "하나" }], subitems: [{ id: "s1", kind: "subitem" as const, children: [] }] },
        { id: "c1", kind: "condBlock" as const, branches: [{ id: "b1", when: "D0001 = 1", children: [{ id: "i2", kind: "item" as const, children: [] }] }] },
      ],
    };
    const r = expandClause(clause, {}, "k");
    expect(r.ok && JSON.stringify(r.value)).toBe(
      JSON.stringify([
        { id: "k/i1", kind: "item", children: [{ id: "k/t1", kind: "text", text: "하나" }], subitems: [{ id: "k/s1", kind: "subitem", children: [] }] },
        { id: "k/c1", kind: "condBlock", branches: [{ id: "k/b1", when: "D0001 = 1", children: [{ id: "k/i2", kind: "item", children: [] }] }] },
      ]),
    );
  });
});

describe("재검사 — 인자 · 기본 연결 (최종 결정 2 · 기능/함수조항 §3.7)", () => {
  const 판정: BlockClause = {
    code: "C0010",
    label: "판정",
    mode: "block",
    body: [{ id: "p1", kind: "paragraph", children: [{ id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신형", children: [{ id: "t1", kind: "text", text: "갱신" }] }] }] }],
    options: [],
    params: [{ name: "갱신형", type: { kind: "boolean" }, default: { kind: "discriminator", code: "D0001" } }],
    required: { discriminators: [], attributes: [] },
  };
  const usages: Usage[] = [
    { documentId: "doc-1", ownerKind: "coverage", ownerId: "cov-1", ownerName: "수술비" },
    { documentId: "doc-2", ownerKind: "coverage", ownerId: "cov-2", ownerName: "상해사망", bindings: { 갱신형: { kind: "discriminator", code: "D0006" } } },
  ];

  it("인자를 더하면(기본 연결 없음) 연결하지 않은 사용처가 재검사에 연결 누락으로 오른다", () => {
    const added: BlockClause = { ...판정, params: [...판정.params!, { name: "면책", type: { kind: "boolean" } }] };
    const entries = recheckUsages(added, usages, lookup);
    expect(entries.map((e) => [e.usage.documentId, e.issues.map((i) => [i.kind, i.at.refPath])])).toEqual([
      ["doc-1", [["argUnbound", "arg.면책"]]],
      ["doc-2", [["argUnbound", "arg.면책"]]],
    ]);
  });

  it("기본 연결 구분자를 지우면 정의가 기대는 구분자가 깨지고, 기본 연결을 쓰는 사용처만 재검사에 오른다", () => {
    const shrunk = lookupFrom(catalog.filter((d) => d.code !== "D0001"));
    const def = checkAttachmentForReference(판정, shrunk);
    expect(def.broken).toEqual(["D0001"]);
    const entries = recheckUsages(판정, usages, shrunk);
    expect(entries.map((e) => [e.usage.documentId, e.issues.map((i) => i.kind)])).toEqual([["doc-1", ["brokenRef"]]]);
  });

  it("사용처 연결의 타입이 인자와 다르면(타입 조회를 주면) 재검사에 오른다", () => {
    const typed = recheckUsages(판정, [{ ...usages[1], bindings: { 갱신형: { kind: "discriminator", code: "D0002" } } }], lookup, (code) => (code === "D0002" ? { kind: "string" } : { kind: "boolean" }));
    expect(typed[0].issues.map((i) => i.kind)).toEqual(["typeMismatch"]);
  });
});
