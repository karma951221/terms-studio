/**
 * 완결성 · 보통약관 요구 참조 검사 — 순수.
 *
 * - 값 자리 = **노드 × 마스터 필드** (ADR-0037). 부착 · 노출여부가 없으므로 레벨만 알면 자리가 정해진다.
 * - 상품담보 완결성 = 스냅샷 실체(상품담보 · 세부보장 · 급부)마다 그 레벨 마스터 자리의 미입력.
 *   실행 기반 필터(실제 밟는 분기만)는 조립(C2)이 이 목록 위에 얹는다.
 * - 기본계약 검사(기능/상품 §3.5): 보통약관이 요구하는 **구분자**가 카탈로그에 있는가.
 *   2026-09-12 이전에는 「기본계약 스냅샷에 부착됐는가」였다 — 부착이 사라지면서 존재 검사만 남았다.
 *   실패는 거부가 아니라 이슈 목록 (D-P5-13).
 * - 기본계약 수 규칙(기능/상품 §3.5 · MVP 정확히 1개): 0 · 2+ 의 읽기 판정과 「두 번째 지정 거부」를 한 곳에 —
 *   서비스(checkBaseContract · designateBaseContract · mount) 와 조립(booklet) 이 같은 문구·좌표를 낸다.
 */
import { missingSlots, type SlotReader, valueSlotsOf } from "../catalog/values";
import type { MasterTree } from "../master";
import type { AttachLevel, Code, Coordinate, Id, Issue } from "../types";
import type { MissingSlot, RequiredCoverageRef } from "./types";

/** 그 레벨 노드가 갖는 값 자리 수 — 「입력 n / m」의 m. */
export function slotCountOf(level: AttachLevel, master?: MasterTree): number {
  return valueSlotsOf(level, master).length;
}

export function missingSlotsOf(
  owner: MissingSlot["owner"],
  ownerName: string,
  level: AttachLevel,
  read: SlotReader,
  master?: MasterTree,
): MissingSlot[] {
  return missingSlots(level, read, master).map((path) => ({ owner, ownerName, level, path }));
}

/** 미입력 목록 → 조립 오류 패널 표기 (kind notEntered). */
export function missingToIssues(missing: readonly MissingSlot[], productCoverageId?: string): Issue[] {
  return missing.map((m) => ({
    kind: "notEntered",
    message: `${m.ownerName} 의 ${m.path} 이(가) 미입력입니다`,
    at: {
      // 상품 · 세목 선택지 값은 상품 화면에서 입력한다 — 좌표가 그 화면을 가리킨다.
      document: m.owner.kind === "product" || m.owner.kind === "plan" ? "product" : "special",
      ownerId: productCoverageId ?? m.owner.id,
      ownerName: m.ownerName,
      refPath: m.path,
    },
  }));
}

/**
 * 보통약관이 요구하는 구분자가 카탈로그에 있는가 (기능/상품 §3.5).
 * 없는 구분자는 문면이 값을 받을 길이 없다 — 깨진 참조로 보고한다.
 */
export function checkGeneralAttachment(
  required: readonly RequiredCoverageRef[],
  knownDiscriminatorCodes: readonly Code[],
  baseContract: { id: string; name: string },
): Issue[] {
  const known = new Set(knownDiscriminatorCodes);
  const issues: Issue[] = [];
  for (const ref of required) {
    if (known.has(ref.discriminatorCode)) continue;
    issues.push({
      kind: "brokenRef",
      message: `보통약관이 요구하는 구분자 ${ref.discriminatorCode} 이(가) 카탈로그에 없습니다 (기본계약 「${baseContract.name}」)`,
      at: {
        document: "general",
        ...ref.at,
        ownerId: baseContract.id,
        ownerName: baseContract.name,
        refPath: ref.discriminatorCode,
      },
    });
  }
  return issues;
}

// ───────────────────────────── 기본계약 수 규칙 (기능/상품 §3.5 · MVP 정확히 1개) ─────────────────────────────

/**
 * 기본계약 오류 좌표의 `refPath` — 상품 좌표에 이 값이 있으면 링크가 **고치는 자리**(보통약관 탭의 기본계약 블록
 * `#base-contract`)로 간다. 상품 상세 첫 화면으로 떨어뜨리면 사람이 어디를 고칠지 다시 찾아야 한다.
 */
export const BASE_CONTRACT_REF = "baseContract";

function baseContractCoordinate(product: { id: Id; name: string }): Coordinate {
  return { document: "product", ownerId: product.id, ownerName: product.name, refPath: BASE_CONTRACT_REF };
}

/**
 * 읽기 시점 판정 — 0 → `noBaseContract` · 2+ → `unsupported`(복구 동선 「하나만 남기고 해제」) · 1 → 없음.
 * 2+ 는 서비스가 두 번째 지정을 막으므로 기존 데이터·우회 저장에서만 생긴다 — 그래도 조립은 이 오류로 멈춘다.
 * 독립특약(`standalone`, 계약형태 E0007 · 기능/상품 §3.1 · 2026-10-01)은 거꾸로 0 이 정상이고 1+ 가 오류다 —
 * 서비스가 탑재 · 지정 · 전환 저장에서 막으므로 이것도 우회 저장에서만 생긴다.
 */
export function baseContractCountIssue(count: number, product: { id: Id; name: string }, standalone = false): Issue | undefined {
  const at = baseContractCoordinate(product);
  if (standalone) {
    return count === 0 ? undefined : { kind: "unsupported", severity: "error", message: "독립특약 상품은 기본계약을 두지 않습니다 — 기본계약을 해제하세요", at, source: at };
  }
  if (count === 0) return { kind: "noBaseContract", severity: "error", message: "기본계약이 지정되지 않았습니다", at, source: at };
  if (count > 1) return { kind: "unsupported", severity: "error", message: `기본계약이 ${count}개입니다 — 하나만 남기고 해제하세요 (MVP 는 1개)`, at, source: at };
  return undefined;
}

/**
 * 지정 전 검사 — 이미 기본계약이 있으면 거부한다 (기능/상품 §3 「기본계약」 · MVP 정확히 1개).
 * 같은 상품담보를 다시 지정하는 것도 「이미 기본계약」이므로 같은 거부다. 바꾸려면 해제 → 지정.
 * 독립특약 상품은 수와 무관하게 거부한다 (기능/상품 §3.1 · 2026-10-01).
 */
export function baseContractDesignationIssues(existingCount: number, product: { id: Id; name: string }, standalone = false): Issue[] {
  if (standalone) return [{ kind: "unsupported", message: "독립특약 상품은 기본계약을 두지 않습니다", at: baseContractCoordinate(product) }];
  if (existingCount === 0) return [];
  return [{ kind: "unsupported", message: "기본계약은 하나만 지정할 수 있습니다 — 먼저 현재 기본계약을 해제하세요 (MVP)", at: baseContractCoordinate(product) }];
}
