import { describe, expect, it } from "vitest";

import type { CtxDiscriminator, CtxNode } from "@/app/(app)/documents/[id]/_components/condition/types";

import { bindingLabel, bindingOfValue, bindingOptions, bindingValue, newParamNameError, paramEntries, typeLabel, typeOfValue, typeValue } from "./params";

const discriminators = [
  { code: "D0001", label: "갱신여부", level: "coverage" as const, type: { kind: "boolean" as const }, forms: [] },
  { code: "D0002", label: "담보명", level: "coverage" as const, type: { kind: "string" as const }, forms: [] },
  { code: "D0003", label: "사유", level: "plan" as const, type: { kind: "enum" as const, enumCode: "E0001" }, forms: [] },
];
const enums = [{ code: "E0001", label: "납입면제사유", values: [{ code: "V01", label: "암" }] }];
const forms = [{ key: "waiver", label: "납입면제", booleanFields: [{ key: "applies", label: "적용여부" }] }];

describe("인자 표 칸 값 (기능/함수조항 §4.3)", () => {
  it("타입 칸 값은 왕복한다", () => {
    for (const t of [{ kind: "boolean" as const }, { kind: "enum" as const, enumCode: "E0001" }, { kind: "planOptions" as const, form: "waiver" }]) expect(typeOfValue(typeValue(t))).toEqual(t);
  });

  it("연결 칸 후보는 타입이 같은 구분자 + 상수 — 세목 선택지 목록은 원천(폼 전체 · 참거짓 필드 = 예)", () => {
    expect(bindingOptions({ kind: "boolean" }, discriminators, enums, forms, true).map((o) => o.value)).toEqual(["d:D0001", "c:true", "c:false"]);
    expect(bindingOptions({ kind: "enum", enumCode: "E0001" }, discriminators, enums, forms, false).map((o) => o.value)).toEqual(["d:D0003"]);
    expect(bindingOptions({ kind: "planOptions", form: "waiver" }, discriminators, enums, forms, false).map((o) => o.label)).toEqual(["납입면제 — 모든 선택지", "납입면제 — 적용여부 = 예인 선택지"]);
  });

  it("연결 칸 값은 왕복한다 — 원천 「적용여부 = 예」는 거름 식 waiver.applies = true", () => {
    const source = bindingOfValue("s:waiver:applies", { kind: "planOptions", form: "waiver" });
    expect(source).toEqual({ kind: "source", source: { form: "waiver", filter: "waiver.applies = true" } });
    expect(bindingValue(source)).toBe("s:waiver:applies");
    expect(bindingOfValue("c:false", { kind: "boolean" })).toEqual({ kind: "const", value: false });
    expect(bindingLabel({ kind: "discriminator", code: "D0001" }, { kind: "boolean" }, discriminators, enums, forms)).toBe("갱신여부 (D0001)");
  });

  it("반복의 현재 원소 — 원소 타입이 같은 감싼 반복만 후보(열거값 → enum 인자 · 종 → 세목 선택지 목록 인자), 칸 값 r:<반복 id> 은 왕복한다", () => {
    const loops = [
      { id: "fo", label: "현재 종 — 납입면제종마다", type: { kind: "planOptions" as const, form: "waiver" } },
      { id: "fi", label: "현재 원소 — 납입면제사유마다", type: { kind: "enum" as const, enumCode: "E0001" } },
    ];
    expect(bindingOptions({ kind: "enum", enumCode: "E0001" }, discriminators, enums, forms, false, loops).map((o) => o.value)).toEqual(["r:fi", "d:D0003"]);
    expect(bindingOptions({ kind: "planOptions", form: "waiver" }, discriminators, enums, forms, false, loops)[0]).toEqual({ value: "r:fo", label: "현재 종 — 납입면제종마다", group: "반복" });
    const current = bindingOfValue("r:fi", { kind: "enum", enumCode: "E0001" });
    expect(current).toEqual({ kind: "current", loop: "fi" });
    expect(bindingValue(current)).toBe("r:fi");
    expect(bindingLabel(current, { kind: "enum", enumCode: "E0001" }, discriminators, enums, forms, loops)).toBe("현재 원소 — 납입면제사유마다");
  });

  it("인자는 조건 · 슬롯 고르기에 arg.<이름> 칸으로 선다 — 세목 선택지 목록은 타입 없이", () => {
    const entries = paramEntries([{ name: "갱신형", type: { kind: "boolean" } }, { name: "종들", type: { kind: "planOptions", form: "waiver" } }, { name: "", type: { kind: "string" } }], enums);
    expect(entries.map((e) => [e.code, e.type?.kind, e.param])).toEqual([
      ["arg.갱신형", "boolean", true],
      ["arg.종들", undefined, true],
    ]);
  });
});

describe("인자 추가 줄의 이름 검사 (2026-10-01)", () => {
  const ps = [{ name: "사유", type: { kind: "boolean" as const } }];
  it("비었음 · 겹침 · 모양은 막고, 맞으면 null", () => {
    expect(newParamNameError(ps, "  ")).toBe("인자 이름을 적는다");
    expect(newParamNameError(ps, "사유")).toContain("겹칩니다");
    expect(newParamNameError(ps, "두 단어")).toContain("글자로 시작");
    expect(newParamNameError(ps, "갱신형")).toBeNull();
  });
});

describe("조 참조 인자 (ADR-0083 결정 2 · 7)", () => {
  const 지급사유 = { name: "보험금의 지급사유 조", type: { kind: "articleRef" as const } };
  it("타입 칸 값 「articleRef」은 왕복하고 「조 참조」로 읽힌다 · 기본 연결 후보가 없다", () => {
    expect(typeOfValue(typeValue(지급사유.type))).toEqual({ kind: "articleRef" });
    expect(typeLabel(지급사유.type, [], [])).toBe("조 참조");
    expect(bindingOptions(지급사유.type, [{ code: "D0001", label: "x", level: "product", forms: [], type: { kind: "boolean" } }], [], [], true)).toEqual([]);
    expect(bindingLabel(undefined, 지급사유.type, [], [], [])).toBe("조 참조 인자는 넣는 자리마다 연결합니다");
  });
  it("조건 · 슬롯 고르기에 나오지 않는다", () => {
    expect(paramEntries([지급사유], [])).toEqual([]);
  });
  it("이름에 띄어쓰기를 쓸 수 있다 — 값 인자는 막는다", () => {
    expect(newParamNameError([], "보험금의 지급사유 조", { kind: "articleRef" })).toBeNull();
    expect(newParamNameError([], "보험금의 지급사유 조")).not.toBeNull();
  });
});

describe("키 경로 연결 칸 (ADR-0087 결정 4 · 7)", () => {
  const discs: CtxDiscriminator[] = [
    { code: "D0007", label: "감액 여부", level: "subCoverage", type: { kind: "boolean" }, forms: [] },
    { code: "D0008", label: "급부 여부", level: "benefit", type: { kind: "boolean" }, forms: [] },
  ];
  const nodes: CtxNode[] = [
    { id: "cov", level: "coverage", name: "암" },
    { id: "s1", level: "subCoverage", name: "유사암", parentId: "cov", key: "01", keyPath: "01" },
    { id: "b1", level: "benefit", name: "진단", parentId: "s1", key: "1", keyPath: "01.1" },
  ];
  it("노드 묶음 · 현재 묶음 · 값 인코딩", () => {
    const opts = bindingOptions({ kind: "boolean" }, discs, [], [], false, [], { nodes, loops: [{ id: "f", level: "subCoverage" }] });
    expect(opts).toContainEqual({ value: "d:D0007@01", label: "세부보장 01 · 유사암 › 감액 여부", group: "세부보장 01 · 유사암" });
    expect(opts).toContainEqual({ value: "d:D0007@cur:f", label: "현재 세부보장 › 감액 여부", group: "현재 세부보장" });
    expect(opts).toContainEqual({ value: "d:D0008@01.1", label: "세부보장 01 · 유사암 › 급부 1 · 진단 › 급부 여부", group: "세부보장 01 · 유사암 › 급부 1 · 진단" });
    expect(opts.some((o) => o.value === "d:D0007" || o.value === "d:D0008")).toBe(false);
    // 세부보장마다 안에서는 급부 레벨 구분자를 「현재」로 내지 않는다
    expect(opts.some((o) => o.value === "d:D0008@cur:f")).toBe(false);
    expect(bindingOfValue("d:D0007@01", { kind: "boolean" })).toEqual({ kind: "discriminator", code: "D0007", node: { path: "01" } });
    expect(bindingOfValue("d:D0007@cur:f", { kind: "boolean" })).toEqual({ kind: "discriminator", code: "D0007", node: { current: "f" } });
    expect(bindingValue({ kind: "discriminator", code: "D0007", node: { path: "01" } })).toBe("d:D0007@01");
    expect(bindingValue({ kind: "discriminator", code: "D0007", node: { current: "f" } })).toBe("d:D0007@cur:f");
    expect(bindingLabel({ kind: "discriminator", code: "D0007", node: { path: "01" } }, { kind: "boolean" }, discs, [], [], [], { nodes, loops: [] })).toBe("세부보장 01 · 유사암 › 감액 여부");
  });
  it("하위 레벨 기본 연결(한정 없음)의 표시는 담보약관에서도 이름으로", () => {
    expect(bindingLabel({ kind: "discriminator", code: "D0007" }, { kind: "boolean" }, discs, [], [], [], { nodes, loops: [] })).toBe("감액 여부 (D0007)");
  });
  it("반복 목록이 없는 화면(문서 본문 표시)의 현재 노드 연결은 이름으로", () => {
    expect(bindingLabel({ kind: "discriminator", code: "D0007", node: { current: "f" } }, { kind: "boolean" }, discs, [], [], [], { nodes, loops: [] })).toBe("현재 노드 › 감액 여부");
  });
  it("급부 반복은 세부보장 · 급부 레벨 모두 현재로 낸다 · 트리 없으면(프리셋 · 일반) 평면 후보", () => {
    const opts = bindingOptions({ kind: "boolean" }, discs, [], [], false, [], { nodes, loops: [{ id: "g", level: "benefit" }] });
    expect(opts.map((o) => o.value)).toEqual(expect.arrayContaining(["d:D0007@cur:g", "d:D0008@cur:g"]));
    expect(bindingOptions({ kind: "boolean" }, discs, [], [], false).map((o) => o.value)).toEqual(["d:D0007", "d:D0008"]);
  });
});
