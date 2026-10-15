// src/domain/document/particles.test.ts
import { describe, expect, it } from "vitest";
import { chooseParticle, codaOf, isParticlePreset, PARTICLE_PRESETS } from "./particles";

const pick = (key: Parameters<typeof chooseParticle>[0], before: string) => chooseParticle(key, before).text;

describe("조사 프리셋", () => {
  it("15쌍 · 키 유일 · 칩 표기는 받침있음/받침없음", () => {
    expect(PARTICLE_PRESETS).toHaveLength(15);
    expect(new Set(PARTICLE_PRESETS.map((p) => p.key)).size).toBe(15);
    for (const p of PARTICLE_PRESETS) expect(p.label).toBe(`${p.final}/${p.open}`);
  });
  it("모르는 키는 프리셋이 아니다", () => {
    expect(isParticlePreset("eul-reul")).toBe(true);
    expect(isParticlePreset("nope")).toBe(false);
    expect(isParticlePreset(3)).toBe(false);
  });
});

describe("받침 판정", () => {
  it("한글 — 받침 있음 · 없음 · ㄹ", () => {
    expect(codaOf("보험금")).toBe("final");
    expect(codaOf("회사")).toBe("open");
    expect(codaOf("서울")).toBe("rieul");
  });
  it("닫는 괄호는 짝 여는 괄호 앞 글자로 — 겹 괄호 포함", () => {
    expect(codaOf("사망보험금(이하 '보험금'이라 합니다)")).toBe("final");
    expect(codaOf("회사(갑(을))")).toBe("open");
    expect(codaOf("보험금)")).toBeUndefined(); // 짝 없음
  });
  it("낫표 · 따옴표는 그 안 마지막 글자로", () => {
    expect(codaOf("「보험금」")).toBe("final");
    expect(codaOf("『회사』")).toBe("open");
    expect(codaOf("“서울”")).toBe("rieul");
  });
  it("숫자는 읽는 소리 — 끝자리, 끝이 0이면 받침 있음", () => {
    expect(codaOf("제3")).toBe("final"); // 삼
    expect(codaOf("2")).toBe("open"); // 이
    expect(codaOf("1")).toBe("rieul"); // 일
    expect(codaOf("6")).toBe("final"); // 육
    expect(codaOf("10")).toBe("final"); // 십
    expect(codaOf("1000")).toBe("final"); // 천
    expect(codaOf("0")).toBe("final"); // 영
    expect(codaOf("2.5")).toBe("open"); // 오
  });
  it("% 는 퍼센트 — 받침 없음", () => {
    expect(codaOf("2.5%")).toBe("open");
  });
  it("판정 불가 — 영문 · 기호 · 빈 글 · 끝 공백", () => {
    expect(codaOf("ABC")).toBeUndefined();
    expect(codaOf("-")).toBeUndefined();
    expect(codaOf("")).toBeUndefined();
    expect(codaOf("보험금 ")).toBeUndefined();
  });
});

describe("조사 고르기", () => {
  it("받침으로 고른다", () => {
    expect(pick("eul-reul", "보험금")).toBe("을");
    expect(pick("eul-reul", "회사")).toBe("를");
    expect(pick("eul-reul", "제3조")).toBe("를");
    expect(pick("i-ga", "제1항")).toBe("이");
    expect(pick("gwa-wa", "보험금")).toBe("과");
  });
  it("으로 류는 ㄹ 받침이면 받침 없음 쪽", () => {
    expect(pick("euro-ro", "서울")).toBe("로");
    expect(pick("euro-ro", "보험금")).toBe("으로");
    expect(pick("euro-ro", "회사")).toBe("로");
    expect(pick("euroseo-roseo", "1")).toBe("로서");
    expect(pick("eul-reul", "서울")).toBe("을"); // ㄹ 예외가 없는 프리셋은 받침 있음
  });
  it("판정 불가면 병기 · resolved false", () => {
    expect(chooseParticle("eul-reul", "ABC")).toEqual({ text: "을(를)", resolved: false });
    expect(chooseParticle("eul-reul", "보험금")).toEqual({ text: "을", resolved: true });
  });
});
