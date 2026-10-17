/**
 * 제1절 판정기 (ADR-0082 결정 1 ~ 7 · 9 C1 · 기능/조립산출 §3.9 · §3.10) — 순수 함수 `judgeFirstSection`.
 *
 * 입력은 블록(블록 순서)마다 「템플릿 조 id → 그 조에 조연결한 블록 조의 항 단위」다. 항 단위의 `sig` 는 「같다」 서명 —
 * 같은 함수조항 · 같은 옵션 · 같은 인자(해소 뒤 글)일 때만 같고, 일반 글 항은 서명이 없다(늘 다르다, 결정 4).
 */
import { describe, expect, it } from "vitest";

import { judgeFirstSection, type JudgeBlock, type JudgeUnit } from "./section";

const fn = (sig: string, selfRefs: number[] = []): JudgeUnit => ({ sig, selfRefs });
const plain = (selfRefs: number[] = []): JudgeUnit => ({ selfRefs });

function block(id: string, articles: Record<string, JudgeUnit[]>, composite = false): JudgeBlock {
  return { productCoverageId: id, ...(composite ? { composite: true } : {}), articles: new Map(Object.entries(articles).map(([t, units]) => [t, { articleId: `${id}-${t}`, units }])) };
}

describe("연결 수로 먼저 가른다 (결정 3)", () => {
  it("k = 0 — 판정 기록이 없다(마스터) · 0 < k < N 특칙 — 옵션과 무관, 연결한 블록만 자기 조(기재)", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x")] }), block("B", {})], new Map([["T1", "common"]]));
    expect(v.get("T1")).toMatchObject({ kind: "special", k: 1, n: 2, option: "common", linkedBlocks: ["A"], unlinkedBlocks: ["B"], reason: "partialOption" });
    expect(v.get("T1")!.blocks.get("A")).toEqual({ kind: "listed" });
    expect(v.has("T9")).toBe(false);
  });

  it("옵션 없음 조의 일부 연결은 정상 특칙 — 사유 partial", () => {
    const v = judgeFirstSection([block("A", { T1: [plain()] }), block("B", {}), block("C", { T1: [plain()] })], new Map());
    expect(v.get("T1")).toMatchObject({ kind: "special", k: 2, n: 3, option: "none", reason: "partial", linkedBlocks: ["A", "C"], unlinkedBlocks: ["B"] });
  });
});

describe("블록 하나 · 복합 블록 (결정 7 · 결정 2)", () => {
  it("N = 1 — 판정 없이 위임(옵션 조도) · 사유 single · 블록은 자기 조", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x")], T2: [plain()] })], new Map([["T1", "all"]]));
    expect(v.get("T1")).toMatchObject({ kind: "delegate", k: 1, n: 1, reason: "single", option: "all" });
    expect(v.get("T2")).toMatchObject({ kind: "delegate", reason: "single" });
    expect(v.get("T1")!.blocks.get("A")).toEqual({ kind: "listed" });
  });

  it("복합 블록은 분모에서 뺀다 — 둘 중 하나가 복합이면 N = 1 위임, 복합 블록의 연결은 k 에 들지 않는다", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x")] }), block("Z", { T1: [fn("x")], T3: [fn("y")] }, true)], new Map());
    expect(v.get("T1")).toMatchObject({ kind: "delegate", k: 1, n: 1, linkedBlocks: ["A"] });
    // 복합 블록만 연결한 조는 k = 0 — 마스터
    expect(v.get("T3")).toMatchObject({ kind: "master", k: 0, n: 1, reason: "unlinked" });
  });

  it("N = 0(복합 블록만) — 모든 조 마스터", () => {
    const v = judgeFirstSection([block("Z", { T1: [fn("x")] }, true)], new Map());
    expect(v.get("T1")).toMatchObject({ kind: "master", k: 0, n: 0, reason: "noBlock" });
  });
});

describe("전부 연결(k = N ≥ 2) — 「같다」 · 준용하기 옵션 (결정 4 · 5)", () => {
  it("모두 같음 → 공통 (세 옵션 모두) — 제1절 = 첫 블록의 항 · 블록 조는 모두 생략", () => {
    for (const option of ["none", "common", "all"] as const) {
      const v = judgeFirstSection([block("A", { T1: [fn("x"), fn("y")] }), block("B", { T1: [fn("x"), fn("y")] })], new Map(option === "none" ? [] : [["T1", option]]));
      expect(v.get("T1"), option).toMatchObject({ kind: "common", k: 2, n: 2, reason: "allSame" });
      expect(v.get("T1")!.raised).toEqual([
        { productCoverageId: "A", unit: 0 },
        { productCoverageId: "A", unit: 1 },
      ]);
      expect([...v.get("T1")!.blocks.values()]).toEqual([{ kind: "omitted" }, { kind: "omitted" }]);
    }
  });

  it("항 수 · 순서가 다르면 「모두 같음」이 아니다 — 같은 항이 순서만 바뀌어도 다르다", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x"), fn("y")] }), block("B", { T1: [fn("y"), fn("x")] })], new Map());
    expect(v.get("T1")).toMatchObject({ kind: "delegate", reason: "differentWithCommon" });
  });

  it("일반 글 항은 글자까지 같아도 다르다 → 없음: 위임", () => {
    const v = judgeFirstSection([block("A", { T1: [plain()] }), block("B", { T1: [plain()] })], new Map());
    expect(v.get("T1")).toMatchObject({ kind: "delegate", reason: "differentNoCommon" });
    expect([...v.get("T1")!.blocks.values()]).toEqual([{ kind: "listed" }, { kind: "listed" }]);
  });

  it("공통항 모으기 · 공통 항 없음 → 위임", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x")] }), block("B", { T1: [fn("y")] })], new Map([["T1", "common"]]));
    expect(v.get("T1")).toMatchObject({ kind: "delegate", reason: "differentNoCommon", option: "common" });
  });

  it("공통항 모으기 · 공통 항 있음 → 공통항 분리 — 제1절 = 공통 항(첫 블록 순서) · 전용 항 있는 블록 분리 · 없는 블록 생략", () => {
    const v = judgeFirstSection(
      [block("A", { T1: [fn("x"), plain(), fn("y")] }), block("B", { T1: [fn("y"), fn("x")] }), block("C", { T1: [fn("x"), fn("y"), fn("z")] })],
      new Map([["T1", "common"]]),
    );
    const t1 = v.get("T1")!;
    expect(t1).toMatchObject({ kind: "commonSplit", k: 3, n: 3, reason: "differentWithCommon" });
    expect(t1.raised).toEqual([
      { productCoverageId: "A", unit: 0 },
      { productCoverageId: "A", unit: 2 },
    ]);
    expect(t1.blocks.get("A")).toEqual({ kind: "split", exclusive: [1] });
    expect(t1.blocks.get("B")).toEqual({ kind: "omitted" });
    expect(t1.blocks.get("C")).toEqual({ kind: "split", exclusive: [2] });
    // 블록 항 → 제1절에 오른 항 (블록 참조 별칭의 재료)
    expect(t1.raisedOf.get("B#0")).toBe(1);
    expect(t1.raisedOf.get("B#1")).toBe(0);
  });

  it("C1 — 전용 항이 공통 항을 가리키는 블록은 쪼개지 않고 조 통째(whole), 다른 블록은 분리 그대로", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x"), plain([0])] }), block("B", { T1: [fn("x"), plain()] })], new Map([["T1", "common"]]));
    const t1 = v.get("T1")!;
    expect(t1.kind).toBe("commonSplit");
    expect(t1.blocks.get("A")).toEqual({ kind: "whole" });
    expect(t1.blocks.get("B")).toEqual({ kind: "split", exclusive: [1] });
  });

  it("전체항 모으기 · 다름 → 전체항 합침 — 첫 블록 항 순서 + 뒤 블록의 새 항을 블록 순서대로 · 같은 함수조항 항은 한 번 · 일반 글 항은 블록마다 · 모든 블록 생략", () => {
    const v = judgeFirstSection([block("A", { T1: [fn("x"), plain()] }), block("B", { T1: [fn("y"), fn("x"), plain()] })], new Map([["T1", "all"]]));
    const t1 = v.get("T1")!;
    expect(t1).toMatchObject({ kind: "joinAll", reason: "differentWithCommon" });
    expect(t1.raised).toEqual([
      { productCoverageId: "A", unit: 0 },
      { productCoverageId: "A", unit: 1 },
      { productCoverageId: "B", unit: 0 },
      { productCoverageId: "B", unit: 2 },
    ]);
    expect(t1.raisedOf.get("B#1")).toBe(0);
    expect([...t1.blocks.values()]).toEqual([{ kind: "omitted" }, { kind: "omitted" }]);
    // 공통 항 없음이어도 합침
    expect(judgeFirstSection([block("A", { T1: [plain()] }), block("B", { T1: [plain()] })], new Map([["T1", "all"]])).get("T1")).toMatchObject({ kind: "joinAll", reason: "differentNoCommon" });
  });

  it("같은 블록 문서를 둘 탑재해도 일반 글은 다르다 — 서명이 없다", () => {
    const v = judgeFirstSection([block("A", { T1: [plain(), fn("x")] }), block("B", { T1: [plain(), fn("x")] })], new Map([["T1", "common"]]));
    expect(v.get("T1")!.kind).toBe("commonSplit");
  });
});
