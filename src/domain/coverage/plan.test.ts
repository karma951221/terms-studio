import { describe, expect, it } from "vitest";

import {
  applyStructurePlanTo,
  dryRunStructurePlan,
  hasRemoves,
  hasStructuralChange,
  savedStructureOf,
  structureDraftOf,
  structureIssues,
  structurePlan,
  structureRemovals,
  type StructureDraftSub,
} from "./plan";
import type { Coverage } from "./types";

// ───────────────────────────── 구조 초안 (ADR-0052 결정 1) ─────────────────────────────

const tree: Coverage = {
  id: "c1",
  name: "수술비",
  description: "",
  subCoverages: [
    { id: "s1", name: "1종수술", order: 0, benefits: [{ id: "b1", name: "수술급여금", order: 0 }, { id: "b2", name: "위로금", order: 1 }] },
    { id: "s2", name: "2종수술", order: 1, benefits: [{ id: "b3", name: "수술급여금", order: 0 }] },
  ],
};

/** 깊은 복사 — 테스트마다 초안을 손대므로. */
const draftOf = (): StructureDraftSub[] => structureDraftOf(tree).map((s) => ({ ...s, benefits: s.benefits.map((b) => ({ ...b })) }));

const emptyPlan = { renames: [], newSubCoverages: [], newBenefits: [], removes: [], reorders: [] };

describe("structureDraftOf", () => {
  it("트리 순서대로 · 키는 encodeNodeKey · id 를 품는다", () => {
    const draft = structureDraftOf(tree);
    expect(draft).toEqual([
      { id: "s1", key: "subCoverage:s1", name: "1종수술", benefits: [{ id: "b1", key: "benefit:b1", name: "수술급여금" }, { id: "b2", key: "benefit:b2", name: "위로금" }] },
      { id: "s2", key: "subCoverage:s2", name: "2종수술", benefits: [{ id: "b3", key: "benefit:b3", name: "수술급여금" }] },
    ]);
  });

  it("왕복 — 손대지 않은 초안의 계획은 비어 있다", () => {
    expect(structurePlan(tree, structureDraftOf(tree))).toEqual(emptyPlan);
    expect(hasRemoves(structurePlan(tree, structureDraftOf(tree)))).toBe(false);
  });
});

describe("structureIssues", () => {
  it("손대지 않은 초안 — 이슈 없음", () => {
    expect(structureIssues(draftOf())).toEqual([]);
  });

  it("빈 이름 — 공백만 있어도 빈 것", () => {
    const draft = draftOf();
    draft[0]!.benefits[1]!.name = "  ";
    const issues = structureIssues(draft);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.key).toBe("benefit:b2");
  });

  it("형제 중복 — trim 으로 비교하고 두 행 모두 표시. 다른 세부보장 아래 같은 급부명은 허용", () => {
    const draft = draftOf();
    draft[0]!.benefits[1]!.name = " 수술급여금 ";
    const issues = structureIssues(draft);
    expect(issues.map((i) => i.key).sort()).toEqual(["benefit:b1", "benefit:b2"]);
    // s2 의 「수술급여금」(b3) 은 다른 형제 집합이라 걸리지 않는다.
  });

  it("세부보장 0개", () => {
    const issues = structureIssues([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("세부보장");
  });

  it("급부 0개인 세부보장 — 그 세부보장 키에 이슈", () => {
    const draft = draftOf();
    draft[1]!.benefits = [];
    const issues = structureIssues(draft);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.key).toBe("subCoverage:s2");
    expect(issues[0]!.message).toContain("급부");
  });
});

describe("structurePlan", () => {
  it("이름만 변경 — renames 에 기존 노드 · trim 한 이름", () => {
    const draft = draftOf();
    draft[0]!.name = " 일종수술 ";
    draft[1]!.benefits[0]!.name = "수술보험금";
    const plan = structurePlan(tree, draft);
    expect(plan).toEqual({
      ...emptyPlan,
      renames: [
        { level: "subCoverage", id: "s1", name: "일종수술" },
        { level: "benefit", id: "b3", name: "수술보험금" },
      ],
    });
  });

  it("새 세부보장(급부 2개) — 첫 급부는 함께, 나머지는 benefitNames 로. 끝에 붙으면 순서 변경 없음", () => {
    const draft = draftOf();
    draft.push({ key: "new:1", name: "3종수술", benefits: [{ key: "new:2", name: "수술급여금" }, { key: "new:3", name: "입원급여금" }] });
    const plan = structurePlan(tree, draft);
    expect(plan).toEqual({ ...emptyPlan, newSubCoverages: [{ key: "new:1", name: "3종수술", benefitNames: ["수술급여금", "입원급여금"] }] });
  });

  it("기존 세부보장에 급부 추가 — newBenefits 에 부모 id", () => {
    const draft = draftOf();
    draft[1]!.benefits.push({ key: "new:1", name: "위로금" });
    const plan = structurePlan(tree, draft);
    expect(plan).toEqual({ ...emptyPlan, newBenefits: [{ subCoverageId: "s2", name: "위로금" }] });
  });

  it("세부보장 삭제 — 자식 급부는 removes 에 넣지 않는다(서비스가 연쇄). 남은 세부보장의 급부 삭제는 넣는다", () => {
    const draft = draftOf();
    draft.splice(1, 1); // s2 (b3 포함)
    draft[0]!.benefits.splice(1, 1); // b2
    const plan = structurePlan(tree, draft);
    // 트리 순서대로 — s1 의 급부 b2 가 s2 보다 먼저.
    expect(plan.removes).toEqual([
      { level: "benefit", id: "b2", name: "위로금" },
      { level: "subCoverage", id: "s2", name: "2종수술" },
    ]);
    expect(hasRemoves(plan)).toBe(true);
    expect(plan.reorders).toEqual([]); // 삭제만으로는 순서가 안 바뀐다
    expect(structureRemovals(structureDraftOf(tree), draft)).toEqual(plan.removes);
  });

  it("순서 변경 — 새 노드가 섞이면 이름으로, 기존 노드는 id 로 부모별 최종 순서", () => {
    const draft = draftOf();
    // 새 세부보장을 맨 앞에, 기존 s1 의 급부는 뒤집는다.
    draft.unshift({ key: "new:1", name: "0종수술", benefits: [{ key: "new:2", name: "급여금" }] });
    const s1 = draft[1]!;
    s1.benefits = [{ key: "new:3", name: "신급부" }, s1.benefits[1]!, s1.benefits[0]!];
    const plan = structurePlan(tree, draft);
    expect(plan.newSubCoverages).toEqual([{ key: "new:1", name: "0종수술", benefitNames: ["급여금"] }]);
    expect(plan.newBenefits).toEqual([{ subCoverageId: "s1", name: "신급부" }]);
    expect(plan.reorders).toEqual([
      { level: "subCoverage", order: [{ name: "0종수술" }, { id: "s1", name: "1종수술" }, { id: "s2", name: "2종수술" }] },
      { level: "benefit", subCoverageId: "s1", order: [{ name: "신급부" }, { id: "b2", name: "위로금" }, { id: "b1", name: "수술급여금" }] },
    ]);
  });

  it("기존 노드끼리만 자리 바꿈 — id 순서만", () => {
    const draft = draftOf();
    draft.reverse();
    const plan = structurePlan(tree, draft);
    expect(plan.reorders).toEqual([{ level: "subCoverage", order: [{ id: "s2", name: "2종수술" }, { id: "s1", name: "1종수술" }] }]);
  });
});

describe("dryRunStructurePlan — 서비스 호출 전 메모리 검증", () => {
  it("아무 변화 없음 → 원본 그대로", () => {
    const r = dryRunStructurePlan(tree, structurePlan(tree, draftOf()));
    expect(r.ok && r.value).toEqual(tree);
  });

  it("✕ 한 형제의 이름을 새 급부에 다시 쓰면 duplicate — 추가가 삭제보다 앞이라 (structureIssues 는 통과하는 경우)", () => {
    const draft = draftOf();
    draft[0]!.benefits = [draft[0]!.benefits[0]!, { key: "new:1", name: "위로금" }]; // b2 「위로금」 빼고 같은 이름의 새 급부
    expect(structureIssues(draft)).toEqual([]);
    const r = dryRunStructurePlan(tree, structurePlan(tree, draft));
    expect(!r.ok && r.rejection.reason).toBe("duplicate");
  });

  it("삭제될 형제의 이름으로 개명해도 duplicate (이름이 삭제보다 앞)", () => {
    const draft = draftOf();
    draft[0]!.benefits = [{ ...draft[0]!.benefits[0]!, name: "위로금" }];
    const r = dryRunStructurePlan(tree, structurePlan(tree, draft));
    expect(!r.ok && r.rejection.reason).toBe("duplicate");
  });

  it("마지막 급부를 새 급부로 갈아끼움 — 추가가 먼저라 최소 구조에 안 걸린다", () => {
    const draft = draftOf();
    draft[1]!.benefits = [{ key: "new:1", name: "새급부" }]; // s2 의 유일한 b3 → 새급부
    const plan = structurePlan(tree, draft);
    expect(plan.removes).toEqual([{ level: "benefit", id: "b3", name: "수술급여금" }]);
    const r = dryRunStructurePlan(tree, plan);
    expect(r.ok && r.value.subCoverages[1]!.benefits.map((b) => b.name)).toEqual(["새급부"]);
  });

  it("빈 이름 · 급부 0개인 새 세부보장 · 세부보장 전부 삭제는 도메인 거부로 잡힌다", () => {
    const empty = draftOf();
    empty[0]!.name = " ";
    expect(!dryRunStructurePlan(tree, structurePlan(tree, empty)).ok).toBe(true);

    const noBenefit = draftOf();
    noBenefit.push({ key: "new:1", name: "3종", benefits: [] });
    const r = dryRunStructurePlan(tree, structurePlan(tree, noBenefit));
    expect(!r.ok && r.rejection.reason).toBe("invalid");

    const r2 = dryRunStructurePlan(tree, structurePlan(tree, []));
    expect(!r2.ok && r2.rejection.reason).toBe("minimumStructure");
  });

  it("순서 변경 + 새 노드 — 결과 트리가 초안 순서를 따른다", () => {
    const draft = draftOf();
    draft.unshift({ key: "new:1", name: "0종수술", benefits: [{ key: "new:2", name: "급여금" }, { key: "new:3", name: "위로금" }] });
    const plan = structurePlan(tree, draft);
    expect(hasStructuralChange(plan)).toBe(true);
    const r = dryRunStructurePlan(tree, plan);
    expect(r.ok && r.value.subCoverages.map((s) => s.name)).toEqual(["0종수술", "1종수술", "2종수술"]);
    expect(r.ok && r.value.subCoverages[0]!.benefits.map((b) => b.name)).toEqual(["급여금", "위로금"]);
  });

  it("hasStructuralChange — 이름만 바뀐 계획은 거짓", () => {
    const draft = draftOf();
    draft[0]!.name = "일종";
    expect(hasStructuralChange(structurePlan(tree, draft))).toBe(false);
  });

  it("savedStructureOf — id 없는 행을 걷어 원본으로 쓴다", () => {
    const draft = draftOf();
    draft.push({ key: "new:1", name: "3종", benefits: [{ key: "new:2", name: "x" }] });
    draft[0]!.benefits.push({ key: "new:3", name: "y" });
    expect(savedStructureOf(draft)).toEqual(structureDraftOf(tree));
  });

  it("applyStructurePlanTo — id 발급을 넘기면 결과 트리가 저장용이 된다 (새 세부보장 · 급부에 그 id)", () => {
    const draft = draftOf();
    draft.push({ key: "new:1", name: "3종수술", benefits: [{ key: "new:2", name: "급여금" }, { key: "new:3", name: "위로금" }] });
    let seq = 0;
    const r = applyStructurePlanTo(tree, structurePlan(tree, draft), () => `real-${seq++}`);
    expect(r.ok && r.value.subCoverages[2]).toEqual({ id: "real-0", name: "3종수술", order: 2, benefits: [{ id: "real-1", name: "급여금", order: 0 }, { id: "real-2", name: "위로금", order: 1 }] });
    const dry = dryRunStructurePlan(tree, structurePlan(tree, draft));
    expect(dry.ok && dry.value.subCoverages[2]!.id.startsWith("dry:")).toBe(true); // 드라이런의 id 는 가짜 — 검증용
  });
});
