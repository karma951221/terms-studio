import { describe, expect, it } from "vitest";

import { placeGate } from "./placeGate";

/**
 * 누르는 동안 자리 바꾸기를 미룬다 (기능/문면 §4.3) — 자리가 바뀌면 툴바의 「조건 편집」 · 「고른 것 속성」 묶음이 서며
 * 본문이 아래로 밀린다. 누르는 순간 밀리면 놓는 자리가 달라져 누른 버튼(⊕ 등)의 click 이 빗나가고, 오른쪽 클릭 메뉴가 엉뚱한 자리 것이 된다.
 */
describe("placeGate — 누르는 동안 자리 미루기", () => {
  const setup = () => {
    const applied: (string | undefined)[] = [];
    return { applied, gate: placeGate<string | undefined>((p) => applied.push(p)) };
  };

  it("누를 때는 자리를 바꾸지 않고, 뗄 때 바꾼다", () => {
    const { applied, gate } = setup();
    gate.press("head");
    expect(applied).toEqual([]);
    gate.release();
    expect(applied).toEqual(["head"]);
  });

  it("누르는 사이의 초점 자리는 누른 자리를 덮어 뗄 때 한 번만 바꾼다", () => {
    const { applied, gate } = setup();
    gate.press("block");
    gate.focus("inline");
    expect(applied).toEqual([]);
    gate.release();
    expect(applied).toEqual(["inline"]);
  });

  it("누르지 않은 초점(키보드 이동)은 곧바로 바꾼다", () => {
    const { applied, gate } = setup();
    gate.focus("inline");
    expect(applied).toEqual(["inline"]);
  });

  it("본문 빈 곳을 누른 자리(undefined)도 뗄 때 그대로 반영한다", () => {
    const { applied, gate } = setup();
    gate.press(undefined);
    gate.release();
    expect(applied).toEqual([undefined]);
  });

  it("누르지 않았는데 떼면(본문 밖에서 누름) 아무것도 바꾸지 않는다 · 한 번 뗀 뒤 다시 떼도 그대로", () => {
    const { applied, gate } = setup();
    gate.release();
    gate.press("head");
    gate.release();
    gate.release();
    expect(applied).toEqual(["head"]);
  });

  it("툴바 · 셀 조작 줄을 누르는 동안(hold)은 그 버튼의 초점이 자리를 바꾸지 않고, 떼도 그대로다", () => {
    const { applied, gate } = setup();
    gate.hold();
    gate.focus("block");
    gate.release();
    expect(applied).toEqual([]);
    gate.focus("inline");
    expect(applied).toEqual(["inline"]);
  });
});
