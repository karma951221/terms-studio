/**
 * 절 형태 제1절 판정의 조립 쪽 — 판정 재료 모으기 · 판정 · 제1절로 오르는 글 · 블록 조 처리 · 판정 기록
 * (ADR-0082 결정 1 ~ 9 · 11 · 15 · 기능/조립산출 §3.9 · §3.10 · §3.12).
 *
 *   블록(조건 해소 · 블록 빈 조 빼기 뒤) → 연결 검사(duplicateLink · linkTargetGone · wrongGeneral · linkedSpecialRule)
 *   → 판정 단위(sameness) → judgeFirstSection → 제1절로 오르는 항(raisedArticles) → 블록 조 처리(treatBlock) → 판정 기록
 *
 * - 제1절로 오르는 항은 블록 조의 항을 그대로 옮긴다 — 노드 id 는 `상품담보id~` 앞마디, 열쇠는 `상품담보id~블록조id:열쇠`(템플릿 코드와 겹치지 않게),
 *   보통약관 참조는 제1절 안 참조로, 자기 블록 조 참조는 조연결한 템플릿 조로(결정 9 — 항이면 오른 항의 새 열쇠, 오르지 않은 항이면 사라짐 → `articleGone`).
 * - 블록에 남은 조가 제1절로 오른 조 · 항을 가리키면(C4) 렌더 별칭으로 제1절을 찾는다.
 *
 * DB·React import 금지 (순수층).
 */
import { articleRefLabel } from "../document/numbering";
import type { Coordinate, Id, Issue } from "../types";
import { blockPositions, judgeUnits } from "./sameness";
import { FIRST_SECTION_NAME, judgeFirstSection, type FirstSectionVerdict, type JoinOption, type JudgeBlock } from "./section";
import type { AssemblyCoverage, FirstSectionRecord, NumberedDoc, RArticle, RParagraph, SInline, SubstitutedDoc } from "./types";
import { articlesOf, mapArticles } from "./walk";

/** 판정에 드는 블록 하나 — 블록 순서. */
export interface SectionBlock {
  c: AssemblyCoverage;
  doc: SubstitutedDoc;
  /** 복합 블록 — 판별은 후속 기획(조립산출 §5). 지금은 늘 false. */
  composite: boolean;
}

export interface SectionEnv {
  /** 이 상품 최종 트리(조건 해소 · 노출 끔 뒤)에 있는 템플릿 조 id. */
  present: ReadonlySet<Id>;
  /** 상품이 노출을 끈 템플릿 조 id → 조 명. */
  hidden?: ReadonlyMap<Id, string>;
  /** 템플릿 조 id → 조 명 (템플릿 원본 접은 제목). */
  titles: ReadonlyMap<Id, string>;
  /** 템플릿 조 id → 준용하기 옵션 (템플릿 원본 — 사본이 아니다). */
  options: ReadonlyMap<Id, JoinOption>;
  /** 블록 담보약관의 대응 보통약관이 상품 템플릿과 다르면 true. */
  wrongGeneral: (c: AssemblyCoverage) => boolean;
  /** 제1절 좌표(문서 · 템플릿 id). */
  generalAt: Coordinate;
}

export interface SectionPlan {
  verdicts: Map<Id, FirstSectionVerdict>;
  /** 블록(상품담보 id) → 판정에 든 연결(블록 조 id → 템플릿 조 id). */
  links: Map<Id, Map<Id, Id>>;
  /** 블록 좌표의 오류 · 경고 (블록 번호 전 — 블록 조 id 좌표). */
  blockIssues: Map<Id, Issue[]>;
  /** 제1절 좌표의 경고 (번호 전 — 템플릿 조 id 좌표). */
  firstIssues: Issue[];
  /** 참조 대치 내역 — 템플릿 조 id → 내역. */
  substitutions: Map<Id, FirstSectionRecord["substitutions"]>;
  /** 블록 → (블록 조 항 열쇠 `블록조id#열쇠` → 제1절에 오른 항의 새 열쇠). */
  keyMaps: Map<Id, Map<string, string>>;
}

const OPTION_LABEL: Record<JoinOption, string> = { none: "없음", common: "공통항 모으기", all: "전체항 모으기" };

/** 제1절로 오른 블록 노드의 열쇠 — 템플릿 코드 · 다른 블록 열쇠와 겹치지 않게. */
export function raisedKey(productCoverageId: Id, blockArticleId: Id, key: string): string {
  return `${productCoverageId}~${blockArticleId}:${key}`;
}

/** 블록 담보약관 좌표 — 블록 조 자리. */
function blockAt(c: AssemblyCoverage, a?: RArticle<SInline>): Coordinate {
  return { document: "special", ownerId: c.snapshot.id, ownerName: c.snapshot.name, ...(a ? { articleId: a.id, articleTitle: a.title, nodePath: [a.id] } : {}) };
}
function blockSource(c: AssemblyCoverage, doc: SubstitutedDoc, a?: RArticle<SInline>): Coordinate {
  return { document: "coverageMaster", ownerId: c.snapshot.coverageId, documentId: doc.id, ownerName: c.snapshot.coverageName, ...(a ? { articleId: a.id, articleTitle: a.title, nodePath: [doc.id, a.id] } : {}) };
}

/** 이 조 안에서 템플릿 조 `target` 을 보통약관 참조로 가리키는가 (`linkedSpecialRule`). */
function refersGeneral(a: RArticle<SInline>, target: Id): boolean {
  let hit = false;
  const walk = (x: unknown): void => {
    if (hit || !x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const n = x as { kind?: string; scope?: string; targets?: { articleId: Id }[] };
    if (n.kind === "articleRef" && n.scope === "general" && n.targets?.some((t) => t.articleId === target)) hit = true;
    for (const [k, v] of Object.entries(x)) if (k !== "issue" && typeof v === "object") walk(v);
  };
  walk(a.children);
  return hit;
}

/** 판정 재료를 모으고 판정한다 — 연결 검사의 오류 · 경고와 함께. */
export function planFirstSection(blocks: readonly SectionBlock[], env: SectionEnv): SectionPlan {
  const links = new Map<Id, Map<Id, Id>>();
  const blockIssues = new Map<Id, Issue[]>();
  const judge: JudgeBlock[] = [];
  const unitsByBlock = new Map<Id, Map<Id, RArticle<SInline>>>();
  const substitutions = new Map<Id, FirstSectionRecord["substitutions"]>();
  for (const b of blocks) {
    const issues: Issue[] = [];
    const pc = b.c.snapshot.id;
    if (env.wrongGeneral(b.c)) {
      issues.push({ kind: "wrongGeneral", severity: "error", message: `담보 「${b.c.snapshot.coverageName}」 담보약관의 대응 보통약관이 이 상품의 보통약관 템플릿과 다릅니다 — 조연결이 다른 템플릿을 가리킵니다`, at: blockAt(b.c), source: blockSource(b.c, b.doc) });
    }
    if (b.composite) issues.push({ kind: "compositeBlock", severity: "warning", message: `복합 블록 「${b.c.snapshot.name}」 — 제1절 판정 분모에서 뺍니다(블록은 담보 문면 그대로)`, at: blockAt(b.c), source: blockSource(b.c, b.doc) });
    const linked = new Map<Id, Id>();
    const byTemplate = new Map<Id, RArticle<SInline>>();
    for (const a of articlesOf(b.doc)) {
      const t = a.linkedArticleId;
      if (t === undefined) continue;
      if (!env.present.has(t)) {
        const hidden = env.hidden?.get(t);
        const why = hidden !== undefined ? `상품에서 노출을 끈 조 「${hidden}」` : `이 상품의 보통약관에 없는 조(조건으로 빠짐) 「${env.titles.get(t) ?? t}」`;
        issues.push({ kind: "linkTargetGone", severity: "error", message: `블록 조 「${a.title}」 이(가) 조연결한 템플릿 조가 ${why}입니다`, at: blockAt(b.c, a), source: blockSource(b.c, b.doc, a) });
        continue;
      }
      if (byTemplate.has(t)) {
        issues.push({ kind: "duplicateLink", severity: "error", message: `블록 조 「${a.title}」 이(가) 앞 조 「${byTemplate.get(t)!.title}」 와 같은 템플릿 조 「${env.titles.get(t) ?? t}」 에 조연결했습니다 — 앞 조만 연결로 셉니다`, at: blockAt(b.c, a), source: blockSource(b.c, b.doc, a) });
        continue;
      }
      if (refersGeneral(a, t)) {
        issues.push({ kind: "linkedSpecialRule", severity: "warning", message: `블록 조 「${a.title}」 이(가) 조연결한 템플릿 조 「${env.titles.get(t) ?? t}」 을(를) 보통약관 참조로도 가리킵니다 — 특칙을 연결했습니다(전부 연결 · 블록 하나면 마스터가 사라질 수 있다)`, at: blockAt(b.c, a), source: blockSource(b.c, b.doc, a) });
      }
      byTemplate.set(t, a);
      linked.set(a.id, t);
    }
    links.set(pc, linked);
    unitsByBlock.set(pc, byTemplate);
    blockIssues.set(pc, issues);
  }
  // 판정 단위 — 자기 블록 조 참조는 조연결한 템플릿 조로 대치해 견준다(결정 9). 대치 내역은 기록에
  for (const b of blocks) {
    const pc = b.c.snapshot.id;
    const positions = blockPositions(b.doc);
    const articles = new Map<Id, { articleId: Id; units: ReturnType<typeof judgeUnits> }>();
    for (const [t, a] of unitsByBlock.get(pc)!) {
      const subs: FirstSectionRecord["substitutions"] = [];
      articles.set(t, { articleId: a.id, units: judgeUnits(a, { owner: pc, linkOf: links.get(pc)!, positions, onSubstitute: (refId, from, to) => subs.push({ productCoverageId: pc, refId, from, to }) }) });
      if (subs.length > 0) substitutions.set(t, [...(substitutions.get(t) ?? []), ...subs]);
    }
    judge.push({ productCoverageId: pc, ...(b.composite ? { composite: true } : {}), articles });
  }
  const verdicts = judgeFirstSection(judge, env.options);
  // 비교하지 않은 조(위임 1/1 · 특칙 · 마스터)에는 대치가 없다
  for (const [t, v] of verdicts) if (v.n < 2 || v.k < v.n) substitutions.delete(t);

  const names = new Map(blocks.map((b) => [b.c.snapshot.id, b.c.snapshot.name]));
  const firstIssues: Issue[] = [];
  for (const [t, v] of verdicts) {
    const title = env.titles.get(t) ?? t;
    if (v.reason === "partialOption") {
      const at = { ...env.generalAt, articleId: t, articleTitle: title, nodePath: [t] };
      firstIssues.push({
        kind: "partialLinkOption",
        severity: "warning",
        message: `「${title}」의 준용하기 옵션 「${OPTION_LABEL[v.option]}」이(가) 적용되지 않습니다 — 블록 ${v.n}개 중 ${v.k}개만 연결해 특칙으로 나갑니다 · 연결하지 않은 담보: ${v.unlinkedBlocks.map((id) => names.get(id) ?? id).join(", ")}`,
        at,
        source: at,
      });
    }
    if (v.kind === "joinAll") {
      for (const b of blocks) {
        const a = unitsByBlock.get(b.c.snapshot.id)?.get(t);
        const units = judge.find((j) => j.productCoverageId === b.c.snapshot.id)?.articles.get(t)?.units;
        if (!a || !units || !units.some((u) => u.sig === undefined)) continue;
        blockIssues.get(b.c.snapshot.id)!.push({ kind: "joinPlainText", severity: "warning", message: `전체항 모으기 조 「${title}」에 연결한 블록 조 「${a.title}」에 일반 글 항이 있습니다 — 합쳐지지 않고 블록마다 따로 실립니다(함수조항으로 쓴다)`, at: blockAt(b.c, a), source: blockSource(b.c, b.doc, a) });
      }
    }
  }
  return { verdicts, links, blockIssues, firstIssues, substitutions, keyMaps: keyMapsOf(blocks, verdicts, unitsByBlock) };
}

/** 항 · 그 안 호 · 목의 열쇠 — 문서 순(깊이 우선). */
function keysInOrder(p: RArticle<SInline>["children"][number]): string[] {
  if (p.kind !== "paragraph") return [];
  const out: string[] = [];
  if (p.key !== undefined) out.push(p.key);
  for (const it of p.items ?? []) {
    if (it.kind !== "item") continue;
    if (it.key !== undefined) out.push(it.key);
    for (const s of it.subitems ?? []) if (s.kind === "subitem" && s.key !== undefined) out.push(s.key);
  }
  return out;
}

/** 블록 항 열쇠 → 제1절에 오른 그 항(같은 서명이면 대표 항)의 새 열쇠 — 같은 자리(문서 순)끼리 잇는다. */
function keyMapsOf(blocks: readonly SectionBlock[], verdicts: ReadonlyMap<Id, FirstSectionVerdict>, articles: ReadonlyMap<Id, ReadonlyMap<Id, RArticle<SInline>>>): Map<Id, Map<string, string>> {
  const out = new Map<Id, Map<string, string>>(blocks.map((b) => [b.c.snapshot.id, new Map()]));
  for (const [t, v] of verdicts) {
    for (const b of blocks) {
      const pc = b.c.snapshot.id;
      const a = articles.get(pc)?.get(t);
      if (!a || !v.blocks.has(pc)) continue;
      a.children.forEach((p, unit) => {
        const r = v.raisedOf.get(`${pc}#${unit}`);
        if (r === undefined) return;
        const rep = v.raised[r];
        const repArticle = articles.get(rep.productCoverageId)!.get(t)!;
        const theirs = keysInOrder(repArticle.children[rep.unit]);
        keysInOrder(p).forEach((key, i) => {
          if (theirs[i] !== undefined) out.get(pc)!.set(`${a.id}#${key}`, raisedKey(rep.productCoverageId, repArticle.id, theirs[i]));
        });
      });
    }
  }
  return out;
}

/** 블록 노드를 제1절로 옮긴다 — id · 열쇠 앞마디, 보통약관 참조 → 제1절 안, 자기 블록 조 참조 → 템플릿 조 (결정 9 · C2 · C3). */
function lift<T>(x: T, pc: Id, blockArticleId: Id, links: ReadonlyMap<Id, Id>, keyMap: ReadonlyMap<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const n = v as Record<string, unknown> & { kind?: string };
    if (n.kind === "error") return { ...n, id: `${pc}~${String(n.id)}` };
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(n)) out[k] = k === "issue" || k === "at" ? val : walk(val);
    if (typeof n.id === "string" && n.kind !== undefined) out.id = `${pc}~${n.id}`;
    if (typeof n.key === "string") out.key = raisedKey(pc, blockArticleId, n.key);
    if (Array.isArray(n.groups)) out.groups = (n.groups as string[]).map((g) => raisedKey(pc, blockArticleId, g));
    if (n.kind === "articleRef") {
      const ref = n as unknown as { scope: string; targets: { articleId: Id; code?: string }[] };
      out.scope = "self";
      if (ref.scope === "self") {
        out.targets = ref.targets.map((t) => {
          const linked = links.get(t.articleId);
          if (linked === undefined) return t; // C5 — 블록 고유 조는 제1절에 없다 → articleGone
          if (t.code === undefined) return { ...t, articleId: linked };
          return { ...t, articleId: linked, code: keyMap.get(`${t.articleId}#${t.code}`) ?? raisedKey(pc, t.articleId, t.code) };
        });
      }
    }
    return out;
  };
  return walk(x) as T;
}

/** 제1절로 오르는 조의 본문 — 템플릿 조 id → 오른 항들(제1절 항 순서). 공통 · 공통항 분리 · 전체항 합침. */
export function raisedArticles(plan: SectionPlan, blocks: readonly SectionBlock[]): Map<Id, RArticle<SInline>["children"]> {
  const out = new Map<Id, RArticle<SInline>["children"]>();
  const docs = new Map(blocks.map((b) => [b.c.snapshot.id, b.doc]));
  for (const [t, v] of plan.verdicts) {
    if (v.kind !== "common" && v.kind !== "commonSplit" && v.kind !== "joinAll") continue;
    out.set(
      t,
      v.raised.map(({ productCoverageId: pc, unit }) => {
        const links = plan.links.get(pc)!;
        const a = articlesOf(docs.get(pc)!).find((x) => links.get(x.id) === t)!;
        return lift(a.children[unit], pc, a.id, links, plan.keyMaps.get(pc)!);
      }),
    );
  }
  return out;
}

/** 공통항 분리 블록 조의 ① — 준용 문구 항 열쇠 (P · PZ 밖 예약 열쇠, ADR-0082 결정 8). */
export const JOIN_KEY = "SJ0100";

/** 준용 문구 「제1절 일반조항 제N조(조 제목) 및 아래의 각 항을 따릅니다.」 — N 은 그 템플릿 조의 제1절 번호. */
export function joinText(articleNumber: number, articleTitle: string): string {
  return `${FIRST_SECTION_NAME} ${articleRefLabel(articleNumber, articleTitle)} 및 아래의 각 항을 따릅니다.`;
}

/**
 * 블록 조 처리 (결정 6) — 공통 · 전체항 합침 → 생략, 공통항 분리 → ① 준용 문구 + 전용 항(②부터 다시 매김) · 전용 항 없으면 생략 · C1 통째,
 * 특칙 · 위임 → 그대로. 돌려주는 별칭은 블록에 남은 조가 제1절로 오른 조 · 항을 가리킬 때(C4) 쓴다.
 */
export function treatBlock(block: SectionBlock, plan: SectionPlan, first: NumberedDoc | undefined): { doc: SubstitutedDoc; aliases: Map<string, string> } {
  const pc = block.c.snapshot.id;
  const links = plan.links.get(pc) ?? new Map<Id, Id>();
  const keyMap = plan.keyMaps.get(pc) ?? new Map<string, string>();
  const aliases = new Map<string, string>();
  const firstArticles = new Map((first ? articlesOf(first.doc) : []).map((a) => [a.id, a]));
  const doc = mapArticles(block.doc, (a): RArticle<SInline> | null => {
    const t = links.get(a.id);
    const v = t === undefined ? undefined : plan.verdicts.get(t);
    const treatment = v?.blocks.get(pc);
    if (!t || !treatment || treatment.kind === "listed" || treatment.kind === "whole") return a;
    for (const key of a.children.flatMap(keysInOrder)) {
      const to = keyMap.get(`${a.id}#${key}`);
      if (to) aliases.set(`${a.id}#${key}`, `${t}#${to}`);
    }
    if (treatment.kind === "omitted") {
      aliases.set(a.id, t);
      return null;
    }
    const n = first?.numbers.get(t)?.n;
    const title = firstArticles.get(t)?.title ?? a.title;
    const join: RParagraph<SInline> = { kind: "paragraph", id: `${a.id}::join`, key: JOIN_KEY, children: [{ kind: "text", id: `${a.id}::join-text`, text: n === undefined ? "" : joinText(n, title) }] };
    return { ...a, children: [join, ...treatment.exclusive.map((i) => a.children[i])] };
  });
  return { doc, aliases };
}

/** 판정 기록 (결정 11) — 템플릿 조 순(제1절 번호 순, 최종 트리에 없는 조는 뒤). */
export function firstSectionRecords(plan: SectionPlan, blocks: readonly SectionBlock[], first: NumberedDoc | undefined, titles: ReadonlyMap<Id, string>, order: readonly Id[]): FirstSectionRecord[] {
  const names = new Map(blocks.map((b) => [b.c.snapshot.id, b.c.snapshot.name]));
  const named = (id: Id) => ({ productCoverageId: id, name: names.get(id) ?? id });
  const firstArticles = new Map((first ? articlesOf(first.doc) : []).map((a) => [a.id, a]));
  const rank = (id: Id) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...plan.verdicts]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([t, v]): FirstSectionRecord => {
      const number = first?.numbers.get(t)?.n;
      return {
        articleId: t,
        title: firstArticles.get(t)?.title ?? titles.get(t) ?? t,
        ...(number !== undefined ? { number } : {}),
        k: v.k,
        n: v.n,
        option: v.option,
        result: v.kind,
        reason: v.reason,
        linked: v.linkedBlocks.map(named),
        unlinked: v.unlinkedBlocks.map(named),
        blocks: [...v.blocks].map(([id, treatment]) => ({ ...named(id), treatment: treatment.kind })),
        substitutions: plan.substitutions.get(t) ?? [],
      };
    });
}
