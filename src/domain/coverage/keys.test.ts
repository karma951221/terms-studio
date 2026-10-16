// src/domain/coverage/keys.test.ts
import { describe, expect, it } from "vitest";

import { assignNodeKeys, coveredByLoop, fillKeys, formatNodeKey, keyPathLabel, nodeByKeyPath, nodeKeyLabel, parseKeyPath, smallestFreeKey, TREE_DEPTH } from "./keys";
import type { Coverage } from "./types";

const tree: Coverage = {
  id: "cov",
  name: "암진단비",
  description: "",
  subCoverages: [
    { id: "s1", key: "01", name: "유사암", order: 0, benefits: [{ id: "b1", key: "1", name: "진단비", order: 0 }] },
    { id: "s3", key: "03", name: "일반암", order: 1, benefits: [{ id: "b3", key: "1", name: "진단비", order: 0 }, { id: "b4", key: "3", name: "재진단", order: 1 }] },
  ],
};

describe("노드 키 모양 (ADR-0087 결정 2)", () => {
  it("세부보장은 두 자리, 99 를 넘으면 자릿수를 늘린다 · 급부는 그대로", () => {
    expect(formatNodeKey("subCoverage", 1)).toBe("01");
    expect(formatNodeKey("subCoverage", 99)).toBe("99");
    expect(formatNodeKey("subCoverage", 100)).toBe("100");
    expect(formatNodeKey("benefit", 2)).toBe("2");
  });

  it("빈 가장 작은 번호 — 01 · 03 이 있으면 02, 숫자로 비교한다", () => {
    expect(smallestFreeKey("subCoverage", ["01", "03"])).toBe("02");
    expect(smallestFreeKey("subCoverage", [])).toBe("01");
    expect(smallestFreeKey("benefit", ["1", "2"])).toBe("3");
    const ninetyNine = Array.from({ length: 99 }, (_, i) => formatNodeKey("subCoverage", i + 1));
    expect(smallestFreeKey("subCoverage", ninetyNine)).toBe("100");
  });
});

describe("assignNodeKeys — 최종 트리 기준 (ADR-0087 결정 2 · 기능/담보 §3.8)", () => {
  it("남는 노드는 키를 지키고, 새 노드는 형제 순서대로 빈 가장 작은 키를 받는다", () => {
    const draft = {
      ...tree,
      subCoverages: [
        tree.subCoverages[1], // 03 이 앞으로 와도 그대로
        { id: "new-s", key: "99", name: "새", order: 1, benefits: [{ id: "new-b", key: "7", name: "새급부", order: 0 }] },
      ],
    };
    const out = assignNodeKeys(draft, (id) => id === "s3" || id === "b3" || id === "b4");
    expect(out.subCoverages.map((s) => s.key)).toEqual(["03", "01"]);
    expect(out.subCoverages[1].benefits.map((b) => b.key)).toEqual(["1"]);
    expect(out.subCoverages[0].benefits.map((b) => b.key)).toEqual(["1", "3"]);
  });

  it("같은 저장에서 지운 노드의 키도 빈 번호다 — 지운 02 를 새 노드가 다시 받는다", () => {
    const before = { ...tree, subCoverages: [tree.subCoverages[0], { ...tree.subCoverages[0], id: "s2", key: "02", name: "실수" }] };
    const after = { ...before, subCoverages: [before.subCoverages[0], { id: "again", key: "03", name: "다시", order: 1, benefits: [{ id: "again-b", key: "2", name: "급부", order: 0 }] }] };
    const out = assignNodeKeys(after, (id) => id === "s1" || id === "b1");
    expect(out.subCoverages.map((s) => s.key)).toEqual(["01", "02"]);
  });
});

describe("키 경로", () => {
  it("parseKeyPath — 01 · 01.2 · 100.3 만, 옛 노드 id 는 아니다", () => {
    expect(parseKeyPath("01")).toEqual({ sub: "01" });
    expect(parseKeyPath("01.2")).toEqual({ sub: "01", benefit: "2" });
    expect(parseKeyPath("100.3")).toEqual({ sub: "100", benefit: "3" });
    expect(parseKeyPath("1")).toBeUndefined();
    expect(parseKeyPath("3f1a9c2e-0b1d-4a5e-8f00-123456789abc")).toBeUndefined();
  });

  it("nodeByKeyPath — 레벨 · id · 키 경로를 돌려준다, 없는 키는 undefined", () => {
    expect(nodeByKeyPath(tree, "03.3")).toMatchObject({ level: "benefit", id: "b4", keyPath: "03.3" });
    expect(nodeByKeyPath(tree, "01")).toMatchObject({ level: "subCoverage", id: "s1", keyPath: "01" });
    expect(nodeByKeyPath(tree, "02")).toBeUndefined();
  });

  it("표기 — 「세부보장 01 · 유사암 › 급부 1 · 진단비」", () => {
    expect(nodeKeyLabel("subCoverage", "01", "유사암")).toBe("세부보장 01 · 유사암");
    expect(nodeKeyLabel("benefit", "1")).toBe("급부 1");
    expect(keyPathLabel(tree, "01.1")).toBe("세부보장 01 · 유사암 › 급부 1 · 진단비");
    expect(keyPathLabel(tree, "09")).toBeUndefined();
  });
});

describe("정규형 키 경로만 (preflight M1)", () => {
  it("비정규형은 키 경로가 아니다 — 001 · 1 · 01.0 · 01.02 · 00", () => {
    for (const bad of ["001", "1", "00", "01.0", "01.02", "01.", ".1", "01.2.3", " 01"]) expect(parseKeyPath(bad)).toBeUndefined();
    expect(parseKeyPath("10")).toEqual({ sub: "10" });
    expect(parseKeyPath("100")).toEqual({ sub: "100" });
  });

  it("nodeByKeyPath 는 문자열 그대로 비교한다", () => {
    expect(nodeByKeyPath(tree, "001")).toBeUndefined();
    expect(nodeByKeyPath(tree, "03.03")).toBeUndefined();
  });
});

describe("fillKeys — 채번 루프 하나 (preflight M3)", () => {
  it("남는 행은 키를 지키고 나머지는 형제 순서대로 빈 가장 작은 키를 받는다", () => {
    const rows = [{ id: "a", key: "09" }, { id: "b", key: "x" }, { id: "c", key: "x" }];
    expect(fillKeys("subCoverage", rows, (id) => id === "a").map((r) => r.key)).toEqual(["09", "01", "02"]);
    expect(rows[1].key).toBe("x");
  });
});

describe("레벨 깊이 · 반복이 레벨을 푸는가 (preflight M4)", () => {
  it("깊이표", () => {
    expect(TREE_DEPTH).toEqual({ subCoverage: 1, benefit: 2 });
  });

  it("반복 레벨이 같거나 더 깊으면 그 레벨을 푼다", () => {
    expect(coveredByLoop("subCoverage", "subCoverage")).toBe(true);
    expect(coveredByLoop("subCoverage", "benefit")).toBe(true);
    expect(coveredByLoop("benefit", "benefit")).toBe(true);
    expect(coveredByLoop("benefit", "subCoverage")).toBe(false);
  });
});
