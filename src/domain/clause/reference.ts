/**
 * 공용조항 참조 — 사용처 쪽 규칙 (순수).
 *
 * - `checkAttachmentForReference` : 참조 추가 시 요구 구분자 존재 검사 (ADR-0010 결정 4).
 *   2026-09-12 이후 부착(노출여부)이 없어 「값 자리가 없어서 미부착」인 경우가 사라졌다 (ADR-0037) —
 *   남는 것은 **카탈로그에 없는 구분자**(깨진 참조)뿐이다. `missing` 은 항상 비어 있고 자리만 남겨 둔다.
 * - `validateOptionSelection` · `resolveOptions` : 옵션 선택 검증 · 오버라이드 해소 (기능/공용조항 §3.2 · 기능/상품 §3.6).
 * - `expandClause` : 인라인화 — 옵션 자리를 선택지 본문으로 치환한 노드 배열. 조건은 해소하지 않는다.
 * - `recheckUsages` : 정의 수정 후 사용처 전부 재검사 (ADR-0010 결정 5 · 기능/공용조항 §3.2).
 */
import type { Discriminator } from "../catalog/types";
import { ok, reject } from "../types";
import type { Code, Coordinate, Id, Issue, Result } from "../types";
import type { Block, BlockBranch, Inline, InlineBranch, ItemNode, SubitemNode } from "./nodes";
import type { Clause, ClauseBody, OptionSelection } from "./types";

// ───────────────────────────── 카탈로그 조회 ─────────────────────────────

/** 구분자 코드 → 정의. 없으면 undefined (깨진 참조). 카탈로그 서비스의 `get`/`list` 로 만든다. */
export type DiscriminatorLookup = (code: Code) => Discriminator | undefined;

export function lookupFrom(defs: readonly Discriminator[]): DiscriminatorLookup {
  const map = new Map(defs.map((d) => [d.code, d]));
  return (code) => map.get(code);
}

// ───────────────────────────── 부착 검사 ─────────────────────────────

export interface AttachmentCheck {
  /** 미부착 요구 구분자 — 부착 폐기 후 늘 빈 배열 (ADR-0037). */
  missing: Code[];
  /** 카탈로그에 없는 요구 구분자 (깨진 참조). */
  broken: Code[];
  /** missing → notAttached · broken → brokenRef. */
  issues: Issue[];
}

/**
 * 요구 구분자 존재 검사 — 검사 ② (a) (기능/공용조항 §3.4). 부착이 사라져 값 자리가 없어서 막히는 경우는 없다 (ADR-0037) —
 * 카탈로그에 없는 구분자만 깨진 참조로 보고한다. `missing` 은 늘 비어 있다 (호출부 계약 보존).
 *
 * 이슈의 `at` 은 사용처 좌표(참조가 놓인 자리), `source` 는 **공용조항 본문**이다 — 고치면 사라지는 곳은
 * 그 구분자를 읽는 공용조항 쪽(참조 제거)이지 사용처가 아니다 (ADR-0049 §4 「원천은 고치면 사라지는 곳」).
 */
export function checkAttachmentForReference(
  clause: Clause,
  lookup: DiscriminatorLookup,
  coordinate: Coordinate = {},
): AttachmentCheck {
  const broken: Code[] = [];
  const issues: Issue[] = [];
  for (const code of clause.required.discriminators) {
    if (lookup(code)) continue;
    broken.push(code);
    issues.push({
      kind: "brokenRef",
      message: `공용조항 ${clause.code} 이(가) 읽는 구분자가 없습니다: ${code}`,
      at: { ...coordinate, refPath: code },
      source: { document: "clause", ownerId: clause.code, ownerName: clause.label, refPath: code },
    });
  }
  return { missing: [], broken, issues };
}

// ───────────────────────────── 옵션 선택 ─────────────────────────────

/** 미선택 → optionUnselected · 정의에 없는 옵션/선택지 → optionInvalid. 빈 배열이면 유효. */
export function validateOptionSelection(clause: Clause, selection: OptionSelection, coordinate: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  for (const opt of clause.options) {
    const chosen = selection[opt.code];
    if (chosen === undefined) {
      issues.push({ kind: "optionUnselected", message: `옵션 ${opt.label}(${opt.code}) 이(가) 선택되지 않았습니다`, at: { ...coordinate, refPath: opt.code } });
    } else if (!opt.values.some((v) => v.code === chosen)) {
      issues.push({
        kind: "optionInvalid",
        message: `옵션 ${opt.label}(${opt.code}) 의 유효 집합에 없는 선택입니다: ${chosen}`,
        at: { ...coordinate, refPath: opt.code },
      });
    }
  }
  const known = new Set(clause.options.map((o) => o.code));
  for (const code of Object.keys(selection)) {
    if (!known.has(code)) {
      issues.push({ kind: "optionInvalid", message: `공용조항 ${clause.code} 에 없는 옵션입니다: ${code}`, at: { ...coordinate, refPath: code } });
    }
  }
  return issues;
}

/** 오버라이드 > 마스터 기본 순으로 합친 뒤 유효 집합 검사 (기능/상품 §3.6). */
export function resolveOptions(
  clause: Clause,
  master: OptionSelection,
  override: OptionSelection = {},
  coordinate: Coordinate = {},
): { selection: OptionSelection; issues: Issue[] } {
  const selection: OptionSelection = { ...master, ...override };
  return { selection, issues: validateOptionSelection(clause, selection, coordinate) };
}

// ───────────────────────────── 인라인화 ─────────────────────────────

/**
 * 옵션 자리를 선택지 본문으로 치환한 새 노드 배열. 모든 노드 id 는 `${refNodeId}/${원노드id}`.
 * 조건은 해소하지 않는다 — 문맥은 사용처(조립·사전평가) 몫.
 */
export function expandClause(clause: Clause, selection: OptionSelection, refNodeId: Id): Result<ClauseBody> {
  const issues = validateOptionSelection(clause, selection);
  if (issues.length > 0) return reject({ reason: "invalid", issues });

  const nid = (id: Id) => `${refNodeId}/${id}`;
  const valueBody = (optionCode: Code): Inline[] => {
    const opt = clause.options.find((o) => o.code === optionCode)!;
    return opt.values.find((v) => v.code === selection[optionCode])!.body;
  };

  // 옵션 자리는 자리 id 를 앞에 붙여 펼친다 — 같은 옵션을 본문에 두 번 두어도 펼친 노드 id 가 겹치지 않는다
  // (예: 「{기산일}부터 180일 … {기산일}부터 180일이 되는 날」 — 2026-09-28 메리츠 공용조항 재편)
  const inlines = (list: Inline[], scope = ""): Inline[] => list.flatMap((n) => inline(n, scope));
  const inline = (n: Inline, scope: string): Inline[] => {
    switch (n.kind) {
      case "optionSlot":
        return inlines(valueBody(n.optionCode), `${scope}${n.id}/`);
      case "inlineCond":
        return [{ ...n, id: nid(scope + n.id), branches: n.branches.map((b): InlineBranch => ({ ...b, id: nid(scope + b.id), children: inlines(b.children, scope) })) }];
      default:
        return [{ ...n, id: nid(scope + n.id) }];
    }
  };
  const subitem = (s: SubitemNode): SubitemNode => ({ ...s, id: nid(s.id), children: inlines(s.children) });
  const item = (it: ItemNode): ItemNode => ({
    ...it,
    id: nid(it.id),
    children: inlines(it.children),
    ...(it.subitems ? { subitems: it.subitems.map(subitem) } : {}),
  });
  const block = (b: Block): Block => {
    if (b.kind === "paragraph") {
      return { ...b, id: nid(b.id), children: inlines(b.children), ...(b.items ? { items: b.items.map(item) } : {}) };
    }
    return { ...b, id: nid(b.id), branches: b.branches.map((br): BlockBranch => ({ ...br, id: nid(br.id), children: br.children.map(block) })) };
  };

  if (clause.mode === "inline") return ok(inlines(clause.body));
  return ok(clause.body.map(block));
}

// ───────────────────────────── 사용처 재검사 ─────────────────────────────

/** 사용처 문서의 소유 실체 종류 — 담보약관은 담보, 보통약관은 템플릿. */
export type UsageOwnerKind = "coverage" | "general";

/** 공용조항을 참조하는 문서 1건 (참조 인스턴스 단위 — D-P3-10). C1/B3 가 제공한다. */
export interface Usage {
  documentId: Id;
  ownerKind: UsageOwnerKind;
  ownerId: Id;
  ownerName?: string;
  /** 문서 안 참조 노드 id (있으면 좌표에 싣는다). */
  refNodeId?: Id;
  /** 그 참조의 마스터 옵션 선택. 없으면 옵션 검사는 건너뛴다. */
  selection?: OptionSelection;
}

export interface RecheckEntry {
  usage: Usage;
  /** 미부착 요구 구분자 (담보 사용처만). */
  missing: Code[];
  /** notAttached · brokenRef · optionUnselected · optionInvalid */
  issues: Issue[];
}

/** 사용처 → 좌표. ownerId 는 소유 실체(담보 id · 보통약관 문서 id), 참조가 놓인 문서는 documentId 에 — 고치러 가기가 그 문서의 그 노드로 간다. */
export function usageCoordinate(u: Usage): Coordinate {
  return {
    document: u.ownerKind === "coverage" ? "coverageMaster" : "general",
    ownerId: u.ownerId,
    documentId: u.documentId,
    ...(u.ownerName ? { ownerName: u.ownerName } : {}),
    ...(u.refNodeId ? { nodePath: [u.refNodeId] } : {}),
  };
}

/** 사용처 전부를 훑어 문제가 있는 것만 돌려준다 — 요구 구분자 존재 + 옵션 선택. */
export function recheckUsages(
  clause: Clause,
  usages: readonly Usage[],
  lookup: DiscriminatorLookup,
): RecheckEntry[] {
  const out: RecheckEntry[] = [];
  for (const usage of usages) {
    const at = usageCoordinate(usage);
    const r = checkAttachmentForReference(clause, lookup, at);
    const issues: Issue[] = [...r.issues];
    if (usage.selection) issues.push(...validateOptionSelection(clause, usage.selection, at));
    if (issues.length > 0) out.push({ usage, missing: r.missing, issues });
  }
  return out;
}
