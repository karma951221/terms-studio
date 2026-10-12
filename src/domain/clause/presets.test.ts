import { describe, expect, it } from "vitest";

import type { ParamDef } from "./params";
import { checkPresets, presetUsage, unfoldPreset, type PresetDef } from "./presets";
import type { Clause } from "./types";

/**
 * 함수조항 프리셋 (ADR-0084) — 인자 연결 · 옵션 선택의 이름 붙은 조합을 함수조항 안에 두고 사용처는 참조한다.
 */

const 사유: ParamDef = { name: "사유", type: { kind: "enum", enumCode: "E0001" } };
const 담보명: ParamDef = { name: "담보명", type: { kind: "string" }, default: { kind: "discriminator", code: "D0001" } };
const 지급사유: ParamDef = { name: "지급사유 조", type: { kind: "articleRef" } };

function clause(presets: PresetDef[] = [], params: ParamDef[] = [사유, 담보명, 지급사유]): Clause {
  return {
    code: "C0022",
    label: "납입면제 호",
    mode: "item",
    body: [],
    options: [{ code: "O01", label: "기산", order: 0, values: [{ code: "V01", label: "계약일", order: 0, body: [] }, { code: "V02", label: "최초계약일", order: 1, body: [] }] }],
    params,
    presets,
    required: { discriminators: [], attributes: [] },
  };
}

const 상해: PresetDef = { code: "S01", name: "상해", options: { O01: "V01" }, bindings: { 사유: { kind: "const", value: "V01" } } };
const env = { enumValues: (code: string) => (code === "E0001" ? ["V01", "V02"] : undefined) };

describe("검사 ① — 프리셋 (결정 1 · 3 · 6)", () => {
  it("옵션마다 선택 · 기본 연결 없는 값 인자마다 연결이 있으면 통과 — 기본 연결 있는 인자 · 조 참조 인자는 비워 둔다", () => {
    expect(checkPresets(clause([상해]), env)).toEqual([]);
  });

  it("빈 값은 저장 거부 — 「프리셋 ‘상해’ 에 옵션 O01 선택이 비었습니다」 · 인자도 같다", () => {
    const issues = checkPresets(clause([{ code: "S01", name: "상해" }]), env);
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("프리셋 ‘상해’ 에 옵션 O01 선택이 비었습니다"), expect.stringContaining("프리셋 ‘상해’ 에 인자 사유 연결이 비었습니다")]);
  });

  it("「사용처가 채움」을 명시로 고른 인자는 비어도 된다 (2026-10-12 사용자 결정)", () => {
    expect(checkPresets(clause([{ code: "S01", name: "상해", options: { O01: "V01" }, fromUsage: ["사유"] }]), env)).toEqual([]);
  });

  it("깨진 선택 · 없는 옵션 · 없는 인자 · 타입 불일치 · 담지 않는 연결(조 참조 · 반복의 현재 원소)은 거부", () => {
    const bad: PresetDef = {
      code: "S01",
      name: "상해",
      options: { O01: "V09", O09: "V01" },
      bindings: { 사유: { kind: "const", value: "V07" }, 없음: { kind: "const", value: "x" }, "지급사유 조": { kind: "articleRef", targets: [{ articleId: "a" }], scope: "self" } },
    };
    const kinds = checkPresets(clause([bad]), env).map((i) => i.kind);
    expect(kinds).toEqual(["optionInvalid", "optionInvalid", "brokenRef", "brokenRef", "structure"]);
    const current: PresetDef = { ...상해, bindings: { 사유: { kind: "current", loop: "f1" } } };
    expect(checkPresets(clause([current]), env).map((i) => i.kind)).toEqual(["structure"]);
  });

  it("이름은 비지 않고 함수조항 안에서 겹치지 않는다 · 코드는 S + 두 자리, 겹치지 않는다", () => {
    const issues = checkPresets(clause([상해, { ...상해, code: "S02" }, { ...상해, code: "S01", name: "질병" }, { ...상해, code: "S03", name: " " }]), env);
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining("이름이 겹칩니다: 상해"), expect.stringContaining("코드가 겹칩니다: S01"), expect.stringContaining("이름이 비어")]);
  });
});

describe("사용처의 실제 값 — 프리셋 → 기본 연결, 덮어쓰기 금지 (결정 2 · 4)", () => {
  it("프리셋이 없으면 사용처 값 그대로", () => {
    expect(presetUsage(clause([상해]), { options: { O01: "V02" }, bindings: { 사유: { kind: "const", value: "V02" } } })).toEqual({ options: { O01: "V02" }, bindings: { 사유: { kind: "const", value: "V02" } }, issues: [] });
  });

  it("프리셋이면 옵션 · 연결은 프리셋 값, 사용처는 조 참조 인자 · 「사용처가 채움」 인자만 댄다", () => {
    const ref = { kind: "articleRef" as const, targets: [{ articleId: "a1" }], scope: "self" as const };
    const r = presetUsage(clause([상해]), { preset: "S01", options: {}, bindings: { "지급사유 조": ref } });
    expect(r).toEqual({ options: { O01: "V01" }, bindings: { 사유: { kind: "const", value: "V01" }, "지급사유 조": ref }, preset: 상해, issues: [] });
  });

  it("프리셋을 쓰는 자리가 값을 덮어쓰면 오류 — 풀어 직접 연결로", () => {
    const r = presetUsage(clause([상해]), { preset: "S01", options: { O01: "V02" }, bindings: { 사유: { kind: "const", value: "V02" } } });
    expect(r.issues.map((i) => i.kind)).toEqual(["structure", "structure"]);
    expect(r.options).toEqual({ O01: "V01" });
  });

  it("없는 프리셋을 가리키면 깨진 참조", () => {
    expect(presetUsage(clause([상해]), { preset: "S09", options: {} }).issues.map((i) => i.kind)).toEqual(["brokenRef"]);
  });
});

describe("프리셋 풀기 — 프리셋 값을 직접 연결 · 옵션 선택으로 옮긴다 (결정 4 · 7)", () => {
  it("출력이 같은 직접 연결 — 사용처가 대던 조 참조 연결은 남는다", () => {
    const ref = { kind: "articleRef" as const, targets: [{ articleId: "a1" }], scope: "self" as const };
    expect(unfoldPreset(clause([상해]), { preset: "S01", options: {}, bindings: { "지급사유 조": ref } })).toEqual({ options: { O01: "V01" }, bindings: { 사유: { kind: "const", value: "V01" }, "지급사유 조": ref } });
  });
});
