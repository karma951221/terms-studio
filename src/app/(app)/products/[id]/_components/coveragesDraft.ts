/**
 * 상품담보 탭의 편집 초안 (기능/상품 §3.8 · §4.5, 2026-10-04) — 기본계약 · 특별약관 두 표의 행.
 *
 * 편집 중 한 일(「+ 담보 추가」 · 상품담보명 · 세목 부착/해제 · 🗑 탑재 해제와 되돌리기)은 이 초안에만 쌓이고, 탭 첫 줄의 `저장` 한 번이
 * 바뀐 것만 `saveCoverages` 입력(`added` · `updated` · `removed`)으로 보낸다. 서비스가 전부 다시 검사한다 — 여기의 `addRowProblem` 은
 * 추가 줄에서 바로 말해 주는 화면 검사일 뿐이다(같은 규칙: 조합 중복 · 기본계약 하나 · 독립특약).
 * 「특약 그룹」 섹션(ADR-0090 · §3.7)의 그룹 목록 · 소속도 같은 초안에 쌓여 같은 저장에 실린다(`groups`).
 * 순수 함수만 둔다(React 없음).
 */
import { combinationKey, effectiveGroups, groupedCoverageIds as domainGroupedCoverageIds, normalizeSelections, type AttributeKind, type AttributeSelection, type ProductCoverage, type ProductGroupSetting, type ProductGroupsInput } from "@/domain/product";
import type { Code, Id, Issue } from "@/domain/types";
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

/**
 * 특약 그룹 목록의 한 줄 (ADR-0090). 열쇠: 기본 그룹 `category:V01` · 저장된 사용자 그룹은 그 id · 새 사용자 그룹 `newgroup:N`
 * (저장 거부 이슈가 이 열쇠로 돌아온다).
 */
export type DraftGroup = { key: string; kind: "category"; code: Code } | { key: string; kind: "user"; id?: Id; name: string };

/** 그룹 목록을 세우는 재료 — 담보의 담보분류(담보 마스터) · 열거형 「담보분류」의 값 순서. */
export interface GroupContext {
  categoryOf: (coverageId: Id) => Code | undefined;
  categoryOrder: readonly Code[];
}

export interface CoveragesDraft {
  rows: CoverageDraftRow[];
  /** 다음 추가 행 번호 (`new:N`). */
  seq: number;
  /** 그룹 목록(저장된 순서 — 이 상품에 없는 기본 그룹이 남아 있을 수 있다, 보이는 목록은 `displayGroups`). */
  groups: DraftGroup[];
  /** 담보 id → 사용자 그룹 열쇠. 탑재 해제한 담보의 소속도 남는다(되돌리면 제자리) — 보이는 것 · 저장 입력은 탑재된 것만. */
  members: Record<Id, string>;
  /** 다음 새 그룹 번호 (`newgroup:N`). */
  groupSeq: number;
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
  | { type: "reset"; draft: CoveragesDraft }
  // 특약 그룹 섹션 (ADR-0090)
  | { type: "addGroup"; ctx: GroupContext }
  | { type: "renameGroup"; key: string; name: string }
  | { type: "removeGroup"; key: string }
  | { type: "moveGroup"; key: string; dir: -1 | 1; ctx: GroupContext }
  | { type: "joinGroup"; key: string; coverageId: Id }
  | { type: "leaveGroup"; coverageId: Id };

export function initCoveragesDraft(base: readonly ProductCoverage[], special: readonly ProductCoverage[], attached: Readonly<Record<Id, readonly Id[]>>, groups?: ProductGroupSetting): CoveragesDraft {
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
  return {
    rows: [...base.map(row("base")), ...special.map(row("special"))],
    seq: 1,
    groups: (groups?.groups ?? []).map((g): DraftGroup => (g.kind === "category" ? { key: `category:${g.code}`, kind: "category", code: g.code } : { key: g.id, kind: "user", id: g.id, name: g.name })),
    members: Object.fromEntries((groups?.memberships ?? []).map((m) => [m.coverageId, m.groupId])),
    groupSeq: 1,
  };
}

// ───────────────────────────── 특약 그룹 섹션 (ADR-0090) ─────────────────────────────

/**
 * 이 초안에서 그룹을 읽는 담보 — 지울 행은 빼고, 처음 나온 행 순서. 특약 절의 담보, 기본계약이 둘 이상(케이스 2 — 제2절 블록)이면
 * 기본계약 담보도(도메인 `groupedCoverageIds` — 서비스 저장 · 조립과 같은 기준, ADR-0090 결정 7). 기본계약 하나의 기본계약은 그룹을 읽지 않는다.
 */
export function groupedCoverageIds(draft: CoveragesDraft): Id[] {
  return domainGroupedCoverageIds(draft.rows.filter((r) => !r.removed).map((r) => ({ coverageId: r.coverageId, base: r.section === "base" })));
}

/** 보이는 그룹 목록 — 저장된 순서(이 상품에 없게 된 기본 그룹은 뺀다) 뒤에 자리가 없는 기본 그룹을 열거값 순서로 (도메인 `effectiveGroups` 와 같다). */
export function displayGroups(draft: CoveragesDraft, ctx: GroupContext): DraftGroup[] {
  const present = new Set(groupedCoverageIds(draft).flatMap((id) => ctx.categoryOf(id) ?? []));
  const byKey = new Map(draft.groups.map((g) => [g.key, g]));
  const asDomain = draft.groups.map((g) => (g.kind === "category" ? { kind: "category" as const, code: g.code } : { kind: "user" as const, id: g.key, name: g.name }));
  return effectiveGroups(asDomain, present, ctx.categoryOrder).map((g) => (g.kind === "category" ? { key: `category:${g.code}`, kind: "category", code: g.code } : byKey.get(g.id)!));
}

/** 그 그룹에 든 담보(탑재된 것만, 행 순서) — 사용자 그룹은 소속, 기본 그룹은 그 담보분류에서 사용자 그룹에 들지 않은 것. */
export function groupCoverages(draft: CoveragesDraft, ctx: GroupContext, group: DraftGroup): Id[] {
  const users = new Set(draft.groups.flatMap((g) => (g.kind === "user" ? [g.key] : [])));
  return groupedCoverageIds(draft).filter((id) => {
    const member = draft.members[id];
    const inUser = member !== undefined && users.has(member);
    return group.kind === "user" ? inUser && member === group.key : !inUser && ctx.categoryOf(id) === group.code;
  });
}

/** 담보가 드는 그룹 — 특별약관 표의 「그룹」 열(읽기 전용). 담보분류를 정할 수 없으면(미입력 · 지운 값) undefined. */
export function groupOfCoverage(draft: CoveragesDraft, ctx: GroupContext, coverageId: Id): DraftGroup | undefined {
  const member = draft.members[coverageId];
  const user = member === undefined ? undefined : draft.groups.find((g) => g.kind === "user" && g.key === member);
  if (user) return user;
  const code = ctx.categoryOf(coverageId);
  return code !== undefined && ctx.categoryOrder.includes(code) ? { key: `category:${code}`, kind: "category", code } : undefined;
}

/** 「+ 담보」 고르기의 후보 — 그룹을 읽는 담보(`groupedCoverageIds`) 중 사용자 그룹에 들지 않은 것. */
export function freeCoverages(draft: CoveragesDraft): Id[] {
  const users = new Set(draft.groups.flatMap((g) => (g.kind === "user" ? [g.key] : [])));
  return groupedCoverageIds(draft).filter((id) => !(draft.members[id] !== undefined && users.has(draft.members[id]!)));
}

/** 저장 입력의 그룹 — 보이는 목록 + 탑재된 담보의 소속. */
function groupsOf(draft: CoveragesDraft, ctx: GroupContext): ProductGroupsInput {
  const list = displayGroups(draft, ctx).map((g) => (g.kind === "category" ? { kind: "category" as const, code: g.code } : { kind: "user" as const, key: g.key, ...(g.id ? { id: g.id } : {}), name: g.name }));
  const users = new Set(list.flatMap((g) => (g.kind === "user" ? [g.key] : [])));
  const mounted = groupedCoverageIds(draft);
  const memberships = mounted.flatMap((coverageId) => {
    const group = draft.members[coverageId];
    return group !== undefined && users.has(group) ? [{ coverageId, group }] : [];
  });
  return { list, memberships };
}

/** 그룹이 저장본과 다른가 — 다르면 저장 입력에 실을 그룹, 같으면 undefined. */
export function groupsInput(saved: CoveragesDraft, draft: CoveragesDraft, ctx: GroupContext): ProductGroupsInput | undefined {
  const next = groupsOf(draft, ctx);
  const sortMembers = (g: ProductGroupsInput) => JSON.stringify({ list: g.list, memberships: [...g.memberships].sort((a, b) => a.coverageId.localeCompare(b.coverageId)) });
  return sortMembers(next) === sortMembers(groupsOf(saved, ctx)) ? undefined : next;
}

function groupsReducer(state: CoveragesDraft, action: Extract<CoveragesDraftAction, { type: "addGroup" | "renameGroup" | "removeGroup" | "moveGroup" | "joinGroup" | "leaveGroup" }>): CoveragesDraft {
  switch (action.type) {
    case "addGroup": {
      // 새 그룹은 목록 끝 — 보이는 목록을 그대로 굳혀 그 뒤에 붙인다(자리 없던 기본 그룹이 새 그룹 뒤로 밀리지 않게)
      const key = `newgroup:${state.groupSeq}`;
      return { ...state, groups: [...displayGroups(state, action.ctx), { key, kind: "user", name: "" }], groupSeq: state.groupSeq + 1 };
    }
    case "renameGroup":
      return { ...state, groups: state.groups.map((g) => (g.key === action.key && g.kind === "user" ? { ...g, name: action.name } : g)) };
    case "removeGroup": {
      const members = Object.fromEntries(Object.entries(state.members).filter(([, group]) => group !== action.key));
      return { ...state, groups: state.groups.filter((g) => g.key !== action.key), members };
    }
    case "moveGroup": {
      const list = displayGroups(state, action.ctx);
      const i = list.findIndex((g) => g.key === action.key);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= list.length) return state;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      // 이 상품에 지금 없는 기본 그룹(탑재 해제 중)의 자리는 뒤에 남겨 되돌리면 돌아올 수 있게
      const shown = new Set(next.map((g) => g.key));
      return { ...state, groups: [...next, ...state.groups.filter((g) => !shown.has(g.key))] };
    }
    case "joinGroup":
      return { ...state, members: { ...state.members, [action.coverageId]: action.key } };
    case "leaveGroup": {
      const { [action.coverageId]: _gone, ...members } = state.members;
      void _gone;
      return { ...state, members };
    }
  }
}

function update(state: CoveragesDraft, key: string, change: (row: CoverageDraftRow) => CoverageDraftRow): CoveragesDraft {
  return { ...state, rows: state.rows.map((r) => (r.key === key ? change(r) : r)) };
}

export function coveragesDraftReducer(state: CoveragesDraft, action: CoveragesDraftAction): CoveragesDraft {
  switch (action.type) {
    case "add": {
      const key = `new:${state.seq}`;
      const row: CoverageDraftRow = { key, ...action.row, plans: [], status: "added", removed: false };
      return { ...state, rows: [...state.rows, row], seq: state.seq + 1 };
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
    default:
      return groupsReducer(state, action);
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

/** 고친 것이 있나 — ✕ · 탭 링크 · 경로 링크의 「버립니까?」 판정. 되돌려 같아지면 고친 것이 아니다. 그룹은 `ctx` 를 주면 함께 본다. */
export function coveragesDraftDirty(saved: CoveragesDraft, draft: CoveragesDraft, ctx?: GroupContext): boolean {
  if (draft.rows.some((r) => r.status === "added")) return true;
  if (draft.rows.some((r) => rowStatus(saved, draft, r.key) !== "saved")) return true;
  return ctx !== undefined && groupsInput(saved, draft, ctx) !== undefined;
}

/** 저장 입력 — 바뀐 것만. 지우는 행의 이름 · 부착은 보내지 않는다. 그룹은 `ctx` 를 주면 바뀌었을 때만 싣는다. */
export function toCoveragesInput(saved: CoveragesDraft, draft: CoveragesDraft, ctx?: GroupContext): ProductCoveragesInput {
  const groups = ctx ? groupsInput(saved, draft, ctx) : undefined;
  return {
    ...(groups ? { groups } : {}),
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
