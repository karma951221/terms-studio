/**
 * 함수조항 모델 — 사용처 상자 안에 함수조항이 **어떻게 짜였는지**가 보여야 한다 (2026-09-28 사용자 QA:
 * 「대표자의 지정」이 가운데 편집기에서 접힌 이름표로만 보여 모델을 알 수 없었다).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";
import type { ReferenceTarget } from "@/domain/document";

import { ClauseModel } from "./ClauseModel";

/** 슬롯 · 옵션 자리 · 문장 안 조건 · 조 참조 · 별표 참조 · 블록 조건을 다 가진 함수조항. */
const modelClause: Clause = {
  code: "C0007",
  label: "대표자의 지정",
  mode: "block",
  required: { discriminators: ["D0001"], attributes: [] },
  options: [
    {
      code: "O01",
      label: "지정 주체",
      order: 0,
      values: [
        { code: "V01", label: "계약자", body: [{ id: "v1", kind: "text", text: "계약자는" }], order: 0 },
        { code: "V02", label: "피보험자", body: [{ id: "v2", kind: "text", text: "피보험자는" }], order: 1 },
      ],
    },
  ],
  body: [
    {
      id: "p1",
      kind: "paragraph",
      children: [
        { id: "o1", kind: "optionSlot", optionCode: "O01" },
        { id: "t1", kind: "text", text: " 대표자를 지정하여 " },
        { id: "s1", kind: "slot", ref: "D0001" },
        { id: "t2", kind: "text", text: " 을 청구합니다. " },
        { id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "D0001 = '사망'", children: [{ id: "t3", kind: "text", text: "사망한 경우" }] }, { id: "b2", children: [{ id: "t4", kind: "text", text: "그 밖" }] }] },
        { id: "r1", kind: "articleRef", targets: [{ articleId: "A3" }], connector: "및" },
        { id: "x1", kind: "appendixRef", appendixCode: "AP01" },
      ],
    },
    {
      id: "cb",
      kind: "condBlock",
      branches: [{ id: "cb1", when: "D0001 = '입원'", children: [{ id: "p2", kind: "paragraph", children: [{ id: "t5", kind: "text", text: "입원 조건 항" }] }] }],
    },
  ],
};

const references = new Map<string, ReferenceTarget>([["A3", { kind: "article", article: { id: "A3", n: 3, title: "보험금의 지급사유" } }]]);

function render(selected: Record<string, string>) {
  return renderToStaticMarkup(
    <ClauseModel clause={modelClause} selected={selected} references={references} appendixName={(c) => (c === "AP01" ? "재해분류표" : undefined)} exprText={(s) => s.replace("D0001", "담보명")} />,
  );
}

describe("ClauseModel — 함수조항 본문의 모델을 편다", () => {
  it("글 · 슬롯 칩 · 문장 안 조건(IF/ELSE 머리) · 조 참조 · 별표 참조 · 블록 조건(IF 상자)", () => {
    const html = render({ O01: "V02" });
    expect(html).toContain("대표자를 지정하여");
    expect(html).toContain("〔담보명〕"); // 슬롯 — 구분자 표시명
    expect(html).toContain("IF 담보명 = &#x27;사망&#x27;");
    expect(html).toContain("ELSE");
    expect(html).toContain("보통약관 제3조");
    expect(html).toContain("【별표 재해분류표】");
    expect(html).toContain('<span class="ts-cond-badge">IF</span> 담보명 = &#x27;입원&#x27;');
    expect(html).toContain("입원 조건 항");
    // 문면 편집기의 자리로 읽히면 안 된다
    expect(html).not.toContain("data-block");
    expect(html).not.toContain("data-inline");
  });

  it("옵션 자리 — 선택지 전부 + 이 사용처가 고른 것(✓)", () => {
    const html = render({ O01: "V02" });
    expect(html).toContain("지정 주체");
    expect(html).toContain("계약자");
    expect(html).toMatch(/<b class="ts-clause-model-opt-value is-chosen" aria-current="true">✓피보험자<\/b>/);
    expect(html).not.toContain("미선택");
  });

  it("고른 선택지가 없으면 「미선택」을 드러낸다", () => {
    expect(render({})).toContain("· 미선택");
  });
});

/** 인자를 가진 함수조항 — 공통 항 · 값별 분기(질병 칸 · 상해 「문구 없음」) · 조건 블록. */
const foldClause: Clause = {
  code: "C0100",
  label: "납입면제 사유",
  mode: "block",
  required: { discriminators: [], attributes: [] },
  options: [],
  params: [{ name: "사유", type: { kind: "enum", enumCode: "E0001" } }],
  body: [
    { id: "p0", kind: "paragraph", children: [{ id: "t0", kind: "text", text: "공통 항" }] },
    {
      id: "sw",
      kind: "switchBlock",
      on: "arg.사유",
      cases: [
        { id: "k1", values: ["V01"], children: [{ id: "p1", kind: "paragraph", children: [{ id: "t1", kind: "text", text: "질병 칸 항" }] }, { id: "p1b", kind: "paragraph", children: [{ id: "t1b", kind: "text", text: "질병 칸 둘째 항" }] }] },
        { id: "k2", values: ["V02"], empty: true, children: [] },
      ],
    },
    { id: "cb", kind: "condBlock", branches: [{ id: "cb1", when: "arg.사유 = 'V01'", children: [{ id: "p2", kind: "paragraph", children: [{ id: "t2", kind: "text", text: "조건 칸 항" }] }] }] },
  ],
};

function renderFold(scope?: string) {
  return renderToStaticMarkup(
    <ClauseModel clause={foldClause} selected={{}} references={references} {...(scope ? { foldScope: scope } : {})} valueLabel={(on, v) => (on === "arg.사유" ? ({ V01: "질병", V02: "상해" } as Record<string, string>)[v] : undefined)} />,
  );
}

describe("ClauseModel — 인자 있는 함수조항은 접어 둔다 (최종 결정 8 · 기능/함수조항 §4.4)", () => {
  it("인자 있는 조항은 칸 머리만 — 칸마다 접힌 <details>, 머리 = 배정 값 이름 · 문장 수", () => {
    const html = renderFold();
    expect(html.match(/<details/g)).toHaveLength(2); // 질병 칸 · IF 가지 (문구 없음 칸은 펼칠 것이 없다)
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toMatch(/<summary[^>]*>.*질병.*문장 2.*<\/summary>/);
    expect(html).not.toContain(">V01<");
    expect(html).toContain("상해 — 문구 없음");
    expect(html).toContain("공통 항"); // 칸 밖 본문은 그대로
  });

  it("칸을 누르면 그 칸만 펼침 — 한 분기의 칸은 같은 묶음(name)이고, 묶음 이름은 상자마다 다르다", () => {
    const html = renderFold("box-1");
    const names = [...html.matchAll(/<details[^>]* name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["box-1:sw", "box-1:cb"]);
    expect(renderFold("box-2")).toContain('name="box-2:sw"');
  });

  it("인자 0개 조항은 전체 — 접지 않는다", () => {
    expect(render({ O01: "V01" })).not.toContain("<details");
  });
});

describe("ClauseModel — 사용처 자리 번호부터 잇는다 (2026-10-03 사용자 QA)", () => {
  const base = { required: { discriminators: [], attributes: [] }, options: [] };
  const p = (id: string, t: string) => ({ id, kind: "paragraph" as const, children: [{ id: `${id}t`, kind: "text" as const, text: t }] });
  const nums = (html: string) => [...html.matchAll(/<span class="ts-doc-num">([^<]*) <\/span>/g)].map((m) => m[1]);

  it("항 — ② 자리면 ②③ (자리 없으면 ①②, 단항 자리면 번호 없음)", () => {
    const clause: Clause = { ...base, code: "C0013", label: "약관의 해석", mode: "block", body: [p("q1", "회사는 약관의 뜻이"), p("q2", "회사는 보험금을")] };
    const at = (n: number, label: string) => renderToStaticMarkup(<ClauseModel clause={clause} selected={{}} references={new Map()} at={{ kind: "paragraph", n, label }} />);
    expect(nums(at(2, "②"))).toEqual(["②", "③"]);
    expect(nums(at(1, ""))).toEqual([]);
    expect(nums(renderToStaticMarkup(<ClauseModel clause={clause} selected={{}} references={new Map()} />))).toEqual(["①", "②"]);
  });

  it("호 — 3. 자리면 목록이 3.부터 (counter-reset 2)", () => {
    const clause: Clause = { ...base, code: "C0200", label: "사유 호", mode: "item", body: [{ id: "i1", kind: "item", children: [] }, { id: "i2", kind: "item", children: [] }] };
    const html = renderToStaticMarkup(<ClauseModel clause={clause} selected={{}} references={new Map()} at={{ kind: "item", n: 3, label: "3." }} />);
    expect(html).toContain('<ol class="ts-doc-items" style="counter-reset:ts-doc-item 2">');
  });

  it("목 — 나. 자리면 목록이 나.부터 (counter-reset 1)", () => {
    const clause: Clause = { ...base, code: "C0300", label: "사유 목", mode: "subitem", body: [{ id: "s1", kind: "subitem", children: [] }] };
    const html = renderToStaticMarkup(<ClauseModel clause={clause} selected={{}} references={new Map()} at={{ kind: "subitem", n: 2, label: "나." }} />);
    expect(html).toContain('<ol class="ts-doc-subitems" style="counter-reset:ts-doc-subitem 1">');
  });
});
