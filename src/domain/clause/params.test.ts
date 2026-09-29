import { describe, expect, it } from "vitest";

import type { ExprType } from "../expression";
import { applyBindings } from "./bind";
import { boundDiscriminators, checkParams, checkUsageBindings, type BindingEnv, type ParamDef } from "./params";
import type { Clause } from "./types";

/**
 * 함수조항 인자 · 인자 연결 · 기본 연결 (최종 결정 2 · 24 · 기능/함수조항 §3.7).
 * 검사 ① 인자 표(이름 · 타입 · 기본 연결), 검사 ② 사용처 연결(누락 = 저장 오류 · 타입 불일치 · 없는 구분자), 조립의 연결 바꿔 쓰기.
 */

const TYPES: Record<string, ExprType> = {
  D0001: { kind: "string" },
  D0002: { kind: "boolean" },
  D0003: { kind: "boolean" },
  D0004: { kind: "enum", enumCode: "E0001" },
};
const env: BindingEnv = {
  discriminatorType: (code) => TYPES[code],
  enumValues: (code) => (code === "E0001" ? ["V01", "V02"] : undefined),
};

const 담보명: ParamDef = { name: "담보명", type: { kind: "string" }, default: { kind: "discriminator", code: "D0001" } };
const 갱신형: ParamDef = { name: "갱신형", type: { kind: "boolean" } };

function clause(params: ParamDef[], body: Clause["body"] = []): Clause {
  return { code: "C0001", label: "지급사유", mode: "block", body: body as never, options: [], params, required: { discriminators: [], attributes: [] } };
}

describe("검사 ① — 인자 표", () => {
  it("이름은 식에 쓰는 이름 — 비었거나 겹치거나 예약어면 오류", () => {
    const issues = checkParams([{ name: "", type: { kind: "boolean" } }, 갱신형, { ...갱신형 }, { name: "and", type: { kind: "boolean" } }, { name: "1형", type: { kind: "boolean" } }], env);
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringContaining("비어"),
      expect.stringContaining("겹칩니다: 갱신형"),
      expect.stringContaining("and"),
      expect.stringContaining("1형"),
    ]);
  });

  it("기본 연결 구분자는 인자 타입과 같아야 한다 — 다르면 typeMismatch, 없으면 brokenRef", () => {
    expect(checkParams([담보명], env)).toEqual([]);
    const wrong = checkParams([{ ...담보명, default: { kind: "discriminator", code: "D0002" } }], env);
    expect(wrong).toEqual([expect.objectContaining({ kind: "typeMismatch", message: expect.stringContaining("boolean") })]);
    const gone = checkParams([{ ...담보명, default: { kind: "discriminator", code: "D0099" } }], env);
    expect(gone).toEqual([expect.objectContaining({ kind: "brokenRef", at: { refPath: "D0099" } })]);
  });

  it("표 타입은 인자가 될 수 없다", () => {
    expect(checkParams([{ name: "표", type: { kind: "table", columns: [] } as unknown as ParamDef["type"] }], env)[0]).toMatchObject({ kind: "typeMismatch" });
  });

  it("세목 선택지 목록 인자의 기본 연결은 「원천」 — 세목 폼 + 거름(그 폼 필드의 참거짓 식) (§7-2)", () => {
    const 종들: ParamDef = { name: "종들", type: { kind: "planOptions", form: "waiver" }, default: { kind: "source", source: { form: "waiver", filter: "waiver.applies = true" } } };
    expect(checkParams([종들], env)).toEqual([]);
    const otherForm = checkParams([{ ...종들, default: { kind: "source", source: { form: "no_surrender" } } }], env);
    expect(otherForm[0]).toMatchObject({ kind: "typeMismatch" });
    const badFilter = checkParams([{ ...종들, default: { kind: "source", source: { form: "waiver", filter: "D0002" } } }], env);
    expect(badFilter[0].message).toContain("거름");
    const notPlan = checkParams([{ name: "x", type: { kind: "planOptions", form: "coverage_basic" } }], env);
    expect(notPlan[0].message).toContain("세목");
  });

  it("반복의 현재 원소 연결은 아직 지원하지 않는다 (반복 블록과 함께 연다)", () => {
    expect(checkParams([{ ...갱신형, default: { kind: "current", loop: "f1" } }], env)[0]).toMatchObject({ kind: "unsupported" });
  });
});

describe("검사 ② — 사용처 연결", () => {
  it("기본 연결 없는 인자를 연결하지 않으면 저장 오류(argUnbound)", () => {
    expect(checkUsageBindings(clause([갱신형]), undefined, env)).toEqual([expect.objectContaining({ kind: "argUnbound", at: { refPath: "arg.갱신형" } })]);
  });

  it("기본 연결이 있으면 연결 없이 통과 — 다를 때만 바꾼다", () => {
    expect(checkUsageBindings(clause([담보명]), {}, env)).toEqual([]);
  });

  it("연결 구분자 타입이 다르면 오류, 없는 구분자면 brokenRef", () => {
    expect(checkUsageBindings(clause([갱신형]), { 갱신형: { kind: "discriminator", code: "D0001" } }, env)[0]).toMatchObject({ kind: "typeMismatch" });
    expect(checkUsageBindings(clause([갱신형]), { 갱신형: { kind: "discriminator", code: "D0098" } }, env)[0]).toMatchObject({ kind: "brokenRef" });
  });

  it("상수 연결 — 타입이 맞아야 하고 열거형이면 그 열거형의 값이어야 한다", () => {
    const 사유: ParamDef = { name: "사유", type: { kind: "enum", enumCode: "E0001" } };
    expect(checkUsageBindings(clause([갱신형, 사유]), { 갱신형: { kind: "const", value: true }, 사유: { kind: "const", value: "V02" } }, env)).toEqual([]);
    expect(checkUsageBindings(clause([갱신형]), { 갱신형: { kind: "const", value: "예" } }, env)[0]).toMatchObject({ kind: "typeMismatch" });
    expect(checkUsageBindings(clause([사유]), { 사유: { kind: "const", value: "V09" } }, env)[0]).toMatchObject({ kind: "brokenRef" });
  });

  it("선언에 없는 인자에 연결하면 brokenRef", () => {
    expect(checkUsageBindings(clause([]), { 없음: { kind: "const", value: true } }, env)[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "arg.없음" } });
  });

  it("사용처가 읽는 구분자 = 직접 읽기 + 실제 연결(사용처 연결 > 기본 연결)", () => {
    const c = { ...clause([담보명, 갱신형]), required: { discriminators: ["D0009"], attributes: [] } };
    expect(boundDiscriminators(c, { 갱신형: { kind: "discriminator", code: "D0003" } })).toEqual(["D0009", "D0001", "D0003"]);
    expect(boundDiscriminators(c, { 담보명: { kind: "const", value: "골절" }, 갱신형: { kind: "const", value: true } })).toEqual(["D0009"]);
  });
});

describe("조립 — 연결로 바꿔 쓰기 (applyBindings)", () => {
  const body = [
    {
      id: "p1",
      kind: "paragraph",
      children: [
        { id: "s1", kind: "slot", ref: "arg.담보명" },
        { id: "c1", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신형 and attr.A0001 = '2'", children: [{ id: "t1", kind: "text", text: "갱신" }] }] },
      ],
    },
  ] as Clause["body"];
  const fmt = (v: string | number | boolean) => String(v);

  it("구분자 연결 — arg.X 가 그 구분자 코드가 된다(사용처 문맥에서 평가)", () => {
    const r = applyBindings(clause([담보명, 갱신형], body), { 갱신형: { kind: "discriminator", code: "D0003" } }, fmt);
    expect(r.ok && JSON.stringify(r.value.body)).toContain('"ref":"D0001"');
    expect(r.ok && JSON.stringify(r.value.body)).toContain('"when":"D0003 and attr.A0001 = \'2\'"');
  });

  it("상수 연결 — 조건은 리터럴, 슬롯은 그 값의 글", () => {
    const r = applyBindings(clause([담보명, 갱신형], body), { 담보명: { kind: "const", value: "골절진단비" }, 갱신형: { kind: "const", value: false } }, fmt);
    const text = r.ok ? JSON.stringify(r.value.body) : "";
    expect(text).toContain('{"id":"s1","kind":"text","text":"골절진단비"}');
    expect(text).toContain('"when":"false and attr.A0001 = \'2\'"');
  });

  it("연결이 빠지면 펼칠 수 없다 — argUnbound", () => {
    const r = applyBindings(clause([담보명, 갱신형], body), {}, fmt);
    expect(r.ok ? [] : r.rejection.reason === "invalid" ? r.rejection.issues.map((i) => i.kind) : []).toEqual(["argUnbound"]);
  });

  it("인자를 읽지 않는 식은 손대지 않는다", () => {
    const plain = [{ id: "p1", kind: "paragraph", children: [{ id: "s1", kind: "slot", ref: "D0001" }] }] as Clause["body"];
    const c = clause([], plain);
    const r = applyBindings(c, {}, fmt);
    expect(r.ok && r.value.body).toBe(plain);
  });
});
