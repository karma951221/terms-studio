import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ParamDef } from "@/domain/clause";

import type { ClauseEditOption, ClauseEditPreset } from "../edit-types";
import { FROM_USAGE, PresetsPane, withPresetArg } from "./PresetsPane";

const options: ClauseEditOption[] = [{ code: "O01", label: "기산", values: [{ code: "V01", label: "계약일", text: "계약일" }, { code: "V02", label: "최초계약일", text: "최초계약일" }] }];
const params: ParamDef[] = [
  { name: "사유", type: { kind: "enum", enumCode: "E0001" } },
  { name: "담보명", type: { kind: "string" }, default: { kind: "discriminator", code: "D0001" } },
  { name: "지급사유 조", type: { kind: "articleRef" } },
];
const 상해: ClauseEditPreset = { code: "S01", name: "상해", options: { O01: "V01" }, bindings: {}, fromUsage: ["사유"] };
const render = (editing: boolean, uses = new Map<string, number>()) =>
  renderToStaticMarkup(<PresetsPane presets={[상해]} editing={editing} onChange={() => undefined} options={options} params={params} uses={uses} newCode={() => "new:1"} discriminators={[]} enums={[{ code: "E0001", label: "사유", values: [{ code: "V01", label: "암" }] }]} forms={[]} />);

describe("프리셋 구획 (ADR-0084 결정 8)", () => {
  it("편집 — 맨 위 추가 줄 · 프리셋마다 카드(⊖ · 이름 · 옵션마다 선택 · 값 인자마다 연결), 조 참조 인자 줄은 없다", () => {
    const html = render(true);
    expect(html).toContain('aria-label="새 프리셋 이름"');
    expect(html).toContain('aria-label="프리셋 추가"');
    expect(html).toContain('aria-label="프리셋 삭제 · 상해"');
    expect(html).toContain('aria-label="상해 — 옵션 기산"');
    expect(html).toContain('aria-label="상해 — 인자 사유"');
    expect(html).toContain('aria-label="상해 — 인자 담보명"');
    expect(html).not.toContain("지급사유 조");
    expect(html).toContain("사용처가 채움(반복의 현재 원소)");
  });

  it("읽기 — 값 요약 · 사용처 수", () => {
    const html = render(false, new Map([["S01", 3]]));
    expect(html).toContain("기산: 계약일");
    expect(html).toContain("사유 ← 사용처가 채움(반복의 현재 원소)");
    expect(html).toContain("사용처 3곳");
    expect(html).not.toContain("<select");
  });

  it("인자 칸 — 「사용처가 채움」과 연결은 서로 바뀐다", () => {
    const bound = withPresetArg(상해, params[0], "c:V01");
    expect(bound).toMatchObject({ bindings: { 사유: { kind: "const", value: "V01" } }, fromUsage: [] });
    expect(withPresetArg(bound, params[0], FROM_USAGE)).toMatchObject({ bindings: {}, fromUsage: ["사유"] });
  });
});
