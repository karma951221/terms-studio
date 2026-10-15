import { describe, expect, it } from "vitest";

import { originsOf, renamesFrom, trackOrigins } from "./renames";

const a = { name: "사유" };
const b = { name: "종들" };

describe("이름 바꾸기 표 — 편집본의 줄마다 저장된 옛 이름을 따라간다 (기능/함수조항 §3.7)", () => {
  it("시작 — 저장된 이름 그대로", () => {
    expect(originsOf([a, b])).toEqual(["사유", "종들"]);
  });

  it("같은 길이(이름 · 타입 고침)는 자리 그대로, 덧붙이면 새 줄(옛 이름 없음), 빼면 그 줄의 옛 이름도 빠진다", () => {
    const renamed = { name: "면제사유" };
    expect(trackOrigins([a, b], [renamed, b], ["사유", "종들"])).toEqual(["사유", "종들"]);
    expect(trackOrigins([a, b], [a, b, { name: "새" }], ["사유", "종들"])).toEqual(["사유", "종들", undefined]);
    expect(trackOrigins([a, b], [b], ["사유", "종들"])).toEqual(["종들"]);
  });

  it("그 밖(통째로 바꿈)은 이름으로 다시 맞춘다", () => {
    expect(trackOrigins([a], [b, a, { name: "x" }], ["사유"], ["사유", "종들"])).toEqual(["종들", "사유", undefined]);
  });

  it("표 — 옛 이름과 지금 이름(다듬은)이 다른 줄만, 새 줄은 없다", () => {
    expect(renamesFrom(["사유", "종들", undefined], [{ name: " 면제사유 " }, b, { name: "새" }])).toEqual({ 사유: "면제사유" });
  });
});
