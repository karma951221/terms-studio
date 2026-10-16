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

  it("기본 연결에는 반복의 현재 원소를 둘 수 없다 — 넣는 자리(반복 블록 안)에서 연결한다 (ADR-0077 결정 3)", () => {
    expect(checkParams([{ ...갱신형, default: { kind: "current", loop: "f1" } }], env)[0]).toMatchObject({ kind: "structure", message: expect.stringContaining("기본 연결") });
  });

  it("사용처의 현재 원소 연결 — 자리를 모르면(loops 없음) 건너뛰고, 감싼 반복이 없으면 반복 밖 오류", () => {
    const c = clause([갱신형]);
    const bindings = { 갱신형: { kind: "current" as const, loop: "f1" } };
    expect(checkUsageBindings(c, bindings, env)).toEqual([]);
    expect(checkUsageBindings(c, bindings, { ...env, loops: new Map() })).toEqual([expect.objectContaining({ kind: "structure", message: expect.stringContaining("반복 밖") })]);
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

  it("사용처가 읽는 구분자 = 실제 연결(사용처 연결 > 기본 연결)", () => {
    const c = clause([담보명, 갱신형]);
    expect(boundDiscriminators(c, { 갱신형: { kind: "discriminator", code: "D0003" } })).toEqual(["D0001", "D0003"]);
    expect(boundDiscriminators(c, { 담보명: { kind: "const", value: "골절" }, 갱신형: { kind: "const", value: true } })).toEqual([]);
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

  it("키 경로 연결은 D@키경로 로, 「현재」 연결은 한정자 없는 참조로 바꿔 쓴다 (ADR-0087 결정 4)", () => {
    const c = clause([{ name: "감액", type: { kind: "boolean" } }], [{ id: "p", kind: "paragraph", children: [{ id: "c", kind: "inlineCond", branches: [{ id: "b", when: "arg.감액 = true", children: [{ id: "t", kind: "text", text: "있음" }] }] }] }] as Clause["body"]);
    const keyed = applyBindings(c, { 감액: { kind: "discriminator", code: "D0007", node: { path: "01" } } }, fmt);
    expect(keyed.ok && JSON.stringify(keyed.value.body)).toContain("D0007@01 = true");
    const current = applyBindings(c, { 감액: { kind: "discriminator", code: "D0007", node: { current: "loop-1" } } }, fmt);
    expect(current.ok && JSON.stringify(current.value.body)).toContain('"D0007 = true"');
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

describe("조 참조 인자 (ADR-0083 결정 2 · 5)", () => {
  const 지급사유: ParamDef = { name: "보험금의 지급사유 조", type: { kind: "articleRef" } };
  const 연결 = { kind: "articleRef" as const, targets: [{ articleId: "a1" }], scope: "self" as const };

  it("이름은 식에 안 들어가 공백을 허용한다 — 비었거나 겹치면 오류는 같다", () => {
    expect(checkParams([지급사유], env)).toEqual([]);
    expect(checkParams([지급사유, { ...지급사유 }, { name: " ", type: { kind: "articleRef" } }], env).map((i) => i.message)).toEqual([
      expect.stringContaining("겹칩니다: 보험금의 지급사유 조"),
      expect.stringContaining("비어"),
    ]);
  });

  it("기본 연결이 없다 — 두면 오류 「조 참조 인자는 넣는 자리마다 연결합니다」", () => {
    const issues = checkParams([{ ...지급사유, default: { kind: "const", value: "x" } }], env);
    expect(issues.map((i) => [i.kind, i.message])).toEqual([["structure", expect.stringContaining("조 참조 인자는 넣는 자리마다 연결합니다")]]);
  });

  it("미연결 = argUnbound · 조 참조 인자에는 조 참조 연결만 · 값 인자에 조 참조 연결은 타입 불일치", () => {
    expect(checkUsageBindings(clause([지급사유]), undefined, env).map((i) => i.kind)).toEqual(["argUnbound"]);
    expect(checkUsageBindings(clause([지급사유]), { "보험금의 지급사유 조": 연결 }, env)).toEqual([]);
    expect(checkUsageBindings(clause([지급사유]), { "보험금의 지급사유 조": { kind: "const", value: "제1조" } }, env).map((i) => i.kind)).toEqual(["typeMismatch"]);
    expect(checkUsageBindings(clause([갱신형]), { 갱신형: 연결 }, env).map((i) => i.kind)).toEqual(["typeMismatch"]);
  });

  it("조 참조 연결은 구분자를 읽지 않는다", () => {
    expect(boundDiscriminators(clause([지급사유, 담보명]), { "보험금의 지급사유 조": 연결 })).toEqual(["D0001"]);
  });
});
