/**
 * 함수조항 참조 — 사용처 쪽 규칙 (순수).
 *
 * - `checkAttachmentForReference` : 참조 추가 시 요구 구분자 존재 검사 (기능/함수조항 §3.4 ②).
 *   2026-09-12 이후 부착(노출여부)이 없어 「값 자리가 없어서 미부착」인 경우가 사라졌다 (ADR-0037) —
 *   남는 것은 **카탈로그에 없는 구분자**(깨진 참조)뿐이다. `missing` 은 항상 비어 있고 자리만 남겨 둔다.
 * - `validateOptionSelection` · `resolveOptions` : 옵션 선택 검증 · 오버라이드 해소 (기능/함수조항 §3.2 · 기능/상품 §3.6).
 * - `expandClause` : 인라인화 — 옵션 자리를 선택지 본문으로 치환한 노드 배열 · 조 참조 인자 슬롯을 사용처 연결(사용처 조 참조)로. 조건은 해소하지 않는다.
 * - `recheckUsages` : 정의 수정 후 사용처 전부 재검사 — 옵션 · 인자 연결 · 연결한 구분자 (기능/함수조항 §3.2 · §3.4 · ADR-0076).
 */
import type { Discriminator } from "../catalog/types";
import { ok, reject } from "../types";
import type { Code, Coordinate, Id, Issue, Result } from "../types";
import type { Block, BlockBranch, BulletListNode, Inline, InlineBranch, ItemBodyNode, ItemNode, SubitemBodyNode, SubitemNode } from "./nodes";
import type { ExprType } from "../expression";
import { coveredByLoop, LEVEL_WORD, type KeyedLevel } from "../coverage/keys";
import { boundDiscriminators, checkUsageBindings, definitionDiscriminators, type Bindings } from "./params";
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
 * 요구 구분자 존재 검사 — 검사 ② (a) (기능/함수조항 §3.4). 부착이 사라져 값 자리가 없어서 막히는 경우는 없다 (ADR-0037) —
 * 카탈로그에 없는 구분자만 깨진 참조로 보고한다. `missing` 은 늘 비어 있다 (호출부 계약 보존).
 *
 * 이슈의 `at` 은 사용처 좌표(참조가 놓인 자리), `source` 는 **함수조항 본문**이다 — 고치면 사라지는 곳은
 * 그 구분자를 읽는 함수조항 쪽(참조 제거)이지 사용처가 아니다 (ADR-0049 §4 「원천은 고치면 사라지는 곳」).
 */
export function checkAttachmentForReference(
  clause: Clause,
  lookup: DiscriminatorLookup,
  coordinate: Coordinate = {},
  /** 대조할 구분자 — 기본은 정의가 기대는 전부(본문 직접 읽기 + 기본 연결). 사용처 재검사는 그 사용처가 실제로 읽는 것(`boundDiscriminators`). */
  codes: readonly Code[] = definitionDiscriminators(clause),
): AttachmentCheck {
  const broken: Code[] = [];
  const issues: Issue[] = [];
  for (const code of codes) {
    if (lookup(code)) continue;
    broken.push(code);
    issues.push({
      kind: "brokenRef",
      message: `함수조항 ${clause.code} 이(가) 읽는 구분자가 없습니다: ${code}`,
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
      issues.push({ kind: "optionInvalid", message: `함수조항 ${clause.code} 에 없는 옵션입니다: ${code}`, at: { ...coordinate, refPath: code } });
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
 * 옵션 자리를 선택지 본문으로 치환한 새 노드 배열. 모든 노드 id 는 `${refNodeId}/${원노드id}`. 항 · 호 · 목의 P코드는 그대로 둔다.
 * 조 참조 인자 슬롯(`scope: "param"`)은 사용처 연결(`bindings`)의 조 참조 — 대상 + 연결어 + 범위(`self` · `general`) — 로 바꾼다(ADR-0083 결정 4).
 * 펼친 뒤에는 사용처 자신의 조 참조라 문면 자기 참조와 같은 규칙(계산 번호 · 덩어리 표기 · 분기로 사라짐)을 탄다. 연결이 없으면 `argUnbound` 거부.
 * 「이 함수조항」(`scope: "clause"`) 대상은 코드 그대로 둔다 — 사용처 조 · 참조 노드 코드와 짝지어 푸는 것은 조립이다
 * (펼친 노드의 열쇠 = 참조 노드 코드 / 안쪽 코드, ADR-0072 결정 3 개정). 조건은 해소하지 않는다 — 문맥은 사용처(조립) 몫.
 */
export function expandClause(clause: Clause, selection: OptionSelection, refNodeId: Id, bindings?: Bindings): Result<ClauseBody> {
  const issues = validateOptionSelection(clause, selection);
  if (issues.length > 0) return reject({ reason: "invalid", issues });
  const unbound: Issue[] = [];

  const nid = (id: Id) => `${refNodeId}/${id}`;
  const valueBody = (optionCode: Code): Inline[] => {
    const opt = clause.options.find((o) => o.code === optionCode)!;
    return opt.values.find((v) => v.code === selection[optionCode])!.body;
  };

  // 옵션 자리는 자리 id 를 앞에 붙여 펼친다 — 같은 옵션을 본문에 두 번 두어도 펼친 노드 id 가 겹치지 않는다
  // (예: 「{기산일}부터 180일 … {기산일}부터 180일이 되는 날」 — 2026-09-28 메리츠 함수조항 재편)
  const inlines = (list: Inline[], scope = ""): Inline[] => list.flatMap((n) => inline(n, scope));
  const inline = (n: Inline, scope: string): Inline[] => {
    switch (n.kind) {
      case "optionSlot":
        return inlines(valueBody(n.optionCode), `${scope}${n.id}/`);
      case "inlineCond":
        return [{ ...n, id: nid(scope + n.id), branches: n.branches.map((b): InlineBranch => ({ ...b, id: nid(scope + b.id), children: inlines(b.children, scope) })) }];
      case "inlineSwitch":
        // 값별 분기는 칸째 두고(고르는 것은 사용처 문맥) id 만 유일화한다
        return [{ ...n, id: nid(scope + n.id), cases: n.cases.map((k) => ({ ...k, id: nid(scope + k.id), children: inlines(k.children, scope) })) }];
      case "articleRef": {
        if (n.scope !== "param") return [{ ...n, id: nid(scope + n.id) }];
        const name = n.targets[0]?.param ?? "";
        const b = bindings?.[name];
        if (b?.kind !== "articleRef") {
          if (!unbound.some((i) => i.at.refPath === `arg.${name}`)) unbound.push({ kind: "argUnbound", message: `함수조항 ${clause.code} 의 조 참조 인자 ${name} 이(가) 연결되지 않았습니다`, at: { refPath: `arg.${name}` } });
          return [];
        }
        // 펼친 노드는 사용처 조 참조 모양(범위 self · general) — 함수조항 노드 타입 밖이라 단언한다
        const ref = { id: nid(scope + n.id), kind: "articleRef", targets: b.targets.map((t) => ({ ...t })), ...(b.connector !== undefined ? { connector: b.connector } : {}), scope: b.scope };
        return [ref as unknown as Inline];
      }
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
  const bullets = (l: BulletListNode): BulletListNode => ({ ...l, id: nid(l.id), children: l.children.map((x) => ({ ...x, id: nid(x.id), children: inlines(x.children) })) });
  // 박스 참조는 잎 — id 만 유일화하고 코드는 그대로 (내용은 조립이 박스 마스터에서 읽는다)
  const block = (b: Block): Block => {
    if (b.kind === "bulletList") return bullets(b);
    if (b.kind === "boxRef") return { ...b, id: nid(b.id) };
    if (b.kind === "paragraph") {
      return { ...b, id: nid(b.id), children: inlines(b.children), ...(b.items ? { items: b.items.map((it) => (it.kind === "bulletList" ? bullets(it) : it.kind === "boxRef" ? { ...it, id: nid(it.id) } : item(it))) } : {}) };
    }
    if (b.kind === "switchBlock") return { ...b, id: nid(b.id), cases: b.cases.map((k) => ({ ...k, id: nid(k.id), children: k.children.map(block) })) };
    return { ...b, id: nid(b.id), branches: b.branches.map((br): BlockBranch => ({ ...br, id: nid(br.id), children: br.children.map(block) })) };
  };

  // 호 · 목 유형 — 목록 자리의 조건 블록은 가지째 두고(해소는 사용처 문맥) id 만 유일화한다
  const itemBody = (n: ItemBodyNode): ItemBodyNode => {
    if (n.kind === "switchBlock") return { ...n, id: nid(n.id), cases: n.cases.map((k) => ({ ...k, id: nid(k.id), children: k.children.map(itemBody) })) };
    if (n.kind === "condBlock") return { ...n, id: nid(n.id), branches: n.branches.map((br) => ({ ...br, id: nid(br.id), children: br.children.map(itemBody) })) };
    if (n.kind === "bulletList") return bullets(n);
    if (n.kind === "boxRef") return { ...n, id: nid(n.id) };
    return item(n);
  };
  const subitemBody = (n: SubitemBodyNode): SubitemBodyNode =>
    n.kind === "switchBlock"
      ? { ...n, id: nid(n.id), cases: n.cases.map((k) => ({ ...k, id: nid(k.id), children: k.children.map(subitemBody) })) }
      : n.kind === "condBlock" ? { ...n, id: nid(n.id), branches: n.branches.map((br) => ({ ...br, id: nid(br.id), children: br.children.map(subitemBody) })) } : subitem(n);

  const body: ClauseBody = clause.mode === "inline" ? inlines(clause.body) : clause.mode === "block" ? clause.body.map(block) : clause.mode === "item" ? clause.body.map(itemBody) : clause.body.map(subitemBody);
  return unbound.length > 0 ? reject({ reason: "invalid", issues: unbound }) : ok(body);
}

// ───────────────────────────── 사용처 재검사 ─────────────────────────────

/** 사용처 문서의 소유 실체 종류 — 담보약관은 담보, 보통약관은 템플릿. */
export type UsageOwnerKind = "coverage" | "general";

/** 함수조항을 참조하는 문서 1건 (참조 인스턴스 단위 — D-P3-10). C1/B3 가 제공한다. */
export interface Usage {
  documentId: Id;
  ownerKind: UsageOwnerKind;
  ownerId: Id;
  ownerName?: string;
  /** 문서 안 참조 노드 id (있으면 좌표에 싣는다). */
  refNodeId?: Id;
  /** 그 참조의 마스터 옵션 선택. 없으면 옵션 검사는 건너뛴다. */
  selection?: OptionSelection;
  /** 그 참조의 인자 연결 (최종 결정 2). 없으면 모든 인자가 기본 연결. 프리셋을 쓰면 프리셋 값을 푼 실제 연결. */
  bindings?: Bindings;
  /** 그 참조가 쓰는 프리셋 코드 (ADR-0084) — 프리셋별 사용 수 · 삭제 확인의 재료. */
  preset?: Code;
  /** 참조 자리를 감싼 가장 안쪽 담보 트리 반복의 레벨 — 그 레벨(이상)의 한정 없는 기본 연결은 현재 노드로 풀린다 (ADR-0087 결정 8). */
  treeLoopLevel?: KeyedLevel;
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

/**
 * 사용처 전부를 훑어 문제가 있는 것만 돌려준다 — 그 사용처가 읽는 구분자 존재(본문 직접 읽기 + 실제 연결) + 옵션 선택 + 인자 연결.
 * 인자를 더하거나(연결 누락) 기본 연결을 바꾸면(구분자가 사라짐 · 타입) 여기서 사용처가 오른다 (최종 결정 2). `typeOf` 를 주면 연결 구분자의 타입까지 본다.
 * 기본 연결을 세부보장 · 급부 레벨 구분자로 바꾸면 키 경로가 없어, 사용처 연결도 없고 감싼 담보 트리 반복이 그 레벨을 풀지 못하는
 * 담보약관 사용처가 연결 누락으로 오른다 (ADR-0087 결정 4 · 8 — 구분자 레벨은 `lookup` 이 준다).
 */
export function recheckUsages(
  clause: Clause,
  usages: readonly Usage[],
  lookup: DiscriminatorLookup,
  typeOf?: (code: Code) => ExprType | undefined,
): RecheckEntry[] {
  const out: RecheckEntry[] = [];
  const env = typeOf ? { discriminatorType: typeOf, discriminatorExists: (code: Code) => lookup(code) !== undefined } : {};
  for (const usage of usages) {
    const at = usageCoordinate(usage);
    const r = checkAttachmentForReference(clause, lookup, at, boundDiscriminators(clause, usage.bindings));
    const issues: Issue[] = [...r.issues];
    if (usage.selection) issues.push(...validateOptionSelection(clause, usage.selection, at));
    issues.push(...checkUsageBindings(clause, usage.bindings, env, at));
    issues.push(...unqualifiedDefaultIssues(clause, usage, lookup, at));
    if (issues.length > 0) out.push({ usage, missing: r.missing, issues });
  }
  return out;
}

/** 사용처가 바꾸지 않은 인자의 기본 연결이 한정 없는 하위 레벨 구분자인데 감싼 트리 반복이 풀지 못하면 `argUnbound`. 보통약관은 문맥 담보가 없어 저장 검사가 따로 본다. */
function unqualifiedDefaultIssues(clause: Clause, usage: Usage, lookup: DiscriminatorLookup, at: Coordinate): Issue[] {
  if (usage.ownerKind !== "coverage") return [];
  const out: Issue[] = [];
  for (const p of clause.params ?? []) {
    const d = usage.bindings?.[p.name] ?? p.default;
    if (d?.kind !== "discriminator" || d.node) continue;
    const level = lookup(d.code)?.level;
    if (level !== "subCoverage" && level !== "benefit") continue;
    if (usage.treeLoopLevel && coveredByLoop(level, usage.treeLoopLevel)) continue;
    out.push({ kind: "argUnbound", message: `함수조항 ${clause.code} 의 인자 ${p.name} 이(가) ${LEVEL_WORD[level]} 레벨 구분자 ${d.code} 에 연결돼 키 경로가 필요합니다`, at: { ...at, refPath: `arg.${p.name}` } });
  }
  return out;
}
