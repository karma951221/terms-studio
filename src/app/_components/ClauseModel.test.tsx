/**
 * 공용조항 모델 — 사용처 상자 안에 공용조항이 **어떻게 짜였는지**가 보여야 한다 (2026-09-28 사용자 QA:
 * 「대표자의 지정」이 가운데 편집기에서 접힌 이름표로만 보여 모델을 알 수 없었다).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";
import type { ReferenceTarget } from "@/domain/document";

import { ClauseModel } from "./ClauseModel";

/** 슬롯 · 옵션 자리 · 문장 안 조건 · 조 참조 · 별표 참조 · 블록 조건을 다 가진 공용조항. */
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
        { id: "r1", kind: "articleRef", targets: [{ nodeId: "A3" }], connector: "및" },
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

describe("ClauseModel — 공용조항 본문의 모델을 편다", () => {
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

describe("「박스」 공용조항 모델 — 문면 박스와 같은 상자, 줄의 옵션 자리 · 슬롯은 칩", () => {
  it("제목 【…】 · 줄마다 한 줄, 옵션 자리는 선택지 전부 + 고른 것", () => {
    const box: Clause = {
      code: "C0100",
      label: "【계약 전 알릴 의무】",
      mode: "box",
      required: { discriminators: [], attributes: [] },
      options: [{ code: "O01", label: "1째 줄", order: 0, values: [{ code: "V01", label: "청약서에서", order: 0, body: [{ id: "v1", kind: "text", text: "청약서에서" }] }, { code: "V02", label: "서면으로", order: 1, body: [{ id: "v2", kind: "text", text: "서면으로" }] }] }],
      body: [{ id: "b", kind: "box", title: "계약 전 알릴 의무", lines: [{ id: "l1", kind: "line", children: [{ id: "t", kind: "text", text: "회사가 " }, { id: "o", kind: "optionSlot", optionCode: "O01" }] }] }],
    };
    const html = renderToStaticMarkup(<ClauseModel clause={box} selected={{ O01: "V02" }} references={new Map()} />);
    expect(html).toContain("ts-doc-box");
    expect(html).toContain("【계약 전 알릴 의무】");
    expect(html).toContain("✓서면으로");
  });
});
