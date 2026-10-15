/**
 * 생성 화면의 값 표 — 빈 행은 막지 않고(제출 때 버린다, 디자인원칙 §2 L2), 중복만 막는다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EnumValuesInput, duplicateKeys } from "./EnumValuesInput";

describe("EnumValuesInput — 생성 값 표", () => {
  it("빈 행은 required 로 막지 않는다 — 값 하나만 써도 생성된다", () => {
    expect(renderToStaticMarkup(<EnumValuesInput />)).not.toContain("required");
  });

  it("중복 검사는 빈 칸끼리를 중복으로 잡지 않는다 · 이름이 겹치면(공백 · 대소문자 무시) 잡는다", () => {
    expect(duplicateKeys([{ key: 0, label: "일반" }, { key: 1, label: "" }, { key: 2, label: "  " }])).toEqual(new Set());
    expect(duplicateKeys([{ key: 0, label: "일반" }, { key: 1, label: " 일반 " }, { key: 2, label: "" }])).toEqual(new Set([0, 1]));
  });
});
