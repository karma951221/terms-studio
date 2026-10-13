/**
 * 자동 탑재 특약 — 원문 fixture 한 줄 설정(`config.ts` `ALPHA2607_AUTO`)만으로 담보 · 템플릿을 만드는 변환 단계 (개발 도구 — 제품 기능 아님).
 * 근거: QA/실물재현/알파플러스2607_모델명세 §7 「주계약 특약 전체」 — 완벽 재현보다 **공통화**가 먼저다.
 *
 * - 이름 · 갱신형: 특약 제목에서 담보명(「갱신형 」 · 「특별약관」을 뗀다)과 갱신유형을 읽는다(`coverageNameOf`).
 * - 갱신형 짝: 같은 담보의 비갱신 · 갱신형 원문 두 벌을 **템플릿 하나**로 합친다(`mergeRenewal`) — 글이 같은 조는 하나,
 *   다른 조 · 한쪽에만 있는 조는 담보속성 갱신유형 조건 블록의 두 가지로(ADR-0003 「조 단위 on/off」). 조립하면 각 탑재분이 제 원문과 같다.
 * - 함수조항: 조째 글이 같은 조끼리 묶는 열쇠(`canonicalArticle`) — 자기 조 밖을 가리키는 참조는 대상과 무관하게 같다(조 참조 인자 — ADR-0083).
 *
 * 노드 id 는 결정적이다: 짝 조건 블록 `<접두>-m<순번>` · 가지 `-t` / `-e`.
 */
import type { ArticleNode, BlockNode, DocumentNode } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";

// ───────────────────────────── 이름 ─────────────────────────────

/** 특약 제목 → 담보명 · 갱신형 여부. 「일반상해사망보장 추가특별약관」처럼 붙어 있어도, 「…특별약관(…)」처럼 뒤에 괄호가 와도 「특별약관」만 뗀다. */
export function coverageNameOf(title: string): { name: string; renewal: boolean } {
  const t = title.trim();
  const renewal = t.startsWith("갱신형 ");
  const rest = renewal ? t.slice("갱신형 ".length) : t;
  const name = rest.replace(/\s*특별약관\s*/, "").trim();
  return { name, renewal };
}

/**
 * 자동 탑재 특약의 책자 제목 · fixture 짝 — 상품담보명 작명(`[A0001] [담보명] [A0002]`)대로 갱신형 탑재분은 「갱신형 」을 붙인다.
 * 갱신형 짝은 두 줄(비갱신 · 갱신형). `firstLine` 은 fixture 의 첫 줄(`# 제목`)을 읽는다 — 원문 대조(real.test)가 쓴다.
 */
export function autoFixtures(specs: readonly { file?: string; auto?: { renewal?: string } }[], firstLine: (file: string) => string): [string, string][] {
  const titleOf = (file: string) => coverageNameOf(firstLine(file).replace(/^#\s*/, ""));
  return specs.flatMap((s): [string, string][] => {
    if (!s.auto || !s.file) return [];
    const { name, renewal } = titleOf(s.file);
    const base: [string, string] = [`${renewal ? "갱신형 " : ""}${name} 특별약관`, s.file];
    return s.auto.renewal ? [base, [`갱신형 ${name} 특별약관`, s.auto.renewal]] : [base];
  });
}

/**
 * 「특별약관의 소멸」 첫 항에서 보험금명 — 「제1조(보험금의 지급사유)에서 정한 ○○ 지급사유가 발생한 경우」의 ○○.
 * 참조 변환 뒤 조 참조 다음 글(「에서 정한 ○○ 지급사유가 …」)에서도 읽는다.
 */
export function claimOf(text: string): string | undefined {
  const m = /^(?:.*\(보험금의 지급사유\))?에서 정한 (.+?) 지급사유가 발생한 경우/.exec(text);
  return m?.[1];
}

// ───────────────────────────── 열쇠 ─────────────────────────────

type AnyNode = { id?: Id; kind?: string; [k: string]: unknown };

/** 조의 구조 노드(항 · 호 · 목 · 표 · 박스 · 박스 참조 · 함수조항 블록) id → 조 안 경로(`p2.i1`) — 문서 순. */
export function localPaths(a: ArticleNode): Map<Id, string> {
  const out = new Map<Id, string>();
  out.set(a.id, "");
  const walk = (list: readonly unknown[], prefix: string) => {
    let k = 0;
    for (const n of list as AnyNode[]) {
      k++;
      const here = `${prefix}${prefix ? "." : ""}${String(n.kind ?? "?").slice(0, 1)}${k}`;
      if (n.id) out.set(n.id, here);
      for (const key of ["items", "subitems"] as const) if (Array.isArray(n[key])) walk(n[key] as unknown[], here);
      if (n.kind === "condBlock") (n.branches as { id: Id; children: unknown[] }[]).forEach((b, bi) => walk(b.children, `${here}b${bi}`));
    }
  };
  walk(a.children, "");
  return out;
}

/** 문서 안 모든 구조 노드 id → (조, 조 안 경로). */
export function documentPaths(tree: DocumentNode): Map<Id, { article: ArticleNode; path: string }> {
  const out = new Map<Id, { article: ArticleNode; path: string }>();
  for (const a of articlesDeep(tree)) for (const [id, path] of localPaths(a)) out.set(id, { article: a, path });
  return out;
}

/** 문서의 조 — 관 · 조건 블록 가지 안까지, 문서 순. */
export function articlesDeep(tree: DocumentNode | { children: unknown[] }): ArticleNode[] {
  const out: ArticleNode[] = [];
  const walk = (list: readonly unknown[]) => {
    for (const n of list as AnyNode[]) {
      if (n.kind === "article") out.push(n as unknown as ArticleNode);
      else if (n.kind === "section") walk(n.children as unknown[]);
      else if (n.kind === "condBlock") for (const b of n.branches as { children: unknown[] }[]) walk(b.children);
    }
  };
  walk(tree.children);
  return out;
}

export interface CanonicalOptions {
  /** 조 제목도 열쇠에 넣는가 (짝 맞추기는 넣고, 함수조항 묶기는 뺀다 — 조 제목은 사용처 소유). */
  withTitle: boolean;
  /** 자기 조 **밖**을 가리키는 참조 대상 하나의 표기. */
  outside: (id: Id) => string;
  /** 글을 지운 모양만 — 낱말만 다른 조를 한 무리로 볼 때(옵션 함수조항 후보). */
  maskText?: boolean;
}

/** 조 하나의 열쇠 — 글 · 참조 · 슬롯 · 박스 · 표 · 함수조항 블록. 노드 id 는 보지 않는다(조 안 참조는 조 안 경로로). */
export function canonicalArticle(a: ArticleNode, opts: CanonicalOptions, children: readonly unknown[] = a.children): string {
  const paths = localPaths(a);
  const target = (id: Id) => (paths.has(id) ? `in:${paths.get(id)}` : opts.outside(id));
  const inl = (list: readonly unknown[]): string =>
    (list as AnyNode[])
      .map((n) => {
        switch (n.kind) {
          case "text":
            return opts.maskText ? "T" : (n.text as string);
          case "slot":
            return `{${n.ref}}`;
          case "appendixRef":
            return `【${n.appendixCode}】`;
          case "articleRef": {
            const ts = (n.targets as { articleId: Id; innerCode?: string }[]).map((t) => (n.scope === "general" ? `g:${t.articleId}` : target(t.articleId)));
            return `⟨${ts.join(",")}|${n.connector ?? ""}⟩`;
          }
          case "inlineCond":
            return `⟦${(n.branches as { when?: string; children: unknown[] }[]).map((b) => `${b.when ?? "else"}→${inl(b.children)}`).join("¦")}⟧`;
          case "clauseInlineRef":
            return `⟦ci:${n.clauseCode}:${JSON.stringify(n.options ?? {})}:${n.preset ?? ""}⟧`;
          default:
            return `⟦${n.kind}⟧`;
        }
      })
      .join("");
  const binding = (b: unknown): string => {
    const o = b as { kind?: string; targets?: { articleId: Id }[]; connector?: string; scope?: string };
    if (o?.kind === "articleRef") return `⟨${(o.targets ?? []).map((t) => (o.scope === "general" ? `g:${t.articleId}` : target(t.articleId))).join(",")}|${o.connector ?? ""}⟩`;
    return JSON.stringify(b);
  };
  const block = (n: AnyNode): string => {
    switch (n.kind) {
      case "paragraph":
        return `¶${inl(n.children as unknown[])}${((n.items as AnyNode[] | undefined) ?? []).map(block).join("")}`;
      case "item":
        return `•${inl(n.children as unknown[])}${((n.subitems as AnyNode[] | undefined) ?? []).map(block).join("")}`;
      case "subitem":
        return `◦${inl(n.children as unknown[])}`;
      case "boxRef":
        return `[B:${n.boxCode}]`;
      case "box":
        return `[b:${n.title}|${(n.lines as string[]).join("\n")}]`;
      case "table":
        return `[T:${n.title ?? ""}:${(n.rows as { header?: boolean; cells: unknown[][] }[]).map((r) => `${r.header ? "h" : ""}${r.cells.map((c) => inl(c)).join("|")}`).join("/")}]`;
      case "clauseBlockRef":
        return `[C:${n.clauseCode}:${JSON.stringify(n.options ?? {})}:${Object.entries((n.bindings as Record<string, unknown>) ?? {})
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => `${k}=${binding(v)}`)
          .join(";")}]`;
      case "condBlock":
        return `[if:${(n.branches as { when?: string; children: AnyNode[] }[]).map((b) => `${b.when ?? "else"}→${b.children.map(block).join("")}`).join("¦")}]`;
      default:
        return `[${n.kind}]`;
    }
  };
  return `${opts.withTitle ? `§${a.title}` : ""}${(children as AnyNode[]).map(block).join("")}`;
}

// ───────────────────────────── 갱신형 짝 ─────────────────────────────

/** 같은 열쇠의 두 조 — 구조 노드를 문서 순으로 짝짓는다(열쇠가 같으면 구조가 같다). */
function pairIds(from: ArticleNode, to: ArticleNode): Map<Id, Id> {
  const a = [...localPaths(from)];
  const b = new Map([...localPaths(to)].map(([id, p]) => [p, id]));
  const out = new Map<Id, Id>();
  for (const [id, p] of a) {
    const other = b.get(p);
    if (other) out.set(id, other);
  }
  return out;
}

/** 두 열(조 열쇠)의 최장 공통 부분열 — 짝지은 (i, j) 목록. */
function lcs(a: readonly string[], b: readonly string[]): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** 노드 아래 모든 조 참조(문면 · 함수조항 블록 연결)의 자기 문서 대상을 옮긴다. */
function remapRefs(node: unknown, move: ReadonlyMap<Id, Id>): void {
  const visit = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as AnyNode;
    if (o.kind === "articleRef" && o.scope !== "general") {
      o.targets = (o.targets as { articleId: Id }[]).map((t) => (move.has(t.articleId) ? { ...t, articleId: move.get(t.articleId)! } : t));
    }
    Object.values(o).forEach(visit);
  };
  visit(node);
}

/** 조 자리 조건 블록 하나(IF 하나 — 조 자리는 켜고 끄기만, 기능/문면 §3.3). */
function articleIf(id: Id, when: string, articles: ArticleNode[]): DocumentNode["children"][number] {
  return { id, kind: "condBlock", branches: [{ id: `${id}-t`, when, children: articles as BlockNode[] }] } as unknown as DocumentNode["children"][number];
}

/**
 * 비갱신 · 갱신형 원문 두 벌 → 템플릿 한 벌. 조 열(제목 + 글)의 최장 공통 부분열은 비갱신 쪽 조 하나로 두고,
 * 그 사이의 다른 조 무리는 조 자리 조건 블록 둘 — 갱신형 무리 `<접두>-m<k>`(when) · 비갱신 무리 `<접두>-m<k>n`(`not (when)`).
 * 조 자리 조건은 IF 하나만 둘 수 있어(ELSE 없음) 두 블록으로 나눈다. 갱신형 쪽 조의 참조가 하나로 합친 조를 가리키면 비갱신 쪽 같은 자리로 옮긴다.
 * 두 문서 모두 관 없이 조만 있어야 한다.
 */
export function mergeRenewal(base: DocumentNode, renewal: DocumentNode, when: string, idPrefix: string): DocumentNode {
  const flat = (t: DocumentNode) => {
    if (t.children.some((c) => c.kind !== "article")) throw new Error(`${t.title}: 관 · 조건 블록이 있는 문서는 갱신형 짝으로 합치지 않는다`);
    return t.children as ArticleNode[];
  };
  const bs = flat(base);
  const rs = flat(renewal);
  const keysOf = (tree: DocumentNode, list: ArticleNode[]) => {
    const pos = documentPaths(tree);
    return list.map((a) => canonicalArticle(a, { withTitle: true, outside: (id) => (pos.has(id) ? `${pos.get(id)!.article.title}#${pos.get(id)!.path}` : `?${id}`) }));
  };
  const matched = lcs(keysOf(base, bs), keysOf(renewal, rs));
  const move = new Map<Id, Id>();
  for (const [i, j] of matched) for (const [r, b] of pairIds(rs[j], bs[i])) move.set(r, b);
  // 합친 조의 참조가 갈리는 조(비갱신 쪽에만 남는 조)를 가리키면 갱신형 쪽 같은 제목 · 같은 자리도 대상에 더한다 —
  // 두 대상은 서로 다른 가지라 늘 하나만 남고, 일부 대상이 사라진 참조는 남은 대상으로 찍힌다(기능/문면 §3.5)
  const kept = new Set(matched.map(([i]) => bs[i]));
  const bPos = documentPaths(base);
  const rByTitlePath = new Map<string, Id>();
  for (const [id, { article, path }] of documentPaths(renewal)) if (!matched.some(([, j]) => rs[j] === article)) rByTitlePath.set(`${article.title}#${path}`, id);
  for (const a of kept) {
    const visit = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(visit);
      if (!n || typeof n !== "object") return;
      const o = n as AnyNode;
      if (o.kind === "articleRef" && o.scope !== "general") {
        o.targets = (o.targets as { articleId: Id }[]).flatMap((t) => {
          const at = bPos.get(t.articleId);
          if (!at || kept.has(at.article)) return [t];
          const twin = rByTitlePath.get(`${at.article.title}#${at.path}`);
          return twin ? [t, { ...t, articleId: twin }] : [t];
        });
      }
      Object.values(o).forEach(visit);
    };
    visit(a.children);
  }
  const children: DocumentNode["children"] = [];
  let seq = 0;
  const gap = (bRun: ArticleNode[], rRun: ArticleNode[]) => {
    if (bRun.length === 0 && rRun.length === 0) return;
    const id = `${idPrefix}-m${++seq}`;
    rRun.forEach((a) => remapRefs(a, move));
    if (rRun.length > 0) children.push(articleIf(id, when, rRun));
    if (bRun.length > 0) children.push(articleIf(`${id}n`, `not (${when})`, bRun));
  };
  let bi = 0;
  let ri = 0;
  for (const [i, j] of [...matched, [bs.length, rs.length] as [number, number]]) {
    gap(bs.slice(bi, i), rs.slice(ri, j));
    if (i < bs.length) children.push(bs[i]);
    bi = i + 1;
    ri = j + 1;
  }
  return { ...base, children };
}

type ArticleIfNode = { id: Id; kind: string; branches: { id: Id; when?: string; children: ArticleNode[] }[] };

/**
 * 짝 조건 블록 둘(갱신형 `-m<k>` · 비갱신 `-m<k>n`)에서 앞 · 뒤 조가 (함수조항을 얹은 뒤) 같은 글이 되면 비갱신 쪽 하나로 꺼낸다 — 준용규정(갱신형 가지를 품은 함수조항) 등.
 * 꺼낼 갱신형 조를 어느 참조도 가리키지 않을 때만(`referenced`) 꺼낸다. 빈 조건 블록은 지운다. 꺼낸 조 수를 돌려준다.
 */
export function collapseRenewal(tree: DocumentNode, idPrefix: string, referenced: (article: ArticleNode) => boolean): number {
  const pos = documentPaths(tree);
  const key = (a: ArticleNode) => canonicalArticle(a, { withTitle: true, outside: (id) => (pos.has(id) ? `${pos.get(id)!.article.title}#${pos.get(id)!.path}` : `?${id}`) });
  const isPair = (c: unknown, suffix: "" | "n") => {
    const o = c as ArticleIfNode | undefined;
    return o?.kind === "condBlock" && new RegExp(`^${idPrefix}-m\\d+${suffix}$`).test(o.id);
  };
  let hoisted = 0;
  const out: DocumentNode["children"] = [];
  const list = tree.children;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!isPair(c, "") || !isPair(list[i + 1], "n") || (list[i + 1] as unknown as ArticleIfNode).id !== `${(c as unknown as ArticleIfNode).id}n`) {
      out.push(c);
      continue;
    }
    const r = (c as unknown as ArticleIfNode).branches[0];
    const b = (list[i + 1] as unknown as ArticleIfNode).branches[0];
    i++;
    const head: ArticleNode[] = [];
    while (r.children.length > 0 && b.children.length > 0 && key(r.children[0]) === key(b.children[0]) && !referenced(r.children[0])) {
      r.children.shift();
      head.push(b.children.shift()!);
    }
    const tail: ArticleNode[] = [];
    while (r.children.length > 0 && b.children.length > 0 && key(r.children.at(-1)!) === key(b.children.at(-1)!) && !referenced(r.children.at(-1)!)) {
      r.children.pop();
      tail.unshift(b.children.pop()!);
    }
    hoisted += head.length + tail.length;
    out.push(...(head as DocumentNode["children"]));
    if (r.children.length > 0) out.push(c);
    if (b.children.length > 0) out.push(list[i]);
    out.push(...(tail as DocumentNode["children"]));
  }
  tree.children = out;
  return hoisted;
}

// ───────────────────────────── 낱말만 다른 조 ─────────────────────────────

type InlineOwner = { kind?: string; children?: unknown[]; items?: unknown[]; subitems?: unknown[] };

/** 항 · 호 · 목 글 노드를 문서 순으로 — 문면 블록 · 함수조항 본문 블록이 같은 순서로 걷는다(옵션 자리를 순번으로 맞춘다). */
export function textNodesOf(blocks: readonly unknown[]): { text: string }[] {
  const out: { text: string }[] = [];
  const owner = (n: InlineOwner) => {
    for (const c of (n.children ?? []) as { kind: string; text?: string }[]) if (c.kind === "text") out.push(c as { text: string });
    for (const it of (n.items ?? []) as InlineOwner[]) if (it.kind === "item") owner(it);
    for (const u of (n.subitems ?? []) as InlineOwner[]) if (u.kind === "subitem") owner(u);
  };
  for (const b of blocks as InlineOwner[]) if (b.kind === "paragraph") owner(b);
  return out;
}

/** 공통 앞 · 뒤를 뗀 구간(낱말 경계로 넓힌다) — 앞 길이와 글마다의 구간. 모두 같으면 undefined. */
export function wordRegions(texts: readonly string[]): { prefix: number; regions: string[] } | undefined {
  if (texts.every((t) => t === texts[0])) return undefined;
  const chars = texts.map((t) => [...t]);
  const min = Math.min(...chars.map((c) => c.length));
  let prefix = 0;
  while (prefix < min && chars.every((c) => c[prefix] === chars[0][prefix])) prefix++;
  let suffix = 0;
  while (suffix < min - prefix && chars.every((c) => c[c.length - 1 - suffix] === chars[0][chars[0].length - 1 - suffix])) suffix++;
  const space = (c: string | undefined) => c === undefined || /\s/.test(c);
  while (prefix > 0 && !space(chars[0][prefix - 1])) prefix--;
  while (suffix > 0 && !chars.every((c) => space(c[c.length - suffix]))) suffix--;
  return { prefix, regions: chars.map((c) => c.slice(prefix, c.length - suffix).join("")) };
}

/** 낱말 옵션 무리 — 입력 순번 · 옵션 자리(글 노드 순번 · 앞 길이 · 순번마다의 구간). */
export interface WordCluster {
  members: number[];
  places: { at: number; prefix: number; regions: string[] }[];
}

/**
 * 같은 모양 조들(글 노드 수가 같다)을 낱말만 다른 무리로 — 다른 글 자리가 `maxPlaces` 이하, 자리마다 구간이 `maxRegion` 자 이하이고 비지 않으며,
 * 띄어쓰기만 다르지 않을 때(함수조항 규칙 — 띄어쓰기만 다른 곳은 옵션으로 두지 않는다). 먼저 나온 조가 무리의 씨앗이다. 두 조 이상인 무리만 돌려준다 —
 * 다른 자리가 없는 무리는 조째 같은 글이다(옵션 없는 함수조항).
 */
export function wordClusters(texts: readonly string[][], maxRegion = 30, maxPlaces = 3): WordCluster[] {
  const plan = (members: number[]): WordCluster | undefined => {
    const places: WordCluster["places"] = [];
    for (let at = 0; at < texts[members[0]].length; at++) {
      const column = members.map((m) => texts[m][at]);
      const r = wordRegions(column);
      if (!r) continue;
      if (r.regions.some((x) => [...x].length > maxRegion || x.trim() === "")) return undefined;
      const distinct = [...new Set(column)];
      if (new Set(distinct.map((t) => r.regions[column.indexOf(t)].replace(/\s/g, ""))).size !== distinct.length) return undefined;
      places.push({ at, prefix: r.prefix, regions: r.regions });
      if (places.length > maxPlaces) return undefined;
    }
    return { members, places };
  };
  const clusters: number[][] = [];
  texts.forEach((t, i) => {
    const home = clusters.find((c) => texts[c[0]].length === t.length && plan([...c, i]) !== undefined);
    if (home) home.push(i);
    else clusters.push([i]);
  });
  return clusters.filter((c) => c.length > 1).map((c) => plan(c)!);
}
