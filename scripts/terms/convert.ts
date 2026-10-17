/**
 * 원문 `.md`(파싱양식) → 시드 JSON 문면 (개발 도구 — 제품 기능 아님).
 *
 *   npm run terms:convert
 *
 * 1. `tests/fixtures/terms/*.md` 를 `parseTerms` 로 읽는다.
 * 2. 관·조·항·호·목·표·박스 구조 노드를 결정적 id 로 만들고 조·항·호 색인을 채운다.
 * 3. 담보속성 조건 오버레이(`inlineConds`)를 얹고, 항·호·목 텍스트의 조·별표 참조 평문을 `inlinesFromText` 로
 *    참조 슬롯으로 바꾼다 — 조건 가지 안의 참조도 같이 풀린다.
 * 4. 보통약관의 기본계약 대치 조는 제목만 남기고, 기본계약 문면은 그 조들을 뽑아 조연결한다.
 * 5. 슬롯 오버레이(담보명 등)를 얹는다.
 * 6. 함수조항 · 박스를 만든다 — 조 · 여러 항 함수조항(`CLAUSES`, 원문 한 자리 `from` 에서 또는 평문에서, `clauses.ts`)과
 *    정적 마스터 박스(원문의 박스 전부, 같은 박스는 하나 · 낱말만 달라도 따로, `boxes.ts`). 적재 순서로 코드를 매기고,
 *    박스 자리는 박스 참조로 · 설정의 쓰임 자리는 함수조항 참조로 바꾼다.
 * 7. 조 자리 조건 오버레이(`articleConds`)를 얹고 `validateTree` 로 검증한 뒤 `src/db/seed/data/{generals,documents,appendices,boxes,clauses}.json` 을 쓴다.
 *
 * 변환하지 못한 참조는 `[report]` 로 stdout 에 남긴다 — 사람이 본다 (법령 인용은 의도된 미변환).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ArticleNode, BlockNode, BoxNode, BoxRefNode, DocumentNode, InlineNode, ParagraphNode, SectionNode, TableNode } from "../../src/domain/document/nodes";
import { articleRefsOf, indexTree, validateTree } from "../../src/domain/document/nodes";
import { referenceKeysOf, targetOfNode, withCodes } from "../../src/domain/document/pcode";
import { foldTitle, titleNodes } from "../../src/domain/document/title";
import type { RefTarget } from "../../src/domain/document/nodes";
import { clauseCodeEntries, withClauseCodes } from "../../src/domain/clause/pcode";
import type { ArticleRefNode as ClauseArticleRef } from "../../src/domain/clause/nodes";
import type { Id } from "../../src/domain/types";
import { boxSites, planBoxes, replaceBox, type BoxPlan } from "./boxes";
import type { Discriminator } from "../../src/domain/catalog/types";
import { applyClauseUse, articleRefParamsOf, INNER_TARGETS, clauseFromSource, inlineBody, optionCode, parameterize, placeOptions, reId, valueCode, type ClauseRecord } from "./clauses";
import { articlesDeep, canonicalArticle, claimOf, collapseRenewal, coverageNameOf, localPaths, mergeRenewal, textNodesOf, wordClusters } from "./auto";
import { APPENDED_CLAUSE_KEYS, APPENDICES, CLAUSES, PRODUCTS, RENEWAL, SEED_DIR, type ClauseUse, type ProductTerms, type SlotOverlay, type SpecialSpec } from "./config";
import { parseTerms, type ParsedArticle, type ParsedDoc } from "./parse";
import { applyArticleConds, applyBoxConds, applyInlineClauses, applyInlineConds, articlesOf } from "./overlay";
import { basisDateClause } from "./renewal";
import { inlinesFromText, leftoverReferences, type ArticleEntry, type ArticleIndex, type ParagraphGroup, type RefEnv } from "./refs";
import { applyAlphaWaiver, applyMeritzWaiver, guardAlphaApplication, guardDiseaseApplication, guardExcludeSentence, guardOwnWaiver, guardWaiverBlocks, guardWaiverMentions, resolveWaiverCodes } from "./waiver";

const root = process.cwd();
const read = (product: ProductTerms, file: string) => readFileSync(path.join(root, product.fixtureDir, file), "utf8");
const numberId = (n: string) => n.replace("의", "_");

export interface Built {
  tree: DocumentNode;
  index: ArticleIndex;
  /** 조 id → 원문 번호 (슬롯 오버레이가 조를 찾을 때). */
  numberOf: Map<Id, string>;
  /** 통합형 특약의 특약 자체 납입면제 소제목 자리 — 조 직속 블록(머리 박스 · 항 · 표) id (`restartGroups`). 납입면제 없는 상품이면 빠진다(`guardOwnWaiver`). */
  waiverBlocks?: Set<Id>;
  /** 자동 탑재 특약 — 원문 제목(갱신형 짝이면 갱신형 쪽도) · 소멸 조에서 읽은 보험금명(담보 값 D0001). */
  auto?: { title: string; renewalTitle?: string; claim?: string };
}

/** 표 셀을 인라인 노드로 — 1차에서는 평문 텍스트 하나, 2차(convertText)가 참조를 슬롯으로 바꾼다. */
function textCell(id: Id, text: string): InlineNode[] {
  return [{ id, kind: "text", text }];
}

/** 소제목 머리 박스 — 「**3.(보장의 소멸)**」 · 머리말이 붙은 「5.(보험료의 납입면제)회사는 …」. 소제목 번호. */
const SUBSECTION_HEAD = /^\**(\d+)\.\(((?:[^()]|\([^()]*\))*)\)/;
/** 종형 머리 박스 — 한 줄 「[2종(보험료 납입면제형)]」 · 「[1형(해약환급금 지급형)]」. 안쪽 글. */
const VARIANT_HEAD = /^\[([^[\]]+)\]$/;

export interface StructureOptions {
  /**
   * 통합형 특약의 항 번호 무리 — 소제목 · 종형 머리 박스 다음 항부터 번호를 다시 센다(`ParagraphNode.restart`), 조 색인에 무리(`ArticleEntry.groups`)를 둔다.
   * 원문이 세부보장마다 「1.(보험금의 지급사유)」부터 다시 매기고 「제N항」이 그 소제목의 N번째 항을 가리킨다. 자동 탑재 특약만 켠다(2604 · 손으로 쓴 특약은 그대로).
   */
  restartGroups?: boolean;
}

/** 1차 — 구조 노드. 텍스트는 아직 평문(text 노드 하나)으로 둔다. */
export function buildStructure(doc: ParsedDoc, prefix: string, title: string, articleFilter?: (a: ParsedArticle) => boolean, opts: StructureOptions = {}): Built {
  const index: ArticleIndex = { byNumber: new Map() };
  const numberOf = new Map<Id, string>();
  const waiverBlocks = new Set<Id>();
  const withSections = doc.sections.length > 1 || doc.sections[0]?.title !== "";

  const article = (a: ParsedArticle): ArticleNode => {
    const aid = `${prefix}-a${numberId(a.number)}`;
    const entry: ArticleEntry = { id: aid, title: a.title, paragraphIds: [], itemIds: new Map() };
    const children: BlockNode[] = [];
    let paragraph: ParagraphNode | undefined;
    let item: { id: Id } | undefined;
    let staticSeq = 0;
    // 항 번호 무리 (restartGroups) — 머리 박스가 선 뒤 첫 항이 새 무리를 연다
    const groups: ParagraphGroup[] = [];
    let head: { section?: number; variant?: string } | undefined;
    // 특약 자체 납입면제 소제목 자리(「N.(보험료의 납입면제)」 · 「N.(납입면제에 관한 세부규정)」 — 형 머리 [1형(…)] · 다음 소제목에서 끝난다)
    let inWaiver = false;
    let isHead = false;
    for (const line of a.body) {
      isHead = false;
      if (opts.restartGroups && line.kind === "box") {
        const text = [line.title, ...line.lines].join(" ").trim();
        const section = SUBSECTION_HEAD.exec(text);
        const variant = line.title === "" && line.lines.length === 1 ? VARIANT_HEAD.exec(line.lines[0].trim()) : null;
        if (section) {
          head = { section: Number(section[1]) };
          inWaiver = /납입면제/.test(section[2]);
        } else if (variant) {
          head = { ...head, variant: variant[1] };
          if (/^\d+형/.test(variant[1])) inWaiver = false;
        }
        isHead = Boolean(section || variant);
      }
      if (line.kind === "paragraph") {
        const pid = `${aid}-p${entry.paragraphIds.length + 1}`;
        paragraph = { id: pid, kind: "paragraph", children: [{ id: `${pid}-x0`, kind: "text", text: line.text }] };
        if (opts.restartGroups) {
          const last = groups.at(-1);
          if (!last || head) {
            const section = head?.section ?? last?.section;
            const coverage = !last ? 0 : section !== undefined && last.section !== undefined && section < last.section ? last.coverage + 1 : last.coverage;
            groups.push({ paragraphIds: [pid], ...(section !== undefined ? { section } : {}), ...(head?.variant !== undefined ? { variant: head.variant } : {}), coverage });
            if (last) paragraph.restart = true;
          } else last.paragraphIds.push(pid);
          head = undefined;
        }
        entry.paragraphIds.push(pid);
        entry.itemIds.set(pid, []);
        if (inWaiver) waiverBlocks.add(pid);
        children.push(paragraph);
        item = undefined;
        continue;
      }
      if (!paragraph && (line.kind === "item" || line.kind === "subitem")) throw new Error(`항 없이 ${line.kind} 이 왔다: ${a.title}`);
      if (line.kind === "item" && paragraph) {
        // 항 글과 첫 호 사이에 선 표 · 박스(「… 다음 각 호의 사항을 말합니다.」 뒤 표 → 호)는 호 목록 맨 앞에 — 렌더 순서가 원문과 같다
        if (!paragraph.items?.length) {
          const at = children.indexOf(paragraph);
          const between = children.slice(at + 1);
          if (between.length > 0 && between.every((c) => c.kind === "table" || c.kind === "box")) {
            children.splice(at + 1);
            paragraph.items = [...(between as (TableNode | BoxNode)[])];
          }
        }
        const items = entry.itemIds.get(paragraph.id)!;
        const iid = `${paragraph.id}-i${items.length + 1}`;
        items.push(iid);
        (paragraph.items ??= []).push({ id: iid, kind: "item", children: [{ id: `${iid}-x0`, kind: "text", text: line.text }] });
        item = { id: iid };
        continue;
      }
      if (line.kind === "subitem" && paragraph) {
        if (!item) throw new Error(`호 없이 목이 왔다: ${a.title}`);
        const owner = (paragraph.items ?? []).find((n): n is Extract<typeof n, { kind: "item" }> => n.kind === "item" && n.id === item!.id)!;
        const uid = `${item.id}-u${(owner.subitems?.length ?? 0) + 1}`;
        (owner.subitems ??= []).push({ id: uid, kind: "subitem", children: [{ id: `${uid}-x0`, kind: "text", text: line.text }] });
        continue;
      }
      if (line.kind === "item" || line.kind === "subitem") continue;
      // 표·박스 — 항에 호가 있으면 그 항의 목록 자리에, 아니면 조 직속에 (렌더 순서는 같다). 첫 항 앞(통합형 특약의 세부보장 머리)도 조 직속
      staticSeq += 1;
      const node: TableNode | BoxNode =
        line.kind === "table"
          ? {
              id: `${aid}-t${staticSeq}`,
              kind: "table",
              ...(line.title !== undefined ? { title: line.title } : {}),
              columns: Array.from({ length: Math.max(1, ...line.rows.map((r) => r.cells.length)) }, () => ({})),
              rows: line.rows.map((r, ri) => {
                const width = Math.max(1, ...line.rows.map((x) => x.cells.length));
                const cells = [...r.cells, ...Array<string>(width - r.cells.length).fill("")];
                return { ...(r.header ? { header: true } : {}), cells: cells.map((text, ci) => textCell(`${aid}-t${staticSeq}-r${ri}c${ci}`, text)) };
              }),
            }
          : // 제목만 있는 박스(줄 0)는 제목을 줄로 — 박스 마스터는 줄이 하나 이상이어야 하고, 찍히는 글(【제목】 한 줄)은 같다
            line.lines.length === 0 && line.title !== ""
            ? { id: `${aid}-b${staticSeq}`, kind: "box", title: "", lines: [`【${line.title}】`] }
            : { id: `${aid}-b${staticSeq}`, kind: "box", title: line.title, lines: line.lines };
      if (inWaiver) waiverBlocks.add(node.id);
      // 소제목 · 형 머리 박스는 앞 항의 호 목록에 넣지 않고 조 직속에 — 무리 경계가 항 밖에 선다(찍히는 순서는 같다)
      if (paragraph?.items && paragraph.items.length > 0 && !isHead) paragraph.items.push(node);
      else children.push(node);
    }
    if (groups.length > 1) entry.groups = groups;
    index.byNumber.set(a.number, entry);
    numberOf.set(aid, a.number);
    return { id: aid, kind: "article", title: titleNodes(a.title, aid), children };
  };

  const top: DocumentNode["children"] = [];
  doc.sections.forEach((s, si) => {
    const articles = s.articles.filter((a) => !articleFilter || articleFilter(a)).map(article);
    if (withSections) {
      const section: SectionNode = { id: `${prefix}-s${si + 1}`, kind: "section", title: s.title, children: articles };
      top.push(section);
    } else top.push(...articles);
  });
  return { tree: { id: `${prefix}-doc`, kind: "document", title, children: top }, index, numberOf, ...(waiverBlocks.size > 0 ? { waiverBlocks } : {}) };
}

/** 2차 — 항·호·목의 평문을 인라인 노드로. 조건 가지 안의 평문도 같은 규칙으로 (가지 id 기준 채번). */
export function convertText(built: Built, general: ArticleIndex | undefined, appendixByNumber: Map<number, string>, report: string[], generalFallback = false): void {
  for (const a of articlesOf(built.tree)) {
    const env: RefEnv = { self: built.index, general, appendixByNumber, currentArticleId: a.id, report, ...(generalFallback ? { generalFallback, looseTitles: true } : {}) };
    /** 이어진 텍스트런은 한 번에 변환하고, 조건 노드는 가지 안을 재귀로 변환한 뒤 그대로 둔다. */
    const convert = (ownerId: Id, children: InlineNode[]): InlineNode[] => {
      let seq = 0;
      const newId = () => `${ownerId}-x${++seq}`;
      const out: InlineNode[] = [];
      let run = "";
      const flush = () => {
        if (run === "") return;
        out.push(...inlinesFromText(run, env, newId));
        run = "";
      };
      for (const n of children) {
        if (n.kind === "text") {
          run += n.text;
          continue;
        }
        flush();
        if (n.kind === "inlineCond") for (const branch of n.branches) branch.children = convert(branch.id, branch.children);
        out.push(n);
      }
      flush();
      return out;
    };
    // 표 셀 — 조·별표 참조를 슬롯으로 (번호는 계산값이므로 평문으로 굳히지 않는다)
    for (const c of a.children) {
      if (c.kind !== "table") continue;
      env.currentParagraphId = undefined;
      c.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => (row.cells[ci] = convert(`${c.id}-r${ri}c${ci}`, cell))));
    }
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      env.currentParagraphId = p.id;
      p.children = convert(p.id, p.children);
      for (const it of p.items ?? []) {
        if (it.kind !== "item") continue;
        it.children = convert(it.id, it.children);
        for (const u of it.subitems ?? []) if (u.kind === "subitem") u.children = convert(u.id, u.children);
      }
    }
  }
}

/** 변환 뒤에도 텍스트로 남은 참조 모양 평문 — 법령 인용은 제외한다 (변환 누락 감시). */
function reportLeftovers(built: Built, label: string, report: string[]): void {
  for (const a of articlesDeep(built.tree)) {
    const walk = (owner: { children: InlineNode[] }) => {
      for (const n of owner.children) {
        if (n.kind === "inlineCond") {
          for (const branch of n.branches) walk(branch);
          continue;
        }
        if (n.kind !== "text") continue;
        for (const found of leftoverReferences(n.text)) report.push(`${label} 조 「${foldTitle(a.title)}」 에 조 참조 평문이 남음: ${found}…`);
      }
    };
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      walk(p);
      for (const it of p.items ?? []) {
        if (it.kind !== "item") continue;
        walk(it);
        for (const u of it.subitems ?? []) if (u.kind === "subitem") walk(u);
      }
    }
  }
}

/** 슬롯 오버레이 — 지정 조의 텍스트 노드에서 `find` 첫 등장을 슬롯으로 쪼갠다. */
function applySlots(built: Built, slots: SlotOverlay[], report: string[]): void {
  for (const slot of slots) {
    const a = [...articlesOf(built.tree)].find((x) => built.numberOf.get(x.id) === slot.article);
    if (!a) {
      report.push(`슬롯 오버레이: 조 ${slot.article} 없음`);
      continue;
    }
    let done = false;
    const owners: { id: Id; children: InlineNode[] }[] = [];
    for (const p of a.children) {
      if (p.kind !== "paragraph") continue;
      owners.push(p);
      for (const it of p.items ?? []) if (it.kind === "item") owners.push(it);
    }
    for (const owner of owners) {
      const at = owner.children.findIndex((n) => n.kind === "text" && n.text.includes(slot.find));
      if (at < 0) continue;
      const node = owner.children[at] as Extract<InlineNode, { kind: "text" }>;
      const i = node.text.indexOf(slot.find);
      const before = node.text.slice(0, i);
      const after = node.text.slice(i + slot.find.length);
      const replacement: InlineNode[] = [
        ...(before ? [{ id: `${node.id}a`, kind: "text" as const, text: before }] : []),
        { id: `${node.id}s`, kind: "slot", ref: slot.ref },
        ...(after ? [{ id: `${node.id}b`, kind: "text" as const, text: after }] : []),
      ];
      owner.children.splice(at, 1, ...replacement);
      done = true;
      break;
    }
    if (!done) report.push(`슬롯 오버레이: 조 ${slot.article} 에서 「${slot.find}」 을 찾지 못함`);
  }
}

function validate(tree: DocumentNode, kind: "general" | "special", generalTree?: DocumentNode): string[] {
  const generalIds = new Set<Id>();
  if (generalTree) for (const e of indexTree(generalTree).nodes.values()) if (e.node.kind === "article") generalIds.add(e.node.id);
  const issues = validateTree(tree, {
    kind,
    ...(kind === "special" ? { generalArticleIds: generalIds, generalReferenceKeys: generalTree ? referenceKeysOf(generalTree) : new Set<string>() } : {}),
    appendixExists: (code) => APPENDICES.some((a) => a.code === code),
  });
  return issues.map((i) => `${i.kind}: ${i.message} @ ${(i.at.nodePath ?? []).join("/")}`);
}

/** 변환 중간 모양의 대상(노드 id) → 참조 대상(조 · 조+P코드). 코드가 매겨진 트리의 색인으로 푼다 (ADR-0072 결정 3). */
function targetOfId(ix: ReturnType<typeof indexTree>, id: Id, where: string): RefTarget {
  const t = targetOfNode(ix, id);
  if (!t) throw new Error(`${where}: 조 참조 대상 ${id} 를 (조, P코드)로 풀 수 없다`);
  return t;
}

/**
 * 문면의 조 참조 대상을 (조, P코드)로 — 자기 참조는 이 트리, 보통약관 참조는 대응 보통약관. 함수조항 참조의 조 참조 인자 연결도 같다(ADR-0083).
 * P코드를 매긴 뒤에 부른다.
 */
function codeTargets(tree: DocumentNode, generalTree: DocumentNode | undefined, where: string, clauseOf: (code: string) => ClauseRecord | undefined): void {
  const own = indexTree(tree);
  const general = generalTree ? indexTree(generalTree) : undefined;
  for (const e of own.nodes.values()) {
    for (const r of articleRefsOf(e.node)) {
      const ix = r.scope === "self" ? own : general;
      if (!ix) throw new Error(`${where}: 대응 보통약관 없이 보통약관 참조가 있다`);
      r.targets = r.targets.map((t) => {
        // 함수조항 블록으로 바뀐 항을 가리키면 (블록 참조 코드, 안쪽 코드) — 펼친 함수조항 안쪽 (ADR-0077 결정 6)
        const inner = !ix.nodes.has(t.articleId) ? INNER_TARGETS.get(t.articleId) : undefined;
        if (!inner) return targetOfId(ix, t.articleId, where);
        const clause = clauseOf(inner.clauseCode);
        const innerCode = clause && clauseCodeEntries(withClauseCodes(clause.body)).entries.find((x) => x.id === inner.innerId)?.code;
        if (!innerCode) throw new Error(`${where}: 함수조항 ${inner.clauseCode} 안쪽 ${inner.innerId} 의 코드가 없다`);
        return { ...targetOfId(ix, inner.refId, where), innerCode };
      });
    }
  }
}

/** 함수조항 본문의 조 참조 대상 — 보통약관(노드 id → 조 · P코드) · 이 함수조항(본문 노드 id → 제 코드). 조 참조 인자 슬롯은 그대로. */
function codeClauseTargets(clause: ClauseRecord, generals: ReturnType<typeof indexTree>[]): ClauseRecord {
  const body = withClauseCodes(clause.body);
  const own = clauseCodeEntries(body).entries;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.kind === "articleRef" && n.scope !== "param") {
      const r = n as unknown as ClauseArticleRef;
      r.targets = r.targets.map((t) => {
        const id = t.articleId ?? "";
        if (r.scope === "clause") {
          const code = own.find((e) => e.id === id)?.code;
          if (!code) throw new Error(`${clause.code}: 「이 함수조항」 참조 대상 ${id} 의 P코드가 없다`);
          return { code };
        }
        const ix = generals.find((g) => g.nodes.has(id));
        if (!ix) throw new Error(`${clause.code}: 보통약관 참조 대상 ${id} 가 보통약관에 없다`);
        // 값 한정(반복으로 생긴 호 — 역할 함수조항, ADR-0077 결정 7) · 펼친 함수조항 안쪽 코드(ADR-0077 결정 6)는 그대로 싣는다
        return { ...targetOfId(ix, id, clause.code), ...(t.innerCode ? { innerCode: t.innerCode } : {}), ...(t.restrict ? { restrict: t.restrict } : {}) };
      });
    }
    for (const key of ["children", "items", "subitems", "branches", "cases"]) {
      const list = n[key];
      if (Array.isArray(list)) list.forEach(visit);
    }
  };
  (body as unknown[]).forEach(visit);
  for (const o of clause.options) for (const v of o.values) (v.body as unknown[]).forEach(visit);
  return { ...clause, body } as ClauseRecord;
}

/** 상품 한 벌의 보통약관 — 구조 · 참조. */
interface BuiltProduct {
  product: ProductTerms;
  parsed: ParsedDoc;
  general: Built;
  specials: Map<string, Built>;
}

function main(): void {
  const report: string[] = [];

  // ── 상품마다 보통약관 · 담보약관 (구조 · 조건 · 참조 · 슬롯)
  const products: BuiltProduct[] = PRODUCTS.map((product) => {
    const parsed = parseTerms(read(product, product.general.file));
    const general = buildStructure(parsed, product.general.idPrefix, parsed.title);
    // 형 축 문장 · 박스의 상품 범위 조건 — 참조 변환 · 박스 마스터 전에 (가지 안의 참조도 슬롯이 되고, 감싼 박스도 박스 참조가 된다)
    applyInlineConds(general.tree, general.numberOf, product.general.inlineConds ?? [], report);
    applyBoxConds(general.tree, general.numberOf, product.general.boxConds ?? [], report);
    convertText(general, undefined, product.appendixNumbers, report);
    reportLeftovers(general, `[${product.general.code}]`, report);
    for (const a of articlesOf(general.tree)) {
      if (product.general.emptyArticles.includes(general.numberOf.get(a.id) ?? "")) a.children = [];
    }
    const specials = new Map<string, Built>();
    for (const spec of product.specials) specials.set(spec.code, buildSpecial(spec, product, parsed, general, report));
    return { product, parsed, general, specials };
  });
  /** 문서 코드 → 문면 (보통약관 · 담보약관 전부) — 함수조항 `from` 이 가리킨다. */
  const built = new Map<string, Built>();
  for (const p of products) {
    built.set(p.product.general.code, p.general);
    for (const [code, b] of p.specials) built.set(code, b);
  }

  // ── 박스(원문의 박스 전부 → 정적 마스터)와 함수조항(조 · 여러 항, 설정)을 만들고, 적재 순서로 코드를 매긴다.
  // 박스 자리를 먼저 박스 참조로 바꾼다 — 조째 함수조항이 항 사이 · 호 목록의 박스 참조를 본문에 품는다(최종 결정 6)
  const productOf = (code: string) => products.find((p) => p.product.code === code)!;
  const sites = products.flatMap((p) => [
    ...boxSites(p.general.tree, { doc: p.product.general.code, product: p.product.code, general: true }),
    ...p.product.specials.flatMap((spec) => boxSites(p.specials.get(spec.code)!.tree, { doc: spec.code, product: p.product.code, general: false, ...(spec.auto ? { late: true } : {}) })),
  ]);
  const boxes = orderBoxes(planBoxes(sites));
  // 박스 자리 → 박스 참조 (같은 목록 자리)
  for (const plan of boxes) for (const site of plan.sites) replaceBox(site, plan.record.code);
  // 「기준일 문구」(ADR-0086 결정 6) — 담보약관만 쓰는 문구 함수조항이라 담보약관 함수조항 맨 앞 코드
  const configured = [basisDateClause(), ...CLAUSES.map((c) => ({ key: c.key, record: buildClause(c, built, products, report) }))];
  // 알파Plus 납입면제 — 역할 함수조항 여섯 + 반복 템플릿(waiver.ts). 박스 참조가 선 뒤에 옮긴다(암 정의 칸 · 그림 박스). 보통약관이 쓰는 함수조항이다
  const alphaWaiver = applyAlphaWaiver(productOf("alpha").general, productOf("meritz").general);
  // 같은 상품군의 다른 판(알파Plus2607) — 템플릿만 같은 모양으로 바꾸고 함수조항은 2604 것을 함께 쓴다(조 id 체계가 같아 참조가 그대로 풀린다).
  // 그 판 원문으로 만든 함수조항은 버리되, 2604 것과 글이 다르면 보고한다(인수기준 알려진 차이로 적는다). 메리츠 변환(정의 원문을 옮긴다) 전에 읽는다
  for (const p of products.filter((x) => x.product.line === "alpha" && x.product.code !== "alpha")) {
    for (const own of applyAlphaWaiver(p.general, productOf("meritz").general)) {
      const shared = alphaWaiver.find((w) => w.key === own.key);
      if (!shared) throw new Error(`${p.product.code}: 납입면제 함수조항 ${own.key} 이 2604 에 없다`);
      if (canonicalClause(own.record) !== canonicalClause(shared.record)) report.push(`[${p.product.general.code}] 납입면제 함수조항 「${shared.record.label}」 — 이 판 원문과 글 · 박스가 달라 2604 것을 쓴다(알려진 차이)`);
    }
  }
  // 메리츠 납입면제 — 같은 모양으로. 호 · 부활 문구는 알파Plus 것을 함께 쓰고, 정의 · 부가항 · 세부규정 · 무효는 메리츠 전용(글 · 가리키는 조가 다르다)
  const waiver = [...alphaWaiver, ...applyMeritzWaiver(productOf("meritz").general, alphaWaiver)];
  configured.push(...waiver);
  const generalKeys = new Set([...products.flatMap((p) => (p.product.general.clauses ?? []).map((u) => u.clause)), ...waiver.map((w) => w.key)]);
  const clauses = orderClauses(configured, generalKeys, APPENDED_CLAUSE_KEYS);
  const clauseByKey = new Map(configured.map((c) => [c.key, c.record]));
  // 함수조항 자리표 @key → 코드 — 보통약관의 납입면제 자리 · 담보약관의 문구 함수조항 오버레이
  for (const tree of [...built.values()].map((b) => b.tree)) resolveWaiverCodes(tree, (key) => clauseByKey.get(key)?.code);
  const applyUses = (b: Built, uses: readonly ClauseUse[], label: string) => {
    const articleOf = (number: string) => [...articlesOf(b.tree)].find((x) => b.numberOf.get(x.id) === number);
    for (const u of uses) {
      const clause = clauseByKey.get(u.clause);
      if (!clause) throw new Error(`${label}: 함수조항 ${u.clause} 정의 없음`);
      applyClauseUse(u, clause, articleOf, `[${label}]`, report, b.tree);
    }
  };
  for (const p of products) {
    applyUses(p.general, p.product.general.clauses ?? [], p.product.general.code);
    for (const spec of p.product.specials) applyUses(p.specials.get(spec.code)!, spec.clauses ?? [], spec.code);
  }

  // 납입면제 조를 가리키는 문장 — 「납입면제 있음」 조건으로(납입면제 없는 상품이면 세 조와 함께 빠진다). 사용처 자리 대조(applyUses) 뒤에 고친다
  // 납입면제 세 조의 id — 상품군마다(같은 상품군의 판은 조 id 체계가 같다)
  const waiverArticles: Record<ProductTerms["line"], string[]> = { alpha: ["g-a27_1", "g-a27_2", "g-a27_3"], meritz: ["m-a29", "m-a30", "m-a31"] };
  const isWaiverOf = (line: ProductTerms["line"]) => (id: string) => waiverArticles[line].some((a) => id === a || id.startsWith(`${a}-`));
  // 자동 탑재 특약 — 기존 함수조항과 같은 조는 그 함수조항으로, 남은 조 중 조째 같은 글끼리는 새 함수조항(맨 뒤 코드)으로. 갱신형 짝의 같아진 가지는 하나로
  const autoStats = applyAutoClauses(products, CLAUSES.map((c) => clauseByKey.get(c.key)!), clauses, report, isWaiverOf("alpha"));
  for (const p of products) {
    const isWaiver = isWaiverOf(p.product.line);
    // 특약 자체의 납입면제(조째 · 통합형 특약의 소제목 자리)는 「납입면제 있음」으로 통째 감싸고, 그 자리를 가리키는 문장도 함께 고친다
    const own = new Map<string, (id: Id) => boolean>();
    for (const spec of p.product.specials.filter((s) => s.auto)) {
      const b = p.specials.get(spec.code)!;
      const inside = guardOwnWaiver(b.tree, b.waiverBlocks ?? new Set());
      own.set(spec.code, inside);
      guardWaiverBlocks(b.tree, isWaiver, inside);
    }
    guardWaiverMentions(p.general.tree, isWaiver, p.product.general.code);
    for (const spec of p.product.specials) {
      const inside = own.get(spec.code);
      guardWaiverMentions(p.specials.get(spec.code)!.tree, inside ? (id) => isWaiver(id) || inside(id) : isWaiver, spec.code);
    }
  }
  // 준용규정 함수조항 — 상품군마다 한 번(같은 상품군의 판이 함께 쓴다)
  const application = (key: string) => {
    const c = clauseByKey.get(key);
    if (!c) throw new Error(`${key} 함수조항 없음`);
    return c;
  };
  guardAlphaApplication(application("alpha-application"), isWaiverOf("alpha"));
  guardDiseaseApplication(application("alpha-application-disease"), isWaiverOf("alpha"));
  const meritzApplication = application("meritz-application");
  guardWaiverMentions({ id: meritzApplication.code, kind: "document", title: "", children: meritzApplication.body } as unknown as DocumentNode, isWaiverOf("meritz"), meritzApplication.code);

  // ── 조 자리 조건 · 검증
  const generals: { code: string; tree: DocumentNode }[] = [];
  const documents: { code: string; ownerCoverage: string; general: string; tree: DocumentNode }[] = [];
  const issues: string[] = [];
  // P코드 — 조마다 깊이 순 · 문서 순으로 매긴다(배타 가지의 같은 자리 항은 같은 코드, ADR-0072 결정 10). 적재가 코드를 그대로 쓴다
  for (const p of products) {
    p.general.tree = withCodes(p.general.tree);
    for (const b of p.specials.values()) b.tree = withCodes(b.tree);
  }
  // 조 참조 대상 — 변환 중간의 노드 id 를 (조, P코드)로 (ADR-0072 결정 3 · 10)
  const clauseOfCode = (code: string) => clauses.find((c) => c.code === code);
  for (const p of products) {
    codeTargets(p.general.tree, undefined, p.product.general.code, clauseOfCode);
    for (const spec of p.product.specials) codeTargets(p.specials.get(spec.code)!.tree, p.general.tree, spec.code, clauseOfCode);
  }
  for (const p of products) {
    issues.push(...validate(p.general.tree, "general").map((l) => `${p.product.general.code}: ${l}`));
    generals.push({ code: p.product.general.code, tree: p.general.tree });
    for (const spec of p.product.specials) {
      const b = p.specials.get(spec.code)!;
      applyArticleConds(b.tree, b.numberOf, spec.articleConds ?? [], report);
      b.tree = withCodes(b.tree);
      issues.push(...validate(b.tree, "special", p.general.tree).map((l) => `${spec.code}: ${l}`));
      documents.push({ code: spec.code, ownerCoverage: spec.ownerCoverage, general: p.product.general.code, tree: b.tree });
    }
  }
  checkClauseOrder(clauses, generals);

  // ── 쓰지 않는 박스를 빼고 코드를 다시 매긴다 — 같은 상품군의 판(2607) 보통약관의 박스 중 2604 함수조항이 대신하는 자리(납입면제 정의 · 그림)의 것
  const catalog = JSON.parse(readFileSync(path.join(root, SEED_DIR, "discriminators.json"), "utf8")) as Discriminator[];
  const generalIndexes = products.map((p) => indexTree(p.general.tree));
  const finalClauses = clauses.map((c) => codeClauseTargets(parameterize(c, catalog), generalIndexes));
  const generalClauseCodes = new Set(generals.flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"clauseCode":"(C\d+)"/g)].map((m) => m[1])));
  const plannedFront = new Set(boxes.filter((b) => b.sites.some((x) => x.general)).map((b) => b.record.code));
  const boxRecords = compactBoxes(boxes.map((b) => b.record), [generals, documents, finalClauses], [generals, finalClauses.filter((c) => generalClauseCodes.has(c.code))], plannedFront);

  // ── 출력
  const out = (file: string, data: unknown) => writeFileSync(path.join(root, SEED_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
  out("appendices.json", APPENDICES.map((a) => ({ code: a.code, name: a.name })));
  out("generals.json", generals);
  out("documents.json", documents);
  out("boxes.json", boxRecords);
  // 함수조항은 구분자를 직접 읽지 않고 인자만 읽는다 (최종 결정 2) — 직접 읽기를 「인자 + 기본 연결 = 그 구분자」로 기계 변환한다.
  // 구분자 카탈로그는 손으로 적는 시드(discriminators.json)다. 사용처는 기본 연결을 쓰므로 조립 결과가 그대로다
  out("clauses.json", finalClauses);
  writeAutoSeeds(products, out);

  const stats = (tree: DocumentNode) => {
    const ix = indexTree(tree);
    const count = (kind: string) => [...ix.nodes.values()].filter((e) => e.node.kind === kind).length;
    return `관 ${count("section")} · 조 ${count("article")} · 항 ${count("paragraph")} · 호 ${count("item")} · 목 ${count("subitem")} · 표 ${count("table")} · 박스 ${count("boxRef")} · 조참조 ${count("articleRef")} · 별표참조 ${count("appendixRef")} · 슬롯 ${count("slot")} · 조건 ${count("condBlock")}/${count("inlineCond")} · 함수조항 ${count("clauseInlineRef") + count("clauseBlockRef")}`;
  };
  const all = [...generals, ...documents];
  for (const g of generals) console.log(`[general] ${g.tree.title}: ${stats(g.tree)}`);
  for (const d of documents) console.log(`[special] ${d.tree.title}: ${stats(d.tree)}`);
  for (const b of boxRecords) console.log(`[box] ${b.code} ${b.name}`);
  for (const c of clauses) console.log(`[clause] ${c.code} ${c.label} (${c.mode}) — 쓰임 ${all.reduce((n, d) => n + JSON.stringify(d.tree).split(`"clauseCode":"${c.code}"`).length - 1, 0)}`);
  console.log(`[auto] 특약 ${autoStats.docs} · 기존 함수조항 쓰임 ${autoStats.existingUses} · 새 함수조항 ${autoStats.created.length}(쓰임 ${autoStats.createdUses}) · 조 일부 쓰임 ${autoStats.partialUses} · 갱신형 짝 가지 합침 ${autoStats.hoisted}`);
  for (const line of report) console.log(`[report] ${line}`);
  for (const line of issues) console.log(`[invalid] ${line}`);
  if (issues.length > 0) process.exit(1);
}

// ───────────────────────────── 자동 탑재 특약 ─────────────────────────────

interface AutoStats {
  docs: number;
  existingUses: number;
  created: ClauseRecord[];
  createdUses: number;
  /** 조 일부(잇닿은 항)만 함수조항 블록이 된 자리. */
  partialUses: number;
  hoisted: number;
}

/** 옵션 선택의 모든 조합 — 옵션이 없으면 빈 선택 하나. */
function selections(c: ClauseRecord): Record<string, string>[] {
  return c.options.reduce<Record<string, string>[]>((acc, o) => acc.flatMap((sel) => o.values.map((v) => ({ ...sel, [o.code]: v.code }))), [{}]);
}

/** 조의 첫 항부터 마지막 항까지 — 함수조항 본문이 될 수 있으면(항 · 박스 참조만, 호 목록에 표 · 함수조항 문구 없음) 그 블록들. */
function clauseSlice(a: ArticleNode): (ParagraphNode | BoxRefNode)[] | undefined {
  const first = a.children.findIndex((c) => c.kind === "paragraph");
  if (first < 0 || a.children[first].id !== `${a.id}-p1`) return undefined;
  let last = first;
  a.children.forEach((c, i) => {
    if (c.kind === "paragraph") last = i;
  });
  const slice = a.children.slice(first, last + 1);
  if (slice.some((c) => c.kind !== "paragraph" && c.kind !== "boxRef")) return undefined;
  const plain = (n: unknown): boolean => !JSON.stringify(n).includes('"kind":"clauseInlineRef"');
  for (const p of slice) {
    if (p.kind !== "paragraph") continue;
    for (const it of p.items ?? []) {
      if (it.kind !== "item" && it.kind !== "boxRef") return undefined;
      if (it.kind === "item" && (it.subitems ?? []).some((u) => u.kind !== "subitem")) return undefined;
    }
    if (!plain(p)) return undefined;
  }
  return slice as (ParagraphNode | BoxRefNode)[];
}

/**
 * 자동 탑재 특약의 함수조항 (QA/실물재현/알파플러스2607_모델명세 §3 — 공통화가 먼저):
 * 1. 조마다 기존 함수조항(설정 `CLAUSES`, 옵션 조합 전부)을 대 본다 — 조의 항 전부가 그 함수조항의 렌더 안에 있으면 그 함수조항 블록으로.
 * 2. 남은 조를 조째 글(조 밖 참조는 대상과 무관 — 조 참조 인자)로 묶어 두 곳 이상이면 새 함수조항 — 본문은 첫 자리에서 따고 코드는 맨 뒤.
 *    납입면제 두 조를 「…은 제외하며, 1종 … 도 제외합니다」로 가리키는 준용규정은 「납입면제 있음」 조건으로 가른다.
 * 3. 그래도 남은 조의 잇닿은 항이 함수조항(기존 · 새로 찾은 것) 하나와 같으면 그 항들만 함수조항 블록으로(조 일부).
 * 4. 갱신형 짝의 조건 블록에서 함수조항을 얹은 뒤 같아진 앞 · 뒤 조는 하나로 꺼낸다.
 */
function applyAutoClauses(products: readonly BuiltProduct[], candidates: readonly ClauseRecord[], clauses: ClauseRecord[], report: string[], isWaiver: (id: Id) => boolean): AutoStats {
  const docs = products.flatMap((p) => p.product.specials.filter((s) => s.auto).map((spec) => ({ spec, b: p.specials.get(spec.code)! })));
  const stats: AutoStats = { docs: docs.length, existingUses: 0, created: [], createdUses: 0, partialUses: 0, hoisted: 0 };
  const paragraphs = (list: readonly { kind: string }[]) => list.filter((c) => c.kind === "paragraph").length;
  const blockCandidates = candidates.filter((c) => c.mode === "block").map((c) => ({ c, n: paragraphs(c.body as { kind: string }[]), sels: selections(c) }));
  // 1. 기존 함수조항
  for (const { spec, b } of docs) {
    for (const a of articlesDeep(b.tree)) {
      if (!clauseSlice(a) && !a.children.some((c) => c.kind === "paragraph")) continue;
      const n = paragraphs(a.children);
      const hit = blockCandidates.some(({ c, n: m, sels }) => m === n && sels.some((sel) => applyClauseUse({ article: foldTitle(a.title), paragraph: 1, clause: c.code, options: sel }, c, () => a, `[${spec.code}]`, [], b.tree)));
      if (hit) stats.existingUses++;
    }
  }
  // 2. 남은 조 — 같은 모양(글을 지운 열쇠)끼리 조째 같은 글이거나 낱말 구간만 다르면 새 함수조항 하나(다른 낱말은 옵션 — 기능/함수조항 §3.2, 선택지 문구는 평문)
  const shapes = new Map<string, { spec: SpecialSpec; b: Built; a: ArticleNode; slice: (ParagraphNode | BoxRefNode)[] }[]>();
  for (const { spec, b } of docs) {
    for (const a of articlesDeep(b.tree)) {
      if (a.children.some((c) => c.kind === "clauseBlockRef")) continue;
      const slice = clauseSlice(a);
      if (!slice || JSON.stringify(slice).includes('"kind":"inlineCond"')) continue;
      const key = canonicalArticle(a, { withTitle: false, outside: () => "OUT", maskText: true }, slice);
      shapes.set(key, [...(shapes.get(key) ?? []), { spec, b, a, slice }]);
    }
  }
  const variants = [...shapes.values()].flatMap((list) => (list.length < 2 ? [] : wordClusters(list.map((m) => textNodesOf(m.slice).map((t) => t.text))).map((c) => ({ c, ms: c.members.map((i) => list[i]) }))));
  const sameTitle = new Map<string, number>();
  for (const g of variants) sameTitle.set(foldTitle(g.ms[0].a.title), (sameTitle.get(foldTitle(g.ms[0].a.title)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const { c, ms } of variants) {
    const title = foldTitle(ms[0].a.title);
    const k = (seen.get(title) ?? 0) + 1;
    seen.set(title, k);
    const label = sameTitle.get(title)! > 1 ? `${title}(알파Plus2607 ${k})` : `${title}(알파Plus2607)`;
    const key = `auto-${clauses.length + 1}`;
    const blocks = clauseFromSource(ms[0].b.tree, ms[0].slice, key);
    // 옵션 자리 — 첫 자리 조의 글 노드 순번 · 앞 길이로 글을 [앞, 옵션 자리, 뒤]로 가른다(함수조항 본문은 원문 자리와 같은 순서의 글 노드를 갖는다)
    const nodes = textNodesOf(blocks);
    const options = c.places.map((place, oi) => {
      const values = [...new Set(place.regions)];
      const labels = values.map((v) => (v.length > 20 ? `${[...v].slice(0, 20).join("")}…` : v));
      return {
        code: optionCode(oi),
        label: `낱말 ${oi + 1}`,
        order: oi,
        values: values.map((v, vi) => ({ code: valueCode(vi), label: labels.indexOf(labels[vi]) === vi ? labels[vi] : `${labels[vi]} ${vi + 1}`, order: vi, body: [{ id: `c-${key}-o${oi + 1}v${vi + 1}-x1`, kind: "text" as const, text: v }] })),
      };
    });
    c.places.forEach((place, oi) => {
      const node = nodes[place.at];
      const chars = [...node.text];
      const region = [...place.regions[0]];
      const parts = [
        ...(place.prefix > 0 ? [{ id: `c-${key}-w${oi}a`, kind: "text", text: chars.slice(0, place.prefix).join("") }] : []),
        { id: `c-${key}-w${oi}`, kind: "optionSlot", optionCode: optionCode(oi) },
        ...(place.prefix + region.length < chars.length ? [{ id: `c-${key}-w${oi}b`, kind: "text", text: chars.slice(place.prefix + region.length).join("") }] : []),
      ];
      const visit = (list: unknown[]): boolean => {
        const at = list.indexOf(node);
        if (at >= 0) {
          list.splice(at, 1, ...parts);
          return true;
        }
        return list.some((n) => {
          const o = n as { children?: unknown[]; items?: unknown[]; subitems?: unknown[] };
          return [o.children, o.items, o.subitems].some((x) => Array.isArray(x) && visit(x));
        });
      };
      if (!visit(blocks as unknown[])) throw new Error(`${key}: 옵션 자리 ${oi} 를 함수조항 본문에서 찾지 못했다`);
    });
    const body = reId(blocks, `c-${key}`);
    const params = articleRefParamsOf(body);
    // 문장 안 조건으로 가를 수 없는 납입면제 조 참조(특약 자체의 납입면제 조)가 든 조는 함수조항으로 두지 않는다 — 문면에서 조째 · 소제목째(guardOwnWaiver) 또는 호 · 항째(guardWaiverBlocks) 감싼다
    try {
      guardClauseWaiver({ code: key, label, mode: "block", description: "", body: structuredClone(body), options: [] }, isWaiver);
    } catch {
      seen.set(title, k - 1);
      continue;
    }
    const where = [...new Set(ms.map((m) => m.spec.code))];
    const record: ClauseRecord = {
      code: `C${String(clauses.length + 1).padStart(4, "0")}`,
      label,
      mode: "block",
      description: `알파Plus2607 특약 ${where.length}곳이 조째 같은 글이${options.length > 0 ? `고 낱말 ${options.length}자리만 다르다(옵션)` : "다"} — 변환기가 찾아 묶었다(첫 자리 ${ms[0].spec.code} 「${title}」)`,
      body,
      options,
      ...(params.length > 0 ? { params } : {}),
    };
    clauses.push(record);
    stats.created.push(record);
    ms.forEach((m, mi) => {
      const selection = Object.fromEntries(c.places.map((place, oi) => [optionCode(oi), valueCode(options[oi].values.findIndex((v) => (v.body[0] as { text: string }).text === place.regions[mi]))]));
      if (applyClauseUse({ article: foldTitle(m.a.title), paragraph: 1, clause: record.code, options: selection }, record, () => m.a, `[${m.spec.code}]`, report, m.b.tree)) stats.createdUses++;
    });
    guardClauseWaiver(record, isWaiver);
  }
  // 3. 조 일부 — 남은 조의 잇닿은 항이 함수조항(기존 · 새로 찾은 것) 하나와 같으면 그 자리만 함수조항 블록으로(제3자 합의 항 · 사망 시 소멸 항 등). 큰 함수조항부터
  const everything = [...blockCandidates, ...stats.created.map((c) => ({ c, n: paragraphs(c.body as { kind: string }[]), sels: selections(c) }))].sort((x, y) => y.n - x.n);
  for (const { spec, b } of docs) {
    for (const a of articlesDeep(b.tree)) {
      for (const p of a.children.filter((c): c is ParagraphNode => c.kind === "paragraph")) {
        if (!a.children.includes(p)) continue;
        const at = Number(/-p(\d+)$/.exec(p.id)?.[1] ?? 0);
        if (at === 0) continue;
        const rest = paragraphs(a.children.slice(a.children.indexOf(p)));
        const hit = everything.some(({ c, n, sels }) => n <= rest && sels.some((sel) => applyClauseUse({ article: foldTitle(a.title), paragraph: at, clause: c.code, options: sel }, c, () => a, `[${spec.code}]`, [], b.tree)));
        if (hit) stats.partialUses++;
      }
    }
  }
  // 4. 갱신형 짝 — 같아진 가지
  for (const { spec, b } of docs) {
    if (!spec.auto?.renewal) continue;
    stats.hoisted += collapseRenewal(b.tree, spec.idPrefix, (art) => referencedArticle(b.tree, art));
  }
  return stats;
}

/** 조 안 노드(사라져 함수조항 블록 안쪽이 된 항 포함)를 그 조 밖의 참조 · 인자 연결이 가리키는가. */
function referencedArticle(tree: DocumentNode, article: ArticleNode): boolean {
  const own = new Set(localPaths(article).keys());
  for (const [old, inner] of INNER_TARGETS) if (own.has(inner.refId)) own.add(old);
  const outside = articlesDeep(tree).filter((a) => a !== article);
  const targets = new Set([...JSON.stringify(outside).matchAll(/"articleId":"([^"]+)"/g)].map((m) => m[1]));
  return [...own].some((id) => targets.has(id));
}

/** 새 함수조항 본문의 납입면제 두 조 참조 — 「…은 제외하며, 1종 … 도 제외합니다」면 「납입면제 있음」으로 가른다. 다른 조와 섞인 나열은 그대로(남은 대상으로 찍힌다). */
function guardClauseWaiver(record: ClauseRecord, isWaiver: (id: Id) => boolean): void {
  const visit = (p: { children?: unknown[]; items?: unknown[] }) => {
    const xs = (p.children ?? []) as Array<{ kind: string; targets?: { articleId?: string }[] }>;
    const at = xs.findIndex((c) => c.kind === "articleRef" && (c.targets ?? []).length > 0 && (c.targets ?? []).every((t) => isWaiver(t.articleId ?? "")));
    if (at >= 0 && !guardExcludeSentence(p as Parameters<typeof guardExcludeSentence>[0], at)) throw new Error(`${record.code} ${record.label}: 납입면제 조 참조를 감쌀 문장을 모른다`);
    for (const it of (p.items ?? []) as { children?: unknown[] }[]) visit(it);
  };
  for (const b of record.body as { kind: string }[]) if (b.kind === "paragraph") visit(b as { children?: unknown[] });
}

/**
 * 자동 탑재 특약의 담보 · 탑재 시드 — `coverages.json` 은 손으로 쓴 것 뒤에(코드는 이어서), `products.json` 은 그 상품의 손으로 쓴 탑재 뒤에.
 * 담보명 · 갱신유형은 원문 제목, 보험금명은 소멸 조에서 읽은 것(없으면 담보명), 담보분류 · 특약 그룹은 원문 파일(특별약관 Ⅰ ~ Ⅴ) —
 * 기본 그룹(담보분류)과 맞지 않는 파일은 그 상품의 사용자 그룹이고, 상품의 그룹 목록(`groups`)은 원문 파일 순서다 (ADR-0090).
 * 갱신형 짝은 담보 하나 · 탑재 둘(갱신유형 비갱신형 · 갱신형), 갱신형만 있는 특약은 탑재 하나(갱신형).
 */
function writeAutoSeeds(products: readonly BuiltProduct[], out: (file: string, data: unknown) => void): void {
  // 자동 탑재분은 `auto: true` 로 표시한다 — 다시 쓸 때 지난번 자동 탑재분을 모두 지우고 지금 설정으로 새로 쓴다(손으로 쓴 것은 그대로)
  type Coverage = { key: string; code: string; name: string; benefitName: string; category?: string; coverageValues: { path: string; value: unknown }[]; benefitValues: unknown[]; auto?: true };
  type Group = { category: string } | { name: string; coverages: string[] };
  type Mount = { code: string; coverage: string; section: string; attributes: { kindCode: string; valueCode: string }[]; auto?: true };
  const coverages = JSON.parse(readFileSync(path.join(root, SEED_DIR, "coverages.json"), "utf8")) as Coverage[];
  const seeded = JSON.parse(readFileSync(path.join(root, SEED_DIR, "products.json"), "utf8")) as { code: string; mounts: Mount[]; groups?: Group[] }[];
  const hand = coverages.filter((c) => !c.auto);
  const next: Coverage[] = [...hand];
  for (const p of products) {
    const mounts: Mount[] = [];
    const groups: Group[] = [];
    for (const spec of p.product.specials.filter((s) => s.auto)) {
      const { category, group } = spec.auto!;
      const user = group === undefined ? undefined : groups.find((g): g is Extract<Group, { name: string }> => "name" in g && g.name === group);
      if (group !== undefined) {
        if (user) user.coverages.push(spec.ownerCoverage);
        else groups.push({ name: group, coverages: [spec.ownerCoverage] });
      } else if (!groups.some((g) => "category" in g && g.category === category)) groups.push({ category });
      const meta = p.specials.get(spec.code)!.auto!;
      const { name, renewal } = coverageNameOf(meta.title);
      const benefit = meta.claim ?? name;
      next.push({
        key: spec.ownerCoverage,
        code: `COV${String(next.length + 1).padStart(6, "0")}`,
        name,
        benefitName: benefit,
        category: spec.auto!.category,
        coverageValues: [{ path: "coverage_basic.claim_name", value: benefit }],
        benefitValues: [],
        auto: true,
      });
      const attr = (v: string) => [{ kindCode: "A0001", valueCode: v }];
      const mount = (code: string, attributes: Mount["attributes"]): Mount => ({ code, coverage: spec.ownerCoverage, section: "special", attributes, auto: true });
      if (spec.auto!.renewal) mounts.push(mount(spec.ownerCoverage, attr("1")), mount(`${spec.ownerCoverage}-renew`, attr("2")));
      else mounts.push(mount(spec.ownerCoverage, renewal ? attr("2") : []));
    }
    const product = seeded.find((x) => x.code === p.product.code);
    if (product) {
      product.mounts = [...product.mounts.filter((m) => !m.auto), ...mounts];
      if (groups.some((g) => "name" in g)) product.groups = groups;
      else delete product.groups;
    }
  }
  out("coverages.json", next);
  out("products.json", seeded);
}

/** 함수조항 비교용 정규형 — 공백을 지운 JSON (원문 대조가 공백을 보지 않는다). */
function canonicalClause(clause: ClauseRecord): string {
  return JSON.stringify(clause).replace(/\s+/g, "");
}

/**
 * 쓰지 않는 박스를 빼고 남은 것의 코드를 앞에서부터 다시 매긴다. `holders` 의 박스 참조 코드를 제자리에서 고친다.
 * 순서는 그대로이되 `front`(보통약관 · 보통약관이 쓰는 함수조항)가 놓는 박스를 앞으로 — 보통약관 자리가 함수조항으로 바뀌어 보통약관이 더 쓰지 않게 된
 * 박스를 뒤 특약(자동 탑재)이 함께 쓰면 그 박스는 특약 몫이라 뒤로 간다(보통약관이 놓는 박스는 앞 코드 — 화면 E2E 바탕이 앞에서부터 넣는다).
 */
export function compactBoxes<T extends { code: string }>(records: readonly T[], holders: unknown[], front: unknown[] = [], plannedFront: ReadonlySet<string> = new Set()): T[] {
  const codesIn = (x: unknown) => new Set([...JSON.stringify(x).matchAll(/"boxCode":"(BX\d+)"/g)].map((m) => m[1]));
  const used = codesIn(holders);
  const first = codesIn(front);
  const rest = records.filter((r) => used.has(r.code) && !first.has(r.code));
  // 보통약관 몫으로 앞에 두었다가 보통약관이 더 쓰지 않게 된 박스(`plannedFront`)는 맨 뒤 — 그사이 특약 박스의 코드를 밀지 않는다
  const kept = [...records.filter((r) => first.has(r.code)), ...rest.filter((r) => !plannedFront.has(r.code)), ...rest.filter((r) => plannedFront.has(r.code))];
  const rename = new Map(kept.map((r, i) => [r.code, `BX${String(i + 1).padStart(6, "0")}`]));
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (typeof o.boxCode === "string" && rename.has(o.boxCode)) o.boxCode = rename.get(o.boxCode);
    Object.values(o).forEach(visit);
  };
  visit(holders);
  return kept.map((r) => ({ ...r, code: rename.get(r.code)! }));
}

/** 보통약관 조를 가리키는 함수조항인가 — 범위 없는 조 참조가 있다 (제 항 · 사용처 위치 참조는 보통약관 없이도 성립한다). */
function refsGeneralArticle(clause: ClauseRecord): boolean {
  const visit = (n: unknown): boolean => {
    if (Array.isArray(n)) return n.some(visit);
    if (!n || typeof n !== "object") return false;
    const node = n as Record<string, unknown>;
    if (node.kind === "articleRef" && node.scope === undefined) return true;
    return Object.values(node).some(visit);
  };
  return visit(clause.body) || visit(clause.options);
}

/**
 * 함수조항 코드를 적재 순서로 매긴다 — 보통약관이 쓰는 것 · 담보약관만 쓰는 것 · 보통약관 조를 가리키는 것 (각각 설정 순).
 * 보통약관 가져오기는 쓰는 함수조항이 있어야, 보통약관 조를 가리키는 함수조항은 그 조가 있어야 검사 ① 을 통과한다.
 */
function orderClauses(configured: readonly { key: string; record: ClauseRecord }[], generalKeys: ReadonlySet<string>, appended: ReadonlySet<string>): ClauseRecord[] {
  const early = configured.filter((c) => !appended.has(c.key) || generalKeys.has(c.key));
  const ordered: ClauseRecord[] = [
    ...early.filter((c) => generalKeys.has(c.key)).map((c) => c.record),
    ...early.filter((c) => !generalKeys.has(c.key) && !refsGeneralArticle(c.record)).map((c) => c.record),
    ...early.filter((c) => !generalKeys.has(c.key) && refsGeneralArticle(c.record)).map((c) => c.record),
    // 뒤에 더한 상품이 처음 쓰는 함수조항 — 맨 뒤(앞 코드를 밀지 않는다). 담보약관만 쓰므로 보통약관 뒤에 만들어도 된다
    ...configured.filter((c) => appended.has(c.key) && !generalKeys.has(c.key)).map((c) => c.record),
  ];
  ordered.forEach((c, i) => (c.code = `C${String(i + 1).padStart(4, "0")}`));
  return ordered;
}

/**
 * 박스 코드를 적재 순서로 매긴다 — 보통약관이 쓰는 박스(첫 등장 순) → 담보약관만 쓰는 박스.
 * 화면 E2E 바탕(`SEED_PROFILE=base`)은 보통약관이 쓰는 박스를 보통약관과 함께 시드로 넣고, 나머지는 화면으로 친다(BX 앞 코드부터).
 */
function orderBoxes(plans: readonly BoxPlan[]): BoxPlan[] {
  const general = (b: BoxPlan) => b.sites.some((s) => s.general);
  const ordered = [...plans.filter(general), ...plans.filter((b) => !general(b))];
  ordered.forEach((b, i) => (b.record.code = `BX${String(i + 1).padStart(6, "0")}`));
  return ordered;
}

/**
 * 시드 적재 순서 검사 — 함수조항 코드는 시스템 채번(배열 순서)이고, 적재는 「보통약관이 쓰는 함수조항 → 보통약관 → 보통약관 조를 가리키는 함수조항」 순이다
 * (보통약관 가져오기는 쓰는 함수조항이 있어야 · 보통약관 조를 가리키는 함수조항은 그 조가 있어야 검사 ① 을 통과한다).
 * 그래서 보통약관이 쓰는 함수조항은 보통약관 조를 가리키는 어느 함수조항보다 앞 코드여야 한다.
 */
function checkClauseOrder(clauses: readonly ClauseRecord[], generals: readonly { tree: DocumentNode }[]): void {
  const usedByGeneral = new Set(generals.flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"clauseCode":"(C\d+)"/g)].map((m) => m[1])));
  // 보통약관이 쓰면서 보통약관 조를 가리키는 함수조항(역할 함수조항 — 가리키기 순환, 결정 12)은 적재가 두 번에 나눠 만든다(load.ts) — 순서 검사에서 뺀다
  const firstGeneralRef = clauses.findIndex((c) => refsGeneralArticle(c) && !usedByGeneral.has(c.code));
  if (firstGeneralRef < 0) return;
  // 화면 E2E 바탕(SEED_PROFILE=base)은 보통약관이 쓰는 함수조항을 앞에서부터 그 개수만큼 만든다 — 앞 코드에 모여 있어야 한다
  const prefix = clauses.slice(0, usedByGeneral.size).map((c) => c.code);
  if (prefix.some((code) => !usedByGeneral.has(code))) throw new Error(`보통약관이 쓰는 함수조항(${[...usedByGeneral].join(", ")})이 C0001 부터 잇닿아 있지 않다 — CLAUSES 순서를 고친다`);
  const late = clauses.slice(firstGeneralRef).filter((c) => usedByGeneral.has(c.code));
  if (late.length > 0) throw new Error(`보통약관이 쓰는 함수조항 ${late.map((c) => c.code).join(", ")} 이 보통약관 조를 가리키는 함수조항 ${clauses[firstGeneralRef].code} 뒤에 있다 — CLAUSES 순서를 고친다`);
}


/**
 * 함수조항 한 건 — 원문 자리(`from`)의 항 본문(호 · 목 포함, 잇닿은 항 여럿)을 따거나 평문(`text`)을 변환한다.
 * 원문 자리의 자기 조 참조는 제 항 · 조 참조 인자가 되고(`clauseFromSource` — 인자 선언도 여기서), 낱말 옵션은 `place` 자리에 선다.
 * 평문 · 선택지 문구의 참조는 `product` 상품의 별표 번호 · 보통약관 색인으로 푼다.
 */
function buildClause(spec: (typeof CLAUSES)[number], built: Map<string, Built>, products: readonly BuiltProduct[], report: string[]): ClauseRecord {
  // 노드 id 접두는 설정 이름에서 — 코드는 나중에 적재 순서로 매긴다(orderClauses)
  const prefix = `c-${spec.key}`;
  const owner = products.find((p) => p.product.code === (spec.product ?? "alpha"));
  if (!owner) throw new Error(`${spec.key}: 상품 ${spec.product} 없음`);
  const empty = { byNumber: new Map() };
  const convert = (text: string, newId: () => Id) =>
    inlinesFromText(text, { self: empty, general: owner.general.index, appendixByNumber: owner.product.appendixNumbers, currentArticleId: `${prefix}-a`, report }, newId);
  const options = (spec.options ?? []).map((o, oi) => ({
    code: optionCode(oi),
    label: o.label,
    order: oi,
    values: o.values.map((v, vi) => ({ code: valueCode(vi), label: v.label, order: vi, body: inlineBody(v.text, `${prefix}-o${oi + 1}v${vi + 1}`, convert) })),
  }));
  let body: ClauseRecord["body"];
  if (spec.from) {
    const { spec: source, article, paragraph = 1 } = spec.from;
    const b = built.get(source);
    const a = b && [...articlesOf(b.tree)].find((x) => b.numberOf.get(x.id) === article);
    const at = a ? a.children.findIndex((c) => c.kind === "paragraph" && c.id === `${a.id}-p${paragraph}`) : -1;
    // 항 수를 안 주면 그 항부터 조의 끝까지의 항 전부 — 조째 함수조항. 항 사이의 박스 참조는 함께 품고, 마지막 항 뒤(조 끝) 박스는 사용처에 남긴다
    const rest = a && at >= 0 ? a.children.slice(at) : [];
    const paragraphs = spec.from.paragraphs ?? rest.filter((c) => c.kind === "paragraph").length;
    let seen = 0;
    const end = rest.findIndex((c) => c.kind === "paragraph" && ++seen === paragraphs);
    const taken = end >= 0 ? rest.slice(0, end + 1) : [];
    if (!b || taken.filter((c) => c.kind === "paragraph").length !== paragraphs || taken.some((c) => c.kind !== "paragraph" && c.kind !== "boxRef")) throw new Error(`${spec.key}: 원문 자리 ${source} 조 ${article} 제${paragraph}항부터 잇닿은 항 ${paragraphs}개 없음 (사이에 표가 끼면 조째 딸 수 없다)`);
    const blocks = clauseFromSource(b.tree, taken as (ParagraphNode | BoxRefNode)[], spec.key);
    placeOptions(blocks, spec.place ?? [], spec.key);
    body = reId(blocks, prefix);
  } else {
    const inline = inlineBody(spec.text!, prefix, convert);
    body = spec.mode === "inline" ? inline : [{ id: `${prefix}-p1`, kind: "paragraph", children: inline }];
  }
  // 조 참조 인자 — 원문 자리 밖을 가리키던 조 참조마다(같은 대상은 하나), 사용처가 대상을 연결한다 (ADR-0083 결정 8)
  const params = articleRefParamsOf(body);
  return { code: "", label: spec.label, mode: spec.mode, description: spec.description, body, options, ...(params.length > 0 ? { params } : {}) };
}

/**
 * 자동 탑재 특약의 보험금명 슬롯 — 「특별약관의 소멸」 조(갱신형 짝이면 두 가지 모두)의 첫 항 「[제1조(보험금의 지급사유)]에서 정한 ○○ 지급사유가 …」의 ○○ 를
 * 담보 값 슬롯(D0001)으로 바꾼다 — 함수조항 「특별약관의 소멸(지급사유 발생)」 본문의 슬롯과 맞는다. 처음 읽은 보험금명을 돌려준다(담보 값이 된다).
 */
function applyClaimSlots(tree: DocumentNode, report: string[], where: string): string | undefined {
  let claim: string | undefined;
  for (const a of articlesDeep(tree)) {
    if (foldTitle(a.title) !== "특별약관의 소멸") continue;
    const p = a.children.find((c): c is ParagraphNode => c.kind === "paragraph");
    if (!p) continue;
    const at = p.children.findIndex((n, i) => n.kind === "text" && i > 0 && p.children[i - 1].kind === "articleRef" && claimOf(n.text) !== undefined);
    if (at < 0) continue;
    const node = p.children[at] as Extract<InlineNode, { kind: "text" }>;
    const found = claimOf(node.text)!;
    if (claim !== undefined && found !== claim) {
      report.push(`[${where}] 소멸 조의 보험금명이 둘이다 — 「${claim}」 · 「${found}」(앞의 것을 담보 값으로)`);
      continue;
    }
    claim = found;
    const i = node.text.indexOf(found);
    p.children.splice(at, 1, { id: `${node.id}a`, kind: "text", text: node.text.slice(0, i) }, { id: `${node.id}s`, kind: "slot", ref: "D0001" }, { id: `${node.id}b`, kind: "text", text: node.text.slice(i + found.length) });
  }
  return claim;
}

/**
 * 다른 원문의 조 하나를 문면의 `before` 조 앞에 넣는다(설정 `extraArticles` — 갱신형 원문에만 있는 보험기간 조). 넣은 조의 노드 id 는 `<접두>x-a<번호>`,
 * 원문 번호는 `x<번호>`. 조 안 참조는 넣은 조 자신 · 대응 보통약관만 풀린다(보험기간 조에는 참조가 없다).
 */
function insertExtraArticle(built: Built, extra: NonNullable<SpecialSpec["extraArticles"]>[number], general: Built, product: ProductTerms, report: string[], where: string): void {
  const parsed = parseTerms(readFileSync(path.join(root, "tests/fixtures/terms", extra.file), "utf8"));
  const source = parsed.sections.flatMap((s) => s.articles).find((a) => a.number === extra.article);
  if (!source) throw new Error(`${where}: ${extra.file} 에 제${extra.article}조 없음`);
  const one = buildStructure({ title: parsed.title, sections: [{ title: "", articles: [source] }] }, `${built.tree.id.replace(/-doc$/, "")}x`, parsed.title);
  convertText(one, general.index, product.appendixNumbers, report);
  const article = one.tree.children[0] as ArticleNode;
  const at = built.tree.children.findIndex((c) => c.kind === "article" && built.numberOf.get(c.id) === extra.before);
  if (at < 0) throw new Error(`${where}: 넣을 자리 제${extra.before}조 없음`);
  built.tree.children.splice(at, 0, article);
  built.numberOf.set(article.id, `x${extra.article}`);
}

function buildSpecial(spec: SpecialSpec, product: ProductTerms, generalParsed: ParsedDoc, general: Built, report: string[]): Built {
  let built: Built;
  if (spec.extractFrom) {
    const source = spec.extractFrom.file === product.general.file ? generalParsed : parseTerms(read(product, spec.extractFrom.file));
    const wanted = new Set(spec.extractFrom.articles);
    const flat: ParsedDoc = { title: spec.title ?? source.title, sections: [{ title: "", articles: source.sections.flatMap((s) => s.articles).filter((a) => wanted.has(a.number)) }] };
    built = buildStructure(flat, spec.idPrefix, flat.title);
    // 기본계약 문면 안의 자기 참조(제3조 → 제1조 자리)는 self 색인으로 풀린다 — 원문 번호를 그대로 쓴다
    convertText(built, general.index, product.appendixNumbers, report);
    const articles = [...articlesOf(built.tree)];
    spec.extractFrom.articles.forEach((number, i) => {
      const target = general.index.byNumber.get(spec.extractFrom!.linkTo[i]);
      const a = articles.find((x) => built.numberOf.get(x.id) === number);
      if (a && target) a.linkedArticleId = target.id;
      else report.push(`조연결 실패: ${spec.code} 조 ${number} → 보통약관 ${spec.extractFrom!.linkTo[i]}`);
    });
  } else {
    const parsed = parseTerms(read(product, spec.file!));
    built = buildStructure(parsed, spec.idPrefix, spec.title ?? parsed.title, undefined, { restartGroups: Boolean(spec.auto) });
    applyInlineConds(built.tree, built.numberOf, spec.inlineConds ?? [], report);
    applyInlineClauses(built.tree, built.numberOf, spec.inlineClauses ?? [], report);
    // 자동 탑재 특약은 「보통약관 」이 빠진 보통약관 조 참조도 푼다(refs.ts generalFallback)
    convertText(built, general.index, product.appendixNumbers, report, Boolean(spec.auto));
    for (const extra of spec.extraArticles ?? []) insertExtraArticle(built, extra, general, product, report, spec.code);
    if (spec.auto) {
      built.auto = { title: parsed.title };
      // 갱신형 짝 — 두 원문을 따로 변환(참조는 제 문서 안에서 풀린다)한 뒤 템플릿 한 벌로 합친다(auto.ts mergeRenewal)
      if (spec.auto.renewal) {
        const renewalParsed = parseTerms(read(product, spec.auto.renewal));
        const renewal = buildStructure(renewalParsed, `${spec.idPrefix}r`, renewalParsed.title, undefined, { restartGroups: true });
        convertText(renewal, general.index, product.appendixNumbers, report, true);
        built.tree = mergeRenewal(built.tree, renewal.tree, RENEWAL, spec.idPrefix);
        if (renewal.waiverBlocks) built.waiverBlocks = new Set([...(built.waiverBlocks ?? []), ...renewal.waiverBlocks]);
        for (const [id, n] of renewal.numberOf) built.numberOf.set(id, `r${n}`);
        built.auto.renewalTitle = renewalParsed.title;
      }
      built.auto.claim = applyClaimSlots(built.tree, report, spec.code);
    }
  }
  applySlots(built, spec.slots, report);
  reportLeftovers(built, `[${spec.code}]`, report);
  return built;
}

// 직접 실행할 때만 (분석 스크립트가 구조 함수를 가져다 쓴다)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
