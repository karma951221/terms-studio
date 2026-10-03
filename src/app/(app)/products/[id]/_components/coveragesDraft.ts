/**
 * 상품담보 탭의 편집 초안 (기능/상품 §3.8 · §4.5, 2026-10-04) — 기본계약 · 특별약관 두 표의 행.
 *
 * 편집 중 한 일(「+ 담보 추가」 · 상품담보명 · 세목 부착/해제 · 🗑 탑재 해제와 되돌리기)은 이 초안에만 쌓이고, 탭 첫 줄의 `저장` 한 번이
 * 바뀐 것만 `saveCoverages` 입력(`added` · `updated` · `removed`)으로 보낸다. 서비스가 전부 다시 검사한다 — 여기의 `addRowProblem` 은
 * 추가 줄에서 바로 말해 주는 화면 검사일 뿐이다(같은 규칙: 조합 중복 · 기본계약 하나 · 독립특약).
 * 순수 함수만 둔다(React 없음).
 */
import { combinationKey, normalizeSelections, type AttributeKind, type AttributeSelection, type ProductCoverage } from "@/domain/product";
import type { Id, Issue } from "@/domain/types";
import type { CoverageSection, ProductCoveragesInput } from "@/services/product";

/** 표의 한 행 = 상품담보 하나(저장된 것 또는 이번 편집에서 더한 것). */
export interface CoverageDraftRow {
  /** 저장된 행은 상품담보 id, 더한 행은 `new:N` — 저장 거부 이슈가 이 열쇠로 돌아온다. */
  key: string;
  /** 저장된 상품담보 id. 더한 행은 없다. */
  id?: Id;
  section: CoverageSection;
  coverageId: Id;
  /** 더한 행의 담보코드 · 담보명 — 담보 찾기에서 고른 것(저장된 행은 담보 마스터 목록에서 읽는다). */
  coverageCode?: string;
  coverageName?: string;
  attributes: AttributeSelection[];
  name: string;
  /** 부착한 종·형 조합 id. */
  plans: Id[];
  /** `saved` 저장된 행 · `added` 이번 편집에서 더한 행. */
  status: "saved" | "added";
  /** 🗑 — 저장하면 탑재 해제. 되돌리기로 푼다. 더한 행은 표시 없이 초안에서 빠진다. */
  removed: boolean;
}

export interface CoveragesDraft {
  rows: CoverageDraftRow[];
  /** 다음 추가 행 번호 (`new:N`). */
  seq: number;
}

/** 「+ 담보 추가」 줄에서 고른 것. */
export interface NewRowInput {
  section: CoverageSection;
  coverageId: Id;
  coverageCode?: string;
  coverageName?: string;
  attributes: AttributeSelection[];
  /** 작명 규칙이 지은 이름 — 그 줄에서 보이고 행에서 고칠 수 있다. */
  name: string;
}

export type CoveragesDraftAction =
  | { type: "add"; row: NewRowInput }
  | { type: "remove"; key: string }
  | { type: "restore"; key: string }
  | { type: "rename"; key: string; name: string }
  | { type: "attach"; key: string; planId: Id }
  | { type: "detach"; key: string; planId: Id }
  | { type: "reset"; draft: CoveragesDraft };

export function initCoveragesDraft(base: readonly ProductCoverage[], special: readonly ProductCoverage[], attached: Readonly<Record<Id, readonly Id[]>>): CoveragesDraft {
  const row = (section: CoverageSection) => (pc: ProductCoverage): CoverageDraftRow => ({
    key: pc.id,
    id: pc.id,
    section,
    coverageId: pc.coverageId,
    attributes: pc.attributes,
    name: pc.name,
    plans: [...(attached[pc.id] ?? [])],
    status: "saved",
    removed: false,
  });
  return { rows: [...base.map(row("base")), ...special.map(row("special"))], seq: 1 };
}

function update(state: CoveragesDraft, key: string, change: (row: CoverageDraftRow) => CoverageDraftRow): CoveragesDraft {
  return { ...state, rows: state.rows.map((r) => (r.key === key ? change(r) : r)) };
}

export function coveragesDraftReducer(state: CoveragesDraft, action: CoveragesDraftAction): CoveragesDraft {
  switch (action.type) {
    case "add": {
      const key = `new:${state.seq}`;
      const row: CoverageDraftRow = { key, ...action.row, plans: [], status: "added", removed: false };
      return { rows: [...state.rows, row], seq: state.seq + 1 };
    }
    case "remove": {
      const row = state.rows.find((r) => r.key === action.key);
      if (row?.status === "added") return { ...state, rows: state.rows.filter((r) => r.key !== action.key) };
      return update(state, action.key, (r) => ({ ...r, removed: true }));
    }
    case "restore":
      return update(state, action.key, (r) => ({ ...r, removed: false }));
    case "rename":
      return update(state, action.key, (r) => ({ ...r, name: action.name }));
    case "attach":
      return update(state, action.key, (r) => (r.plans.includes(action.planId) ? r : { ...r, plans: [...r.plans, action.planId] }));
    case "detach":
      return update(state, action.key, (r) => ({ ...r, plans: r.plans.filter((p) => p !== action.planId) }));
    case "reset":
      return action.draft;
  }
}

const samePlans = (a: readonly Id[], b: readonly Id[]) => a.length === b.length && a.every((p) => b.includes(p));

/** 행의 표시 — 「추가」 · 「삭제」 · 「변경」(이름 · 부착이 저장본과 다름) · 저장본 그대로. */
export function rowStatus(saved: CoveragesDraft, draft: CoveragesDraft, key: string): "added" | "removed" | "changed" | "saved" {
  const row = draft.rows.find((r) => r.key === key);
  if (!row) return "saved";
  if (row.status === "added") return "added";
  if (row.removed) return "removed";
  const before = saved.rows.find((r) => r.key === key);
  return before && before.name === row.name && samePlans(before.plans, row.plans) ? "saved" : "changed";
}

/** 고친 것이 있나 — ✕ · 탭 링크 · 경로 링크의 「버립니까?」 판정. 되돌려 같아지면 고친 것이 아니다. */
export function coveragesDraftDirty(saved: CoveragesDraft, draft: CoveragesDraft): boolean {
  if (draft.rows.some((r) => r.status === "added")) return true;
  return draft.rows.some((r) => rowStatus(saved, draft, r.key) !== "saved");
}

/** 저장 입력 — 바뀐 것만. 지우는 행의 이름 · 부착은 보내지 않는다. */
export function toCoveragesInput(saved: CoveragesDraft, draft: CoveragesDraft): ProductCoveragesInput {
  return {
    added: draft.rows
      .filter((r) => r.status === "added")
      .map((r) => ({ key: r.key, coverageId: r.coverageId, attributes: r.attributes, section: r.section, name: r.name, plans: r.plans })),
    updated: draft.rows.filter((r) => r.id && rowStatus(saved, draft, r.key) === "changed").map((r) => ({ id: r.id!, name: r.name, plans: r.plans })),
    removed: draft.rows.filter((r) => r.id && r.removed).map((r) => r.id!),
  };
}

/**
 * 「+ 담보 추가」 줄의 화면 검사 — 문제가 있으면 그 줄에 보일 한 줄, 없으면 undefined. 서비스의 탑재 검사와 같은 규칙이다
 * (조합 = 담보 × 담보속성, 지울 행의 조합은 비어 있다 · 기본계약은 남는 것이 없을 때 하나 · 독립특약은 기본계약 없음).
 */
export function addRowProblem(draft: CoveragesDraft, row: Pick<NewRowInput, "section" | "coverageId" | "attributes">, opts: { kinds: readonly AttributeKind[]; standalone: boolean }): string | undefined {
  if (!row.coverageId) return "담보를 고르세요";
  if (row.section === "base") {
    if (opts.standalone) return "독립특약 상품은 기본계약을 두지 않습니다";
    if (draft.rows.some((r) => r.section === "base" && !r.removed)) return "기본계약은 하나만 둘 수 있습니다 — 지금 기본계약을 삭제한 뒤 추가하세요 (MVP)";
  }
  const key = combinationKey(row.coverageId, normalizeSelections(row.attributes, opts.kinds));
  const clash = draft.rows.find((r) => !r.removed && combinationKey(r.coverageId, normalizeSelections(r.attributes, opts.kinds)) === key);
  return clash ? `이미 탑재한 조합입니다 — 「${clash.name}」` : undefined;
}

/** 저장 거부 이슈 → 행(상품담보 id · 추가 행 key)별 문구. 좌표가 없는 것은 `other`(탭 첫 줄 아래 배너). */
export function issuesByRow(issues: readonly Issue[]): { rows: Map<string, string[]>; other: string[] } {
  const rows = new Map<string, string[]>();
  const other: string[] = [];
  for (const i of issues) {
    const key = i.at.ownerId;
    if (key) rows.set(key, [...(rows.get(key) ?? []), i.message]);
    else other.push(i.message);
  }
  return { rows, other };
}
