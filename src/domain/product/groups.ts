/**
 * 특약 그룹 (기능/상품 §3.7 · ADR-0090) — 순수.
 *
 * - **기본 그룹 = 담보분류** — 상품이 따로 정하지 않은 담보는 그 담보의 담보분류 값(`coverage/category.ts`)대로 묶인다.
 * - **사용자 그룹은 상품 안에서** 만든다(이름 = 책자의 그룹 제목). **담보 단위로** 넣는다 — 그 담보의 상품담보는 모두 같은 그룹이다.
 * - **그룹 순서 = 상품의 그룹 목록 하나**(`effectiveGroups`) — 기본 그룹(이 상품에 그 담보분류의 그룹을 읽는 담보가 있는 것만 — `groupedCoverageIds`)과 사용자 그룹이 함께 선다.
 *   목록에 자리가 없는 기본 그룹은 저장된 목록 뒤에 열거형 값 순서. 아무것도 저장하지 않은 상품은 기본 그룹만 열거형 값 순서다.
 * - 그룹 안 순서는 자동(`sortInGroup`): **담보코드 → 담보속성 종류(order) → 유효값(코드 순) 오름차순.**
 *   담보가 1차 키라 같은 담보의 탑재분 뭉침은 정렬의 귀결. 미사용 속성은 사용한 것보다 앞.
 */
import type { Code, Id, Issue, Result } from "../types";
import { ok, reject } from "../types";
import { attributeValueRank } from "./attributes";
import type { AttributeKind, ProductCoverage } from "./types";

/** 상품 그룹 목록의 한 줄 — 기본 그룹(담보분류 값 코드) 또는 사용자 그룹(이름). */
export type ProductGroup = { kind: "category"; code: Code } | { kind: "user"; id: Id; name: string };

/** 사용자 그룹 소속 — 상품 × 담보 하나에 그룹 하나. */
export interface ProductGroupMembership {
  coverageId: Id;
  groupId: Id;
}

/** 상품의 그룹 설정 — 저장된 목록(순서) + 소속. 스냅샷이 아니라 상품의 설정이다(ADR-0090 결정 4). */
export interface ProductGroupSetting {
  groups: ProductGroup[];
  memberships: ProductGroupMembership[];
}

export const NO_PRODUCT_GROUPS: ProductGroupSetting = { groups: [], memberships: [] };

/** 그룹 열쇠 — 기본 그룹 `category:V01`, 사용자 그룹은 id. 화면 초안 · 저장 거부 좌표 · 책자 그룹 id 가 같은 열쇠를 쓴다. */
export function groupKey(group: ProductGroup): string {
  return group.kind === "category" ? `category:${group.code}` : group.id;
}

/**
 * 이 상품의 그룹 목록 — 저장된 순서(이 상품에 없는 기본 그룹 · 열거형에 없는 값은 뺀다) 뒤에 자리가 없는 기본 그룹을 열거형 값 순서로.
 * `present` = 이 상품에서 그룹을 읽는 담보들(`groupedCoverageIds`)의 담보분류, `categoryOrder` = 열거형 「담보분류」의 값 순서.
 */
export function effectiveGroups(saved: readonly ProductGroup[], present: ReadonlySet<Code>, categoryOrder: readonly Code[]): ProductGroup[] {
  const known = new Set(categoryOrder);
  const out: ProductGroup[] = [];
  const placed = new Set<Code>();
  for (const g of saved) {
    if (g.kind === "user") out.push(g);
    else if (present.has(g.code) && known.has(g.code) && !placed.has(g.code)) {
      out.push(g);
      placed.add(g.code);
    }
  }
  for (const code of categoryOrder) if (present.has(code) && !placed.has(code)) out.push({ kind: "category", code });
  return out;
}

/**
 * 그룹을 읽는 담보 (ADR-0090 결정 7) — 특약 담보, 그리고 기본계약이 둘 이상(케이스 2 — 절 형태의 제2절 블록)이면 기본계약 담보도.
 * 같은 그룹 목록이 블록과 특약 그룹 둘 다의 순서라서다. 기본계약 하나(대치 형태)의 기본계약은 보통약관 조 자리라 그룹을 읽지 않는다.
 * `mounts` = 탑재 상품담보마다 한 줄(담보 id · 기본계약인가). 처음 나온 순 · 중복 없음.
 * 서비스 저장(`saveCoverages` — 소속 대상 · 기본 그룹) · 화면 초안 · 조립(`orderInGroups` — 이 상품의 기본 그룹)이 같이 쓴다.
 * 독립특약(케이스 3)의 블록은 탑재 상품담보 = 특약 절이라 따로 넓힐 것이 없다.
 */
export function groupedCoverageIds(mounts: readonly { coverageId: Id; base: boolean }[]): Id[] {
  const blocks = mounts.filter((m) => m.base).length >= 2;
  return [...new Set(mounts.filter((m) => !m.base || blocks).map((m) => m.coverageId))];
}

/** 상품담보 탭 저장의 그룹 입력 — 화면의 최종 목록(순서대로) + 소속. 새 사용자 그룹은 `id` 없이 화면 열쇠(`key`)만. */
export interface ProductGroupsInput {
  list: ({ kind: "category"; code: Code } | { kind: "user"; key: string; id?: Id; name: string })[];
  /** `group` = 사용자 그룹의 열쇠(`list` 의 `key`). */
  memberships: { coverageId: Id; group: string }[];
}

export interface GroupPlanContext {
  saved: ProductGroupSetting;
  /** 저장 전 이 상품에서 그룹을 읽던 담보(`groupedCoverageIds`) — 같은 저장의 탑재 해제로 빠진 담보의 소속은 조용히 지운다. */
  mountedBefore: ReadonlySet<Id>;
  /** 저장 뒤 이 상품에서 그룹을 읽는 담보(`groupedCoverageIds` — 특약 담보 + 기본계약 2+ 의 기본계약 담보). */
  mountedAfter: ReadonlySet<Id>;
  /** 저장 뒤 이 상품의 기본 그룹 — 그룹을 읽는 담보들의 담보분류(열거형에 있는 값). */
  present: ReadonlySet<Code>;
  categoryOrder: readonly Code[];
  /** 기본 그룹 제목(담보분류 값의 「그룹 제목」) — 이름 중복 검사용. */
  categoryTitle: (code: Code) => string | undefined;
  newId: () => Id;
}

const titleKey = (title: string) => title.trim().replace(/\s+/g, " ");

/**
 * 그룹 저장 계획 — 최종 목록 · 소속을 검사하고 정리한다. 입력이 없으면(그룹을 고치지 않은 저장) 저장본을 정리만 한다.
 * - 거부: 빈 이름 · 이 상품의 다른 그룹 제목(기본 그룹의 「그룹 제목」 포함)과 같은 이름 · 같은 그룹 두 번 · 이 상품 것이 아닌 그룹 id ·
 *   담보가 두 그룹에 · 없는 그룹 · 이 상품에 특약으로 탑재된 적 없는 담보. 좌표 = 그 그룹 줄(`ownerId` = 그룹 열쇠).
 * - 정리: 이 상품에 없게 된 기본 그룹 · 같은 저장에서 탑재 해제한 담보의 소속은 조용히 뺀다(기능/상품 §3.8).
 */
export function planProductGroups(input: ProductGroupsInput | undefined, ctx: GroupPlanContext): Result<ProductGroupSetting> {
  if (input === undefined) {
    const groups = ctx.saved.groups.filter((g) => g.kind === "user" || ctx.present.has(g.code));
    return ok({ groups, memberships: ctx.saved.memberships.filter((m) => ctx.mountedAfter.has(m.coverageId)) });
  }
  const issues: Issue[] = [];
  const at = (key: string, refPath?: string) => ({ document: "product" as const, ownerId: key, ...(refPath ? { refPath } : {}) });
  const savedUser = new Set(ctx.saved.groups.flatMap((g) => (g.kind === "user" ? [g.id] : [])));
  const titles = new Set([...ctx.present].flatMap((code) => {
    const t = ctx.categoryTitle(code);
    return t ? [titleKey(t)] : [];
  }));
  const groups: ProductGroup[] = [];
  const idOfKey = new Map<string, Id>();
  const seenCategory = new Set<Code>();
  for (const row of input.list) {
    if (row.kind === "category") {
      if (seenCategory.has(row.code)) issues.push({ kind: "typeMismatch", message: "같은 기본 그룹이 두 번 있습니다 — 화면을 새로고침해 주세요", at: at(`category:${row.code}`) });
      seenCategory.add(row.code);
      if (ctx.present.has(row.code)) groups.push({ kind: "category", code: row.code });
      continue;
    }
    if (idOfKey.has(row.key)) {
      issues.push({ kind: "typeMismatch", message: "같은 그룹이 두 번 있습니다 — 화면을 새로고침해 주세요", at: at(row.key) });
      continue;
    }
    if (row.id !== undefined && !savedUser.has(row.id)) {
      issues.push({ kind: "brokenRef", message: "이 상품의 그룹이 아닙니다 — 화면을 새로고침해 주세요", at: at(row.key) });
      continue;
    }
    const id = row.id ?? ctx.newId();
    idOfKey.set(row.key, id);
    const name = row.name.trim();
    if (!name) issues.push({ kind: "typeMismatch", message: "그룹 이름은 비울 수 없습니다", at: at(row.key, "name") });
    else if (titles.has(titleKey(name))) issues.push({ kind: "typeMismatch", message: `이 상품의 다른 그룹 제목과 같습니다 — 「${name}」`, at: at(row.key, "name") });
    if (name) titles.add(titleKey(name));
    groups.push({ kind: "user", id, name });
  }
  const memberships: ProductGroupMembership[] = [];
  const placed = new Set<Id>();
  for (const m of input.memberships) {
    const groupId = idOfKey.get(m.group);
    if (placed.has(m.coverageId)) {
      issues.push({ kind: "typeMismatch", message: "담보 하나는 사용자 그룹 하나에만 듭니다", at: at(m.group, "coverages") });
      continue;
    }
    if (groupId === undefined) {
      issues.push({ kind: "brokenRef", message: "없는 그룹입니다 — 화면을 새로고침해 주세요", at: at(m.group, "coverages") });
      continue;
    }
    if (!ctx.mountedAfter.has(m.coverageId)) {
      if (!ctx.mountedBefore.has(m.coverageId)) issues.push({ kind: "brokenRef", message: "이 상품에 특약으로 탑재된 담보가 아닙니다", at: at(m.group, "coverages") });
      continue;
    }
    placed.add(m.coverageId);
    memberships.push({ coverageId: m.coverageId, groupId });
  }
  if (issues.length) return reject({ reason: "invalid", issues });
  return ok({ groups, memberships });
}

/** 담보의 정렬 순서 — 담보코드 순(조립이 주입). 없으면 담보 id 문자열 순. */
export type CoverageOrder = (coverageId: Id) => number;

export function sortInGroup<T extends ProductCoverage>(
  members: readonly T[],
  kinds: readonly AttributeKind[],
  coverageOrder?: CoverageOrder,
): T[] {
  const orderedKinds = [...kinds].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const valueOrder = (m: ProductCoverage, kind: AttributeKind): number => {
    const sel = m.attributes.find((s) => s.kindCode === kind.code);
    if (!sel) return -1; // 미사용 속성이 앞
    const v = kind.values.find((x) => x.code === sel.valueCode);
    return v ? attributeValueRank(v.code) : Number.MAX_SAFE_INTEGER; // 코드 순이 곧 값 순서 · 깨진 값은 뒤
  };
  return [...members].sort((a, b) => {
    if (a.coverageId !== b.coverageId) {
      if (coverageOrder) {
        const d = coverageOrder(a.coverageId) - coverageOrder(b.coverageId);
        if (d !== 0) return d;
      }
      return a.coverageId.localeCompare(b.coverageId);
    }
    for (const kind of orderedKinds) {
      const d = valueOrder(a, kind) - valueOrder(b, kind);
      if (d !== 0) return d;
    }
    return a.id.localeCompare(b.id);
  });
}
