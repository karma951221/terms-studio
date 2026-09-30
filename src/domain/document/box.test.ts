import { describe, expect, it } from "vitest";

import { boxLinesFromText, boxLinesText, createBox, formatBoxCode, isValidBoxCode, reviseBox } from "./box";

/** 순번 출처 흉내 — 부를 때마다 1 씩 오른다. */
function seqSource(start = 1) {
  let next = start;
  return () => next++;
}

describe("박스 마스터 (기능/박스 §3.1 — 정적 마스터, 코드는 시스템 채번 BX000001 · 등록 후 불변)", () => {
  it("코드 접두는 BX · 최소 6자리, 자리수를 넘으면 자연 확장한다", () => {
    expect(formatBoxCode(1)).toBe("BX000001");
    expect(formatBoxCode(1_000_000)).toBe("BX1000000");
    expect(() => formatBoxCode(0)).toThrow(RangeError);
    expect(isValidBoxCode("BX000001")).toBe(true);
    expect(isValidBoxCode("AX000001")).toBe(false);
  });

  it("이름 · 제목 · 줄을 넣으면 코드는 시스템이 BX000001 부터 채번한다 — 제목은 비워도 된다", async () => {
    const nextSeq = seqSource();
    expect(await createBox({ name: "【용어풀이】 보험연도", title: "보험연도", lines: ["보험연도란 …"] }, [], nextSeq)).toEqual({
      ok: true,
      value: { code: "BX000001", name: "【용어풀이】 보험연도", title: "보험연도", lines: ["보험연도란 …"] },
    });
    expect(await createBox({ name: "예시", title: "", lines: ["가", "", "나"] }, [], nextSeq)).toMatchObject({ ok: true, value: { code: "BX000002", title: "", lines: ["가", "", "나"] } });
  });

  it("박스 이름 중복 거부 — 넣을 때 이름으로 고르므로 같은 이름 둘은 헷갈린다 (순번도 태우지 않는다)", async () => {
    const nextSeq = seqSource();
    const r = await createBox({ name: " 보험연도 ", title: "", lines: ["x"] }, ["보험연도"], nextSeq);
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "invalid") expect(r.rejection.issues[0].message).toContain("이미 있는 박스 이름");
    expect(await createBox({ name: "보험연도2", title: "", lines: ["x"] }, ["보험연도"], nextSeq)).toMatchObject({ ok: true, value: { code: "BX000001" } });
  });

  it("줄 비움 거부 — 줄이 하나도 없는 박스는 만들 수 없다 (빈 이름도 거부)", async () => {
    const nextSeq = seqSource();
    const noLines = await createBox({ name: "빈 박스", title: "제목", lines: [] }, [], nextSeq);
    expect(noLines.ok).toBe(false);
    if (!noLines.ok && noLines.rejection.reason === "invalid") expect(noLines.rejection.issues[0].message).toContain("줄이 하나 이상");
    expect((await createBox({ name: " ", title: "", lines: ["x"] }, [], nextSeq)).ok).toBe(false);
  });

  it("고치기 — 이름 · 제목 · 줄을 한 번에 바꾸고, 자기 이름은 중복으로 보지 않는다", () => {
    const box = { code: "BX000001", name: "보험연도", title: "", lines: ["a"] };
    expect(reviseBox(box, { name: "보험연도", title: "보험연도", lines: ["b"] }, ["보험연도", "예시"])).toEqual({ ok: true, value: { ...box, title: "보험연도", lines: ["b"] } });
    expect(reviseBox(box, { name: "예시", title: "", lines: ["a"] }, ["보험연도", "예시"]).ok).toBe(false);
    expect(reviseBox(box, { name: "보험연도", title: "", lines: [] }, ["보험연도"]).ok).toBe(false);
  });

  it("줄 칸 글 ↔ 줄 목록 — 한 줄 = 한 줄, 가운데 빈 줄은 남고 끝의 빈 줄은 버린다", () => {
    expect(boxLinesFromText("가\r\n\n나\n\n")).toEqual(["가", "", "나"]);
    expect(boxLinesFromText("  \n")).toEqual([]);
    expect(boxLinesText(["가", "", "나"])).toBe("가\n\n나");
  });
});
