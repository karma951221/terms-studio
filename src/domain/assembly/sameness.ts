/**
 * 제1절 판정의 「같다」 — 함수조항 동일 가드 · 항 단위 (ADR-0082 결정 4 · 9 · 기능/함수조항 §3.8 · 기능/조립산출 §3.9 · §3.10).
 *
 * - 판정 단위는 블록 조의 직속 자식 하나(항 · 표 · 박스 · 오류 마커). 「항」 함수조항이 펼친 항(`clauseUse`)만 서명을 갖는다 —
 *   일반 글 항 · 문장 안 「문구」 함수조항만 든 항 · 조 직속 표 · 박스 · 글머리 목록은 서명이 없어 늘 「다르다」(함수조항 §5 「같다 단위의 빈자리」 ② ③ — 2026-10-17 단순한 쪽).
 * - 「항」 함수조항 하나가 항 여럿을 펴면 펼친 항 하나하나가 단위다(빈자리 ① — 서명에 펼친 순번).
 * - 서명 = 함수조항 코드 + 고른 옵션 + 펼친 순번 + 해소 뒤 내용. 인자는 해소 뒤 글로 견준다 — 담보 값을 넘긴 인자는 블록마다 글이 달라 「다르다」.
 * - 참조 대치(결정 9): 자기 블록 조를 가리키는 참조는 그 조가 조연결한 템플릿 조로 바꿔 끼운 뒤 견주고, 항 · 호 · 목은 (조, 순번)으로 본다.
 *   조연결 없는 블록 조를 가리키면 블록마다 다른 값이라 「다르다」(C5). 보통약관 참조는 그대로.
 *
 * DB·React import 금지 (순수층).
 */
import type { Id } from "../types";
import { keyBase } from "./resolve";
import type { JudgeUnit } from "./section";
import type { RArticle, RParagraph, SInline, SubstitutedDoc } from "./types";
import { articlesOf } from "./walk";

/** 블록 문서 안 항 · 호 · 목 열쇠(`조id#열쇠` · 원형 열쇠) → 순번 경로(「2」 · 「2.1」 · 「2.1.3」 — 조 직속 자식 순번부터). */
export function blockPositions(doc: SubstitutedDoc): Map<string, string> {
  const out = new Map<string, string>();
  const put = (articleId: Id, key: string | undefined, pos: string) => {
    if (key === undefined) return;
    for (const k of [key, keyBase(key)]) if (!out.has(`${articleId}#${k}`)) out.set(`${articleId}#${k}`, pos);
  };
  for (const a of articlesOf(doc)) {
    a.children.forEach((p, i) => {
      if (p.kind !== "paragraph") return;
      put(a.id, p.key, `${i}`);
      (p.items ?? []).forEach((it, j) => {
        if (it.kind !== "item") return;
        put(a.id, it.key, `${i}.${j}`);
        (it.subitems ?? []).forEach((sub, k) => {
          if (sub.kind === "subitem") put(a.id, sub.key, `${i}.${j}.${k}`);
        });
      });
    });
  }
  return out;
}

export interface SamenessContext {
  /** 블록(상품담보 id) — 조연결 없는 블록 조 참조 · 오류 마커를 블록마다 다르게 만든다. */
  owner: Id;
  /** 블록 조 id → 조연결한 템플릿 조 id (이 블록에서 판정 대상인 연결만). */
  linkOf: ReadonlyMap<Id, Id>;
  /** `blockPositions` 결과. */
  positions: ReadonlyMap<string, string>;
  /** 참조 대치 내역 받기 — 참조 노드 id · 블록 조 id → 템플릿 조 id (판정 기록, ADR-0082 결정 11). */
  onSubstitute?: (refId: Id, from: Id, to: Id) => void;
}

/** 블록 조 하나의 판정 단위 — 조 직속 자식마다 서명 · 같은 조 안 참조 순번. */
export function judgeUnits(article: RArticle<SInline>, ctx: SamenessContext): JudgeUnit[] {
  const ownKeys = new Map<string, number>();
  article.children.forEach((p, i) => {
    if (p.kind !== "paragraph") return;
    for (const k of keysIn(p)) if (!ownKeys.has(k)) ownKeys.set(k, i);
  });
  return article.children.map((p, i): JudgeUnit => {
    const selfRefs = p.kind === "paragraph" ? [...new Set(selfTargets(p, article.id).flatMap((code) => {
      const at = ownKeys.get(code) ?? ownKeys.get(keyBase(code));
      return at !== undefined && at !== i ? [at] : [];
    }))] : [];
    if (p.kind !== "paragraph" || !p.clauseUse) return { selfRefs };
    const { code, options, index } = p.clauseUse;
    return { sig: `${code}|${options}|${index}|${serialize({ children: p.children, items: p.items ?? [] }, ctx)}`, selfRefs };
  });
}

/** 항 · 그 안 호 · 목의 열쇠(원형 포함). */
function keysIn(p: RParagraph<SInline>): string[] {
  const out: string[] = [];
  const add = (k?: string) => {
    if (k !== undefined) out.push(k, keyBase(k));
  };
  add(p.key);
  for (const g of p.groups ?? []) add(g);
  for (const it of p.items ?? []) {
    if (it.kind !== "item") continue;
    add(it.key);
    for (const sub of it.subitems ?? []) if (sub.kind === "subitem") add(sub.key);
  }
  return out;
}

/** 이 항 안에서 같은 조(`articleId`)의 항 · 호 · 목을 가리키는 자기 참조의 코드. */
function selfTargets(p: RParagraph<SInline>, articleId: Id): string[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const node = x as { kind?: string; scope?: string; targets?: { articleId: Id; code?: string }[] };
    if (node.kind === "articleRef" && node.scope === "self") for (const t of node.targets ?? []) if (t.articleId === articleId && t.code !== undefined) out.push(t.code);
    for (const [k, v] of Object.entries(x)) if (k !== "issue" && typeof v === "object") walk(v);
  };
  walk(p);
  return out;
}

/** 내용 직렬화 — 노드 id · 열쇠 · 반복 표지는 버리고, 참조는 대치한 값으로, 오류 마커는 블록마다 다르게. */
function serialize(x: unknown, ctx: SamenessContext): string {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map((v) => serialize(v, ctx)).join(",")}]`;
  const node = x as Record<string, unknown> & { kind?: string };
  if (node.kind === "error") return `⟦error:${ctx.owner}:${String(node.id)}⟧`;
  if (node.kind === "articleRef") {
    const ref = node as unknown as { id: Id; scope: string; connector?: string; targets: { articleId: Id; code?: string; innerCode?: string; values?: string[]; keys?: string[] }[] };
    const targets = ref.targets.map((t) => {
      const tail = `${t.innerCode ?? ""}|${(t.values ?? []).join(",")}|${(t.keys ?? []).join(",")}`;
      if (ref.scope === "general") return `G:${t.articleId}#${t.code ?? ""}|${tail}`;
      const linked = ctx.linkOf.get(t.articleId);
      if (linked === undefined) return `B:${ctx.owner}:${t.articleId}#${t.code ?? ""}|${tail}`;
      ctx.onSubstitute?.(ref.id, t.articleId, linked);
      const pos = t.code === undefined ? "" : (ctx.positions.get(`${t.articleId}#${t.code}`) ?? ctx.positions.get(`${t.articleId}#${keyBase(t.code)}`) ?? `?${t.code}`);
      return `T:${linked}#${pos}|${tail}`;
    });
    return `⟦ref:${ref.connector ?? ""}:${targets.join(";")}⟧`;
  }
  const skip = new Set(["id", "key", "loops", "groups", "clauseUse", "excludeFromComparison"]);
  return `{${Object.keys(node)
    .filter((k) => !skip.has(k))
    .sort()
    .map((k) => `${k}:${serialize(node[k], ctx)}`)
    .join(",")}}`;
}
