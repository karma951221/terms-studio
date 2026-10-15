import { describe, expect, it } from "vitest";

import type { Block } from "./nodes";
import { normalizeRenames, renameInBody, renameInLocals, renameInPresets } from "./rename";

const renames = { params: { 사유: "면제사유", "지급사유 조": "보험금 조" }, locals: { 사유들: "모든사유" } };

describe("normalizeRenames — 남길 이름 바꾸기만", () => {
  it("같은 이름 · 지금 없는 새 이름 · 아직 쓰는 옛 이름은 뺀다", () => {
    expect(normalizeRenames({ params: { A: "A", B: "C", D: "E", F: "G" }, locals: { x: "y" } }, { params: ["C", "D", "G", "F"], locals: ["y"] })).toEqual({
      params: { B: "C" },
      locals: { x: "y" },
    });
  });
});

describe("renameInBody — 본문 식 · 슬롯 · 분기 대상 · 조 참조 인자 슬롯", () => {
  it("조건 · 슬롯 · switch 대상 · 조 참조 인자 슬롯을 함께 바꾼다 — 글은 그대로, 원본은 바꾸지 않는다", () => {
    const body: Block[] = [
      {
        id: "c",
        kind: "condBlock",
        branches: [
          {
            id: "b1",
            when: "var.사유들.있음('V01')",
            children: [
              {
                id: "p",
                kind: "paragraph",
                children: [
                  { id: "s", kind: "slot", ref: "arg.사유.F01" },
                  { id: "r", kind: "articleRef", targets: [{ param: "지급사유 조" }], scope: "param" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "w",
        kind: "switchBlock",
        on: "arg.사유",
        cases: [{ id: "k", values: ["V01"], children: [{ id: "q", kind: "paragraph", children: [{ id: "t", kind: "text", text: "arg.사유 는 글이라 그대로" }] }] }],
      },
    ];
    const json = JSON.stringify(renameInBody(body, renames));
    expect(json).toContain(`"when":"var.모든사유.있음('V01')"`);
    expect(json).toContain(`"ref":"arg.면제사유.F01"`);
    expect(json).toContain(`"param":"보험금 조"`);
    expect(json).toContain(`"on":"arg.면제사유"`);
    expect(json).toContain("arg.사유 는 글이라 그대로");
    expect(body[1]).toMatchObject({ on: "arg.사유" });
  });
});

describe("renameInLocals · renameInPresets", () => {
  it("내부 변수 선언 이름과 식(인자 · 앞 내부 변수)", () => {
    expect(
      renameInLocals(
        [
          { name: "사유들", expr: "arg.종들.합치기(waiver.reasons)" },
          { name: "암", expr: "var.사유들.있음('V01') and arg.사유 = 'V01'" },
        ],
        renames,
      ),
    ).toEqual([
      { name: "모든사유", expr: "arg.종들.합치기(waiver.reasons)" },
      { name: "암", expr: "var.모든사유.있음('V01') and arg.면제사유 = 'V01'" },
    ]);
  });

  it("프리셋 연결 키 · 사용처가 채움 이름", () => {
    expect(renameInPresets([{ code: "S01", name: "상해", bindings: { 사유: { kind: "const", value: "V01" } }, fromUsage: ["지급사유 조"] }], renames)).toEqual([
      { code: "S01", name: "상해", bindings: { 면제사유: { kind: "const", value: "V01" } }, fromUsage: ["보험금 조"] },
    ]);
  });
});
