import { describe, expect, it } from "vitest";

import { renameExprRefs } from "./parser";

describe("renameExprRefs — 인자 · 내부 변수 이름 바꾸기 (기능/함수조항 §3.7 이름 변경)", () => {
  const params = new Map([["사유", "면제사유"]]);
  const locals = new Map([["사유들", "모든사유"]]);

  it("arg.<옛 이름> · var.<옛 이름> 만 바꾸고 나머지 글자는 그대로", () => {
    expect(renameExprRefs("arg.사유 = 'V01'  and var.사유들.있음('V02')", { params, locals })).toBe("arg.면제사유 = 'V01'  and var.모든사유.있음('V02')");
  });

  it("필드 · 다른 이름 · 문자열 안 · 마스터 경로는 건드리지 않는다", () => {
    expect(renameExprRefs("arg.사유.사유 = '사유'", { params })).toBe("arg.면제사유.사유 = '사유'");
    expect(renameExprRefs("arg.사유2 or waiver.사유", { params })).toBe("arg.사유2 or waiver.사유");
    expect(renameExprRefs("var.사유 and arg.사유들", { params, locals })).toBe("var.사유 and arg.사유들");
  });

  it("맞바꾸기도 한 번에 — 차례로 바꾸지 않는다", () => {
    expect(
      renameExprRefs("arg.A and arg.B", {
        params: new Map([
          ["A", "B"],
          ["B", "A"],
        ]),
      }),
    ).toBe("arg.B and arg.A");
  });

  it("안 읽히는 식은 그대로 (저장 검사가 오류 자리를 알린다)", () => {
    expect(renameExprRefs("arg.사유 = '닫히지 않음", { params })).toBe("arg.사유 = '닫히지 않음");
  });
});
