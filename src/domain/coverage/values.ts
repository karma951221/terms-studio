/**
 * 담보 레벨 값 규칙 (순수) — 값 쓰기 검사 · 폼 프리필 · 완결성 조회.
 *
 * - **값 자리는 마스터가 만든다** (ADR-0037): 그 레벨의 마스터 필드는 모든 노드에 항상 있다.
 *   부착 · 노출여부 · 선택 필드가 없으므로 `notAttached` 로 거절할 자리가 없다 —
 *   남는 거절은 「그 레벨의 자리가 아님(notFound)」과 타입 불일치뿐이다.
 * - 검증은 catalog `validateValue`.
 * - 기본값은 `formPrefill` 로만 돌려준다 — 저장소로 자동 유입되는 경로는 없다 (ADR-0004).
 * - 완결성 조회 = 담보 하위 트리 전체(담보·세부보장·급부)의 미입력 자리 (D-P2-11).
 *   「실행 기반(실제 타는 분기)」 필터는 조립·문면이 있어야 하므로 `CompletenessFilter` 로 주입한다 (C2).
 */
import type { EnumLookup, SlotPath } from "../catalog";
import { missingSlots, prefill, valueSlotsOf } from "../catalog";
import { fieldsOfLevel, findMasterField, masterFieldLabel, type MasterTree } from "../master";
import { type Coordinate, type Id, ok, reject, type Result, type Value, type ValueSlot } from "../types";
import { nodeName, nodesOf } from "./tree";
import { validateSlotValue } from "./traits";
import type { Coverage, CoverageNodeRef } from "./types";

// ───────────────────────────── 마스터 값 묶음 ─────────────────────────────

/** 담보 하위 트리의 값 — 키는 노드 id (uuid 라 레벨 간 충돌 없음). 없는 노드 = 값 없음. */
export interface MasterValues {
  slots: ReadonlyMap<Id, ReadonlyMap<SlotPath, ValueSlot>>;
}

const EMPTY_SLOTS: ReadonlyMap<SlotPath, ValueSlot> = new Map();

export function slotsOfNode(values: MasterValues, nodeId: Id): ReadonlyMap<SlotPath, ValueSlot> {
  return values.slots.get(nodeId) ?? EMPTY_SLOTS;
}

// ───────────────────────────── 값 쓰기 검사 ─────────────────────────────

/**
 * 값 쓰기 전 검사. 통과하면 마스터 경로를 그대로 돌려준다 — 저장소 writeSlot 의 인자.
 * 실체 레벨 · 경로 · 타입 순으로 본다.
 * 오류 좌표의 ownerId 는 담보 id 다 — 호출부가 `coverageId` 를 주면 싣고, 모르면 비운다 (노드 id 를 담보 id 자리에 넣지 않는다).
 * 값 소유 노드는 `node` 에.
 */
export function checkValueWrite(
  path: SlotPath,
  value: Value,
  owner: CoverageNodeRef,
  enums: EnumLookup,
  master?: MasterTree,
  coverageId?: Id,
): Result<SlotPath> {
  const at: Coordinate = { document: "coverageMaster", ...(coverageId ? { ownerId: coverageId } : {}), node: owner, refPath: path };
  const field = findMasterField(path, master);
  if (!field || field.level !== owner.level) {
    return reject({ reason: "notFound", what: `값 자리 ${path}` });
  }
  const issues = validateSlotValue(path, field.field.type, value, enums, at);
  if (issues.length > 0) return reject({ reason: "invalid", issues });
  return ok(path);
}

// ───────────────────────────── 프리필 ─────────────────────────────

/**
 * 폼 초기값 — 명시 값이 있으면 그 값, 없으면 기본값(있는 자리만). 미입력이고 기본값도 없으면 자리 없음.
 * 여기서 돌려준 기본값은 사람이 저장해야 명시 값이 된다.
 */
export function formPrefill(
  level: CoverageNodeRef["level"],
  slots: ReadonlyMap<SlotPath, ValueSlot>,
  master?: MasterTree,
): Record<SlotPath, Value> {
  const out = prefill(level, master);
  for (const path of valueSlotsOf(level, master)) {
    const slot = slots.get(path);
    if (slot?.entered) out[path] = slot.value;
  }
  return out;
}

// ───────────────────────────── 완결성 ─────────────────────────────

/** 미입력 자리 하나. */
export interface MissingSlot {
  owner: CoverageNodeRef;
  /** `담보 > 세부보장 > 급부` */
  ownerName: string;
  /** 마스터 필드 표시명 (「납입면제 › 적용여부」). */
  label: string;
  path: SlotPath;
  at: Coordinate;
}

/**
 * 실행 기반 필터 — 「탑재분의 실제 타는 분기」 기준으로 좁힌다 (기능/조립산출 §3 「오류 — 실행 경로 · 부분 조립」 · ADR-0016).
 * 조립(C2)이 구현해 주입한다. 기본은 항등(마스터 전체).
 */
export type CompletenessFilter = (items: MissingSlot[], tree: Coverage) => MissingSlot[];

/** 완결성 조회 — 담보 하위 트리 전체의 마스터 자리 중 미입력. 트리 순서 · 마스터 선언 순서. */
export function completeness(
  tree: Coverage,
  values: MasterValues,
  filter: CompletenessFilter = (items) => items,
  master?: MasterTree,
): MissingSlot[] {
  const out: MissingSlot[] = [];
  for (const node of nodesOf(tree)) {
    const slots = slotsOfNode(values, node.id);
    const ownerName = nodeName(tree, node) ?? node.name;
    const labels = new Map(fieldsOfLevel(node.level, master).map((f) => [f.path, masterFieldLabel(f)]));
    for (const path of missingSlots(node.level, (p) => slots.get(p), master)) {
      out.push({
        owner: { level: node.level, id: node.id },
        ownerName,
        label: labels.get(path) ?? path,
        path,
        at: { document: "coverageMaster", ownerId: tree.id, ownerName, node: { level: node.level, id: node.id }, refPath: path },
      });
    }
  }
  return filter(out, tree);
}
