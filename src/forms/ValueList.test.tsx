import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnumDef, EnumLookup } from "@/domain/catalog/types";
import type { MasterForm } from "@/domain/master";
import { entered, type ValueSlot } from "@/domain/types";

import { buildForm } from "./model";
import { ValueList } from "./ValueList";

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

const master: MasterForm[] = [
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    fields: [
      { key: "exempt", label: "면책여부", type: { kind: "boolean" } },
      { key: "rate", label: "지급률", type: { kind: "number" }, defaultValue: 100 },
      { key: "notice", label: "고지유형", type: { kind: "enum", enumCode: "E0001" } },
    ],
  },
];

function render(current: Map<string, ValueSlot> = new Map()) {
  return renderToStaticMarkup(<ValueList model={buildForm("benefit", enums, current, undefined, master)} />);
}

describe("ValueList — 읽기 전용 값 목록 (완결성 표시)", () => {
  it("입력된 값은 표시명으로, 미입력은 「미입력」 배지로 강조한다", () => {
    const html = render(
      new Map([
        ["pay.exempt", entered(false)],
        ["pay.notice", entered("V02")],
      ]),
    );
    expect(html).toContain("아니오");
    expect(html).toContain("간편심사");
    expect(html).not.toContain("V02");
    expect((html.match(/미입력/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("기본값이 있어도 저장 전엔 미입력이다 — 기본값을 값처럼 보여주지 않는다", () => {
    const html = render();
    expect(html).not.toContain("100");
    expect((html.match(/미입력/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("모두 입력되면 값만 표시한다", () => {
    const html = render(
      new Map([
        ["pay.exempt", entered(true)],
        ["pay.rate", entered(80)],
        ["pay.notice", entered("V01")],
      ]),
    );
    expect(html).not.toContain("ts-values-summary");
    expect(html).not.toContain("ts-progress");
    expect(html).not.toContain("미입력");
  });

  it("라벨은 필드 표시명", () => {
    const html = render();
    expect(html).toContain("면책여부");
    expect(html).toContain("지급률");
    expect(html).toContain("고지유형");
  });
});
