/**
 * 참조 그래프 구성 (순수) — 각 영역의 정의·문서·관계를 재료로 노드·간선을 만든다.
 *
 * 재료와 간선:
 * - 입력 마스터 → 마스터 필드 노드 · enum 타입 간선(`type`)
 * - 카탈로그 정의 → 구분자 노드 · 식 참조(`expression`) — 마스터 필드 · 담보속성으로 간다
 * - 공용조항 → 옵션·선택지 노드 · 본문/선택지 본문의 식 참조(`when`·`slot`) · 별표 참조
 * - 문서 → 조 노드 · `collectRefs` 의 참조 전부 (구분자 · 담보속성 · 공용조항+옵션 선택 · 조 참조 · 별표 · 조연결) ·
 *   대응 보통약관(`generalDocument`)
 * - 담보 트리 → 담보 노드 · 문서 연결(`document`)
 * - 상품 → 상품담보 노드 · 탑재(`mount`) · 조합(`combination`) · 옵션 오버라이드(`override`) · 템플릿(`generalDocument`)
 *
 * 식 안의 `attr.X = '값'` · `<enum 자리> = '코드'` 비교는 리터럴까지 읽어 유효값·enum 값 간선을 낸다
 * (담보속성 유효값 · enum 값 삭제 영향의 재료). 문법이 깨진 식은 간선을 내지 않는다.
 * 구분자 참조의 노드 한정자 `D@노드`(ADR-0066)는 구분자 간선에 더해 담보 노드로 가는 `nodeQualifier` 간선을 낸다 —
 * 노드 삭제 영향·끊어진 참조의 재료. 키의 레벨은 담보 트리에서 찾고, 노드가 사라졌으면 구분자 레벨로 둔다
 * (ADR-0066 §3: 둘은 같아야 한다).
 *
 * 조 참조(articleRef)의 대상은 조뿐 아니라 항·호·목도 될 수 있지만(문서 모델), 문서에는 **조만** `article:` 노드로
 * 선언된다 — 그래서 대상 노드 id 를 그대로 키로 쓰지 않고 **속한 조 id** 로 올려서 간선을 낸다. 공용조항의 조
 * 참조 중 범위 없는 것은 보통약관 마스터를 가리킨다(기능/함수조항 §3.5 — 제 항 · 사용처 위치는 간선이 없다) — 공용조항을 넣기 전에 보통약관 문서들의
 * 노드 id → 속한 조 인덱스(`generalNodeArticles`)를 만들어 둔다. 대상이 사라졌으면 깨진 간선으로 남기고,
 * 아예 모르면(보통약관이 안 들어옴) 마찬가지로 깨진 간선으로 남긴다 — 간선을 안 내지는 않는다.
 */
import type { Discriminator } from "../catalog/types";
import { discriminatorResultType } from "../catalog/expression";
import { allMasterFields, findMasterField, masterFieldFullLabel, type MasterTree } from "../master";
import type { ClauseNode } from "../clause/nodes";
import { collectExpressions } from "../clause/body";
import type { Clause, ClauseBody } from "../clause/types";
import { nodesOf } from "../coverage/tree";
import type { Coverage, CoverageNodeLevel } from "../coverage/types";
import { coordinateOf, indexTree } from "../document/nodes";
import { articleRefLabel, numberTree } from "../document/numbering";
import { collectRefs } from "../document/refs";
import { enumReads, extractRefs, inferType, parse, refPath, type EnumReadTypes, type Expr, type ExprType, type Ref } from "../expression";
import type { AttachLevel, Code, Coordinate, FieldType, Id } from "../types";
import type { DocumentInput, EdgeVia, GraphInputs, ProductInput, RefEdge, RefGraph, RefNodeInfo, RefNodeKey } from "./types";

// ───────────────────────────── 키 ─────────────────────────────

/** 노드 키의 정규 문자열. */
export function nodeKey(key: RefNodeKey): string {
  switch (key.kind) {
    case "discriminator":
      return `discriminator:${key.code}`;
    case "masterField":
      return `masterField:${key.path}`;
    case "enum":
      return `enum:${key.enumCode}`;
    case "enumValue":
      return `enumValue:${key.enumCode}/${key.valueCode}`;
    case "enumField":
      return `enumField:${key.enumCode}/${key.key}`;
    case "clause":
      return `clause:${key.code}`;
    case "clauseOption":
      return `clauseOption:${key.clauseCode}/${key.optionCode}`;
    case "clauseOptionValue":
      return `clauseOptionValue:${key.clauseCode}/${key.optionCode}/${key.valueCode}`;
    case "document":
      return `document:${key.id}`;
    case "article":
      return `article:${key.documentId}/${key.articleId}`;
    case "appendix":
      return `appendix:${key.code}`;
    case "box":
      return `box:${key.code}`;
    case "coverageNode":
      return `coverageNode:${key.level}/${key.id}`;
    case "attribute":
      return `attribute:${key.code}`;
    case "attributeValue":
      return `attributeValue:${key.code}/${key.valueCode}`;
    case "product":
      return `product:${key.id}`;
    case "productCoverage":
      return `productCoverage:${key.id}`;
    case "entity":
      return `entity:${key.entityKind}/${key.id}`;
  }
}

/** 키 구조만으로 아는 상위 실체 (선언 여부와 무관 — 깨진 대상에도 쓴다). 담보 노드는 트리를 알아야 해서 여기 없다. */
export function structuralParent(key: RefNodeKey): RefNodeKey | undefined {
  switch (key.kind) {
    case "enumValue":
    case "enumField":
      return { kind: "enum", enumCode: key.enumCode };
    case "clauseOption":
      return { kind: "clause", code: key.clauseCode };
    case "clauseOptionValue":
      return { kind: "clauseOption", clauseCode: key.clauseCode, optionCode: key.optionCode };
    case "article":
      return { kind: "document", id: key.documentId };
    case "attributeValue":
      return { kind: "attribute", code: key.code };
    default:
      return undefined;
  }
}

/** 식 참조 → 노드 키. builtin(뼈대 속성)은 실체가 아니라 undefined. */
export function refNodeKey(ref: Ref): RefNodeKey | undefined {
  switch (ref.kind) {
    case "discriminator":
      return { kind: "discriminator", code: ref.code };
    case "master":
      return { kind: "masterField", path: refPath(ref) };
    case "attr":
      return { kind: "attribute", code: ref.code };
    case "builtin":
      return undefined;
  }
}

/** 값 소유자(값 저장소 owner) → 노드 키. */
export function ownerNodeKey(owner: { kind: string; id: Id }): RefNodeKey {
  switch (owner.kind) {
    case "coverage":
    case "subCoverage":
    case "benefit":
      return { kind: "coverageNode", level: owner.kind, id: owner.id };
    case "product":
      return { kind: "product", id: owner.id };
    case "productCoverage":
      return { kind: "productCoverage", id: owner.id };
    default:
      return { kind: "entity", entityKind: owner.kind, id: owner.id };
  }
}

// ───────────────────────────── 식 보조 ─────────────────────────────

/** `참조 = '문자열'` · `참조 ≠ '문자열'` 비교 — 리터럴이 가리키는 유효값·enum 값을 찾는 재료. */
export function literalCompares(expr: Expr): { ref: Ref; literal: string }[] {
  const out: { ref: Ref; literal: string }[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case "compare": {
        if (e.op === "=" || e.op === "≠") {
          const pairs: [Expr, Expr][] = [
            [e.left, e.right],
            [e.right, e.left],
          ];
          for (const [a, b] of pairs) {
            if (a.kind === "ref" && b.kind === "literal" && b.literal.type === "string") out.push({ ref: a.ref, literal: b.literal.value });
          }
        }
        walk(e.left);
        walk(e.right);
        return;
      }
      case "and":
      case "or":
        walk(e.left);
        walk(e.right);
        return;
      case "not":
        walk(e.operand);
        return;
      default:
        return;
    }
  };
  walk(expr);
  return out;
}

// ───────────────────────────── 구성 ─────────────────────────────

const COVERAGE_NODE_LEVELS: readonly AttachLevel[] = ["coverage", "subCoverage", "benefit"];

class Builder {
  readonly nodes = new Map<string, RefNodeInfo>();
  readonly edges: RefEdge[] = [];
  /** 값 자리 경로 → enum 코드 (enum 값 리터럴 간선용). */
  readonly enumSlots = new Map<string, Code>();
  /** 담보 노드 id → 레벨 (노드 한정자 키용). */
  readonly coverageNodeLevels = new Map<Id, CoverageNodeLevel>();
  /** 구분자 코드 → 레벨 (노드가 사라진 한정자의 키 폴백). */
  readonly discriminatorLevels = new Map<Code, AttachLevel>();
  /** 보통약관 노드 id → 속한 조(documentId·articleId) — 공용조항·문서의 조 참조가 항·호·목을 가리킬 때 조로 올리는 인덱스. 조 자신은 자기 id. */
  readonly generalNodeArticles = new Map<Id, { documentId: Id; articleId: Id }>();

  node(info: RefNodeInfo): void {
    this.nodes.set(nodeKey(info.key), info);
  }

  edge(e: RefEdge): void {
    this.edges.push(e);
  }

  /** 노드 한정자 `D@노드` 의 대상 키. 노드 레벨 → 구분자 레벨 순으로 찾고, 둘 다 모르면 undefined (간선 없음). */
  qualifierKey(code: Code, nodeId: Id): RefNodeKey | undefined {
    const level = this.coverageNodeLevels.get(nodeId) ?? this.discriminatorLevels.get(code);
    if (level === undefined || !COVERAGE_NODE_LEVELS.includes(level)) return undefined;
    return { kind: "coverageNode", level: level as CoverageNodeLevel, id: nodeId };
  }

  /** 구분자 참조 하나의 노드 한정자 간선 (있을 때만). */
  qualifier(from: RefNodeKey, ref: Ref, at: Coordinate): void {
    if (ref.kind !== "discriminator" || !ref.node) return;
    const to = this.qualifierKey(ref.code, ref.node.id);
    if (to) this.edge({ from, to, via: "nodeQualifier", at });
  }

  /** 식 하나의 참조 간선 전부 — 구분자·필드·담보속성 + 리터럴이 가리키는 유효값·enum 값 + 노드 한정자. */
  expression(from: RefNodeKey, src: string, via: EdgeVia, at: Coordinate, opts: { slotOnly?: boolean } = {}): void {
    const parsed = parse(src);
    if (!parsed.ok) return;
    if (opts.slotOnly && parsed.value.kind !== "ref") return;
    for (const { ref, path, aggregate } of extractRefs(parsed.value)) {
      const to = refNodeKey(ref);
      if (!to) continue;
      this.edge({ from, to, via, at: { ...at, refPath: path }, ...(aggregate !== undefined ? { aggregate } : {}) });
      this.qualifier(from, ref, { ...at, refPath: path });
    }
    for (const { ref, literal } of literalCompares(parsed.value)) {
      const path = refPath(ref);
      if (ref.kind === "attr") {
        this.edge({ from, to: { kind: "attributeValue", code: ref.code, valueCode: literal }, via, at: { ...at, refPath: path } });
      } else if (ref.kind === "discriminator" || ref.kind === "master") {
        // 구분자 식은 마스터 필드를 직접 비교한다(`product_basic.notice = 'V02'`) — enum 타입 필드면 그 값 간선 (ADR-0078 결정 4 재검사 · 결정 5 삭제 영향)
        const enumCode = this.enumSlots.get(path);
        if (enumCode !== undefined) this.edge({ from, to: { kind: "enumValue", enumCode, valueCode: literal }, via, at: { ...at, refPath: path } });
      }
    }
  }
}

function enumOf(type: FieldType): Code | undefined {
  return "enumCode" in type ? type.enumCode : undefined;
}

function addDiscriminator(b: Builder, def: Discriminator, catalog: ReadonlyMap<Code, Discriminator>, master?: MasterTree): void {
  b.node({ key: { kind: "discriminator", code: def.code }, label: def.label, level: def.level });
  b.discriminatorLevels.set(def.code, def.level);
  // 결과 타입이 enum 이면 `구분자 = 'V02'` 리터럴에서 enum 값 간선을 낼 수 있다 — 명시 타입이 있으면 그것,
  // 없으면 식에서 추론한다 (기능/구분자 §3.1). 구분자 참조는 카탈로그로 푼다 (기능/구분자 §3.2)
  const type = discriminatorResultType(def, master, catalog);
  const e = type ? enumOf(type) : undefined;
  if (e !== undefined) b.enumSlots.set(def.code, e);
}

/** 마스터 필드 노드 + enum 타입 간선. 마스터는 코드라 늘 선언돼 있다 (깨질 수 없다). */
function addMasterFields(b: Builder, master?: MasterTree): void {
  for (const f of allMasterFields(master)) {
    const key: RefNodeKey = { kind: "masterField", path: f.path };
    const label = masterFieldFullLabel(f);
    b.node({ key, label, level: f.level, detail: f.field.type.kind });
    const e = enumOf(f.field.type);
    if (e !== undefined) {
      b.enumSlots.set(f.path, e);
      b.edge({ from: key, to: { kind: "enum", enumCode: e }, via: "type", at: { refPath: f.path, ownerName: label } });
    }
  }
}

/** 구분자 식 → 마스터 필드 · 담보속성 (역인덱스 1단). */
function addExpression(b: Builder, def: Discriminator): void {
  b.expression({ kind: "discriminator", code: def.code }, def.expression, "expression", { ownerId: def.code, ownerName: def.label });
}

/**
 * 함수조항 본문 노드 전부 (경로 포함) — 별표 · 박스 참조 수집용. 식은 collectExpressions 가 따로 본다.
 * 노드 종류가 서로 달라 유형(문구 · 항 · 호 · 목)을 몰라도 걷는다. 경로: 노드마다 제 id 를 얹고, 조건 가지는 가지 id 를 얹는다.
 */
function walkClauseNodes(body: readonly ClauseNode[], basePath: Id[], visit: (node: ClauseNode, path: Id[]) => void): void {
  const walk = (n: ClauseNode, path: Id[]) => {
    const here = [...path, n.id];
    visit(n, here);
    switch (n.kind) {
      case "inlineCond":
      case "condBlock":
        for (const br of n.branches as { id: Id; children: ClauseNode[] }[]) for (const c of br.children) walk(c, [...here, br.id]);
        return;
      case "bulletList":
      case "subitem":
      case "bullet":
        for (const c of n.children) walk(c, here);
        return;
      case "paragraph":
        for (const c of n.children) walk(c, here);
        for (const it of n.items ?? []) walk(it, here);
        return;
      case "item":
        for (const c of n.children) walk(c, here);
        for (const si of n.subitems ?? []) walk(si, here);
        return;
      default:
        return;
    }
  };
  for (const n of body) walk(n, basePath);
}

/**
 * 보통약관 문서들의 노드 id → 속한 조 인덱스 (`Builder.generalNodeArticles`). 공용조항을 넣기 전에 채운다 —
 * 공용조항의 범위 없는 조 참조는 보통약관 마스터를 가리키고(기능/함수조항 §3.5), 공용조항은 어느 문서인지 모른다.
 */
function indexGeneralArticles(b: Builder, documents: readonly DocumentInput[]): void {
  for (const doc of documents) {
    if (doc.kind !== "general") continue;
    const ix = indexTree(doc.tree);
    for (const e of ix.nodes.values()) {
      if (e.articleId !== undefined) b.generalNodeArticles.set(e.node.id, { documentId: doc.id, articleId: e.articleId });
    }
  }
}

/**
 * 함수조항 식의 열거값 읽기 간선 — 인자 · 내부 변수 타입으로 `= '값'` · `.있음(값…)` → enumValue, `.필드` · `.거르기(필드 = …)` → enumField
 * (ADR-0078 결정 2 · 4 · 최종 결정 20). 구분자 · 마스터 비교는 `Builder.expression` 이 이미 낸다.
 */
function clauseEnumReads(b: Builder, from: RefNodeKey, src: string, via: EdgeVia, at: Coordinate, types: EnumReadTypes): void {
  const parsed = parse(src);
  if (!parsed.ok) return;
  for (const r of enumReads(parsed.value, types)) {
    const to: RefNodeKey = r.kind === "value" ? { kind: "enumValue", enumCode: r.enumCode, valueCode: r.code } : { kind: "enumField", enumCode: r.enumCode, key: r.code };
    b.edge({ from, to, via, at });
  }
}

/** 함수조항의 식 타입 재료 — 인자 선언 타입 + 내부 변수 타입(앞에서부터 관대하게 추론) + 세목 폼 필드 타입. */
function clauseTypes(clause: Clause, master?: MasterTree): EnumReadTypes {
  const params = new Map((clause.params ?? []).map((p) => [p.name, p.type as ExprType] as const));
  const planField = (form: Code, field: Code): ExprType | undefined => {
    const f = findMasterField(`${form}.${field}`, master);
    return f && f.level === "plan" ? f.field.type : undefined;
  };
  const locals = new Map<string, ExprType>();
  const types: EnumReadTypes = { params: (n) => params.get(n), locals: (n) => locals.get(n), planField };
  for (const l of clause.locals ?? []) {
    const parsed = typeof l.expr === "string" ? parse(l.expr) : undefined;
    const t = parsed?.ok ? inferType(parsed.value, types) : undefined;
    if (t && !locals.has(l.name)) locals.set(l.name, t);
  }
  return types;
}

function addClause(b: Builder, clause: Clause, master?: MasterTree): void {
  const key: RefNodeKey = { kind: "clause", code: clause.code };
  b.node({ key, label: clause.label, detail: clause.mode });
  for (const o of clause.options) {
    const okey: RefNodeKey = { kind: "clauseOption", clauseCode: clause.code, optionCode: o.code };
    b.node({ key: okey, label: o.label, parent: key });
    for (const v of o.values) b.node({ key: { kind: "clauseOptionValue", clauseCode: clause.code, optionCode: o.code, valueCode: v.code }, label: v.label, parent: okey });
  }
  const base: Coordinate = { document: "clause", ownerId: clause.code, ownerName: clause.label };
  // 인자의 기본 연결 → 구분자 (최종 결정 2) — 그 구분자를 지우면 정의가 깨진다(삭제 영향 · 사용처 읽기의 재료)
  for (const p of clause.params ?? []) {
    if (p.default?.kind === "discriminator") b.edge({ from: key, to: { kind: "discriminator", code: p.default.code }, via: "defaultBinding", at: { ...base, refPath: `arg.${p.name}` }, param: p.name });
  }
  const types = clauseTypes(clause, master);
  // 내부 변수 (최종 결정 2) — 식의 참조(합치기가 읽는 세목 필드 등) · 열거값 나열 · 필드 읽기. 좌표 refPath = var.<이름>
  for (const l of clause.locals ?? []) {
    if (typeof l.expr !== "string") continue;
    const at: Coordinate = { ...base, refPath: `var.${l.name}` };
    const parsed = parse(l.expr);
    if (!parsed.ok) continue;
    for (const { ref } of extractRefs(parsed.value)) {
      const to = refNodeKey(ref);
      if (to) b.edge({ from: key, to, via: "local", at });
    }
    clauseEnumReads(b, key, l.expr, "local", at, types);
  }
  const bodies: { body: readonly ClauseNode[]; path: Id[] }[] = [
    { body: clause.body, path: [] },
    ...clause.options.flatMap((o) => o.values.map((v) => ({ body: v.body, path: [o.code, v.code] }))),
  ];
  for (const { body, path } of bodies) {
    for (const e of collectExpressions(body as ClauseBody, path)) {
      const via = e.role === "slot" ? "slot" : "when";
      b.expression(key, e.source, via, { ...base, nodePath: e.nodePath }, { slotOnly: e.role === "slot" });
      clauseEnumReads(b, key, e.source, via, { ...base, nodePath: e.nodePath }, types);
    }
    walkClauseNodes(body, path, (n, nodePath) => {
      if (n.kind === "appendixRef") b.edge({ from: key, to: { kind: "appendix", code: n.appendixCode }, via: "appendixRef", at: { ...base, nodePath } });
      else if (n.kind === "boxRef") b.edge({ from: key, to: { kind: "box", code: n.boxCode }, via: "boxRef", at: { ...base, nodePath } });
      else if (n.kind === "articleRef" && n.scope === undefined) {
        // 범위 없는 공용조항 조 참조는 보통약관 마스터를 가리킨다(기능/함수조항 §3.5 — 제 항 · 사용처 위치 참조는 사용처마다 대상이 달라 간선이 없다). 대상이 항·호·목이면
        // indexGeneralArticles 로 속한 조로 올리고, 인덱스에 없으면(대상이 사라졌거나 보통약관이 안 들어옴)
        // documentId 없는 키로 내 깨진 간선으로 남긴다 (문서 쪽 generalOf 와 같은 모양).
        for (const target of n.targets) {
          const found = b.generalNodeArticles.get(target.nodeId);
          const to: RefNodeKey = found ? { kind: "article", documentId: found.documentId, articleId: found.articleId } : { kind: "article", documentId: "", articleId: target.nodeId };
          b.edge({ from: key, to, via: "articleRef", at: { ...base, nodePath, refPath: target.nodeId } });
        }
      }
    });
  }
}

/** 문서 안 노드 id → 조 키(조 안이면) 또는 문서 키. */
function anchorOf(doc: DocumentInput, articleId: Id | undefined): RefNodeKey {
  return articleId !== undefined ? { kind: "article", documentId: doc.id, articleId } : { kind: "document", id: doc.id };
}

function addDocument(b: Builder, doc: DocumentInput): Map<Id, RefNodeKey> {
  const key: RefNodeKey = { kind: "document", id: doc.id };
  b.node({ key, label: doc.title, detail: doc.kind, ownerId: doc.ownerId ?? doc.id });
  // ownerId 는 소유 실체(담보약관이면 담보 id) — 문서 화면으로 가는 id 는 documentId 에 (사용처 링크가 그 문서의 그 노드로 간다).
  const base: Coordinate = { document: doc.kind, ownerId: doc.ownerId ?? doc.id, documentId: doc.id, ownerName: doc.title };
  const ix = indexTree(doc.tree, base);
  // 조 표시명은 계산된 번호까지 실어 「제2조(보험금의 감액지급)」로 둔다 — 관계정보·확인 팝업이 조를 id 가 아니라
  // 사람이 부르는 이름으로 부르기 위해서다 (디자인원칙 §9.4 · 리뷰 #24). 번호는 저장값이 아니라 계산값이므로(ADR-0012)
  // 여기서 매번 다시 센다.
  const numbers = numberTree(doc.tree);
  /** 문서 안 모든 노드 id → 그 노드가 속한 조 키(또는 문서 키) — 오버라이드의 매개 노드 찾기용. */
  const anchors = new Map<Id, RefNodeKey>();
  for (const e of ix.nodes.values()) {
    if (e.node.kind === "article") {
      const n = numbers.get(e.node.id);
      b.node({ key: { kind: "article", documentId: doc.id, articleId: e.node.id }, label: n ? articleRefLabel(n.n, e.node.title) : e.node.title, parent: key });
    }
    anchors.set(e.node.id, anchorOf(doc, e.articleId));
  }
  const generalOf = (id: Id): RefNodeKey => ({ kind: "article", documentId: doc.generalDocumentId ?? "", articleId: id });

  for (const r of collectRefs(doc.tree, base)) {
    const from = anchorOf(doc, r.at.articleId);
    switch (r.kind) {
      case "discriminator":
        b.edge({ from, to: { kind: "discriminator", code: r.code }, via: r.via, at: r.at });
        if (r.node) b.qualifier(from, { kind: "discriminator", code: r.code, node: r.node }, r.at);
        break;
      case "masterField":
        // 문면은 구분자만 본다 (ADR-0037) — 마스터 직접 참조는 그래프에 남겨 사용처 조회가 보게 한다
        b.edge({ from, to: { kind: "masterField", path: r.path }, via: r.via, at: r.at });
        break;
      case "attribute":
        b.edge({ from, to: { kind: "attribute", code: r.code }, via: "when", at: r.at });
        break;
      case "builtin":
        break;
      case "clause":
        b.edge({ from, to: { kind: "clause", code: r.clauseCode }, via: "clauseRef", at: r.at, options: r.options, ...(r.bindings ? { bindings: r.bindings } : {}) });
        // 사용처의 인자 연결 → 구분자 (기본 연결을 바꾼 것만 — 기본 연결은 함수조항의 defaultBinding 간선)
        for (const [param, binding] of Object.entries(r.bindings ?? {})) {
          if (binding.kind === "discriminator") b.edge({ from, to: { kind: "discriminator", code: binding.code }, via: "binding", at: { ...r.at, refPath: `${r.clauseCode}.arg.${param}` }, param });
        }
        for (const [optionCode, valueCode] of Object.entries(r.options)) {
          b.edge({ from, to: { kind: "clauseOptionValue", clauseCode: r.clauseCode, optionCode, valueCode }, via: "optionSelect", at: { ...r.at, refPath: `${r.clauseCode}.${optionCode}` } });
        }
        break;
      case "article": {
        // 대상 노드 id 를 속한 조 id 로 올린다 — 대상이 항·호·목이면 article: 노드가 선언되지 않아(조만 선언된다)
        // 그대로 두면 깨진 간선으로 잘못 잡힌다. self 는 이 문서의 ix, general 은 indexGeneralArticles 로 찾는다.
        // 인덱스에 없으면(대상이 사라짐) 기존처럼 대상 id 그대로 둔다 — 깨진 간선으로 남는다.
        let to: RefNodeKey;
        if (r.scope === "self") {
          to = { kind: "article", documentId: doc.id, articleId: ix.nodes.get(r.articleId)?.articleId ?? r.articleId };
        } else {
          const found = b.generalNodeArticles.get(r.articleId);
          to = found ? { kind: "article", documentId: found.documentId, articleId: found.articleId } : generalOf(r.articleId);
        }
        b.edge({ from, to, via: "articleRef", at: r.at });
        break;
      }
      case "appendix":
        b.edge({ from, to: { kind: "appendix", code: r.appendixCode }, via: "appendixRef", at: r.at });
        break;
      case "box":
        b.edge({ from, to: { kind: "box", code: r.boxCode }, via: "boxRef", at: r.at });
        break;
      case "link":
        b.edge({ from, to: generalOf(r.linkedArticleId), via: "link", at: r.at });
        break;
    }
  }
  // 조건식의 리터럴 비교 (유효값 · enum 값 간선) — collectRefs 는 리터럴을 주지 않으므로 가지를 한 번 더 훑는다.
  for (const be of ix.branches.values()) {
    if (be.branch.when === undefined) continue;
    const parsed = parse(be.branch.when);
    if (!parsed.ok) continue;
    const at = coordinateOf(ix, be, base);
    for (const { ref, literal } of literalCompares(parsed.value)) {
      const from = anchorOf(doc, be.articleId);
      if (ref.kind === "attr") b.edge({ from, to: { kind: "attributeValue", code: ref.code, valueCode: literal }, via: "when", at: { ...at, refPath: refPath(ref) } });
      else if (ref.kind === "discriminator") {
        const enumCode = b.enumSlots.get(refPath(ref));
        if (enumCode !== undefined) b.edge({ from, to: { kind: "enumValue", enumCode, valueCode: literal }, via: "when", at: { ...at, refPath: refPath(ref) } });
      }
    }
  }
  if (doc.generalDocumentId !== undefined) b.edge({ from: key, to: { kind: "document", id: doc.generalDocumentId }, via: "generalDocument", at: base });
  return anchors;
}

function addCoverage(b: Builder, tree: Coverage): void {
  const root: RefNodeKey = { kind: "coverageNode", level: "coverage", id: tree.id };
  for (const n of nodesOf(tree)) {
    const parent = n.ancestors.at(-1);
    b.node({ key: { kind: "coverageNode", level: n.level, id: n.id }, label: n.name, level: n.level, ...(parent ? { parent: { kind: "coverageNode", level: parent.level, id: parent.id } } : {}) });
    b.coverageNodeLevels.set(n.id, n.level);
  }
  if (tree.documentId !== undefined) {
    b.edge({ from: root, to: { kind: "document", id: tree.documentId }, via: "document", at: { document: "coverageMaster", ownerId: tree.id, ownerName: tree.name } });
  }
}


function addProduct(b: Builder, p: ProductInput, anchors: Map<Id, RefNodeKey>): void {
  const key: RefNodeKey = { kind: "product", id: p.id };
  b.node({ key, label: p.name });
  const base: Coordinate = { document: "product", ownerId: p.id, ownerName: p.name };
  if (p.generalDocumentId !== undefined) b.edge({ from: key, to: { kind: "document", id: p.generalDocumentId }, via: "generalDocument", at: base });
  for (const pc of p.coverages) {
    const pkey: RefNodeKey = { kind: "productCoverage", id: pc.id };
    b.node({ key: pkey, label: pc.name, parent: key });
    const at: Coordinate = { document: "special", ownerId: pc.id, ownerName: pc.name };
    b.edge({ from: pkey, to: { kind: "coverageNode", level: "coverage", id: pc.coverageId }, via: "mount", at });
    for (const a of pc.attributes) {
      b.edge({ from: pkey, to: { kind: "attributeValue", code: a.kindCode, valueCode: a.valueCode }, via: "combination", at: { ...at, refPath: `attr.${a.kindCode}` } });
    }
  }
  for (const o of p.overrides) {
    const at: Coordinate = { ...base, nodePath: [o.nodeId] };
    const through = anchors.get(o.nodeId);
    for (const [optionCode, valueCode] of Object.entries(o.options)) {
      b.edge({
        from: key,
        to: { kind: "clauseOptionValue", clauseCode: o.clauseCode, optionCode, valueCode },
        via: "override",
        at: { ...at, refPath: `${o.clauseCode}.${optionCode}` },
        ...(through ? { through } : {}),
      });
    }
  }
}

/** 재료 전부로 그래프를 만든다. 순수 함수 — 같은 입력이면 같은 그래프. */
export function buildGraph(inputs: GraphInputs): RefGraph {
  const b = new Builder();
  const defs = inputs.discriminators ?? [];
  const catalog: ReadonlyMap<Code, Discriminator> = new Map(defs.map((d) => [d.code, d]));
  for (const d of defs) addDiscriminator(b, d, catalog, inputs.master);
  for (const e of inputs.enums ?? []) {
    const key: RefNodeKey = { kind: "enum", enumCode: e.code };
    b.node({ key, label: e.label });
    for (const v of e.values) b.node({ key: { kind: "enumValue", enumCode: e.code, valueCode: v.code }, label: v.label, parent: key });
    // 유저 정의 필드 (ADR-0078 결정 2) — 읽는 간선은 함수조항 내부 변수 · 슬롯이 들어올 때 붙는다. 선언해 둬야 그 간선이 깨진 참조가 아니다
    for (const f of e.fields ?? []) b.node({ key: { kind: "enumField", enumCode: e.code, key: f.key }, label: f.label, parent: key, detail: f.type });
  }
  for (const a of inputs.appendices ?? []) b.node({ key: { kind: "appendix", code: a.code }, label: a.name });
  for (const x of inputs.boxes ?? []) b.node({ key: { kind: "box", code: x.code }, label: x.name });
  for (const k of inputs.attributeKinds ?? []) {
    const key: RefNodeKey = { kind: "attribute", code: k.code };
    b.node({ key, label: k.label });
    for (const v of k.values) b.node({ key: { kind: "attributeValue", code: k.code, valueCode: v.code }, label: v.label, parent: key });
  }
  addMasterFields(b, inputs.master);
  for (const c of inputs.coverages ?? []) addCoverage(b, c);
  // 간선은 노드 선언이 끝난 뒤 (enum 자리 · 소유자 이름을 알아야 한다)
  for (const d of defs) addExpression(b, d);
  indexGeneralArticles(b, inputs.documents ?? []);
  for (const c of inputs.clauses ?? []) addClause(b, c, inputs.master);
  const anchors = new Map<Id, RefNodeKey>();
  for (const d of inputs.documents ?? []) for (const [id, key] of addDocument(b, d)) anchors.set(id, key);
  for (const p of inputs.products ?? []) addProduct(b, p, anchors);
  return { nodes: b.nodes, edges: b.edges };
}

export type { DocumentInput, ProductInput } from "./types";
