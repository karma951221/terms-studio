/**
 * 상품 조 사본의 참조 무결성 (ADR-0081 · 기능/상품 §3.10) — 템플릿에 조 사본 · 노출 끔을 얹은 **최종 트리**에서
 * 템플릿 단독일 때는 없던 참조 깨짐을 찾는다. 순수.
 *
 * - 대상은 넷 — 같은 템플릿 안 조 참조 · 노출 끈 조를 가리키는 참조 · 대응 보통약관이 이 템플릿인 담보약관의 조연결 · 보통약관 조 참조 ·
 *   함수조항 본문의 보통약관 참조 (결정 2). 뒤의 둘은 「밖의 참조」(`OutsideRef`)로 받는다 — 어떤 문서 · 함수조항을 볼지는 서비스가 고른다.
 * - 깨짐 = 대상 열쇠(`refKey`)가 최종 트리에 없거나 대상 조가 노출 끔이다. 템플릿 단독일 때부터 깨진 참조(같은 노드 · 같은 열쇠)는
 *   템플릿의 일이라 뺀다 — 밖의 참조는 템플릿에 없던 대상이면 뺀다.
 * - 오류는 **가리키는 쪽** 자리에 붙고 원인(지운 항이 든 사본 조 · 끈 조)을 함께 적는다. 밖의 참조는 상품에서 고칠 수 없으므로
 *   원인 조(사본 · 끈 조)의 목차 줄에 붙인다 — 그 상품에서 할 수 있는 일은 사본을 되돌리거나 노출을 켜는 것이다.
 * - 검사는 문서 저장 검증과 같은 정적 검사라 조건을 평가하지 않는다 — 밟지 않는 가지 안의 참조도 깨짐으로 본다(ADR-0081 결과).
 */
import { indexTree, type DocumentNode, type TreeIndex } from "../document/nodes";
import { numberTree, type NodeNumber } from "../document/numbering";
import { nodesOfTarget, parseRefKey, refKey, refLabel, referenceKeys } from "../document/pcode";
import { collectRefs } from "../document/refs";
import type { Code, Coordinate, Id, Issue } from "../types";
import type { GeneralDependents } from "./types";

/** 템플릿 밖에서 이 템플릿의 조 · 자리를 가리키는 참조 하나 — 담보약관의 조연결 · 보통약관 조 참조, 함수조항 본문의 보통약관 참조. */
export interface OutsideRef {
  /** 대상 열쇠(`refKey`) — 조연결이면 조 id. */
  key: string;
  articleId: Id;
  /** 가리키는 쪽의 좌표 (담보약관 · 함수조항). */
  at: Coordinate;
  /** 사람이 읽는 가리키는 쪽 — 「담보약관 「암진단」 보험금」 · 「함수조항 면책 보충(C0002)」. */
  where: string;
}

/** 깨짐 원인 — 사본이 지운 대상 · 노출 끈 조 · (템플릿에도 없는) 없는 대상. */
export type RefBreakCause = "removed" | "hidden" | "missing";

export interface RefBreak {
  /** 오류가 붙을 자리 — 같은 템플릿 안이면 가리키는 노드, 밖의 참조면 원인 조(`articleId`만). */
  at: Coordinate;
  key: string;
  /** 가리킨 대상의 조. */
  articleId: Id;
  cause: RefBreakCause;
  /** 밖의 참조면 가리키는 쪽 표기. */
  outside?: string;
}

export interface CopyRefInput {
  template: DocumentNode;
  /** 템플릿 + 조 사본 (`applyArticleCopies`). */
  final: DocumentNode;
  hidden: Iterable<Id>;
  outside?: readonly OutsideRef[];
  /** 오류 좌표의 기본값 (상품). */
  coordinate?: Coordinate;
}

/** 최종 트리에서 새로 생긴 참조 깨짐 — 같은 템플릿 안(문서 순) 다음 밖의 참조(받은 순). */
export function copyRefBreaks({ template, final, hidden, outside = [], coordinate = {} }: CopyRefInput): RefBreak[] {
  const off = new Set(hidden);
  const before = referenceKeys(indexTree(template));
  const after = referenceKeys(indexTree(final));
  // 템플릿 단독일 때부터 깨진 참조 — 같은 참조 노드 · 같은 열쇠
  const brokenInTemplate = new Set<string>();
  for (const r of collectRefs(template)) {
    if (r.kind === "article" && r.scope === "self" && !before.has(refKey(r))) brokenInTemplate.add(`${r.at.nodePath?.at(-1)}|${refKey(r)}`);
  }
  const causeOf = (key: string, articleId: Id): RefBreakCause | undefined => {
    if (off.has(articleId)) return "hidden";
    if (after.has(key)) return undefined;
    return before.has(key) ? "removed" : "missing";
  };

  const out: RefBreak[] = [];
  for (const r of collectRefs(final, coordinate)) {
    if (r.kind !== "article" || r.scope !== "self") continue;
    if (r.at.articleId !== undefined && off.has(r.at.articleId)) continue; // 끈 조 안 — 나오지 않는다
    const key = refKey(r);
    const cause = causeOf(key, r.articleId);
    if (!cause || brokenInTemplate.has(`${r.at.nodePath?.at(-1)}|${key}`)) continue;
    out.push({ at: r.at, key, articleId: r.articleId, cause });
  }
  for (const o of outside) {
    if (!before.has(o.key)) continue; // 템플릿에 없던 대상 — 이 상품의 일이 아니다
    const cause = causeOf(o.key, o.articleId);
    if (!cause) continue;
    out.push({ at: { ...coordinate, articleId: o.articleId, refPath: o.key }, key: o.key, articleId: o.articleId, cause, outside: o.where });
  }
  return out;
}

/** 조 · 항 · 호 · 목 번호를 이은 자리 표기 — 「제2조 ①」. 번호가 없으면 undefined. */
function placeLabel(ix: TreeIndex, numbers: ReadonlyMap<Id, NodeNumber>, nodeId: Id): string | undefined {
  const path = ix.nodes.get(nodeId)?.path ?? [];
  const parts = path.flatMap((id) => {
    const n = numbers.get(id);
    return n && n.kind !== "section" && n.label !== "" ? [n.label] : [];
  });
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** 목적격 조사 — 끝 글자의 받침으로(「제1조를」 · 「가.을」 → 「가목을」). 호(「1.」 = 1호)는 「를」, 원문자 항 · 그 밖은 「을」. */
function eul(label: string): string {
  if (/\d\.$/.test(label)) return `${label}를`;
  const last = (label.endsWith(".") ? label.slice(0, -1) : label).at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) return `${label}${code % 28 === 0 && !label.endsWith(".") ? "를" : "을"}`;
  return `${label}을`;
}

export interface BreakLabels {
  template: DocumentNode;
  final: DocumentNode;
  /** 최종 트리 번호(함수조항 펼침 수를 아는 화면이 넘긴다). 없으면 기본 번호. */
  numbers?: ReadonlyMap<Id, NodeNumber>;
}

/** 깨짐 → 저장 거부 · 목차 줄 오류. 대상은 템플릿 번호(지운 대상은 최종 트리에 없다), 가리키는 쪽은 최종 트리 번호로. */
export function refBreakIssues(breaks: readonly RefBreak[], labels: BreakLabels): Issue[] {
  if (breaks.length === 0) return [];
  const finalIx = indexTree(labels.final);
  const finalNumbers = labels.numbers ?? numberTree(labels.final);
  const templateIx = indexTree(labels.template);
  const templateNumbers = numberTree(labels.template);
  const targetLabel = (key: string): string => {
    const target = parseRefKey(key);
    const inTemplate = nodesOfTarget(templateIx, target)[0];
    const inFinal = nodesOfTarget(finalIx, target)[0];
    const label = inTemplate ? placeLabel(templateIx, templateNumbers, inTemplate) : inFinal ? placeLabel(finalIx, finalNumbers, inFinal) : undefined;
    return label ?? `대상 ${refLabel(target)}`;
  };
  const articleLabel = (id: Id): string => finalNumbers.get(id)?.label ?? templateNumbers.get(id)?.label ?? "조";
  return breaks.map((b) => {
    const node = b.at.nodePath?.at(-1);
    const where = b.outside ?? (node && placeLabel(finalIx, finalNumbers, node)) ?? (b.at.articleTitle ? `「${b.at.articleTitle}」` : "어느 조");
    const target = targetLabel(b.key);
    let message: string;
    if (b.cause === "removed") message = `${where} — 지운 ${eul(target)} 가리킴 (${articleLabel(b.articleId)} 사본에서 지움) · ${b.outside ? "사본을 되돌리거나 그 항을 남긴다" : "가리키는 조도 사본으로 고친다"}`;
    else if (b.cause === "hidden") message = `${where} — 노출 끈 ${eul(target)} 가리킴 · ${b.outside ? "노출을 켠다" : "가리키는 조도 사본으로 고치거나 노출을 켠다"}`;
    else message = `${where} — 없는 ${eul(target)} 가리킴 · 가리키는 조를 고친다`;
    return { kind: "brokenRef", message, at: b.at };
  });
}

/** 담보약관 하나가 대응 보통약관을 가리키는 참조 — 조연결(조 id) · 보통약관 조 참조(대상 열쇠). `base` 는 그 문서 좌표. */
export function outsideRefsOf(tree: DocumentNode, base: Coordinate = {}): OutsideRef[] {
  const out: OutsideRef[] = [];
  const name = base.ownerName ?? tree.title;
  for (const r of collectRefs(tree, base)) {
    const where = `담보약관 「${name}」${r.at.articleTitle ? ` ${r.at.articleTitle}` : ""}`;
    if (r.kind === "link") out.push({ key: r.linkedArticleId, articleId: r.linkedArticleId, at: r.at, where });
    else if (r.kind === "article" && r.scope === "general") out.push({ key: refKey(r), articleId: r.articleId, at: r.at, where });
  }
  return out;
}

/**
 * 함수조항 하나(본문 · 옵션 선택지 본문)의 보통약관 조 참조 — 범위가 없는 `articleRef`(「이 함수조항」 · 「사용처」는 뺀다).
 * 정의 모양을 깊이 따라가지 않고 노드를 훑는다 — 본문 · 선택지 · 칸 어디에 있든 같다.
 */
export function clauseGeneralRefs(clause: { code: string; label?: string; body?: unknown; options?: unknown }): OutsideRef[] {
  const out: OutsideRef[] = [];
  const where = clause.label ? `함수조항 ${clause.label}(${clause.code})` : `함수조항 ${clause.code}`;
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (x === null || typeof x !== "object") return;
    const n = x as { id?: unknown; kind?: unknown; scope?: unknown; targets?: unknown };
    if (n.kind === "articleRef" && n.scope === undefined && Array.isArray(n.targets)) {
      for (const t of n.targets as { articleId?: unknown; code?: unknown; innerCode?: unknown }[]) {
        if (typeof t?.articleId !== "string") continue;
        const key = refKey({ articleId: t.articleId, ...(typeof t.code === "string" ? { code: t.code } : {}) });
        out.push({ key, articleId: t.articleId, at: { document: "clause", ownerId: clause.code, ...(typeof n.id === "string" ? { nodePath: [n.id] } : {}), refPath: key }, where });
      }
      return;
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(clause.body);
  walk(clause.options);
  return out;
}

/** 이슈 정체 — 종류 · 조 · 자리(경로 끝) · 대상 열쇠. 문구는 보지 않는다. */
function issueKey(i: Issue): string {
  return [i.kind, i.at.articleId ?? "", i.at.nodePath?.at(-1) ?? "", i.at.refPath ?? ""].join("|");
}

/** 최종 트리 검사(E)에서 템플릿 단독 검사(T)에 없던 오류만 — E − T. */
export function newIssuesOnly(finalIssues: readonly Issue[], templateIssues: readonly Issue[]): Issue[] {
  const known = new Set(templateIssues.map(issueKey));
  return finalIssues.filter((i) => !known.has(issueKey(i)));
}

/**
 * 상품 하나가 보는 밖의 참조 — 제가 탑재한 담보(`coverageIds`)의 담보약관 참조 + 그 담보약관 · 이 상품 보통약관 트리(`final`)가 쓰는 함수조항의 참조.
 * 탑재하지 않은 담보약관 · 쓰지 않는 함수조항은 이 상품의 조립에 나오지 않는다.
 */
export function outsideRefsFor(deps: GeneralDependents, coverageIds: ReadonlySet<Id>, final: DocumentNode): OutsideRef[] {
  const docs = deps.documents.filter((d) => coverageIds.has(d.coverageId));
  const used = new Set<Code>(docs.flatMap((d) => d.clauseCodes));
  for (const r of collectRefs(final)) if (r.kind === "clause") used.add(r.clauseCode);
  return [...docs.flatMap((d) => d.refs), ...deps.clauses.filter((c) => used.has(c.code)).flatMap((c) => c.refs)];
}
