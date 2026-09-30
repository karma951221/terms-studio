import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";
import type { EvalContext, LookupResult, TypeResolver } from "../expression";
import { entered, NOT_ENTERED, type Value, type ValueSlot } from "../types";
import { analyzeBody } from "./body";
import { applyBindings, plainConst } from "./bind";
import { checkLocals, enumInfoOf, type LocalDef, type LocalEnv } from "./locals";
import type { ParamDef } from "./params";
import type { Clause } from "./types";

/**
 * 함수조항 내부 변수 — 검사 ①(이름 · 앞 이름만 · 직접 읽기 · 타입) · 펼칠 때 사용처 문맥 평가 (최종 결정 2 · 18 · 기능/함수조항 §3.7).
 */

const E0001: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  description: "",
  fields: [
    { key: "F01", label: "약관표시명", type: "string", order: 1 },
    { key: "F02", label: "면책여부", type: "boolean", order: 2 },
  ],
  values: [
    { code: "V01", label: "암", order: 1, fields: { F01: "암(유사암 제외)", F02: true } },
    { code: "V02", label: "뇌졸중", order: 2, fields: { F02: false } },
    { code: "V03", label: "급성심근경색증", order: 3, fields: { F01: "급성심근경색증", F02: false } },
  ],
} as EnumDef;
const ENUMS = new Map([["E0001", E0001]]);

const PARAMS: ParamDef[] = [
  { name: "종들", type: { kind: "planOptions", form: "waiver" }, default: { kind: "source", source: { form: "waiver", filter: "waiver.applies = true" } } },
  { name: "사유", type: { kind: "enum", enumCode: "E0001" }, default: { kind: "discriminator", code: "D0002" } },
  { name: "사유들", type: { kind: "list<enum>", enumCode: "E0001" }, default: { kind: "discriminator", code: "D0001" } },
];

const resolve: TypeResolver = (ref) => {
  if (ref.kind !== "discriminator") return undefined;
  if (ref.code === "D0001") return { kind: "list<enum>", enumCode: "E0001" };
  if (ref.code === "D0002") return { kind: "enum", enumCode: "E0001" };
  return undefined;
};
const enums = enumInfoOf((c) => ENUMS.get(c));

function issuesOf(locals: LocalDef[], withTypes = true) {
  return checkLocals(locals, PARAMS, withTypes ? { resolveType: resolve, enums } : {}).issues;
}

describe("검사 ① 내부 변수 표", () => {
  it("앞에 선언한 내부 변수만 읽는다 — 뒤 이름 · 자기 자신 = 오류", () => {
    const later = issuesOf([
      { name: "암있음", expr: "var.모든사유.있음('V01')" },
      { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
    ]);
    expect(later[0]).toMatchObject({ kind: "structure", message: expect.stringMatching(/뒤에 선언한 이름/) });
    expect(issuesOf([{ name: "자기", expr: "not var.자기" }])[0].message).toMatch(/자기 자신/);
  });

  it("순서가 맞으면 통과하고 타입을 앞에서부터 쌓는다", () => {
    const r = checkLocals(
      [
        { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
        { name: "암있음", expr: "var.모든사유.있음('V01')" },
        { name: "면책있음", expr: "not var.모든사유.거르기(F02 = true).비었음" },
      ],
      PARAMS,
      { resolveType: resolve, enums },
    );
    expect(r.issues).toEqual([]);
    expect(r.types.get("모든사유")).toEqual({ kind: "list<enum>", enumCode: "E0001" });
    expect(r.types.get("암있음")).toEqual({ kind: "boolean" });
  });

  it("이름 겹침 · 빈 식 · 구분자 직접 읽기 · 개수 연산 = 오류", () => {
    expect(issuesOf([{ name: "a", expr: "arg.사유 = 'V01'" }, { name: "a", expr: "arg.사유 = 'V02'" }])[0].message).toMatch(/겹칩니다/);
    expect(issuesOf([{ name: "a", expr: " " }])[0].message).toMatch(/비어/);
    expect(issuesOf([{ name: "a", expr: "D0001.있음('V01')" }]).length).toBeGreaterThan(0);
    expect(issuesOf([{ name: "a", expr: "D0002 = 'V01'" }])[0].message).toMatch(/직접 읽을 수 없습니다/);
  });

  it("본문이 선언되지 않은 내부 변수를 읽으면 검사 ① 오류 — 타입 조회가 없어도", () => {
    const r = analyzeBody("inline", [{ id: "s1", kind: "slot", ref: "var.없음" }] as never, [], {}, PARAMS, []);
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].message).toMatch(/내부 변수/);
  });

  it("본문 슬롯에 열거값 필드(문자)를 찍을 수 있다 · 요구 구분자에 내부 변수가 읽는 인자의 기본 연결이 든다", () => {
    const r = analyzeBody(
      "inline",
      [{ id: "s1", kind: "slot", ref: "arg.사유.F01" }] as never,
      [],
      { resolveType: resolve, enums },
      PARAMS,
      [{ name: "암있음", expr: "arg.사유들.있음('V01')" }],
    );
    expect(r).toEqual({ ok: true, value: { discriminators: ["D0002", "D0001"], attributes: [] } });
  });
});

// ───────────────────────────── 평가 ─────────────────────────────

interface Option {
  id: string;
  values: Record<string, Value | undefined>;
}

/** 상품 문맥 — 구분자 값 + 세목 선택지(waiver 폼). */
function productContext(discriminators: Record<string, Value>, options: Option[]): EvalContext {
  const optionCtx = (o: Option): EvalContext => ({
    lookup: (ref): LookupResult => {
      if (ref.kind !== "master") return { kind: "missing" };
      const v = o.values[`${ref.form}.${ref.field}`];
      const slot: ValueSlot = v === undefined ? NOT_ENTERED : entered(v);
      return { kind: "slot", slot };
    },
    attribute: () => ({ kind: "unused" }),
    children: () => [optionCtx(o)],
  });
  return {
    lookup: (ref) => (ref.kind === "discriminator" && ref.code in discriminators ? { kind: "slot", slot: entered(discriminators[ref.code]) } : { kind: "missing" }),
    attribute: () => ({ kind: "unused" }),
    children: (ref) => (ref.kind === "master" && ref.form === "waiver" ? options.map(optionCtx) : undefined),
  };
}

const OPTIONS: Option[] = [
  { id: "o1", values: { "waiver.applies": true, "waiver.reasons": ["V03", "V01"] } },
  { id: "o2", values: { "waiver.applies": true, "waiver.reasons": ["V01", "V02"] } },
  { id: "o3", values: { "waiver.applies": false, "waiver.reasons": [] } },
];

function clauseWith(locals: LocalDef[], body: unknown[]): Clause {
  return { code: "C0001", label: "시험", mode: "inline", options: [], params: PARAMS, locals, body, required: { discriminators: [], attributes: [] } } as unknown as Clause;
}

function env(discriminators: Record<string, Value> = { D0001: ["V02"], D0002: "V02" }, options = OPTIONS): LocalEnv {
  return { ctx: productContext(discriminators, options), enums: ENUMS, text: (v) => String(v) };
}

/** 인라인 조건 하나 — 참이면 「예」, 아니면 「아니오」. 펼친 결과의 조건 소스를 본다. */
function condition(when: string) {
  return [{ id: "c1", kind: "inlineCond", branches: [{ id: "b1", when, children: [{ id: "t1", kind: "text", text: "예" }] }, { id: "b2", children: [{ id: "t2", kind: "text", text: "아니오" }] }] }];
}

function whenOf(c: Clause): string {
  return (c.body as unknown as { branches: { when?: string }[] }[])[0].branches[0].when!;
}

describe("펼칠 때 사용처 문맥에서 평가", () => {
  it("종들.합치기(waiver.reasons) — 적용 종(거름)만 · 중복 제거 · 열거형 순서", () => {
    const c = clauseWith([{ name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" }], condition("var.모든사유.있음('V02')"));
    const r = applyBindings(c, undefined, plainConst, {}, env());
    expect(r.ok && whenOf(r.value)).toBe("true");
    // 거름에 걸린 o3 만 V02 를 가지면 거짓
    const onlyExcluded = [OPTIONS[0], { id: "o3", values: { "waiver.applies": false, "waiver.reasons": ["V02"] } }];
    const r2 = applyBindings(c, undefined, plainConst, {}, env(undefined, onlyExcluded));
    expect(r2.ok && whenOf(r2.value)).toBe("false");
  });

  it("합친 목록은 열거형 순서 — 거르기(면책여부 = true)로 걸러도 순서 그대로", () => {
    const c = clauseWith(
      [
        { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
        { name: "면책", expr: "var.모든사유.거르기(F02 = true)" },
      ],
      condition("var.면책.있음('V01') and not var.면책.있음('V03')"),
    );
    const r = applyBindings(c, undefined, plainConst, {}, env());
    expect(r.ok && whenOf(r.value)).toBe("true and not false");
  });

  it("사유들.있음('V01','V02') · 비었음 — 구분자 연결 인자는 사용처 값으로", () => {
    const c = clauseWith([{ name: "암뇌", expr: "arg.사유들.있음('V01', 'V02')" }], condition("var.암뇌 and not arg.사유들.비었음"));
    const r = applyBindings(c, undefined, plainConst, {}, env({ D0001: ["V02"], D0002: "V01" }));
    expect(r.ok && whenOf(r.value)).toBe("true and not false");
  });

  it("사유 = 'V01' 은 인자 연결 그대로 늦은 바인딩 (구분자 코드로 바꿔 쓴다)", () => {
    const c = clauseWith([], condition("arg.사유 = 'V01'"));
    const r = applyBindings(c, undefined, plainConst, {}, env());
    expect(r.ok && whenOf(r.value)).toBe("D0002 = 'V01'");
  });

  it("사유.약관표시명 — 슬롯에 필드 값을 찍고, 빈 값은 미입력 오류", () => {
    const c = clauseWith([], [{ id: "s1", kind: "slot", ref: "arg.사유.F01" }]);
    const filled = applyBindings(c, undefined, plainConst, {}, env({ D0002: "V01" }));
    expect(filled.ok && filled.value.body).toEqual([{ id: "s1", kind: "text", text: "암(유사암 제외)" }]);
    const empty = applyBindings(c, undefined, plainConst, {}, env({ D0002: "V02" }));
    expect(empty.ok).toBe(false);
    if (!empty.ok && empty.rejection.reason === "invalid") expect(empty.rejection.issues[0]).toMatchObject({ kind: "notEntered", message: expect.stringMatching(/약관표시명/) });
  });

  it("평가 재료가 없으면(편집기 미리보기) 함수조항 전용 식은 손대지 않는다", () => {
    const c = clauseWith([{ name: "암", expr: "arg.사유들.있음('V01')" }], condition("var.암 and arg.사유 = 'V01'"));
    const r = applyBindings(c, undefined, plainConst);
    expect(r.ok && whenOf(r.value)).toBe("var.암 and D0002 = 'V01'");
  });
});

describe("밟지 않은 칸 · 가지는 평가하지 않는다 (지연 평가)", () => {
  /** 사유 칸 둘 — V01 칸만 약관표시명(F01) 슬롯. V02 는 F01 이 비었다. */
  const switched = clauseWith([], [
    {
      id: "sw",
      kind: "inlineSwitch",
      on: "arg.사유",
      cases: [
        { id: "k1", values: ["V01", "V03"], children: [{ id: "s1", kind: "slot", ref: "arg.사유.F01" }] },
        { id: "k2", values: ["V02"], children: [{ id: "t2", kind: "text", text: "뇌졸중" }] },
      ],
    },
  ]);

  it("값별 분기 — 고른 칸(V02) 밖의 필드 슬롯은 읽지 않는다: V02 의 약관표시명이 비어도 오류가 아니다", () => {
    const r = applyBindings(switched, undefined, plainConst, {}, env({ D0001: [], D0002: "V02" }));
    expect(r.ok).toBe(true);
  });

  it("값별 분기 — 고른 칸(V01) 안의 필드 슬롯은 값 글로 푼다", () => {
    const r = applyBindings(switched, undefined, plainConst, {}, env({ D0001: [], D0002: "V01" }));
    expect(r.ok && JSON.stringify(r.value.body)).toContain("암(유사암 제외)");
  });

  it("조건 가지 — 거짓인 가지 안의 필드 슬롯은 읽지 않는다", () => {
    const c = clauseWith([], [
      {
        id: "c1",
        kind: "inlineCond",
        branches: [
          { id: "b1", when: "arg.사유 = 'V01'", children: [{ id: "s1", kind: "slot", ref: "arg.사유.F01" }] },
          { id: "b2", children: [{ id: "t2", kind: "text", text: "그 밖" }] },
        ],
      },
    ]);
    const r = applyBindings(c, undefined, plainConst, {}, env({ D0001: [], D0002: "V02" }));
    expect(r.ok).toBe(true);
  });

  it("앞 가지가 참이면 뒤 가지의 조건 · 본문은 평가하지 않는다", () => {
    const c = clauseWith([], [
      {
        id: "c1",
        kind: "inlineCond",
        branches: [
          { id: "b1", when: "arg.사유 = 'V02'", children: [{ id: "t1", kind: "text", text: "뇌" }] },
          { id: "b2", when: "arg.사유.F01 = '암'", children: [{ id: "s2", kind: "slot", ref: "arg.사유.F01" }] },
        ],
      },
    ]);
    const r = applyBindings(c, undefined, plainConst, {}, env({ D0001: [], D0002: "V02" }));
    expect(r.ok).toBe(true);
  });
});
