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
 * 6. 공용조항(`CLAUSES`)을 만들고 — 평문에서, 또는 원문 한 자리(`from`)에서 — 담보약관의 쓰임 자리를 참조로 바꾼다 (`clauses.ts`).
 * 7. 조 자리 조건 오버레이(`articleConds`)를 얹고 `validateTree` 로 검증한 뒤 `src/db/seed/data/{generals,documents,appendices,clauses}.json` 을 쓴다.
 *
 * 변환하지 못한 참조는 `[report]` 로 stdout 에 남긴다 — 사람이 본다 (법령 인용은 의도된 미변환).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ArticleNode, BlockNode, BoxNode, DocumentNode, InlineNode, ParagraphNode, SectionNode, TableNode } from "../../src/domain/document/nodes";
import { indexTree, validateTree } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";
import { applyClauseUse, inlineBody, optionCode, reId, toClauseInline, valueCode, type ClauseRecord } from "./clauses";
import { APPENDICES, CLAUSES, FIXTURE_DIR, GENERAL, SEED_DIR, SPECIALS, type SlotOverlay, type SpecialSpec } from "./config";
import { parseTerms, type ParsedArticle, type ParsedDoc } from "./parse";
import { applyArticleConds, applyInlineConds, articlesOf } from "./overlay";
import { inlinesFromText, leftoverReferences, type ArticleEntry, type ArticleIndex, type RefEnv } from "./refs";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, FIXTURE_DIR, file), "utf8");
const appendixByNumber = new Map(APPENDICES.map((a) => [a.number, a.code]));
const numberId = (n: string) => n.replace("의", "_");

interface Built {
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
function buildStructure(doc: ParsedDoc, prefix: string, title: string, articleFilter?: (a: ParsedArticle) => boolean): Built {
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
function convertText(built: Built, general: ArticleIndex | undefined, report: string[]): void {
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
  const generalRefs = new Set<Id>();
  if (generalTree) {
    for (const e of indexTree(generalTree).nodes.values()) {
      if (e.node.kind === "article") generalIds.add(e.node.id);
      if (["article", "paragraph", "item", "subitem"].includes(e.node.kind)) generalRefs.add(e.node.id);
    }
  }
  const issues = validateTree(tree, {
    kind,
    ...(kind === "special" ? { generalArticleIds: generalIds, generalReferenceIds: generalRefs } : {}),
    appendixExists: (code) => APPENDICES.some((a) => a.code === code),
  });
  return issues.map((i) => `${i.kind}: ${i.message} @ ${(i.at.nodePath ?? []).join("/")}`);
}

function main(): void {
  const report: string[] = [];

  // ── 보통약관
  const generalParsed = parseTerms(read(GENERAL.file));
  const general = buildStructure(generalParsed, GENERAL.idPrefix, generalParsed.title);
  convertText(general, undefined, report);
  reportLeftovers(general, "[보통약관]", report);
  for (const a of articlesOf(general.tree)) {
    if (GENERAL.emptyArticles.includes(general.numberOf.get(a.id) ?? "")) a.children = [];
  }
  const generalIssues = validate(general.tree, "general");

  // ── 담보약관 (구조 · 조건 · 참조 · 슬롯)
  const built = new Map<string, Built>();
  for (const spec of SPECIALS) built.set(spec.code, buildSpecial(spec, generalParsed, general, report));

  // ── 공용조항 — 본문을 만들고 담보약관의 쓰임 자리를 참조로
  const clauses = CLAUSES.map((c) => buildClause(c, built, general, report));
  const clauseByCode = new Map(clauses.map((c) => [c.code, c]));
  for (const spec of SPECIALS) {
    const b = built.get(spec.code)!;
    const articleOf = (number: string) => [...articlesOf(b.tree)].find((x) => b.numberOf.get(x.id) === number);
    for (const u of spec.clauses ?? []) {
      const clause = clauseByCode.get(u.clause);
      if (!clause) throw new Error(`${spec.code}: 공용조항 ${u.clause} 정의 없음`);
      applyClauseUse(u, clause, articleOf, `[${spec.code}]`, report);
    }
  }

  // ── 조 자리 조건 · 검증
  const documents: { code: string; ownerCoverage: string; general: string; tree: DocumentNode }[] = [];
  const specialIssues: string[] = [];
  for (const spec of SPECIALS) {
    const b = built.get(spec.code)!;
    applyArticleConds(b.tree, b.numberOf, spec.articleConds ?? [], report);
    specialIssues.push(...validate(b.tree, "special", general.tree).map((l) => `${spec.code}: ${l}`));
    documents.push({ code: spec.code, ownerCoverage: spec.ownerCoverage, general: GENERAL.code, tree: b.tree });
  }

  // ── 출력
  const out = (file: string, data: unknown) => writeFileSync(path.join(root, SEED_DIR, file), `${JSON.stringify(data, null, 2)}\n`);
  out("appendices.json", APPENDICES.map((a) => ({ code: a.code, name: a.name, description: "" })));
  out("generals.json", [{ code: GENERAL.code, tree: general.tree }]);
  out("documents.json", documents);
  out("clauses.json", clauses);

  const stats = (tree: DocumentNode) => {
    const ix = indexTree(tree);
    const count = (kind: string) => [...ix.nodes.values()].filter((e) => e.node.kind === kind).length;
    return `관 ${count("section")} · 조 ${count("article")} · 항 ${count("paragraph")} · 호 ${count("item")} · 목 ${count("subitem")} · 표 ${count("table")} · 박스 ${count("box")} · 조참조 ${count("articleRef")} · 별표참조 ${count("appendixRef")} · 슬롯 ${count("slot")} · 조건 ${count("condBlock")}/${count("inlineCond")}`;
  };
  console.log(`[general] ${general.tree.title}: ${stats(general.tree)}`);
  for (const d of documents) console.log(`[special] ${d.tree.title}: ${stats(d.tree)} · 공용조항 ${count(d.tree, "clauseInlineRef") + count(d.tree, "clauseBlockRef")}`);
  for (const c of clauses) console.log(`[clause] ${c.code} ${c.label} (${c.mode}) — 쓰임 ${documents.reduce((n, d) => n + JSON.stringify(d.tree).split(`"clauseCode":"${c.code}"`).length - 1, 0)}`);
  for (const line of report) console.log(`[report] ${line}`);
  for (const line of [...generalIssues, ...specialIssues]) console.log(`[invalid] ${line}`);
  if (generalIssues.length + specialIssues.length > 0) process.exit(1);
}

const count = (tree: DocumentNode, kind: string) => [...indexTree(tree).nodes.values()].filter((e) => e.node.kind === kind).length;

/** 공용조항 한 건 — 평문(`text`)을 변환하거나 원문 한 자리(`from`)의 항 본문을 딴다. 조 참조는 보통약관 마스터만. */
function buildClause(spec: (typeof CLAUSES)[number], built: Map<string, Built>, general: Built, report: string[]): ClauseRecord {
  const prefix = `c${Number(spec.code.slice(1))}`;
  const empty = { byNumber: new Map() };
  const convert = (text: string, newId: () => Id) =>
    inlinesFromText(text, { self: empty, general: general.index, appendixByNumber, currentArticleId: `${prefix}-a`, report }, newId);
  const options = (spec.options ?? []).map((o, oi) => ({
    code: optionCode(oi),
    label: o.label,
    order: oi,
    values: o.values.map((v, vi) => ({ code: valueCode(vi), label: v.label, order: vi, body: inlineBody(v.text, `${prefix}-o${oi + 1}v${vi + 1}`, convert) })),
  }));
  let body: ClauseRecord["body"];
  if (spec.from) {
    const b = built.get(spec.from.spec);
    const a = b && [...articlesOf(b.tree)].find((x) => b.numberOf.get(x.id) === spec.from!.article);
    const p = a?.children.find((c) => c.kind === "paragraph" && c.id === `${a.id}-p${spec.from!.paragraph}`);
    if (!p || p.kind !== "paragraph") throw new Error(`${spec.code}: 원문 자리 ${spec.from.spec} 조 ${spec.from.article} 제${spec.from.paragraph}항 없음`);
    body = reId([{ id: "p", kind: "paragraph" as const, children: structuredClone(p.children).map(toClauseInline) }], prefix);
  } else {
    const inline = inlineBody(spec.text!, prefix, convert);
    body = spec.mode === "inline" ? inline : [{ id: `${prefix}-p1`, kind: "paragraph", children: inline }];
  }
  return { code: spec.code, label: spec.label, mode: spec.mode, description: spec.description, body, options };
}

function buildSpecial(spec: SpecialSpec, generalParsed: ParsedDoc, general: Built, report: string[]): Built {
  let built: Built;
  if (spec.extractFrom) {
    const source = spec.extractFrom.file === GENERAL.file ? generalParsed : parseTerms(read(spec.extractFrom.file));
    const wanted = new Set(spec.extractFrom.articles);
    const flat: ParsedDoc = { title: spec.title ?? source.title, sections: [{ title: "", articles: source.sections.flatMap((s) => s.articles).filter((a) => wanted.has(a.number)) }] };
    built = buildStructure(flat, spec.idPrefix, flat.title);
    // 기본계약 문면 안의 자기 참조(제3조 → 제1조 자리)는 self 색인으로 풀린다 — 원문 번호를 그대로 쓴다
    convertText(built, general.index, report);
    const articles = [...articlesOf(built.tree)];
    spec.extractFrom.articles.forEach((number, i) => {
      const target = general.index.byNumber.get(spec.extractFrom!.linkTo[i]);
      const a = articles.find((x) => built.numberOf.get(x.id) === number);
      if (a && target) a.linkedArticleId = target.id;
      else report.push(`조연결 실패: ${spec.code} 조 ${number} → 보통약관 ${spec.extractFrom!.linkTo[i]}`);
    });
  } else {
    const parsed = parseTerms(read(spec.file!));
    built = buildStructure(parsed, spec.idPrefix, spec.title ?? parsed.title);
    applyInlineConds(built.tree, built.numberOf, spec.inlineConds ?? [], report);
    convertText(built, general.index, report);
  }
  applySlots(built, spec.slots, report);
  reportLeftovers(built, `[${spec.code}]`, report);
  return built;
}

main();
