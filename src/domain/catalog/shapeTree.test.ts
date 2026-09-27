import { describe, expect, it } from "vitest";

import { branchChain, buildShapeTree, shapeLevels } from "./shapeTree";
import type { AttachLevel } from "../types";

interface Leaf {
  code: string;
  level: AttachLevel;
}

const leaf = (code: string, level: AttachLevel): Leaf => ({ code, level });

describe("shapeLevels — 다섯 층 사슬 (구조 상수에서 파생)", () => {
  it("상품 › 세목 › 담보 › 세부보장 › 급부", () => {
    expect(shapeLevels()).toEqual(["product", "plan", "coverage", "subCoverage", "benefit"]);
  });
});

describe("buildShapeTree — 조회 트리 (ADR-0070 결정 8)", () => {
  it("레벨별로 잎을 담는다 — 순서는 입력 순서 유지", () => {
    const items = [leaf("D0002", "coverage"), leaf("D0001", "product"), leaf("D0003", "coverage")];
    const root = buildShapeTree(items, (i) => i.level);
    const chain = branchChain(root);
    expect(chain.map((b) => b.level)).toEqual(["product", "plan", "coverage", "subCoverage", "benefit"]);
    expect(chain[0]!.leaves).toEqual([leaf("D0001", "product")]);
    expect(chain[2]!.leaves.map((l) => l.code)).toEqual(["D0002", "D0003"]);
    expect(chain[1]!.leaves).toEqual([]);
  });

  it("잎이 없는 층도 가지는 그대로 있다 (모양이라서 사라지지 않는다)", () => {
    const root = buildShapeTree<Leaf>([], (i) => i.level);
    expect(branchChain(root)).toHaveLength(5);
    expect(root.leaves).toEqual([]);
  });

  it("hasMatch — 그 가지나 아래 어딘가에 잎이 있으면 참", () => {
    const root = buildShapeTree([leaf("D0009", "benefit")], (i) => i.level);
    const chain = branchChain(root);
    expect(chain.map((b) => b.hasMatch)).toEqual([true, true, true, true, true]);
  });

  it("hasMatch — 아무 잎도 없으면 다섯 가지 모두 거짓", () => {
    const root = buildShapeTree<Leaf>([], (i) => i.level);
    expect(branchChain(root).map((b) => b.hasMatch)).toEqual([false, false, false, false, false]);
  });

  it("잎이 있는 가지 아래로는 위쪽 가지의 hasMatch 가 전이되지 않는다 (자기 또는 자손만 본다)", () => {
    const root = buildShapeTree([leaf("D0005", "coverage")], (i) => i.level);
    const chain = branchChain(root);
    expect(chain[0]!.hasMatch).toBe(true); // product — 자손(coverage)에 잎이 있어 참
    expect(chain[1]!.hasMatch).toBe(true); // plan — 자손(coverage)에 잎이 있어 참
    expect(chain[2]!.hasMatch).toBe(true); // coverage — 자기 잎
    expect(chain[3]!.hasMatch).toBe(false); // subCoverage — 자기도 자손도 없음
    expect(chain[4]!.hasMatch).toBe(false); // benefit
  });
});
