import { describe, expect, it } from "vitest";

import type { ParamDef } from "@/domain/clause";

import { localEntries, localsForDisplay, localsForSave } from "./locals";
import type { EnumChoice } from "./params";

const ENUMS: EnumChoice[] = [
  {
    code: "E0001",
    label: "납입면제사유",
    values: [
      { code: "V01", label: "암" },
      { code: "V02", label: "뇌졸중" },
    ],
    fields: [
      { key: "F01", label: "약관표시명", type: "string" },
      { key: "F02", label: "면책여부", type: "boolean" },
    ],
  },
];
const PARAMS: ParamDef[] = [
  { name: "종들", type: { kind: "planOptions", form: "waiver" } },
  { name: "사유", type: { kind: "enum", enumCode: "E0001" } },
];

describe("내부 변수 표 — 필드는 화면에서 이름, 저장은 키 (최종 결정 18 · ADR-0005)", () => {
  it("저장할 때 필드 이름을 키로 · 빈 행은 버린다 · 화면에 보일 때 다시 이름으로", () => {
    const shown = [
      { name: " 모든사유 ", expr: "arg.종들.합치기(waiver.reasons)" },
      { name: "면책", expr: "var.모든사유.거르기(면책여부 = true)" },
      { name: "표시", expr: "arg.사유.약관표시명" },
      { name: "", expr: "" },
    ];
    const saved = localsForSave(PARAMS, shown, ENUMS);
    expect(saved).toEqual([
      { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
      { name: "면책", expr: "var.모든사유.거르기(F02 = true)" },
      { name: "표시", expr: "arg.사유.F01" },
    ]);
    expect(localsForDisplay(PARAMS, saved, ENUMS).map((l) => l.expr)).toEqual(["arg.종들.합치기(waiver.reasons)", "var.모든사유.거르기(면책여부 = true)", "arg.사유.약관표시명"]);
  });

  it("식으로 안 읽히는 글은 그대로 둔다 — 저장 검사가 문법 오류를 알린다", () => {
    expect(localsForSave(PARAMS, [{ name: "a", expr: "arg.사유 = (" }], ENUMS)).toEqual([{ name: "a", expr: "arg.사유 = (" }]);
  });
});

describe("조건 · 슬롯 고르기의 「내부 변수」 칸", () => {
  it("참거짓 · 열거값 내부 변수는 고를 수 있고 열거값이면 필드 칸도 · 목록은 타입 없이", () => {
    const entries = localEntries(
      PARAMS,
      [
        { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
        { name: "암있음", expr: "var.모든사유.있음('V01')" },
        { name: "대표", expr: "arg.사유" },
      ],
      ENUMS,
    );
    expect(entries.map((e) => [e.code, e.label, e.type?.kind, e.local])).toEqual([
      ["var.모든사유", "모든사유(내부 변수)", undefined, true],
      ["var.암있음", "암있음(내부 변수)", "boolean", true],
      ["var.대표", "대표(내부 변수)", "enum", true],
      ["var.대표.F01", "대표.약관표시명", "string", true],
      ["var.대표.F02", "대표.면책여부", "boolean", true],
    ]);
  });
});
