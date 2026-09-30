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

import type { ArticleNode, BlockNode, BoxNode, DocumentNode, InlineNode, ParagraphNode, SectionNode, TableNode } from "../../src/domain/document/nodes";
import { indexTree, validateTree } from "../../src/domain/document/nodes";
import { referenceKeysOf, targetOfNode, withCodes } from "../../src/domain/document/pcode";
import type { RefTarget } from "../../src/domain/document/nodes";
import { clauseCodeEntries, withClauseCodes } from "../../src/domain/clause/pcode";
import type { ArticleRefNode as ClauseArticleRef } from "../../src/domain/clause/nodes";
import type { Id } from "../../src/domain/types";
import { boxSites, planBoxes, replaceBox, type BoxPlan } from "./boxes";
import type { Discriminator } from "../../src/domain/catalog/types";
import { applyClauseUse, clauseFromSource, inlineBody, optionCode, parameterize, placeOptions, reId, valueCode, type ClauseRecord } from "./clauses";
import { APPENDICES, CLAUSES, PRODUCTS, SEED_DIR, type ClauseUse, type ProductTerms, type SlotOverlay, type SpecialSpec } from "./config";
import { parseTerms, type ParsedArticle, type ParsedDoc } from "./parse";
import { applyArticleConds, applyInlineConds, articlesOf } from "./overlay";
import { inlinesFromText, leftoverReferences, type ArticleEntry, type ArticleIndex, type RefEnv } from "./refs";

const root = process.cwd();
const read = (product: ProductTerms, file: string) => readFileSync(path.join(root, product.fixtureDir, file), "utf8");
const numberId = (n: string) => n.replace("의", "_");

export interface Built {
  tree: DocumentNode;
  index: ArticleIndex;
  /** 조 id → 원문 번호 (슬롯 오버레이가 조를 찾을 때). */
  numberOf: Map<Id, string>;
}

/** 표 셀을 인라인 노드로 — 1차에서는 평문 텍스트 하나, 2차(convertText)가 참조를 슬롯으로 바꾼다. */
function textCell(id: Id, text: string): InlineNode[] {
  return [{ id, kind: "text", text }];
}

/** 1차 — 구조 노드. 텍스트는 아직 평문(text 노드 하나)으로 둔다. */
export function buildStructure(doc: ParsedDoc, prefix: string, title: string, articleFilter?: (a: ParsedArticle) => boolean): Built {
  const index: ArticleIndex = { byNumber: new Map() };
  const numberOf = new Map<Id, string>();
  const withSections = doc.sections.length > 1 || doc.sections[0]?.title !== "";

  const article = (a: ParsedArticle): ArticleNode => {
    const aid = `${prefix}-a${numberId(a.number)}`;
    const entry: ArticleEntry = { id: aid, title: a.title, paragraphIds: [], itemIds: new Map() };
    const children: BlockNode[] = [];
    let paragraph: ParagraphNode | undefined;
    let item: { id: Id } | undefined;
    let staticSeq = 0;
    for (const line of a.body) {
      if (line.kind === "paragraph") {
        const pid = `${aid}-p${entry.paragraphIds.length + 1}`;
        paragraph = { id: pid, kind: "paragraph", children: [{ id: `${pid}-x0`, kind: "text", text: line.text }] };
        entry.paragraphIds.push(pid);
        entry.itemIds.set(pid, []);
        children.push(paragraph);
        item = undefined;
        continue;
      }
      if (!paragraph) throw new Error(`항 없이 ${line.kind} 이 왔다: ${a.title}`);
      if (line.kind === "item") {
        const items = entry.itemIds.get(paragraph.id)!;
        const iid = `${paragraph.id}-i${items.length + 1}`;
        items.push(iid);
        (paragraph.items ??= []).push({ id: iid, kind: "item", children: [{ id: `${iid}-x0`, kind: "text", text: line.text }] });
        item = { id: iid };
        continue;
      }
      if (line.kind === "subitem") {
        if (!item) throw new Error(`호 없이 목이 왔다: ${a.title}`);
        const owner = (paragraph.items ?? []).find((n): n is Extract<typeof n, { kind: "item" }> => n.kind === "item" && n.id === item!.id)!;
        const uid = `${item.id}-u${(owner.subitems?.length ?? 0) + 1}`;
        (owner.subitems ??= []).push({ id: uid, kind: "subitem", children: [{ id: `${uid}-x0`, kind: "text", text: line.text }] });
        continue;
      }
      // 표·박스 — 항에 호가 있으면 그 항의 목록 자리에, 아니면 조 직속에 (렌더 순서는 같다)
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
          : { id: `${aid}-b${staticSeq}`, kind: "box", title: line.title, lines: line.lines };
      if (paragraph.items && paragraph.items.length > 0) paragraph.items.push(node);
      else children.push(node);
    }
    index.byNumber.set(a.number, entry);
    numberOf.set(aid, a.number);
    return { id: aid, kind: "article", title: a.title, children };
  };

  const top: DocumentNode["children"] = [];
  doc.sections.forEach((s, si) => {
    const articles = s.articles.filter((a) => !articleFilter || articleFilter(a)).map(article);
    if (withSections) {
      const section: SectionNode = { id: `${prefix}-s${si + 1}`, kind: "section", title: s.title, children: articles };
      top.push(section);
    } else top.push(...articles);
  });
  return { tree: { id: `${prefix}-doc`, kind: "document", title, children: top }, index, numberOf };
}

/** 2차 — 항·호·목의 평문을 인라인 노드로. 조건 가지 안의 평문도 같은 규칙으로 (가지 id 기준 채번). */
export function convertText(built: Built, general: ArticleIndex | undefined, appendixByNumber: Map<number, string>, report: string[]): void {
  for (const a of articlesOf(built.tree)) {
    const env: RefEnv = { self: built.index, general, appendixByNumber, currentArticleId: a.id, report };
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
  for (const a of articlesOf(built.tree)) {
    const walk = (owner: { children: InlineNode[] }) => {
      for (const n of owner.children) {
        if (n.kind === "inlineCond") {
          for (const branch of n.branches) walk(branch);
          continue;
        }
        if (n.kind !== "text") continue;
        for (const found of leftoverReferences(n.text)) report.push(`${label} 조 「${a.title}」 에 조 참조 평문이 남음: ${found}…`);
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

/** 문면의 조 참조 대상을 (조, P코드)로 — 자기 참조는 이 트리, 보통약관 참조는 대응 보통약관. P코드를 매긴 뒤에 부른다. */
function codeTargets(tree: DocumentNode, generalTree: DocumentNode | undefined, where: string): void {
  const own = indexTree(tree);
  const general = generalTree ? indexTree(generalTree) : undefined;
  for (const e of own.nodes.values()) {
    const n = e.node;
    if (n.kind !== "articleRef") continue;
    const ix = n.scope === "self" ? own : general;
    if (!ix) throw new Error(`${where}: 대응 보통약관 없이 보통약관 참조가 있다`);
    n.targets = n.targets.map((t) => targetOfId(ix, t.articleId, where));
  }
}

/** 함수조항 본문의 조 참조 대상 — 보통약관(노드 id → 조 · P코드) · 이 함수조항(본문 노드 id → 제 코드) · 사용처(경로 → `{ host }`). */
function codeClauseTargets(clause: ClauseRecord, generals: ReturnType<typeof indexTree>[]): ClauseRecord {
  const body = withClauseCodes(clause.body);
  const own = clauseCodeEntries(body).entries;
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.kind === "articleRef") {
      const r = n as unknown as ClauseArticleRef;
      r.targets = r.targets.map((t) => {
        const id = t.articleId ?? "";
        if (r.scope === "host") return { host: id };
        if (r.scope === "clause") {
          const code = own.find((e) => e.id === id)?.code;
          if (!code) throw new Error(`${clause.code}: 「이 함수조항」 참조 대상 ${id} 의 P코드가 없다`);
          return { code };
        }
        const ix = generals.find((g) => g.nodes.has(id));
        if (!ix) throw new Error(`${clause.code}: 보통약관 참조 대상 ${id} 가 보통약관에 없다`);
        return targetOfId(ix, id, clause.code);
      });
    }
    for (const key of ["children", "items", "subitems", "branches"]) {
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

  // ── 함수조항(조 · 여러 항, 설정)과 박스(원문의 박스 전부 → 정적 마스터)를 만들고, 적재 순서로 코드를 매긴다
  const configured = CLAUSES.map((c) => ({ key: c.key, record: buildClause(c, built, products, report) }));
  const sites = products.flatMap((p) => [
    ...boxSites(p.general.tree, { doc: p.product.general.code, product: p.product.code, general: true }),
    ...p.product.specials.flatMap((spec) => boxSites(p.specials.get(spec.code)!.tree, { doc: spec.code, product: p.product.code, general: false })),
  ]);
  const boxes = orderBoxes(planBoxes(sites));
  const clauses = orderClauses(configured, new Set(products.flatMap((p) => (p.product.general.clauses ?? []).map((u) => u.clause))));
  const clauseByKey = new Map(configured.map((c) => [c.key, c.record]));
  // 박스 자리 → 박스 참조 (같은 목록 자리)
  for (const plan of boxes) for (const site of plan.sites) replaceBox(site, plan.record.code);
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
  for (const p of products) {
    codeTargets(p.general.tree, undefined, p.product.general.code);
    for (const spec of p.product.specials) codeTargets(p.specials.get(spec.code)!.tree, p.general.tree, spec.code);
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

  // ── 출력
  const out = (file: string, data: unknown) => writeFileSync(path.join(root, SEED_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
  out("appendices.json", APPENDICES.map((a) => ({ code: a.code, name: a.name, description: "" })));
  out("generals.json", generals);
  out("documents.json", documents);
  out("boxes.json", boxes.map((b) => b.record));
  // 함수조항은 구분자를 직접 읽지 않고 인자만 읽는다 (최종 결정 2) — 직접 읽기를 「인자 + 기본 연결 = 그 구분자」로 기계 변환한다.
  // 구분자 카탈로그는 손으로 적는 시드(discriminators.json)다. 사용처는 기본 연결을 쓰므로 조립 결과가 그대로다
  const catalog = JSON.parse(readFileSync(path.join(root, SEED_DIR, "discriminators.json"), "utf8")) as Discriminator[];
  const generalIndexes = products.map((p) => indexTree(p.general.tree));
  out("clauses.json", clauses.map((c) => codeClauseTargets(parameterize(c, catalog), generalIndexes)));

  const stats = (tree: DocumentNode) => {
    const ix = indexTree(tree);
    const count = (kind: string) => [...ix.nodes.values()].filter((e) => e.node.kind === kind).length;
    return `관 ${count("section")} · 조 ${count("article")} · 항 ${count("paragraph")} · 호 ${count("item")} · 목 ${count("subitem")} · 표 ${count("table")} · 박스 ${count("boxRef")} · 조참조 ${count("articleRef")} · 별표참조 ${count("appendixRef")} · 슬롯 ${count("slot")} · 조건 ${count("condBlock")}/${count("inlineCond")} · 함수조항 ${count("clauseInlineRef") + count("clauseBlockRef")}`;
  };
  const all = [...generals, ...documents];
  for (const g of generals) console.log(`[general] ${g.tree.title}: ${stats(g.tree)}`);
  for (const d of documents) console.log(`[special] ${d.tree.title}: ${stats(d.tree)}`);
  for (const b of boxes) console.log(`[box] ${b.record.code} ${b.record.name} — 쓰임 ${b.sites.length}`);
  for (const c of clauses) console.log(`[clause] ${c.code} ${c.label} (${c.mode}) — 쓰임 ${all.reduce((n, d) => n + JSON.stringify(d.tree).split(`"clauseCode":"${c.code}"`).length - 1, 0)}`);
  for (const line of report) console.log(`[report] ${line}`);
  for (const line of issues) console.log(`[invalid] ${line}`);
  if (issues.length > 0) process.exit(1);
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
function orderClauses(configured: readonly { key: string; record: ClauseRecord }[], generalKeys: ReadonlySet<string>): ClauseRecord[] {
  const ordered: ClauseRecord[] = [
    ...configured.filter((c) => generalKeys.has(c.key)).map((c) => c.record),
    ...configured.filter((c) => !generalKeys.has(c.key) && !refsGeneralArticle(c.record)).map((c) => c.record),
    ...configured.filter((c) => !generalKeys.has(c.key) && refsGeneralArticle(c.record)).map((c) => c.record),
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
  const firstGeneralRef = clauses.findIndex(refsGeneralArticle);
  if (firstGeneralRef < 0) return;
  // 화면 E2E 바탕(SEED_PROFILE=base)은 보통약관이 쓰는 함수조항을 앞에서부터 그 개수만큼 만든다 — 앞 코드에 모여 있어야 한다
  const prefix = clauses.slice(0, usedByGeneral.size).map((c) => c.code);
  if (prefix.some((code) => !usedByGeneral.has(code))) throw new Error(`보통약관이 쓰는 함수조항(${[...usedByGeneral].join(", ")})이 C0001 부터 잇닿아 있지 않다 — CLAUSES 순서를 고친다`);
  const late = clauses.slice(firstGeneralRef).filter((c) => usedByGeneral.has(c.code));
  if (late.length > 0) throw new Error(`보통약관이 쓰는 함수조항 ${late.map((c) => c.code).join(", ")} 이 보통약관 조를 가리키는 함수조항 ${clauses[firstGeneralRef].code} 뒤에 있다 — CLAUSES 순서를 고친다`);
}


/**
 * 함수조항 한 건 — 원문 자리(`from`)의 항 본문(호 · 목 포함, 잇닿은 항 여럿)을 따거나 평문(`text`)을 변환한다.
 * 원문 자리의 자기 조 참조는 제 항 · 사용처 위치가 되고(`clauseFromSource`), 낱말 옵션은 `place` 자리에 선다.
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
    // 항 수를 안 주면 그 항부터 조의 끝까지의 항 전부 — 조째 함수조항
    const paragraphs = spec.from.paragraphs ?? (a ? a.children.slice(Math.max(at, 0)).filter((c) => c.kind === "paragraph").length : 0);
    const taken = a && at >= 0 ? a.children.slice(at, at + paragraphs) : [];
    if (!b || taken.length !== paragraphs || taken.some((c) => c.kind !== "paragraph")) throw new Error(`${spec.key}: 원문 자리 ${source} 조 ${article} 제${paragraph}항부터 잇닿은 항 ${paragraphs}개 없음 (사이에 표 · 박스가 끼면 조째 딸 수 없다)`);
    const blocks = clauseFromSource(b.tree, taken as ParagraphNode[], spec.key);
    placeOptions(blocks, spec.place ?? [], spec.key);
    body = reId(blocks, prefix);
  } else {
    const inline = inlineBody(spec.text!, prefix, convert);
    body = spec.mode === "inline" ? inline : [{ id: `${prefix}-p1`, kind: "paragraph", children: inline }];
  }
  return { code: "", label: spec.label, mode: spec.mode, description: spec.description, body, options };
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
    built = buildStructure(parsed, spec.idPrefix, spec.title ?? parsed.title);
    applyInlineConds(built.tree, built.numberOf, spec.inlineConds ?? [], report);
    convertText(built, general.index, product.appendixNumbers, report);
  }
  applySlots(built, spec.slots, report);
  reportLeftovers(built, `[${spec.code}]`, report);
  return built;
}

// 직접 실행할 때만 (분석 스크립트가 구조 함수를 가져다 쓴다)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
