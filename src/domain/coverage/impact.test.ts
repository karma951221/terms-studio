import { describe, expect, it } from "vitest";

import { entered } from "../types";
import { nodeDeleteImpact, NO_USAGE } from "./impact";
import { addBenefit, addSubCoverage, createCoverageTree } from "./tree";
import type { MasterValues } from "./values";

let seq = 0;
const newId = () => `id-${++seq}`;
function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function surgery() {
  seq = 0;
  let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
  tree = unwrap(addSubCoverage(tree, { name: "2종수술", benefitName: "수술보험금" }, newId));
  tree = unwrap(addBenefit(tree, tree.subCoverages[1].id, "입원보험금", newId));
  return tree;
}

function mv(slots: Record<string, Record<string, ReturnType<typeof entered>>>): MasterValues {
  return { slots: new Map(Object.entries(slots).map(([id, s]) => [id, new Map(Object.entries(s))])) };
}

describe("역할권한 S3 — 구조 삭제의 영향 목록", () => {
  it("세부보장 삭제: 하위 급부 이름(cascade) + 그 노드들의 값 행 수 + 주입된 사용처", async () => {
    const tree = surgery();
    const two = tree.subCoverages[1];
    const [b21, b22] = two.benefits;
    const values = mv({
      [two.id]: { "subCoverage.note": entered("x") },
      [b21.id]: { "pay.exempt": entered(true), "pay.rate": entered(1) },
      [b22.id]: { "pay.exempt": entered(false) },
      [tree.subCoverages[0].benefits[0].id]: { "pay.exempt": entered(false) }, // 남는 쪽 — 세지 않는다
    });
    const usage = {
      findUsages: async () => [{ document: "coverageMaster" as const, ownerId: tree.id, articleTitle: "보장범위" }],
    };
    const impact = await nodeDeleteImpact(tree, { level: "subCoverage", id: two.id }, values, usage);
    expect(impact).toEqual({
      valueRowsLost: 4,
      cascade: ["급부 수술보험금", "급부 입원보험금"],
      brokenRefs: [{ document: "coverageMaster", ownerId: tree.id, articleTitle: "보장범위" }],
    });
  });

  it("사용처 주입이 없으면(NO_USAGE) 깨질 참조는 빈 목록 — C1 refs 가 채운다", async () => {
    const tree = surgery();
    const impact = await nodeDeleteImpact(tree, { level: "coverage", id: tree.id }, mv({}), NO_USAGE);
    expect(impact.brokenRefs).toEqual([]);
    expect(impact.cascade).toHaveLength(5);
    expect(impact.valueRowsLost).toBe(0);
  });
});
