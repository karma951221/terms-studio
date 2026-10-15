import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";
import type { Block } from "./nodes";
import { runTrial, trialDefaults } from "./trial";
import type { Clause } from "./types";

/** 함수조항 화면 단독 시험 (기능/함수조항 §3.7 「함수조항 화면에서 시험한다」) — 인자에 값을 넣어 출력을 바로 본다. */
const E0001: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  values: [
    { code: "V01", label: "암", order: 1, fields: { F01: "암(유사암 제외)" } },
    { code: "V02", label: "뇌졸중", order: 2, fields: { F01: "뇌졸중" } },
  ],
  fields: [{ key: "F01", label: "약관표시명", type: "string", order: 1 }],
};
const enums = new Map([["E0001", E0001]]);

const t = (id: string, text: string) => ({ id, kind: "text" as const, text });

const clause: Clause = {
  code: "C0099",
  label: "시험 조항",
  mode: "block",
  required: { discriminators: [], attributes: [] },
  params: [
    { name: "사유", type: { kind: "enum", enumCode: "E0001" } },
    { name: "갱신", type: { kind: "boolean" } },
    { name: "종들", type: { kind: "planOptions", form: "waiver" } },
    { name: "지급사유 조", type: { kind: "articleRef" } },
    { name: "금액", type: { kind: "number" } },
  ],
  locals: [
    { name: "사유들", expr: "arg.종들.합치기(waiver.reasons)" },
    { name: "암있음", expr: "var.사유들.있음('V01')" },
  ],
  options: [
    {
      code: "O01",
      label: "끝말",
      order: 1,
      values: [
        { code: "V01", label: "합니다", body: [t("o1", "합니다")], order: 1 },
        { code: "V02", label: "드립니다", body: [t("o2", "드립니다")], order: 2 },
      ],
    },
  ],
  body: [
    {
      id: "p1",
      kind: "paragraph",
      children: [
        t("a", "기준일은 "),
        { id: "c", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신", children: [t("b", "최초계약일")] }, { id: "b2", children: [t("e", "계약일")] }] },
        t("f", "이고 금액은 "),
        { id: "s1", kind: "slot", ref: "arg.금액" },
        t("g", "원"),
      ],
    },
    { id: "cb", kind: "condBlock", branches: [{ id: "cb1", when: "var.암있음", children: [{ id: "p2", kind: "paragraph", children: [t("h", "암 문장 — "), { id: "s2", kind: "slot", ref: "arg.사유.F01" }], items: [{ id: "i1", kind: "item", children: [t("i", "호 하나")] }] }] }] },
    {
      id: "sw",
      kind: "switchBlock",
      on: "arg.사유",
      cases: [
        { id: "k1", values: ["V01"], children: [{ id: "p3", kind: "paragraph", children: [t("j", "암 칸")] }] },
        { id: "k2", values: ["V02"], empty: true, children: [] },
      ],
    },
    { id: "p4", kind: "paragraph", children: [{ id: "r", kind: "articleRef", targets: [{ param: "지급사유 조" }], scope: "param" }, t("k", "에서 정한 대로 "), { id: "os", kind: "optionSlot", optionCode: "O01" }] },
  ],
} as Clause;

describe("trialDefaults — 처음 시험 값", () => {
  it("참거짓 아니오 · 열거값 첫 값 · 목록 비움 · 문자 빈 글 · 숫자 0 · 세목 선택지 목록은 가상 원소 하나(참거짓 예 · 목록 비움) · 옵션은 첫 선택지", () => {
    const d = trialDefaults(clause, enums);
    expect(d.values).toEqual({ 사유: "V01", 갱신: false, 금액: 0 });
    expect(d.plans).toEqual({ 종들: { applies: true, reasons: [] } });
    expect(d.options).toEqual({ O01: "V01" });
  });
});

describe("runTrial — 시험 문맥으로 펼쳐 렌더", () => {
  it("인자 · 내부 변수 · 조건 · 값별 분기 · 슬롯 · 옵션이 시험 값대로, 조 참조는 자리표시, 번호는 본문 안 순번", () => {
    const out = runTrial(clause, { values: { 사유: "V01", 갱신: true, 금액: 1000000 }, plans: { 종들: { applies: true, reasons: ["V01"] } }, options: { O01: "V02" } }, { enums });
    expect(out.issues).toEqual([]);
    expect(out.lines).toEqual([
      { kind: "paragraph", label: "①", text: "기준일은 최초계약일이고 금액은 1,000,000원" },
      { kind: "paragraph", label: "②", text: "암 문장 — 암(유사암 제외)" },
      { kind: "item", label: "1.", text: "호 하나" },
      { kind: "paragraph", label: "③", text: "암 칸" },
      { kind: "paragraph", label: "④", text: "⟨지급사유 조⟩에서 정한 대로 드립니다" },
    ]);
  });

  it("조사 칩은 앞 글(조건 가지 결과까지)의 받침으로 고른다 — 문장 맨 앞이면 병기", () => {
    const body: Block[] = [
      {
        id: "pp",
        kind: "paragraph",
        children: [
          { id: "c", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신", children: [t("b", "최초계약일")] }, { id: "b2", children: [t("e", "회사")] }] },
          { id: "x1", kind: "particle", preset: "eul-reul" },
          t("f", " 따릅니다"),
        ],
      },
      { id: "pq", kind: "paragraph", children: [{ id: "x2", kind: "particle", preset: "i-ga" }] },
    ];
    const withParticle: Clause = { ...clause, mode: "block", body };
    const run = (갱신: boolean) => runTrial(withParticle, { values: { 사유: "V01", 갱신, 금액: 0 }, plans: { 종들: { applies: true, reasons: [] } }, options: { O01: "V01" } }, { enums }).lines.map((l) => l.text);
    expect(run(true)).toEqual(["최초계약일을 따릅니다", "이(가)"]);
    expect(run(false)).toEqual(["회사를 따릅니다", "이(가)"]);
  });

  it("값이 바뀌면 가지 · 칸이 바뀐다 — 사유 없음이면 조건 블록이, 「문구 없음」 칸이면 그 자리가 빠진다", () => {
    const out = runTrial(clause, { values: { 사유: "V02", 갱신: false, 금액: 0 }, plans: { 종들: { applies: true, reasons: [] } }, options: { O01: "V01" } }, { enums });
    expect(out.lines.map((l) => `${l.label}${l.text}`)).toEqual(["①기준일은 계약일이고 금액은 0원", "②⟨지급사유 조⟩에서 정한 대로 합니다"]);
  });

  it("칸이 없는 값 · 미입력은 시험 결과의 문제 줄로 — 저장하지 않는 화면 상태라 오류로 막지 않는다", () => {
    const out = runTrial(clause, { values: { 사유: "V09", 갱신: false }, plans: { 종들: { applies: true, reasons: [] } }, options: { O01: "V01" } }, { enums });
    expect(out.issues.some((m) => m.includes("V09"))).toBe(true);
  });
});
