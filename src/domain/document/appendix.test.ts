import { describe, expect, it } from "vitest";

import { createAppendix, formatAppendixCode, isValidAppendixCode, renameAppendix } from "./appendix";

/** 순번 출처 흉내 — 부를 때마다 1 씩 오른다. */
function seqSource(start = 1) {
  let next = start;
  return () => next++;
}

describe("별표 마스터 (기능/별표 §3.1 — 코드는 시스템 채번 AX000001 · 등록 후 불변)", () => {
  it("코드 접두는 AX · 최소 6자리, 자리수를 넘으면 자연 확장한다", () => {
    expect(formatAppendixCode(1)).toBe("AX000001");
    expect(formatAppendixCode(21)).toBe("AX000021");
    expect(formatAppendixCode(1_000_000)).toBe("AX1000000");
    expect(() => formatAppendixCode(0)).toThrow(RangeError);
    expect(isValidAppendixCode("AX000001")).toBe(true);
    expect(isValidAppendixCode("APX01_INTEREST")).toBe(false);
  });

  it("이름만 넣으면 코드는 시스템이 AX000001 부터 채번한다 — 별표는 코드 · 이름뿐이다 (주석 폐지 2026-10-10)", async () => {
    const nextSeq = seqSource();
    expect(await createAppendix({ name: "화상 분류표" }, nextSeq)).toEqual({
      ok: true,
      value: { code: "AX000001", name: "화상 분류표" },
    });
    expect(await createAppendix({ name: " 장해분류표 " }, nextSeq)).toEqual({
      ok: true,
      value: { code: "AX000002", name: "장해분류표" },
    });
  });

  it("빈 이름은 거부하고 순번도 태우지 않는다 — 거절이 코드에 구멍을 내지 않게", async () => {
    const nextSeq = seqSource();
    const r = await createAppendix({ name: "  " }, nextSeq);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("invalid");
    expect(await createAppendix({ name: "화상 분류표" }, nextSeq)).toMatchObject({ ok: true, value: { code: "AX000001" } });
  });

  it("이름 수정은 코드를 바꾸지 않는다 — 빈 이름은 거부", () => {
    const a = { code: "AX000001", name: "화상 분류표" };
    expect(renameAppendix(a, "화상분류표")).toEqual({ ok: true, value: { ...a, name: "화상분류표" } });
    expect(renameAppendix(a, "").ok).toBe(false);
  });
});
