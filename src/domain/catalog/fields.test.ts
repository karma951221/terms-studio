import { describe, expect, it } from "vitest";

import type { NextSeq } from "./codes";
import { reviseEnum } from "./definitions";
import { enumFieldByLabel, enumFields, enumFieldValue } from "./fields";
import type { EnumDef } from "./types";

/** 테스트용 순번 소스 — (kind, scope) 마다 1 부터. 필드는 F01 부터, 값은 기존 V02 다음부터. */
function seq(): NextSeq {
  const counters = new Map<string, number>([["enumValue:E0001", 2], ["enumField:E0001", 1]]);
  return (kind, scope) => {
    const key = `${kind}:${scope}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return n;
  };
}

/** 납입면제사유 — 필드 약관표시명(문자열) 하나가 이미 있다. */
const 사유: EnumDef = {
  code: "E0001",
  label: "납입면제사유",
  fields: [{ key: "F01", label: "약관표시명", type: "string", order: 0 }],
  values: [
    { code: "V01", label: "암·면책", order: 0, fields: { F01: "암(유사암제외)" } },
    { code: "V02", label: "뇌졸중", order: 1 },
  ],
};

const kept = [
  { code: "V01", label: "암·면책" },
  { code: "V02", label: "뇌졸중" },
];

const revise = (revision: Partial<Parameters<typeof reviseEnum>[1]>) =>
  reviseEnum(사유, { label: "납입면제사유", description: "", values: kept, ...revision }, { existingEnumLabels: [], nextSeq: seq() });

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection(r: { ok: boolean; rejection?: { reason: string } }): string | undefined {
  return r.ok ? undefined : r.rejection?.reason;
}

describe("열거형 유저 정의 필드 — reviseEnum (ADR-0078 결정 2)", () => {
  it("새 필드를 더하면 F 코드를 받고, 같은 저장에서 그 필드에 값을 넣을 수 있다", async () => {
    const r = unwrap(
      await revise({
        fields: [
          { key: "F01", label: "약관표시명", type: "string" },
          { ref: "new:1", label: "면책여부", type: "boolean" },
        ],
        values: [
          { code: "V01", label: "암·면책", fields: { F01: "암(유사암제외)", "new:1": true } },
          { code: "V02", label: "뇌졸중", fields: { "new:1": false } },
        ],
      }),
    );
    expect(r.def.fields).toEqual([
      { key: "F01", label: "약관표시명", type: "string", order: 0 },
      { key: "F02", label: "면책여부", type: "boolean", order: 1 },
    ]);
    expect(r.def.values.map((v) => v.fields)).toEqual([{ F01: "암(유사암제외)", F02: true }, { F02: false }]);
    expect(r.removedFields).toEqual([]);
    expect(r.retypedFields).toEqual([]);
  });

  it("필드 이름이 겹치면 거부 — 공백 · 대소문자를 무시하고 비교", async () => {
    const r = await revise({ fields: [{ key: "F01", label: "약관표시명", type: "string" }, { ref: "new:1", label: " 약관표시명 ", type: "boolean" }] });
    expect(rejection(r)).toBe("duplicate");
  });

  it("필드 이름을 비우면 거부 · 모르는 필드 코드는 notFound · 모르는 타입은 거부", async () => {
    expect(rejection(await revise({ fields: [{ key: "F01", label: " ", type: "string" }] }))).toBe("invalid");
    expect(rejection(await revise({ fields: [{ key: "F09", label: "x", type: "string" }] }))).toBe("notFound");
    expect(rejection(await revise({ fields: [{ key: "F01", label: "x", type: "number" as "string" }] }))).toBe("invalid");
  });

  it("boolean 필드에 문자열 값이면 거부 · 문자열 필드에 참거짓이면 거부 · 없는 필드 값이면 거부", async () => {
    const fields = [
      { key: "F01", label: "약관표시명", type: "string" as const },
      { ref: "new:1", label: "면책여부", type: "boolean" as const },
    ];
    expect(rejection(await revise({ fields, values: [{ code: "V01", label: "암·면책", fields: { "new:1": "예" } }] }))).toBe("invalid");
    expect(rejection(await revise({ fields, values: [{ code: "V01", label: "암·면책", fields: { F01: true } }] }))).toBe("invalid");
    expect(rejection(await revise({ fields, values: [{ code: "V01", label: "암·면책", fields: { F07: "x" } }] }))).toBe("invalid");
  });

  it("빈 값은 미입력 — 빈 문자열 · 공백 · null 은 키 없음으로 저장", async () => {
    const r = unwrap(await revise({ values: [{ code: "V01", label: "암·면책", fields: { F01: "  " } }, { code: "V02", label: "뇌졸중", fields: { F01: null } }] }));
    expect(r.def.values.map((v) => v.fields)).toEqual([undefined, undefined]);
  });

  it("필드를 지우면 removedFields 에 오르고 값의 그 키가 빠진다", async () => {
    const r = unwrap(await revise({ fields: [], values: [{ code: "V01", label: "암·면책" }, { code: "V02", label: "뇌졸중" }] }));
    expect(r.removedFields).toEqual(["F01"]);
    expect(r.def.fields).toBeUndefined();
    expect(r.def.values[0]!.fields).toBeUndefined();
  });

  it("타입을 바꾸면 retypedFields 에 오르고, 옛 타입 값은 넘겨 두지 않는다", async () => {
    const r = unwrap(await revise({ fields: [{ key: "F01", label: "약관표시명", type: "boolean" }] }));
    expect(r.retypedFields).toEqual(["F01"]);
    expect(r.def.values[0]!.fields).toBeUndefined(); // "암(유사암제외)" 는 참거짓이 아니라 버려진다
  });

  it("fields 를 주지 않으면 필드 정의와 값의 필드 값을 그대로 둔다 (옛 호출)", async () => {
    const r = unwrap(await revise({}));
    expect(r.def.fields).toEqual(사유.fields);
    expect(r.def.values[0]!.fields).toEqual({ F01: "암(유사암제외)" });
  });

  it("필드 순서 = 배열 순서 · 이름 바꾸기는 코드를 지킨다", async () => {
    const r = unwrap(
      await revise({ fields: [{ ref: "new:1", label: "정의조대상", type: "boolean" }, { key: "F01", label: "표시명", type: "string" }] }),
    );
    expect(r.def.fields?.map((f) => [f.key, f.label, f.order])).toEqual([["F02", "정의조대상", 0], ["F01", "표시명", 1]]);
    expect(r.def.values[0]!.fields).toEqual({ F01: "암(유사암제외)" });
  });
});

describe("열거값 필드 조회 — 뒤 페이즈가 읽는 자리", () => {
  it("값이 있으면 value · 빈 칸은 notEntered · 모르는 필드 · 모르는 값은 따로", () => {
    expect(enumFieldValue(사유, "V01", "F01")).toEqual({ kind: "value", value: "암(유사암제외)" });
    expect(enumFieldValue(사유, "V02", "F01")).toEqual({ kind: "notEntered" });
    expect(enumFieldValue(사유, "V01", "F09")).toEqual({ kind: "unknownField" });
    expect(enumFieldValue(사유, "V09", "F01")).toEqual({ kind: "unknownValue" });
  });

  it("필드 목록은 순서대로 · 없으면 빈 목록 · 이름으로 찾기", () => {
    expect(enumFields({ code: "E0002", label: "x", values: [] })).toEqual([]);
    expect(enumFieldByLabel(사유, " 약관표시명")?.key).toBe("F01");
    expect(enumFieldByLabel(사유, "없음")).toBeUndefined();
  });
});
