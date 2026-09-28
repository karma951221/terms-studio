/**
 * 2·3단계 — 조건 해소 + 공용조항 인라인화 (문서 한 벌을 한 문맥으로 실행).
 *
 * - 조건은 **밟은 자리만** 평가한다 (ADR-0016): 가지를 앞에서부터 보다 true 인 첫 가지(또는 else)를 택하고,
 *   택하지 않은 가지 안쪽은 들여다보지 않는다. 오류·미결이면 조건 노드 전체가 오류 마커가 된다 — 조립 문맥에
 *   미결이 남았다는 것은 값이 없다는 뜻이므로 원인에 맞는 Issue 로 바꾼다 (`explainUndetermined`).
 * - 공용조항 참조는 `resolveOptions`(오버라이드 > 마스터, 기능/상품 §3.6) + `expandClause` 로 본문을 그 자리에 펼치고,
 *   펼친 본문의 조건·슬롯은 **사용처 문맥**으로 계속 해소한다 (늦은 바인딩, ADR-0010).
 *   옵션 미선택·무효 · 없는 공용조항은 오류 마커.
 * - 반복(forBlock · inlineFor)은 MVP 자리만 — 만나면 `structure` 오류 마커 (구현 P7).
 * - **행 반복 표**(ADR-0070 결정 6)는 특약 문맥의 행 원천(`ctx.rows` — 상품담보 스냅샷)으로 펼친다:
 *   key 조합마다 템플릿 행 복제 · 구조 표기 → key 표기 · 바깥 key 세로 병합(spans). 조합이 0 이면 표를 생략한다.
 *   행 안의 조건은 행 노드 문맥에서 해소하고, 슬롯은 행 노드(`RSlot.row`)를 달고 치환 단계로 넘긴다.
 *   행 원천이 없는 문맥(보통약관)의 반복 표는 오류 마커.
 * - 슬롯·조 참조·별표 참조는 그대로 둔다 (4·7단계).
 *
 * 좌표: 문서 기본 좌표 + 조(id·조 명) + 노드 경로. 펼친 공용조항 안의 노드 id 는 `${참조노드id}/${원노드id}`.
 */

import type {
  Block as ClauseBlock,
  BoxNode as ClauseBoxNode,
  CondBlockNode as ClauseCondBlockNode,
  Inline as ClauseInline,
  ItemNode as ClauseItemNode,
  ParagraphNode as ClauseParagraphNode,
  SubitemNode as ClauseSubitemNode,
} from "../clause/nodes";
import { expandClause, resolveOptions } from "../clause/reference";
import type { Clause, ClauseMode, OptionSelection } from "../clause/types";
import type { ArticleNode, BoxNode, BulletListNode, BulletNode, ClauseBlockRefNode, CondBlockNode, DocumentNode, ForBlockNode, InlineNode, ItemNode, ParagraphNode, SectionNode, SubitemNode, TableNode } from "../document/nodes";
import { evaluate, parse, type EvalContext } from "../expression";
import { expandRepeatTable } from "../document/repeat";
import { descend, enumerateRows, type StructNodeRef } from "../structure";
import type { Code, Coordinate, Id, Issue } from "../types";
import type { AssemblyContext } from "./context";
import type { ErrorNode, RArticle, RBulletList, RInline, RItem, RParagraph, ResolvedDoc, RSection, RStatic, RSubitem } from "./types";

export interface ResolveEnv {
  clauses: ReadonlyMap<Code, Clause>;
  /** 공용조항 참조 노드 id → 옵션 오버라이드 (상품 스코프 — 보통약관 자리만, 기능/상품 §3.6). */
  overrides: ReadonlyMap<Id, OptionSelection>;
  /** 문서 기본 좌표 (document · ownerId · ownerName). */
  coordinate: Coordinate;
}

export interface ResolveOutcome {
  doc: ResolvedDoc;
  /** 문서 등장 순. */
  issues: Issue[];
}

// ───────────────────────────── 내부 ─────────────────────────────

/** 문면 노드와 공용조항 노드(부분집합 — articleRef 에 scope 없음)를 함께 다룬다. */
type AnyInline = InlineNode | ClauseInline;
type AnyCond = CondBlockNode | ClauseCondBlockNode;
type AnySubitem = ClauseSubitemNode | SubitemNode;
type AnyItem = ItemNode | ClauseItemNode;
type AnyParagraph = ParagraphNode | ClauseParagraphNode;
type AnyBlock = AnyParagraph | AnyCond | ClauseBlockRefNode | ForBlockNode | ClauseBlock | ItemNode | SubitemNode | ArticleNode | SectionNode | TableNode | BoxNode | BulletListNode | BulletNode;
type AnyStatic = TableNode | BoxNode | BulletListNode;
/** 가지 — 블록·인라인·공용조항 쪽 모두 이 모양이다. children 은 자리에 맞게 캐스팅한다. */
interface Branch {
  id: Id;
  when?: string;
  children: readonly unknown[];
}

interface Frame {
  path: Id[];
  articleId?: Id;
  articleTitle?: string;
  /** 반복 표 행 안이면 행 노드 — 조건 · 슬롯이 그 노드 문맥에서 평가된다. */
  row?: StructNodeRef;
}

/**
 * 조 참조의 범위 → 조립 범위. 문면 참조는 제 범위 그대로, 공용조항의 보통약관 참조(범위 없음)는 `general`,
 * 제 항 · 사용처 참조(`clause` · `host`)는 펼칠 때 사용처 노드 id 가 됐으므로 `self` (기능/공용조항 §3.5).
 */
function refScope(scope: "self" | "general" | "clause" | "host" | undefined): "self" | "general" {
  return scope === "self" || scope === "clause" || scope === "host" ? "self" : "general";
}

/**
 * 사용처 위치 경로(`"2.1.3"` = n번째 조 · m번째 항 · k번째 호 · 목) → 사용처 노드 id (기능/공용조항 §3.5).
 * 순번은 **원본 트리의 문서 순**이다 — 관은 투명하고 조건 블록은 모든 가지를 차례로 센다(값에 따라 번호가 바뀌어도 가리키는 노드는 같다).
 * 공용조항 블록이 펼친 항은 세지 않는다 — 사용처가 소유한 노드만 가리킬 수 있다.
 */
export function hostLocator(doc: DocumentNode): (path: string) => Id | undefined {
  const flat = <T extends { kind: string }>(list: readonly unknown[], want: string): T[] =>
    (list as { kind: string; branches?: { children: unknown[] }[]; children?: unknown[] }[]).flatMap((n): T[] => {
      if (n.kind === want) return [n as unknown as T];
      if (n.kind === "condBlock") return (n.branches ?? []).flatMap((b) => flat<T>(b.children, want));
      if (n.kind === "section" && want === "article") return flat<T>(n.children ?? [], want);
      return [];
    });
  const articles = flat<ArticleNode>(doc.children, "article");
  return (path) => {
    const [a, p, i, u] = path.split(".").map(Number);
    const article = articles[a - 1];
    if (!article || p === undefined) return article?.id;
    const paragraph = flat<ParagraphNode>(article.children, "paragraph")[p - 1];
    if (!paragraph || i === undefined) return paragraph?.id;
    const item = flat<ItemNode>(paragraph.items ?? [], "item")[i - 1];
    if (!item || u === undefined) return item?.id;
    return flat<SubitemNode>(item.subitems ?? [], "subitem")[u - 1]?.id;
  };
}

class Walker {
  readonly issues: Issue[] = [];
  constructor(
    private readonly ctx: AssemblyContext,
    private readonly env: ResolveEnv,
    private readonly host?: (path: string) => Id | undefined,
  ) {}

  at(f: Frame, id: Id): Coordinate {
    return {
      ...this.env.coordinate,
      ...(f.articleId !== undefined ? { articleId: f.articleId, articleTitle: f.articleTitle } : {}),
      nodePath: [...f.path, id],
    };
  }

  error(id: Id, issue: Issue): ErrorNode {
    this.issues.push(issue);
    return { kind: "error", id, issue };
  }

  /** 프레임의 평가 문맥 — 반복 표 행이면 행 노드 문맥, 아니면 문서 문맥. */
  evalOf(f: Frame): EvalContext | undefined {
    return f.row ? this.ctx.rows?.rowContext(f.row) : this.ctx.eval;
  }

  /** 조건식 하나 — taken / notTaken / 오류. */
  condition(src: string, at: Coordinate, base: EvalContext | undefined = this.ctx.eval): { kind: "taken" | "notTaken" } | { kind: "error"; issue: Issue } {
    if (!base) return { kind: "error", issue: { kind: "brokenRef", message: "반복 표 행 노드의 문맥을 만들 수 없습니다", at } };
    const parsed = parse(src, at);
    if (!parsed.ok) {
      const issue: Issue =
        parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? parsed.rejection.issues[0] : { kind: "syntax", message: "식을 읽을 수 없습니다", at };
      return { kind: "error", issue };
    }
    const r = evaluate(parsed.value, { ...base, coordinate: at });
    if (r.kind === "error") return { kind: "error", issue: r.issue };
    if (r.kind === "undetermined") return { kind: "error", issue: this.ctx.explainUndetermined(r.reason, at) };
    if (typeof r.value !== "boolean") {
      return { kind: "error", issue: { kind: "typeMismatch", message: `조건식의 결과가 boolean 이 아닙니다 (${typeof r.value})`, at } };
    }
    return { kind: r.value ? "taken" : "notTaken" };
  }

  /** 가지 선택 — 택한 가지, 없음(모두 false · else 없음), 오류. 밟지 않은 가지는 평가하지 않는다. */
  select(branches: readonly Branch[], f: Frame, condId: Id): { kind: "branch"; branch: Branch } | { kind: "none" } | { kind: "error"; issue: Issue } {
    for (const br of branches) {
      if (br.when === undefined) return { kind: "branch", branch: br };
      const r = this.condition(br.when, this.at({ ...f, path: [...f.path, condId] }, br.id), this.evalOf(f));
      if (r.kind === "error") return r;
      if (r.kind === "taken") return { kind: "branch", branch: br };
    }
    return { kind: "none" };
  }

  /** 공용조항 참조 → 펼친 본문 (옵션 해소 포함). 실패면 오류 마커. */
  expand(
    node: { id: Id; clauseCode: Code; options: OptionSelection },
    modes: readonly ClauseMode[],
    at: Coordinate,
  ): { ok: true; mode: ClauseMode; body: (ClauseInline | ClauseBlock | ClauseBoxNode)[] } | { ok: false; marker: ErrorNode } {
    const clause = this.env.clauses.get(node.clauseCode);
    if (!clause) return { ok: false, marker: this.error(node.id, { kind: "brokenRef", message: `공용조항 ${node.clauseCode} 이(가) 없습니다`, at }) };
    if (!modes.includes(clause.mode)) {
      return { ok: false, marker: this.error(node.id, { kind: "structure", message: `공용조항 ${node.clauseCode} 은(는) ${clause.mode} 모드라 ${modes.join(" · ")} 자리에 올 수 없습니다`, at }) };
    }
    const { selection, issues } = resolveOptions(clause, node.options, this.env.overrides.get(node.id), at);
    if (issues.length > 0) {
      this.issues.push(...issues);
      return { ok: false, marker: { kind: "error", id: node.id, issue: issues[0] } };
    }
    const expanded = expandClause(clause, selection, node.id, this.host);
    if (!expanded.ok) {
      const issue: Issue = expanded.rejection.reason === "invalid" ? expanded.rejection.issues[0] : { kind: "optionInvalid", message: "공용조항을 펼칠 수 없습니다", at };
      return { ok: false, marker: this.error(node.id, { ...issue, at: { ...at, ...issue.at } }) };
    }
    return { ok: true, mode: clause.mode, body: expanded.value as (ClauseInline | ClauseBlock | ClauseBoxNode)[] };
  }

  /** 「박스」 공용조항을 펼친 박스 — 줄의 슬롯은 사용처 문맥으로 치환 단계에 넘긴다. */
  clauseBox(n: ClauseBoxNode, f: Frame): RStatic<RInline> {
    const inner = { ...f, path: [...f.path, n.id] };
    return { kind: "box", id: n.id, title: n.title, lines: n.lines.map((l) => this.inlines(l.children, { ...inner, path: [...inner.path, l.id] })) };
  }

  inlines(list: readonly AnyInline[], f: Frame): RInline[] {
    return list.flatMap((n) => this.inline(n, f));
  }

  inline(n: AnyInline, f: Frame): RInline[] {
    const at = this.at(f, n.id);
    switch (n.kind) {
      case "text":
        return [{ kind: "text", id: n.id, text: n.text }];
      case "structKey":
        // 반복 표 행은 펼칠 때 텍스트로 바뀐다 — 여기 오면 반복 표 밖이다 (저장 검사가 막는 꼴)
        return [this.error(n.id, { kind: "structure", message: "구조 표기는 반복 표 안에서만 쓸 수 있습니다", at })];
      case "slot":
        return [{ kind: "slot", id: n.id, ref: n.ref, at, ...(f.row ? { row: f.row } : {}) }];
      case "articleRef":
        return [{ kind: "articleRef", id: n.id, targets: n.targets.map((target) => ({ ...target })), connector: n.connector, scope: refScope(n.scope), at }];
      case "appendixRef":
        return [{ kind: "appendixRef", id: n.id, appendixCode: n.appendixCode, at }];
      case "inlineCond": {
        const r = this.select(n.branches, f, n.id);
        if (r.kind === "error") return [this.error(n.id, r.issue)];
        if (r.kind === "none") return [];
        return this.inlines(r.branch.children as AnyInline[], { ...f, path: [...f.path, n.id, r.branch.id] });
      }
      case "inlineFor":
        return [this.error(n.id, { kind: "structure", message: "인라인 반복은 아직 조립하지 않습니다 (P7)", at })];
      case "clauseInlineRef": {
        const r = this.expand(n, ["inline"], at);
        if (!r.ok) return [r.marker];
        return this.inlines(r.body as ClauseInline[], { ...f, path: [...f.path, n.id] });
      }
      case "optionSlot":
        // expandClause 가 이미 치환했으므로 여기 오면 정의 오류다
        return [this.error(n.id, { kind: "optionInvalid", message: `옵션 자리 ${n.optionCode} 이(가) 치환되지 않았습니다`, at })];
    }
  }

  subitem(n: AnySubitem, f: Frame): RSubitem<RInline> {
    return { kind: "subitem", id: n.id, children: this.inlines(n.children, { ...f, path: [...f.path, n.id] }) };
  }

  subitems(list: readonly (AnySubitem | AnyCond | BulletListNode)[], f: Frame): (RSubitem<RInline> | RBulletList<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RSubitem<RInline> | RBulletList<RInline> | ErrorNode)[] => {
      if (n.kind === "subitem") return [this.subitem(n, f)];
      if (n.kind === "bulletList") return this.static(n, f) as (RBulletList<RInline> | ErrorNode)[];
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.subitems(r.branch.children as (AnySubitem | AnyCond | BulletListNode)[], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }

  item(n: AnyItem, f: Frame): RItem<RInline> {
    const inner = { ...f, path: [...f.path, n.id] };
    return {
      kind: "item",
      id: n.id,
      children: this.inlines(n.children, inner),
      ...(n.subitems ? { subitems: this.subitems(n.subitems, inner) } : {}),
    };
  }

  /**
   * 정적 표·박스 · 글머리 목록 — 표는 셀의 인라인까지, 글머리 목록은 항목(조건 블록은 택한 가지)의 인라인까지 해소한다
   * (기능/문면 §3.2). 반복 표는 펼치고, 조합 0 이면 빈 목록. 글머리 목록은 항목이 모두 빠지면 목록째 없다.
   */
  static(n: AnyStatic, f: Frame): (RStatic<RInline> | ErrorNode)[] {
    // 옛 문면 박스(글 줄) — 하위호환으로 읽는다. 새 박스는 「박스」 공용조항이다 (기능/공용조항 §3.1)
    if (n.kind === "box") return [{ kind: "box", id: n.id, title: n.title, lines: n.lines.map((text, i) => [{ kind: "text", id: `${n.id}/l${i + 1}`, text }]) }];
    if (n.kind === "bulletList") {
      const inner = { ...f, path: [...f.path, n.id] };
      const errors: ErrorNode[] = [];
      const bullets = (list: readonly (BulletNode | AnyCond)[], g: Frame): { id: Id; children: RInline[] }[] =>
        list.flatMap((b) => {
          if (b.kind === "bullet") return [{ id: b.id, children: this.inlines(b.children, { ...g, path: [...g.path, b.id] }) }];
          const r = this.select(b.branches, g, b.id);
          if (r.kind === "error") {
            errors.push(this.error(b.id, r.issue));
            return [];
          }
          if (r.kind === "none") return [];
          return bullets(r.branch.children as (BulletNode | AnyCond)[], { ...g, path: [...g.path, b.id, r.branch.id] });
        });
      const items = bullets(n.children, inner);
      return [...(items.length > 0 ? [{ kind: "bulletList" as const, id: n.id, items }] : []), ...errors];
    }
    if (n.repeat) return this.repeatTable(n as TableNode & { repeat: { depth: 1 | 2 } }, f);
    const inner = { ...f, path: [...f.path, n.id] };
    return [
      {
        kind: "table",
        id: n.id,
        ...(n.title !== undefined ? { title: n.title } : {}),
        columns: n.columns,
        rows: n.rows.map((row) => ({ ...(row.header ? { header: true } : {}), cells: row.cells.map((cell) => this.inlines(cell, inner)) })),
      },
    ];
  }

  /** 행 반복 표 (ADR-0070 결정 6) — 행 원천으로 key 조합을 펴고, 행마다 그 노드 문맥으로 셀을 해소한다. */
  repeatTable(n: TableNode & { repeat: { depth: 1 | 2 } }, f: Frame): (RStatic<RInline> | ErrorNode)[] {
    const at = this.at(f, n.id);
    const source = this.ctx.rows;
    if (!source) return [this.error(n.id, { kind: "structure", message: "반복 표는 담보 약관 템플릿에서만 쓸 수 있습니다", at })];
    const keys = enumerateRows(source.root, n.repeat.depth, source.providers);
    if (!keys.ok) {
      const what = keys.rejection.reason === "notFound" ? ` — ${keys.rejection.what} 없음` : "";
      return [this.error(n.id, { kind: "structure", message: `반복할 구조를 읽을 수 없습니다${what}`, at })];
    }
    const expanded = expandRepeatTable(n, keys.value, descend(source.root.level, n.repeat.depth));
    if (!expanded) return []; // key 조합 0 — 표를 통째로 생략 (ADR-0004 결)
    const inner = { ...f, path: [...f.path, n.id] };
    const rowOf = new Map(expanded.rows.map((r) => [r.index, { level: r.node.level, id: r.node.id }]));
    const t = expanded.table;
    return [
      {
        kind: "table",
        id: t.id,
        ...(t.title !== undefined ? { title: t.title } : {}),
        columns: t.columns,
        rows: t.rows.map((row, ri) => {
          const node = rowOf.get(ri);
          const frame: Frame = node ? { ...inner, row: node } : inner;
          return {
            ...(row.header ? { header: true } : {}),
            cells: row.cells.map((cell) => this.inlines(cell, frame)),
            ...(row.spans ? { spans: row.spans } : {}),
          };
        }),
      },
    ];
  }

  items(list: readonly (AnyItem | AnyCond | AnyStatic | ClauseBlockRefNode)[], f: Frame): (RItem<RInline> | RStatic<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RItem<RInline> | RStatic<RInline> | ErrorNode)[] => {
      if (n.kind === "item") return [this.item(n, f)];
      if (n.kind === "table" || n.kind === "box" || n.kind === "bulletList") return this.static(n, f);
      if (n.kind === "clauseBlockRef") {
        // 호 목록 자리의 공용조항은 「박스」뿐 — 항 · 호 뒤의 박스 자리
        const r = this.expand(n, ["box"], this.at(f, n.id));
        if (!r.ok) return [r.marker];
        return (r.body as ClauseBoxNode[]).map((b) => this.clauseBox(b, { ...f, path: [...f.path, n.id] }));
      }
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.items(r.branch.children as (AnyItem | AnyCond | AnyStatic | ClauseBlockRefNode)[], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }

  paragraph(n: AnyParagraph, f: Frame, excludeFromComparison = false): RParagraph<RInline> {
    const inner = { ...f, path: [...f.path, n.id] };
    return {
      kind: "paragraph",
      id: n.id,
      children: this.inlines(n.children, inner),
      ...(n.items ? { items: this.items(n.items, inner) } : {}),
      ...(excludeFromComparison ? { excludeFromComparison: true } : {}),
    };
  }

  /** 조 안의 블록 자리 — 항 · 조건 블록 · 공용조항 block 참조 · 반복 블록. */
  blocks(list: readonly AnyBlock[], f: Frame, excludeFromComparison = false): (RParagraph<RInline> | RStatic<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RParagraph<RInline> | RStatic<RInline> | ErrorNode)[] => {
      const at = this.at(f, n.id);
      switch (n.kind) {
        case "paragraph":
          return [this.paragraph(n, f, excludeFromComparison)];
        case "table":
        case "box":
        case "bulletList":
          return this.static(n, f);
        case "condBlock": {
          const r = this.select(n.branches, f, n.id);
          if (r.kind === "error") return [this.error(n.id, r.issue)];
          if (r.kind === "none") return [];
          return this.blocks(r.branch.children as AnyBlock[], { ...f, path: [...f.path, n.id, r.branch.id] }, excludeFromComparison);
        }
        case "clauseBlockRef": {
          const r = this.expand(n, ["block", "box"], at);
          if (!r.ok) return [r.marker];
          if (r.mode === "box") return (r.body as ClauseBoxNode[]).map((b) => this.clauseBox(b, { ...f, path: [...f.path, n.id] }));
          return this.blocks(
            r.body as ClauseBlock[],
            { ...f, path: [...f.path, n.id] },
            excludeFromComparison || (this.env.coordinate.document === "general" && n.excludeFromComparison === true),
          );
        }
        case "forBlock":
          return [this.error(n.id, { kind: "structure", message: "블록 반복은 아직 조립하지 않습니다 (P7)", at })];
        default: {
          const bad = n as { kind: string; id: Id };
          return [this.error(bad.id, { kind: "structure", message: `${bad.kind} 은(는) 조 안에 올 수 없습니다`, at })];
        }
      }
    });
  }

  /** 관 안의 조 (조건 블록 투명). 관은 조 자리에 다시 올 수 없다. */
  articlesIn(list: readonly (ArticleNode | CondBlockNode)[], f: Frame): (RArticle<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RArticle<RInline> | ErrorNode)[] => {
      if (n.kind === "article") return [this.article(n, f)];
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.articlesIn(r.branch.children as (ArticleNode | CondBlockNode)[], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }

  article(n: ArticleNode, f: Frame): RArticle<RInline> {
    const inner: Frame = { path: [...f.path, n.id], articleId: n.id, articleTitle: n.title };
    return {
      kind: "article",
      id: n.id,
      title: n.title,
      ...(n.linkedArticleId !== undefined ? { linkedArticleId: n.linkedArticleId } : {}),
      children: this.blocks(n.children, inner),
    };
  }

  articles(list: DocumentNode["children"], f: Frame): (RArticle<RInline> | RSection<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RArticle<RInline> | RSection<RInline> | ErrorNode)[] => {
      if (n.kind === "section") return [{ kind: "section", id: n.id, title: n.title, children: this.articlesIn(n.children, { ...f, path: [...f.path, n.id] }) }];
      if (n.kind === "article") return [this.article(n, f)];
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.articles(r.branch.children as DocumentNode["children"], { ...f, path: [...f.path, n.id, r.branch.id] });
    });
  }
}

/** 문서 한 벌을 문맥으로 실행 — 조건 해소 + 공용조항 인라인화. 슬롯·참조는 남는다. */
export function resolveDocument(doc: DocumentNode, ctx: AssemblyContext, env: ResolveEnv): ResolveOutcome {
  const w = new Walker(ctx, env, hostLocator(doc));
  const children = w.articles(doc.children, { path: [doc.id] });
  return { doc: { kind: "document", id: doc.id, title: doc.title, children }, issues: w.issues };
}
