/**
 * 열거형 편집 초안 → 서비스 입력 — 빈 새 행 버림(디자인원칙 §2 L2) · 뺀 필드 칸 걷기 · 생성은 필드 ref 로.
 */
import { describe, expect, it } from "vitest";

import { enumEditPayload, newEnumPayload } from "./edit-payload";

describe("enumEditPayload — 상세 저장", () => {
  it("빈 채로 남은 새 행(필드 · 값)은 버린다 · 저장된 행은 이름을 비워도 남긴다 · 뺀 필드의 칸은 걷는다", () => {
    const out = enumEditPayload({
      label: "사유",
      description: "",
      fields: [{ key: "F01", label: "표시명", type: "string" }, { key: "new:1", label: " ", type: "boolean" }, { key: "new:2", label: "면책", type: "boolean" }],
      values: [
        { code: "V01", label: "", fields: { F01: "암", F09: "옛 칸", "new:2": true } },
        { code: "new:1", label: "" },
        { code: "new:2", label: "뇌졸중", fields: { "new:2": false } },
      ],
    });
    expect(out.fields).toEqual([{ key: "F01", label: "표시명", type: "string" }, { ref: "new:2", label: "면책", type: "boolean" }]);
    expect(out.values).toEqual([{ code: "V01", label: "", fields: { F01: "암", "new:2": true } }, { label: "뇌졸중", fields: { "new:2": false } }]);
  });
});

describe("newEnumPayload — 생성 (이름 · 값 · 필드 한 번에)", () => {
  it("필드는 ref 로 · 값의 칸은 그 ref 로 · 빈 행은 버린다 · 값 하나만 써도 된다", () => {
    expect(
      newEnumPayload({
        label: " 납입면제사유 ",
        description: "",
        fields: [{ key: "new:1", label: "약관표시명", type: "string" }, { key: "new:2", label: "", type: "string" }],
        values: [{ code: "new:1", label: "암", fields: { "new:1": "암(유사암제외)" } }, { code: "new:2", label: "" }],
      }),
    ).toEqual({ label: "납입면제사유", fields: [{ ref: "new:1", label: "약관표시명", type: "string" }], values: [{ label: "암", fields: { "new:1": "암(유사암제외)" } }] });
  });

  it("필드가 없으면 fields 를 싣지 않는다 · 값 0 개여도 된다", () => {
    expect(newEnumPayload({ label: "고지유형", description: "", fields: [], values: [{ code: "new:1", label: "" }] })).toEqual({ label: "고지유형", values: [] });
  });
});
