/**
 * 담보 구조 초안 · 저장 계획 (순수) — ADR-0052.
 *
 * 화면이 세부보장 · 급부의 추가 · 이름 · 순서 · 삭제를 초안 하나(`StructureDraftSub[]`)에 담고, 서비스가 그 초안을
 * `structurePlan` 으로 풀어 ①이름 → ②추가 → ③삭제 → ④순서 순으로 적용한다 (`services/coverage` `applyStructurePlan`).
 * `dryRunStructurePlan` 은 같은 순서를 트리 편집 규칙(tree.ts)으로 메모리에서 끝까지 돌려 첫 거부를 찾는다 —
 * 저장 전에 계획 전체가 통과하는지 보는 것이라 부분 저장이 없다.
 *
 * 미탑재 담보(결정 1)는 상세 화면 저장 하나에, 탑재된 담보(결정 2)는 별도 「구조 편집」 화면에 — 둘 다 같은 계획을 쓴다.
 */
import { ok, reject, type Id, type Result } from "../types";
import {
  addBenefit,
  addSubCoverage,
  findBenefit,
  removeNode,
  renameBenefit,
  renameSubCoverage,
  reorderBenefits,
  reorderSubCoverages,
} from "./tree";
import type { Coverage, CoverageNodeLevel, NewId } from "./types";

/** `<level>:<id>` 인코딩 — 초안 행의 키이자 화면이 선택된 트리 노드를 쿼리스트링에 싣는 형식. */
export function encodeNodeKey(level: CoverageNodeLevel, id: string): string {
  return `${level}:${id}`;
}

export function decodeNodeKey(key: string | undefined): { level: CoverageNodeLevel; id: string } | undefined {
  if (!key) return undefined;
  const [level, id] = key.split(":");
  if (level !== "coverage" && level !== "subCoverage" && level !== "benefit") return undefined;
  if (!id) return undefined;
  return { level, id };
}

// ───────────────────────────── 구조 초안 (ADR-0052 결정 1) ─────────────────────────────
//
// 미탑재 담보의 상세 화면이 세부보장 · 급부의 추가 · 이름 · 순서 · 삭제를 초안 하나에 담고 저장 한 번에 반영한다.
// `key` 는 클라이언트 임시 키 — 기존 노드는 `encodeNodeKey`, 새 노드는 `new:<n>`. `id` 가 없으면 새 노드.

export interface StructureDraftBenefit {
  id?: Id;
  key: string;
  name: string;
}

export interface StructureDraftSub {
  id?: Id;
  key: string;
  name: string;
  /** 배열 순서 = 화면 순서 = 저장될 order. */
  benefits: StructureDraftBenefit[];
}

/** 저장된 노드만 있는 초안 — 트리에서 막 세운 원본. `structureRemovals` 의 기준이 된다. */
export interface StructureSavedBenefit extends StructureDraftBenefit {
  id: Id;
}

export interface StructureSavedSub extends StructureDraftSub {
  id: Id;
  benefits: StructureSavedBenefit[];
}

/** 트리 → 초안. 저장 뒤 화면이 다시 뜰 때의 시작점이자 「아무 변화 없음」의 기준. */
export function structureDraftOf(tree: Coverage): StructureSavedSub[] {
  return tree.subCoverages.map((sub) => ({
    id: sub.id,
    key: encodeNodeKey("subCoverage", sub.id),
    name: sub.name,
    benefits: sub.benefits.map((benefit) => ({ id: benefit.id, key: encodeNodeKey("benefit", benefit.id), name: benefit.name })),
  }));
}

export interface StructureIssue {
  /** 이슈가 걸린 행의 키. 세부보장 0개는 트리 자체라 `STRUCTURE_ROOT_KEY`. */
  key: string;
  message: string;
}

export const STRUCTURE_ROOT_KEY = "coverage";

/**
 * 초안이 도메인 규칙에 걸리는 곳 — 빈 이름 · 형제 중복(도메인과 같은 trim 비교) · 세부보장 0개 · 급부 0개인 세부보장.
 * 화면이 행 옆에 인라인으로 보이고, 하나라도 있으면 저장을 막는다. 서버는 이 검사를 반복하지 않는다 — 같은 규칙을
 * `dryRunStructurePlan` 이 트리 편집 함수로 돌려 잡는다 (순서 때문에 걸리는 거부까지).
 */
export function structureIssues(draft: readonly StructureDraftSub[]): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const check = (rows: readonly { key: string; name: string }[], what: string) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = row.name.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) issues.push({ key: row.key, message: `${what}을(를) 비울 수 없습니다.` });
      else if ((counts.get(name) ?? 0) > 1) issues.push({ key: row.key, message: `형제와 ${what}이(가) 겹칩니다.` });
    }
  };
  if (draft.length === 0) issues.push({ key: STRUCTURE_ROOT_KEY, message: "세부보장이 하나는 있어야 합니다 (최소 구조)." });
  check(draft, "세부보장명");
  for (const sub of draft) {
    if (sub.benefits.length === 0) issues.push({ key: sub.key, message: "급부가 하나는 있어야 합니다 (최소 구조)." });
    check(sub.benefits, "급부명");
  }
  return issues;
}

export type StructureLevel = "subCoverage" | "benefit";

/** 순서 항목 — 기존 노드는 id, 새 노드는 id 가 없어 이름으로 찾는다 (형제 중복이 막혀 있어 유일하다). */
export interface StructureOrderRef {
  id?: Id;
  name: string;
}

export interface StructureRemoval {
  level: StructureLevel;
  id: Id;
  name: string;
}

/**
 * 저장 계획 — 실행 순서가 목적이다:
 * ① renames → ② newSubCoverages(첫 급부와 함께 · 나머지 급부 덧붙임) · newBenefits → ③ removes(confirm) → ④ reorders.
 * 추가를 삭제보다 먼저 하는 것은 유일한 급부를 교체할 때 최소 구조 거부를 피하기 위해서다.
 */
export interface StructurePlan {
  renames: { level: StructureLevel; id: Id; name: string }[];
  newSubCoverages: { key: string; name: string; benefitNames: string[] }[];
  newBenefits: { subCoverageId: Id; name: string }[];
  /** 원본에 있고 초안에 없는 노드. 부모가 빠지면 자식은 넣지 않는다 — 서비스가 연쇄 삭제한다. */
  removes: StructureRemoval[];
  /** 부모별 최종 순서 — 추가(맨 뒤) · 삭제만으로 나오는 순서와 다를 때만. */
  reorders: ({ level: "subCoverage"; order: StructureOrderRef[] } | { level: "benefit"; subCoverageId: Id; order: StructureOrderRef[] })[];
}

/** 초안에서 저장된 노드(id 있음)만 — 클라이언트가 `initial.structure` 를 원본으로 쓸 때의 좁히기. */
export function savedStructureOf(draft: readonly StructureDraftSub[]): StructureSavedSub[] {
  return draft.flatMap((sub) => (sub.id ? [{ ...sub, id: sub.id, benefits: sub.benefits.flatMap((b) => (b.id ? [{ ...b, id: b.id }] : [])) }] : []));
}

/** 원본에 있고 새 초안에 없는 노드 — 화면의 「저장 시 삭제 N개」 와 계획의 removes 가 같은 셈이다. */
export function structureRemovals(original: readonly StructureSavedSub[], draft: readonly StructureDraftSub[]): StructureRemoval[] {
  const out: StructureRemoval[] = [];
  const keptSubs = new Map(draft.flatMap((s) => (s.id ? [[s.id, s] as const] : [])));
  for (const sub of original) {
    const kept = keptSubs.get(sub.id);
    if (!kept) {
      out.push({ level: "subCoverage", id: sub.id, name: sub.name });
      continue;
    }
    const keptBenefitIds = new Set(kept.benefits.flatMap((b) => (b.id ? [b.id] : [])));
    for (const benefit of sub.benefits) {
      if (!keptBenefitIds.has(benefit.id)) out.push({ level: "benefit", id: benefit.id, name: benefit.name });
    }
  }
  return out;
}

export function structurePlan(original: Coverage, draft: readonly StructureDraftSub[]): StructurePlan {
  const base = structureDraftOf(original);
  const plan: StructurePlan = { renames: [], newSubCoverages: [], newBenefits: [], removes: structureRemovals(base, draft), reorders: [] };
  const originalSubs = new Map(base.map((s) => [s.id, s]));
  const originalBenefits = new Map(base.flatMap((s) => s.benefits.map((b) => [b.id, b] as const)));

  // ① 이름 · ② 추가
  for (const sub of draft) {
    const name = sub.name.trim();
    if (!sub.id) {
      plan.newSubCoverages.push({ key: sub.key, name, benefitNames: sub.benefits.map((b) => b.name.trim()) });
      continue;
    }
    if (name !== originalSubs.get(sub.id)?.name) plan.renames.push({ level: "subCoverage", id: sub.id, name });
    for (const benefit of sub.benefits) {
      const benefitName = benefit.name.trim();
      if (!benefit.id) plan.newBenefits.push({ subCoverageId: sub.id, name: benefitName });
      else if (benefitName !== originalBenefits.get(benefit.id)?.name) plan.renames.push({ level: "benefit", id: benefit.id, name: benefitName });
    }
  }

  // ④ 순서 — ①②③ 뒤의 자연 순서(남은 기존 노드는 원래 순서 · 새 노드는 맨 뒤)와 초안 순서가 다르면.
  const orderOf = (rows: readonly { id?: Id; name: string }[]): StructureOrderRef[] => rows.map((r) => (r.id ? { id: r.id, name: r.name.trim() } : { name: r.name.trim() }));
  const differs = (originalRows: readonly { id?: Id }[], draftRows: readonly { id?: Id; key: string }[]): boolean => {
    const keptIds = new Set(draftRows.flatMap((r) => (r.id ? [r.id] : [])));
    const natural = [...originalRows.filter((r) => keptIds.has(r.id!)).map((r) => r.id!), ...draftRows.filter((r) => !r.id).map((r) => r.key)];
    const actual = draftRows.map((r) => r.id ?? r.key);
    return natural.length !== actual.length || natural.some((k, i) => k !== actual[i]);
  };
  if (differs(base, draft)) plan.reorders.push({ level: "subCoverage", order: orderOf(draft) });
  for (const sub of draft) {
    const before = sub.id ? originalSubs.get(sub.id) : undefined;
    if (!before) continue; // 새 세부보장의 급부는 만든 순서가 곧 순서다
    if (differs(before.benefits, sub.benefits)) plan.reorders.push({ level: "benefit", subCoverageId: before.id, order: orderOf(sub.benefits) });
  }
  return plan;
}

export function hasRemoves(plan: StructurePlan): boolean {
  return plan.removes.length > 0;
}

/** 이름 말고 구조(추가 · 삭제 · 순서)가 바뀌는가 — 탑재된 담보는 이름만 여기서 고친다 (ADR-0052 결정 2 는 별도 화면). */
export function hasStructuralChange(plan: StructurePlan): boolean {
  return plan.newSubCoverages.length > 0 || plan.newBenefits.length > 0 || plan.removes.length > 0 || plan.reorders.length > 0;
}

/** 순서 항목 → id. 새 노드는 형제 중 이름으로 (형제 중복은 도메인이 막아 유일하다). */
export function resolveOrder(siblings: readonly { id: Id; name: string }[], order: readonly StructureOrderRef[]): Id[] | undefined {
  const ids = order.map((ref) => ref.id ?? siblings.find((s) => s.name === ref.name)?.id);
  return ids.every((v): v is Id => v !== undefined) ? ids : undefined;
}

/**
 * 계획을 트리 편집 함수로 메모리에서 ①→②→③→④ 순서 그대로 적용한다 — 서비스는 이 결과를 한 번 저장한다.
 * 「✕ 한 형제의 이름을 새 노드에 다시 쓰는」 것처럼 순서 때문에 걸리는 거부(추가가 삭제보다 앞이라 duplicate)도
 * 여기서 잡힌다. 첫 거부에서 멈추고, 통과하면 결과 트리 하나 — 부분 저장이 없다.
 * `newId` 가 새 세부보장 · 급부의 id 를 발급한다.
 */
export function applyStructurePlanTo(original: Coverage, plan: StructurePlan, newId: NewId): Result<Coverage> {
  let tree = original;
  const step = (r: Result<Coverage>): Result<Coverage> | undefined => {
    if (!r.ok) return r;
    tree = r.value;
    return undefined;
  };
  const notFound = (what: string): Result<Coverage> => reject({ reason: "notFound", what });

  for (const rename of plan.renames) {
    const hit = rename.level === "benefit" ? findBenefit(tree, rename.id) : undefined;
    const r = rename.level === "subCoverage" ? renameSubCoverage(tree, rename.id, rename.name) : hit ? renameBenefit(tree, hit.subCoverage.id, rename.id, rename.name) : notFound(`급부 ${rename.id}`);
    const bad = step(r);
    if (bad) return bad;
  }
  for (const sub of plan.newSubCoverages) {
    const [first, ...rest] = sub.benefitNames;
    if (first === undefined) return reject({ reason: "invalid", issues: [{ kind: "typeMismatch", message: `세부보장 「${sub.name}」에 급부가 하나는 있어야 합니다`, at: {} }] });
    const bad = step(addSubCoverage(tree, { name: sub.name, benefitName: first }, newId));
    if (bad) return bad;
    const created = tree.subCoverages.find((s) => s.name === sub.name.trim());
    if (!created) return notFound(`세부보장 ${sub.name}`);
    for (const name of rest) {
      const badBenefit = step(addBenefit(tree, created.id, name, newId));
      if (badBenefit) return badBenefit;
    }
  }
  for (const benefit of plan.newBenefits) {
    const bad = step(addBenefit(tree, benefit.subCoverageId, benefit.name, newId));
    if (bad) return bad;
  }
  for (const target of plan.removes) {
    const bad = step(removeNode(tree, { level: target.level, id: target.id }));
    if (bad) return bad;
  }
  for (const reorder of plan.reorders) {
    const siblings = reorder.level === "subCoverage" ? tree.subCoverages : tree.subCoverages.find((s) => s.id === reorder.subCoverageId)?.benefits ?? [];
    const order = resolveOrder(siblings, reorder.order);
    if (!order) return notFound("순서를 맞출 노드");
    const bad = step(reorder.level === "subCoverage" ? reorderSubCoverages(tree, order) : reorderBenefits(tree, reorder.subCoverageId, order));
    if (bad) return bad;
  }
  return ok(tree);
}

/** 계획을 가짜 id 로 끝까지 돌려 본다 — 서비스를 부르기 전 첫 거부 찾기. 결과 트리는 검증용이지 저장용이 아니다. */
export function dryRunStructurePlan(original: Coverage, plan: StructurePlan): Result<Coverage> {
  let seq = 0;
  return applyStructurePlanTo(original, plan, () => `dry:${seq++}`);
}

export function isEmptyPlan(plan: StructurePlan): boolean {
  return plan.renames.length === 0 && plan.newSubCoverages.length === 0 && plan.newBenefits.length === 0 && plan.removes.length === 0 && plan.reorders.length === 0;
}
