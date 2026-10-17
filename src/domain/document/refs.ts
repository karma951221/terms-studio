/**
 * 참조 추출 — 문서가 읽는 참조 전부를 좌표와 함께 (기능/관계정보 §3 「참조 그래프」).
 *
 * C1(refs) 역인덱스의 재료다: 구분자(식 안 · 슬롯) · 담보속성 · 내장 경로 · 함수조항 · 조(자기·보통약관) · 별표 · 박스 · 조연결 ·
 * 반복 원천이 읽는 마스터 필드 · 열거값 필드(ADR-0077 — 문면 식이 아니라 반복 장치의 선언이라 구분자를 거치지 않는다).
 * 문법이 깨진 식은 참조를 내지 않는다 (문법 오류는 `validateExpressions` 가 보고한다).
 * 참조 대상의 존재 검증은 `validateTree` (nodes.ts) 몫이다.
 */

import { extractRefs, parse, refPath } from "../expression";
import type { Bindings } from "../clause/params";
import type { Clause } from "../clause/types";
import type { RecheckEntry, Usage } from "../clause/reference";
import type { Code, Coordinate, Id, Issue } from "../types";
import { clauseInnerCodes, isRepeatSource, isTreeSource, treeLoopLevelsAt } from "./blockRepeat";
import { articleRefsOf, coordinateOf, indexTree, type ArticleRefNode, type ClauseGate, type DocumentNode } from "./nodes";
import { refKey, removedRefKeys } from "./pcode";

export type DocRef =
  /** `node` = 노드 한정자 `D@키경로` (ADR-0087) — 담보 노드 키 경로. */
  | { kind: "discriminator"; code: Code; node?: { path: string }; path: string; via: "when" | "slot"; at: Coordinate }
  /** 마스터 필드 직접 참조 — 문면에서는 금지다 (ADR-0037). 나와도 그래프에 깨진 참조로 남긴다. */
  | { kind: "masterField"; path: string; via: "when" | "slot"; at: Coordinate }
  | { kind: "attribute"; code: Code; path: string; at: Coordinate }
  | { kind: "builtin"; path: string; at: Coordinate }
  /** `bindings` = 사용처의 인자 연결(최종 결정 2) — 없으면 기본 연결. */
  | {
      kind: "clause";
      clauseCode: Code;
      options: Record<Code, Code>;
      bindings?: Bindings;
      preset?: Code;
      mode: "block" | "inline";
      /** 참조 자리를 감싼 가장 안쪽 담보 트리 반복의 레벨 — 재검사가 하위 레벨 기본 연결을 그 반복이 푸는지 본다 (ADR-0087 결정 8). */
      treeLoopLevel?: "subCoverage" | "benefit";
      at: Coordinate;
    }
  /** 조 참조의 대상 하나 — 조 id · (항 · 호 · 목이면) P코드 (ADR-0072 결정 3). `at.refPath` = 대상 열쇠(`refKey`). */
  | { kind: "article"; articleId: Id; code?: Code; innerCode?: Code; values?: Code[]; /** 키 한정의 키 (ADR-0087 결정 10). */ keys?: string[]; scope: "self" | "general"; at: Coordinate }
  | { kind: "appendix"; appendixCode: Code; at: Coordinate }
  /** 정적 마스터 박스 참조 (최종 결정 9). */
  | { kind: "box"; boxCode: Code; at: Coordinate }
  /** 동적표 참조 (기능/동적표 §3.5) — `bindings` = 사용처의 인자 연결, 없으면 기본 연결. */
  | { kind: "dynTable"; tableCode: Code; bindings?: Bindings; at: Coordinate }
  /**
   * 반복 원천이 읽는 마스터 필드(`폼.필드`) — 목록 필드(사유 반복은 바깥 종 반복의 폼) · 거름 식의 필드 (ADR-0077).
   * `where` = 합집합 거름의 열거값 필드 키 — 그 목록 필드의 열거형 필드다. 좌표는 반복 블록 · refPath = 마스터 경로.
   */
  | { kind: "repeatSource"; path: string; where?: Code; at: Coordinate }
  /** 조연결 — `at.articleId` 의 조가 보통약관 조 `linkedArticleId` 를 가리킨다. */
  | { kind: "link"; linkedArticleId: Id; at: Coordinate };

/** 문서 순서(전위)대로. `base` 는 좌표 기본값 (document · ownerId). */
export function collectRefs(doc: DocumentNode, base: Coordinate = {}): DocRef[] {
  const ix = indexTree(doc, base);
  const out: DocRef[] = [];

  /** 조 참조 하나 — 대상마다 한 줄 (좌표 refPath = 대상 열쇠). 조 참조 슬롯 · 함수조항 참조의 조 참조 인자 연결이 같이 쓴다. */
  const articleRefs = (n: Pick<ArticleRefNode, "targets" | "scope">, at: Coordinate): void => {
    for (const target of n.targets) {
      const values = target.restrict && "values" in target.restrict ? target.restrict.values : undefined;
      const keys = target.restrict && "keys" in target.restrict ? target.restrict.keys : undefined;
      out.push({
        kind: "article",
        articleId: target.articleId,
        ...(target.code !== undefined ? { code: target.code } : {}),
        ...(target.innerCode !== undefined ? { innerCode: target.innerCode } : {}),
        ...(values ? { values } : {}),
        ...(keys ? { keys } : {}),
        scope: n.scope,
        at: { ...at, refPath: refKey(target) },
      });
    }
  };

  const exprRefs = (src: string, via: "when" | "slot", at: Coordinate): void => {
    const parsed = parse(src);
    if (!parsed.ok) return;
    if (via === "slot" && parsed.value.kind !== "ref") return;
    for (const { ref, path } of extractRefs(parsed.value)) {
      const here = { ...at, refPath: path };
      switch (ref.kind) {
        case "discriminator":
          out.push({ kind: "discriminator", code: ref.code, ...(ref.node ? { node: { path: ref.node.path } } : {}), path, via, at: here });
          break;
        case "master":
          out.push({ kind: "masterField", path, via, at: here });
          break;
        case "attr":
          out.push({ kind: "attribute", code: ref.code, path, at: here });
          break;
        case "builtin":
          out.push({ kind: "builtin", path, at: here });
          break;
      }
    }
  };

  for (const e of ix.nodes.values()) {
    const n = e.node;
    const at = coordinateOf(ix, e, base);
    switch (n.kind) {
      case "article":
        if (n.linkedArticleId !== undefined) out.push({ kind: "link", linkedArticleId: n.linkedArticleId, at });
        break;
      case "condBlock":
      case "inlineCond":
        for (const br of n.branches) {
          const be = ix.branches.get(br.id);
          if (br.when !== undefined && be) exprRefs(br.when, "when", coordinateOf(ix, be, base));
        }
        break;
      case "slot":
        exprRefs(n.ref, "slot", at);
        break;
      case "clauseBlockRef":
      case "clauseInlineRef": {
        const tree = treeLoopLevelsAt(ix, e).at(-1);
        out.push({ kind: "clause", clauseCode: n.clauseCode, options: n.options, ...(n.bindings ? { bindings: n.bindings } : {}), ...(n.preset !== undefined ? { preset: n.preset } : {}), mode: n.kind === "clauseBlockRef" ? "block" : "inline", ...(tree ? { treeLoopLevel: tree.level } : {}), at });
        // 조 참조 인자 연결도 이 문서의 조 참조다 — 깨짐 · 관계 간선을 같이 센다 (ADR-0083 결정 4)
        for (const r of articleRefsOf(n)) articleRefs(r, at);
        break;
      }
      case "articleRef":
        articleRefs(n, at);
        break;
      case "appendixRef":
        out.push({ kind: "appendix", appendixCode: n.appendixCode, at });
        break;
      case "boxRef":
        out.push({ kind: "box", boxCode: n.boxCode, at });
        break;
      case "dynTableRef":
        out.push({ kind: "dynTable", tableCode: n.tableCode, ...(n.bindings ? { bindings: n.bindings } : {}), at });
        break;
      // 반복 원천이 읽는 마스터 필드 — 블록 반복 · 인라인 반복(ADR-0088 — 같은 RepeatSource) 공통
      case "forBlock":
      case "inlineFor": {
        const src = n.source;
        // 담보 트리 반복(세부보장마다 · 급부마다)은 폼 · 필터가 없다 — 반복 원천 간선이 없다 (ADR-0087)
        if (!isRepeatSource(src) || isTreeSource(src)) break;
        const field = (path: string, where?: Code) => out.push({ kind: "repeatSource", path, ...(where !== undefined ? { where } : {}), at: { ...at, refPath: path } });
        if (src.kind === "listOfCurrent") {
          const outer = ix.nodes.get(src.loop)?.node;
          if (outer?.kind === "forBlock" && isRepeatSource(outer.source) && !isTreeSource(outer.source) && outer.source.kind !== "listOfCurrent") field(`${outer.source.form}.${src.field}`);
          break;
        }
        if (src.kind === "union") field(`${src.form}.${src.field}`, src.where?.field);
        if (src.filter !== undefined) {
          const parsed = parse(src.filter);
          if (parsed.ok) for (const { ref } of extractRefs(parsed.value)) if (ref.kind === "master") field(refPath(ref));
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** 문서가 참조하는 동적표 코드 — 등장 순 · 중복 없이 (관계정보 · 동적표 삭제 영향). */
export function dynTableCodesIn(doc: DocumentNode): Set<Code> {
  const out = new Set<Code>();
  for (const r of collectRefs(doc)) if (r.kind === "dynTable") out.add(r.tableCode);
  return out;
}

/**
 * 요구 구분자 — 문서 자체가 읽는 구분자 + 참조한 함수조항이 그 자리 연결로 읽는 구분자(게이트, 기능/함수조항 §3.3). 등장 순 · 중복 없이.
 * B1 이 담보 부착 검사에 쓴다.
 */
export function requiredDiscriminators(doc: DocumentNode, gate?: ClauseGate): Code[] {
  const codes: Code[] = [];
  const add = (c: Code) => {
    if (!codes.includes(c)) codes.push(c);
  };
  for (const r of collectRefs(doc)) {
    if (r.kind === "discriminator") add(r.code);
    // 프리셋이면 그 프리셋의 연결로 (ADR-0084)
    else if (r.kind === "clause" && gate) gate.requiredCodes(r.clauseCode, (gate.usageOf?.(r.clauseCode, r) ?? r).bindings).forEach(add);
  }
  return codes;
}

/** 재검사가 훑는 문서 한 벌 — 관계정보 재검사 목록의 「고치러 가기」 좌표 재료. */
export interface RecheckDocument {
  id: Id;
  title: string;
  kind: "general" | "special";
  /** 소유 실체 — 담보약관이면 담보 id, 보통약관이면 문서 id. */
  ownerId: Id;
  tree: DocumentNode;
  /** 담보약관의 대응 보통약관. */
  generalDocumentId?: Id;
}

/**
 * 함수조항 저장의 외부 참조 영향 (기능/문면 §3.7 · 관계정보 재검사 목록, ADR-0049) — 이 함수조항을 넣은 참조 노드(사용처)의 펼친 안쪽 코드를 가리키는
 * 조 참조 가운데, 그 안쪽 코드가 지금 본문에 없는 것. 같은 문서의 조 참조 · 그 문서를 대응 보통약관으로 둔 담보약관의 보통약관 참조(함수조항 참조의
 * 조 참조 인자 연결 포함)를 본다. 사용처마다 한 항목, 가리키는 자리마다 한 줄 — 「안쪽 코드 P0100 사라짐 — 참조하는 문서 N곳」.
 */
export function lostInnerCodeEntries(clause: Clause, usages: readonly Usage[], documents: readonly RecheckDocument[]): RecheckEntry[] {
  const inner = clauseInnerCodes(clause);
  const byId = new Map(documents.map((d) => [d.id, d] as const));
  const out: RecheckEntry[] = [];
  for (const usage of usages) {
    const doc = byId.get(usage.documentId);
    if (!doc || usage.refNodeId === undefined) continue;
    const head = indexTree(doc.tree).nodes.get(usage.refNodeId);
    const code = (head?.node as { code?: Code } | undefined)?.code;
    if (!head || code === undefined || head.articleId === undefined) continue;
    const articleId = head.articleId;
    // 사라진 안쪽 코드 → 가리키는 자리(문서 · 참조 노드 경로)
    const lost = new Map<Code, { doc: RecheckDocument; path: Id[] }[]>();
    const scan = (from: RecheckDocument, scope: "self" | "general") => {
      for (const e of indexTree(from.tree).nodes.values()) {
        for (const ref of articleRefsOf(e.node)) {
          if (ref.scope !== scope) continue;
          for (const t of ref.targets) {
            if (t.articleId !== articleId || t.code !== code || t.innerCode === undefined || inner.has(t.innerCode)) continue;
            const list = lost.get(t.innerCode) ?? [];
            if (!list.some((x) => x.doc.id === from.id && x.path.at(-1) === e.node.id)) list.push({ doc: from, path: e.path });
            lost.set(t.innerCode, list);
          }
        }
      }
    };
    scan(doc, "self");
    if (doc.kind === "general") for (const d of documents) if (d.kind === "special" && d.generalDocumentId === doc.id) scan(d, "general");
    if (lost.size === 0) continue;
    const issues: Issue[] = [];
    for (const [innerCode, places] of lost) {
      const count = new Set(places.map((p) => p.doc.id)).size;
      for (const p of places) {
        issues.push({
          kind: "brokenRef",
          message: `안쪽 코드 ${innerCode} 사라짐 — 참조하는 문서 ${count}곳 · 「${p.doc.title}」의 조 참조가 함수조항 ${clause.code} 본문에 없는 대상을 가리킵니다`,
          at: { document: p.doc.kind === "general" ? "general" : "coverageMaster", ownerId: p.doc.ownerId, documentId: p.doc.id, ownerName: p.doc.title, nodePath: p.path, refPath: refKey({ articleId, code, innerCode }) },
        });
      }
    }
    out.push({ usage, missing: [], issues });
  }
  return out;
}

/**
 * 함수조항 본문(과 옵션 선택지 문구)의 보통약관 참조 대상 — 범위 없는 조 참조(기능/함수조항 §3.5)의 대상마다 한 줄, 그 참조 노드까지의 id 경로와 함께.
 * 「이 함수조항」 · 조 참조 인자 슬롯은 사용처마다 대상이 달라 들지 않는다. 보통약관 저장의 깨질 참조(확인 카드)가 쓴다.
 */
export function clauseGeneralRefs(clause: Pick<Clause, "body" | "options">): { articleId: Id; code?: Code; innerCode?: Code; nodePath: Id[] }[] {
  const out: { articleId: Id; code?: Code; innerCode?: Code; nodePath: Id[] }[] = [];
  const walk = (x: unknown, path: Id[]): void => {
    if (Array.isArray(x)) return x.forEach((v) => walk(v, path));
    if (typeof x !== "object" || x === null) return;
    const o = x as { id?: unknown; kind?: unknown; scope?: unknown; targets?: unknown };
    const here = typeof o.id === "string" ? [...path, o.id] : path;
    if (o.kind === "articleRef" && o.scope === undefined && Array.isArray(o.targets)) {
      for (const t of o.targets as { articleId?: unknown; code?: unknown; innerCode?: unknown }[]) {
        if (typeof t?.articleId !== "string") continue;
        out.push({ articleId: t.articleId, ...(typeof t.code === "string" ? { code: t.code } : {}), ...(typeof t.innerCode === "string" ? { innerCode: t.innerCode } : {}), nodePath: here });
      }
      return;
    }
    for (const [k, v] of Object.entries(o)) if (k !== "targets" && k !== "bindings") walk(v, here);
  };
  walk(clause.body, []);
  for (const option of clause.options ?? []) for (const value of option.values) walk(value.body, [option.code, value.code]);
  return out;
}

/**
 * 코드 수정 창의 영향 건수 (ADR-0072 결정 6 · 수용 기준 5) — 자리 `nodeId` 의 코드를 `code` 로 바꾸면 이 문서 안에서 깨지는 조 참조 대상 수.
 * 같은 코드의 분기 짝이 남으면 짝으로 해소되어 깨지지 않는다. 조 참조 인자 연결 · 펼친 함수조항 안을 가리키는 대상(그 참조 노드의 코드)도 센다.
 * 깨지는 변경은 문서 저장 오류(`brokenRef`)다 — 창이 「먼저 고쳐야 저장됩니다」로 미리 보인다. 다른 문서 몫은 저장 확인 카드가 센다.
 */
export function codeChangeBreaks(doc: DocumentNode, nodeId: Id, code: Code): number {
  const after = structuredClone(doc);
  const e = indexTree(after).nodes.get(nodeId);
  if (!e) return 0;
  const node = e.node as { code?: Code };
  if (node.code === code) return 0;
  node.code = code;
  const lost = removedRefKeys(doc, after);
  if (lost.size === 0) return 0;
  return collectRefs(doc).filter((r) => r.kind === "article" && r.scope === "self" && lost.has(refKey({ articleId: r.articleId, ...(r.code !== undefined ? { code: r.code } : {}) }))).length;
}
