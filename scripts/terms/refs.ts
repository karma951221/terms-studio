/**
 * 본문 평문의 조·항·호·별표 참조를 참조 슬롯 노드로 바꾼다 (개발 도구 — 제품 기능 아님).
 *
 * 규칙 (2026-09-07 실물 재현 설계 · 기능/문면 §3.5 · 2026-09-08 리뷰 반영):
 * - 참조는 **토큰 체인**으로 읽는다. 조 토큰이 문맥(조·항)을 세우고, 뒤따르는 항·호 토큰이 그 문맥을 물려받는다 —
 *   「제16조(…) 제4항 또는 제5항」의 제5항은 제16조의 것이지 현재 조의 것이 아니다.
 * - `제N조(제목)` · `제N조의M(제목)` → articleRef. 제목이 색인과 다르면 텍스트로 두고 보고한다.
 *   조 뒤의 `제K항`·`제L호`는 공백이 없어도 같은 토큰으로 삼킨다 (실물 「제27조의1(…)제1항」).
 * - 「보통약관 」 접두가 붙으면 scope general. 접두는 덩어리당 한 번 — 뒤 멤버가 접두를 새로 달면 새 덩어리다.
 * - `, ` · ` 및 ` · ` 또는 ` 로 이어진 참조는 한 슬롯(다중 대상 덩어리). 마지막 연결어가 슬롯의 connector 이고,
 *   쉼표로만 이어졌으면 「및」이다 — 연결어는 「및」·「또는」 둘뿐 (기능/문면 §3.5). 실물 「제10호, 제11호」는 「제10호 및 제11호」로 렌더된다.
 * - 「제3조부터 제5조까지」 같은 범위 표기는 읽지 않는다 (개별 나열만) — 렌더는 연속 3개 이상을 범위로 다시 묶는다.
 * - 조 없는 `제K항 [제L호]` 는 문맥이 없으면 **현재 조**의 것이다. 조·항 문맥이 없는 단독 `제L호` 는 해소하지 않는다.
 * - 법령 인용(「의료법 제3조(의료기관)」 「민법 제27조(실종의 선고)」)은 건드리지 않는다 — 직전 낱말이 「…법/법률/령」.
 *   이때 뒤따르는 항·호까지 토큰 통째로 건너뛴다.
 * - `【별표N(이름)】` → appendixRef (번호 → 코드 표). 이름은 마스터가 찍는다.
 */

import type { InlineNode, RefTarget } from "../../src/domain/document/nodes";
import type { Id, ReferenceConnector } from "../../src/domain/types";

export interface ArticleEntry {
  id: Id;
  title: string;
  /** 항 id (순서대로). */
  paragraphIds: Id[];
  /** 항 id → 호 id (순서대로). */
  itemIds: Map<Id, Id[]>;
}

export interface ArticleIndex {
  /** 원문 번호(`"27"` · `"27의1"`) → 조. */
  byNumber: Map<string, ArticleEntry>;
}

export interface RefEnv {
  self: ArticleIndex;
  /** 담보약관이면 대응 보통약관 색인. 보통약관 자신이면 undefined. */
  general?: ArticleIndex;
  appendixByNumber: Map<number, string>;
  currentArticleId: Id;
  /** 지금 변환 중인 항 id — 조 없는 단독 「제N호」는 이 항의 호를 가리킨다 (실물 「제3호 및 제4호의 내용」). */
  currentParagraphId?: Id;
  /** 변환하지 못한 참조 — 사람이 본다. */
  report: string[];
}

interface Piece {
  start: number;
  end: number;
  node: InlineNode;
}

/** 참조 토큰 — 조(문맥을 세운다) · 항 · 호. */
type Token =
  | { kind: "article"; general: boolean; number: string; title: string; paragraph?: string; item?: string; end: number; skipTo?: number }
  | { kind: "paragraph"; paragraph: string; item?: string; end: number }
  | { kind: "item"; item: string; end: number };

/** 참조가 이어지는 문맥 — 조 색인 항목과 (있으면) 항 id. */
interface RefContext {
  scope: "self" | "general";
  entry?: ArticleEntry;
  paragraphId?: Id;
}

const ARTICLE = /(보통약관 )?제(\d+)조(?:의(\d+))?\(((?:[^()]|\([^()]*\))*)\)(?:\s*제(\d+)항)?(?:\s*제(\d+)호)?/y;
const PARAGRAPH = /제(\d+)항(?:\s*제(\d+)호)?/y;
const ITEM = /제(\d+)호/y;
/** 참조가 시작될 수 있는 자리. */
const PROBE = /제\d+(?:조|항|호)/g;
const APPENDIX = /【별표(\d+)\(([^】]*)\)】/g;
/** 직전 텍스트가 「…법 」 「…법률 」 「…령 」 으로 끝나면 법령 인용이다. */
const LAW = /(법|법률|령)\s?$/;
/**
 * 제목 없는 조(`제2조`)를 앞에 둔 항·호 — 「전자서명법 제2조 제2호」 같은 법령 인용이다.
 * 이 시스템의 조는 언제나 제목을 갖는다(파싱양식) — 제목 없는 조 뒤의 항·호는 우리 문서를 가리키지 않는다.
 */
const CITED_ARTICLE = /제\d+조(?:의\d+)?\s*(?:제\d+항\s*)?$/;
const JOIN = /^(, | 및 | 또는 )/;
/** scope 를 가르는 접두 — 덩어리 앞에 붙는다. */
const GENERAL_PREFIX = "보통약관 ";

const squash = (s: string) => s.replace(/\s+/g, "");

function tokenAt(text: string, pos: number): Token | undefined {
  ARTICLE.lastIndex = pos;
  const a = ARTICLE.exec(text);
  if (a) {
    // 항 없이 호만 붙은 조(실물 「제22조(계약의 무효) 제2호」) — 표기가 「제N조 제K항 제L호」로만 나므로 조까지만 참조로 읽고 호는 평문으로 남긴다
    const orphanItem = a[5] === undefined && a[6] !== undefined;
    const end = orphanItem ? pos + a[0].length - /\s*제\d+호$/.exec(a[0])![0].length : pos + a[0].length;
    return {
      kind: "article",
      general: Boolean(a[1]),
      number: a[3] ? `${a[2]}의${a[3]}` : a[2],
      title: a[4],
      ...(a[5] !== undefined ? { paragraph: a[5] } : {}),
      ...(a[6] !== undefined && !orphanItem ? { item: a[6] } : {}),
      end,
      ...(orphanItem ? { skipTo: pos + a[0].length } : {}),
    };
  }
  PARAGRAPH.lastIndex = pos;
  const p = PARAGRAPH.exec(text);
  if (p) return { kind: "paragraph", paragraph: p[1], ...(p[2] !== undefined ? { item: p[2] } : {}), end: pos + p[0].length };
  ITEM.lastIndex = pos;
  const i = ITEM.exec(text);
  if (i) return { kind: "item", item: i[1], end: pos + i[0].length };
  return undefined;
}

/** 토큰 하나를 문맥 위에서 해소한다. 문맥은 조·항이 나올 때마다 갱신된다. */
function resolve(token: Token, context: RefContext, env: RefEnv, raw: string): Id | undefined {
  if (token.kind === "article") {
    // 덩어리 안 대상은 같은 문서다 (기능/문면 §3.5) — 접두 없는 뒤 멤버도 덩어리의 scope 를 따른다
    const general = token.general || context.scope === "general";
    const index = general ? env.general : env.self;
    if (!index) {
      env.report.push(`보통약관 색인 없음: ${raw}`);
      return undefined;
    }
    const entry = index.byNumber.get(token.number);
    if (!entry) {
      env.report.push(`조 없음: ${raw}`);
      return undefined;
    }
    if (squash(entry.title) !== squash(token.title)) {
      env.report.push(`조 제목 불일치: ${raw} ↔ 색인 「${entry.title}」`);
      return undefined;
    }
    context.scope = general ? "general" : context.scope;
    context.entry = entry;
    context.paragraphId = undefined;
    if (token.paragraph === undefined) return entry.id;
    return resolveParagraph(token.paragraph, token.item, context, env, raw);
  }
  if (token.kind === "paragraph") return resolveParagraph(token.paragraph, token.item, context, env, raw);
  const paragraphId = context.paragraphId;
  if (!context.entry || !paragraphId) {
    env.report.push(`호 참조 미해소 (조·항 문맥 없음): ${raw}`);
    return undefined;
  }
  return resolveItem(paragraphId, token.item, context, env, raw);
}

function resolveParagraph(paragraph: string, item: string | undefined, context: RefContext, env: RefEnv, raw: string): Id | undefined {
  const entry = context.entry;
  if (!entry) {
    env.report.push(`항 참조 미해소 (조 문맥 없음): ${raw}`);
    return undefined;
  }
  const paragraphId = entry.paragraphIds[Number(paragraph) - 1];
  if (!paragraphId) {
    env.report.push(`항 없음: ${raw} (조 「${entry.title}」)`);
    return undefined;
  }
  context.paragraphId = paragraphId;
  if (item === undefined) return paragraphId;
  return resolveItem(paragraphId, item, context, env, raw);
}

function resolveItem(paragraphId: Id, item: string, context: RefContext, env: RefEnv, raw: string): Id | undefined {
  const itemId = context.entry?.itemIds.get(paragraphId)?.[Number(item) - 1];
  if (!itemId) {
    env.report.push(`호 없음: ${raw} (조 「${context.entry?.title}」)`);
    return undefined;
  }
  return itemId;
}

interface Chunk {
  /** 덩어리가 끝난 자리 — 실패해도 여기까지는 다시 읽지 않는다. */
  end: number;
  /** 참조로 읽지 않고 평문으로 남길 뒤따르는 구간의 끝 (항 없는 호 · 연결어가 바뀐 뒤의 나열). */
  skipTo?: number;
  /** 변환 중간 모양 — 대상 **노드 id** 를 `articleId` 자리에 싣는다. 출력 직전 `codeTargets`(convert.ts)가 (조, P코드)로 바꾼다 (ADR-0072). */
  targets?: RefTarget[];
  connector?: ReferenceConnector;
  scope?: "self" | "general";
}

/** `start` 에서 시작하는 참조 덩어리를 읽는다. 하나라도 해소하지 못하면 덩어리 전체를 평문으로 남긴다. */
function readChunk(text: string, start: number, env: RefEnv): Chunk {
  const first = tokenAt(text, start);
  if (!first) return { end: start + 1 };
  const before = text.slice(0, start);
  // 법령 인용 — 뒤따르는 항·호까지 토큰 통째로 건너뛴다
  if (first.kind === "article" && !first.general && LAW.test(before)) return { end: first.end };
  if (first.kind !== "article" && CITED_ARTICLE.test(before)) return { end: first.end };

  const current = [...env.self.byNumber.values()].find((entry) => entry.id === env.currentArticleId);
  const context: RefContext = {
    scope: "self",
    ...(current ? { entry: current } : {}),
    ...(env.currentParagraphId !== undefined ? { paragraphId: env.currentParagraphId } : {}),
  };
  const targets: RefTarget[] = [];
  let connectorWord: string | undefined;
  let token: Token | undefined = first;
  let end = first.end;

  let skipTo: number | undefined;
  while (token) {
    const nodeId = resolve(token, context, env, text.slice(start, token.end));
    if (nodeId === undefined) return { end: token.end };
    targets.push({ articleId: nodeId });
    end = token.end;
    if (token.kind === "article" && token.skipTo !== undefined) {
      env.report.push(`항 없는 호 — 조까지만 참조, 호는 평문: ${text.slice(start, token.skipTo)}`);
      skipTo = token.skipTo;
      break;
    }

    const join = JOIN.exec(text.slice(end));
    if (!join) break;
    const next = tokenAt(text, end + join[0].length);
    // 접두를 새로 단 조는 새 덩어리다 (기능/문면 §3.5 — 접두는 덩어리당 한 번)
    if (!next || (next.kind === "article" && next.general)) break;
    const word = join[1] !== ", " ? join[1].trim() : undefined;
    // 연결어가 바뀌면(「제4호 및 제5호 또는 제2항 …」) 한 슬롯의 연결어 하나로 표기할 수 없다 — 앞 연결어까지만 참조, 뒤 나열은 평문 (보고)
    if (word && connectorWord && word !== connectorWord) {
      let tail = next.end;
      for (let more = JOIN.exec(text.slice(tail)); more; more = JOIN.exec(text.slice(tail))) {
        const t = tokenAt(text, tail + more[0].length);
        if (!t) break;
        tail = t.end;
      }
      env.report.push(`연결어가 섞인 나열 — 「${connectorWord}」까지만 참조, 뒤는 평문: ${text.slice(start, tail)}`);
      skipTo = tail;
      break;
    }
    if (word) connectorWord = word;
    token = next;
  }
  // 쉼표로만 이어진 덩어리도 「및」 — 연결어는 둘뿐이다 (기능/문면 §3.5). 대상이 하나면 연결어는 쓰이지 않는다.
  const connector: ReferenceConnector = connectorWord === "또는" ? "또는" : "및";
  return { end, targets, connector, scope: context.scope, ...(skipTo !== undefined ? { skipTo } : {}) };
}

export function inlinesFromText(text: string, env: RefEnv, newId: () => Id): InlineNode[] {
  const pieces: Piece[] = [];
  const covered = (pos: number) => pieces.some((p) => p.start <= pos && pos < p.end);

  for (const m of text.matchAll(APPENDIX)) {
    const code = env.appendixByNumber.get(Number(m[1]));
    if (!code) {
      env.report.push(`별표 ${m[1]} 코드 없음: ${m[0]}`);
      continue;
    }
    pieces.push({ start: m.index, end: m.index + m[0].length, node: { id: newId(), kind: "appendixRef", appendixCode: code } });
  }

  let cursor = 0;
  while (cursor < text.length) {
    PROBE.lastIndex = cursor;
    const probe = PROBE.exec(text);
    if (!probe) break;
    if (covered(probe.index)) {
      cursor = probe.index + probe[0].length;
      continue;
    }
    // 「보통약관 」 접두는 probe 앞에 있다 — 덩어리는 접두부터 시작한다
    const chunkStart = text.slice(0, probe.index).endsWith(GENERAL_PREFIX) ? probe.index - GENERAL_PREFIX.length : probe.index;
    const chunk = readChunk(text, chunkStart, env);
    if (chunk.targets && chunk.targets.length > 0) {
      pieces.push({
        start: chunkStart,
        end: chunk.end,
        node: { id: newId(), kind: "articleRef", targets: chunk.targets, connector: chunk.connector ?? "및", scope: chunk.scope ?? "self" },
      });
    }
    cursor = Math.max(chunk.skipTo ?? chunk.end, probe.index + 1);
  }

  pieces.sort((a, b) => a.start - b.start);
  const out: InlineNode[] = [];
  let pos = 0;
  for (const p of pieces) {
    if (p.start > pos) out.push({ id: newId(), kind: "text", text: text.slice(pos, p.start) });
    out.push(p.node);
    pos = p.end;
  }
  if (pos < text.length) out.push({ id: newId(), kind: "text", text: text.slice(pos) });
  return out;
}

/** 변환 뒤 텍스트 노드에 참조 모양 평문이 남았는지 (법령 인용은 제외) — 변환 누락 감시용. */
export function leftoverReferences(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/제\d+조(?:의\d+)?\(/g)) {
    if (LAW.test(text.slice(0, m.index))) continue;
    out.push(text.slice(m.index, m.index + 24));
  }
  return out;
}
