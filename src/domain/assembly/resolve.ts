/**
 * 2·3단계 — 조건 해소 + 공용조항 인라인화 (문서 한 벌을 한 문맥으로 실행).
 *
 * - 조건은 **밟은 자리만** 평가한다 (ADR-0016): 가지를 앞에서부터 보다 true 인 첫 가지(또는 else)를 택하고,
 *   택하지 않은 가지 안쪽은 들여다보지 않는다. 오류·미결이면 조건 노드 전체가 오류 마커가 된다 — 조립 문맥에
 *   미결이 남았다는 것은 값이 없다는 뜻이므로 원인에 맞는 Issue 로 바꾼다 (`explainUndetermined`).
 * - 함수조항 참조는 `applyBindings`(인자 → 사용처 연결 · 없으면 기본 연결 · 내부 변수와 필드 읽기 · 연산은 사용처 문맥에서 값으로, 최종 결정 2) + `resolveOptions`(오버라이드 > 마스터, 기능/상품 §3.6)
 *   + `expandClause` 로 본문을 그 자리에 펼치고, 펼친 본문의 조건·슬롯은 **사용처 문맥**으로 계속 해소한다(연결한 구분자는 사용처 문맥에서 푼다).
 *   연결 누락 · 옵션 미선택·무효 · 없는 함수조항은 오류 마커.
 * - **값별 분기**(switchBlock · inlineSwitch, 최종 결정 5)는 대상 값(사용처 연결로 바꿔 쓴 식)을 사용처 문맥에서 평가해 그 값의 칸을 펼친다 —
 *   「문구 없음」 칸은 비운다. 칸이 없는 값(열거값 추가로 생긴 미배정)은 **그 값이 실제로 닿은 자리만** `unassignedValue` 오류 마커다
 *   (좌표 = 분기 노드 · refPath 값, 문구에 함수조항 코드 — 그 값을 안 쓰는 상품 · 사용처는 영향 없음).
 * - 반복(forBlock · inlineFor)은 MVP 자리만 — 만나면 `structure` 오류 마커 (구현 P7).
 * - **행 반복 표**(ADR-0070 결정 6)는 특약 문맥의 행 원천(`ctx.rows` — 상품담보 스냅샷)으로 펼친다:
 *   key 조합마다 템플릿 행 복제 · 구조 표기 → key 표기 · 바깥 key 세로 병합(spans). 조합이 0 이면 표를 생략한다.
 *   행 안의 조건은 행 노드 문맥에서 해소하고, 슬롯은 행 노드(`RSlot.row`)를 달고 치환 단계로 넘긴다.
 *   행 원천이 없는 문맥(보통약관)의 반복 표는 오류 마커.
 * - **박스 참조**(정적 마스터, 최종 결정 9)는 박스 마스터(`env.boxes`)에서 제목 · 줄을 읽어 정적 박스로 바꾼다 — 조 자리 · 호 목록 자리,
 *   펼친 공용조항 본문 안도 같다. 없는 박스는 brokenRef 오류 마커. 줄은 고정 글이라 더 해소할 것이 없다.
 * - 슬롯·조 참조·별표 참조는 그대로 둔다 (4·7단계).
 *
 * 좌표: 문서 기본 좌표 + 조(id·조 명) + 노드 경로. 펼친 공용조항 안의 노드 id 는 `${참조노드id}/${원노드id}`.
 */

import type {
  Block as ClauseBlock,
  BulletListNode as ClauseBulletListNode,
  BulletNode as ClauseBulletNode,
  CondBlockNode as ClauseCondBlockNode,
  Inline as ClauseInline,
  InlineSwitchNode as ClauseInlineSwitchNode,
  ItemSwitchBlockNode as ClauseItemSwitchBlockNode,
  SubitemSwitchBlockNode as ClauseSubitemSwitchBlockNode,
  SwitchBlockNode as ClauseSwitchBlockNode,
  ItemCondBlockNode as ClauseItemCondBlockNode,
  ItemNode as ClauseItemNode,
  ParagraphNode as ClauseParagraphNode,
  SubitemCondBlockNode as ClauseSubitemCondBlockNode,
  SubitemNode as ClauseSubitemNode,
} from "../clause/nodes";
import { applyBindings } from "../clause/bind";
import type { LocalEnv } from "../clause/locals";
import type { Bindings } from "../clause/params";
import { expandClause, resolveOptions } from "../clause/reference";
import type { Clause, ClauseMode, OptionSelection } from "../clause/types";
import type { EnumDef } from "../catalog/types";
import type { Box } from "../document/box";
import type { MasterTree } from "../master";
import type { ArticleNode, BoxNode, BoxRefNode, BulletListNode, BulletNode, ClauseBlockRefNode, CondBlockNode, DocumentNode, ForBlockNode, InlineNode, ItemNode, ParagraphNode, SectionNode, SubitemNode, TableNode } from "../document/nodes";
import { evaluate, parse, type EvalContext } from "../expression";
import { expandRepeatTable } from "../document/repeat";
import { descend, enumerateRows, type StructNodeRef } from "../structure";
import type { Code, Coordinate, Id, Issue } from "../types";
import type { AssemblyContext } from "./context";
import { formatValue } from "./substitute";
import type { ErrorNode, RArticle, RBulletList, RInline, RItem, RParagraph, ResolvedDoc, RSection, RStatic, RSubitem } from "./types";

export interface ResolveEnv {
  clauses: ReadonlyMap<Code, Clause>;
  /** 정적 마스터 박스 — 코드 → 박스. 박스 참조를 여기서 편다 (없으면 모든 박스 참조가 brokenRef). */
  boxes?: ReadonlyMap<Code, Box>;
  /** 공용조항 참조 노드 id → 옵션 오버라이드 (상품 스코프 — 보통약관 자리만, 기능/상품 §3.6). */
  overrides: ReadonlyMap<Id, OptionSelection>;
  /** 문서 기본 좌표 (document · ownerId · ownerName). */
  coordinate: Coordinate;
  /** 열거형 — 함수조항 인자의 enum 상수 연결을 슬롯에 찍을 때 표시명으로 (없으면 코드). */
  enums?: ReadonlyMap<Code, EnumDef>;
  /** 마스터 트리 — 함수조항 원천 인자(세목 폼) · 합치기 필드 타입. 없으면 MVP 정본. */
  master?: MasterTree;
}

export interface ResolveOutcome {
  doc: ResolvedDoc;
  /** 문서 등장 순. */
  issues: Issue[];
}

// ───────────────────────────── 내부 ─────────────────────────────

/** 유형(출력 모양)의 화면 말 — 자리 유형 오류 문구용. */
const MODE_WORD: Record<ClauseMode, string> = { inline: "문구", block: "항", item: "호", subitem: "목" };

/** 문면 노드와 공용조항 노드(부분집합 — articleRef 에 scope 없음)를 함께 다룬다. */
type AnyInline = InlineNode | ClauseInline | ClauseInlineSwitchNode;
type AnyCond = CondBlockNode | ClauseCondBlockNode;
type AnySubitem = ClauseSubitemNode | SubitemNode;
type AnyItem = ItemNode | ClauseItemNode;
type AnyParagraph = ParagraphNode | ClauseParagraphNode;
type AnyBlock = AnyParagraph | AnyCond | ClauseSwitchBlockNode | ClauseBlockRefNode | ForBlockNode | ClauseBlock | ItemNode | SubitemNode | ArticleNode | SectionNode | TableNode | BoxNode | BulletListNode | BulletNode | BoxRefNode;
type AnyStatic = TableNode | BoxNode | BulletListNode | ClauseBulletListNode;
/** 호 목록 자리 — 호 · 조건 블록 · 정적 블록 · 박스 참조 · 「호」 함수조항 참조 (펼친 호 유형 본문도 같은 자리). */
type AnyItemSlot = AnyItem | AnyCond | AnyStatic | BoxRefNode | ClauseBlockRefNode | ClauseItemCondBlockNode | ClauseItemSwitchBlockNode;
/** 목 목록 자리 — 목 · 조건 블록 · 글머리 목록 · 「목」 함수조항 참조 (펼친 목 유형 본문도 같은 자리). */
type AnySubitemSlot = AnySubitem | AnyCond | BulletListNode | ClauseBlockRefNode | ClauseSubitemCondBlockNode | ClauseSubitemSwitchBlockNode;
/** 가지 — 블록·인라인·공용조항 쪽 모두 이 모양이다. children 은 자리에 맞게 캐스팅한다. */
interface Branch {
  id: Id;
  when?: string;
  children: readonly unknown[];
}

/** 값별 분기 — 블록 · 문장 안 모두 이 모양이다(칸 본문은 자리에 맞게 캐스팅한다). */
interface SwitchLike {
  id: Id;
  on: string;
  cases: readonly { id: Id; values: readonly Code[]; empty?: true; children: readonly unknown[] }[];
}

interface Frame {
  path: Id[];
  articleId?: Id;
  articleTitle?: string;
  /** 반복 표 행 안이면 행 노드 — 조건 · 슬롯이 그 노드 문맥에서 평가된다. */
  row?: StructNodeRef;
  /** 펼친 함수조항 본문 안이면 그 함수조항 코드 — 값별 분기 미배정 오류 문구가 고칠 곳을 말한다. */
  clause?: Code;
}

/**
 * 조 참조의 범위 → 조립 범위. 문면 참조는 제 범위 그대로, 공용조항의 보통약관 참조(범위 없음)는 `general`,
 * 제 항 · 사용처 참조(`clause` · `host`)는 펼칠 때 사용처 노드 id 가 됐으므로 `self` (기능/함수조항 §3.5).
 */
function refScope(scope: "self" | "general" | "clause" | "host" | undefined): "self" | "general" {
  return scope === "self" || scope === "clause" || scope === "host" ? "self" : "general";
}

/**
 * 사용처 위치 경로(`"2.1.3"` = n번째 조 · m번째 항 · k번째 호 · 목) → 사용처 노드 id (기능/함수조항 §3.5).
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

  /**
   * 값별 분기의 칸 고르기 (최종 결정 5) — 대상 값을 사용처 문맥에서 평가해 그 값이 든 칸. 칸이 없는 값이면 `unassignedValue`
   * (그 값이 실제로 닿은 이 자리만 — 저장 때 미배정은 막혔으므로 여기 오는 것은 열거값 추가로 생긴 미배정이다). 밟지 않은 칸은 보지 않는다.
   */
  choose(n: SwitchLike, f: Frame): { kind: "case"; case: SwitchLike["cases"][number] } | { kind: "error"; issue: Issue } {
    const at = this.at(f, n.id);
    const base = this.evalOf(f);
    if (!base) return { kind: "error", issue: { kind: "brokenRef", message: "반복 표 행 노드의 문맥을 만들 수 없습니다", at } };
    const parsed = parse(n.on, at);
    if (!parsed.ok) {
      const issue: Issue = parsed.rejection.reason === "invalid" && parsed.rejection.issues[0] ? parsed.rejection.issues[0] : { kind: "syntax", message: "식을 읽을 수 없습니다", at };
      return { kind: "error", issue };
    }
    const r = evaluate(parsed.value, { ...base, coordinate: at });
    if (r.kind === "error") return { kind: "error", issue: r.issue };
    if (r.kind === "undetermined") return { kind: "error", issue: this.ctx.explainUndetermined(r.reason, at) };
    if (typeof r.value !== "string") return { kind: "error", issue: { kind: "typeMismatch", message: `값별 분기의 대상 값이 목록값 코드가 아닙니다 (${typeof r.value})`, at } };
    const value = r.value;
    const k = n.cases.find((c) => c.values.includes(value));
    if (!k) {
      const where = f.clause ? `함수조항 ${f.clause} 의 값별 분기` : "값별 분기";
      return { kind: "error", issue: { kind: "unassignedValue", message: `${where}에 값 ${value} 의 칸이 없습니다 — 그 값을 칸에 배정한다`, at: { ...at, refPath: value } } };
    }
    return { kind: "case", case: k };
  }

  /** 값별 분기 → 고른 칸의 본문(「문구 없음」이면 빈 목록) 을 자리 규칙(`each`)으로. 오류면 마커 하나. */
  switchOf<T>(n: SwitchLike, f: Frame, each: (children: readonly unknown[], g: Frame) => T[]): (T | ErrorNode)[] {
    const r = this.choose(n, f);
    if (r.kind === "error") return [this.error(n.id, r.issue)];
    if (r.case.empty) return [];
    return each(r.case.children, { ...f, path: [...f.path, n.id, r.case.id] });
  }

  /** 공용조항 참조 → 펼친 본문 (옵션 해소 포함). 실패면 오류 마커. */
  expand(
    node: { id: Id; clauseCode: Code; options: OptionSelection; bindings?: Bindings },
    modes: readonly ClauseMode[],
    at: Coordinate,
    f: Frame,
  ): { ok: true; mode: ClauseMode; body: (ClauseInline | ClauseBlock)[] } | { ok: false; marker: ErrorNode } {
    const defined = this.env.clauses.get(node.clauseCode);
    if (!defined) return { ok: false, marker: this.error(node.id, { kind: "brokenRef", message: `함수조항 ${node.clauseCode} 이(가) 없습니다`, at }) };
    // 인자 연결 — 펼치기 전에 arg.X 를 사용처 연결(없으면 기본 연결)로 바꿔 쓰고, 내부 변수 · 필드 읽기 · 연산은 사용처 문맥에서 값으로 푼다
    const usage = this.evalOf(f);
    const locals: LocalEnv | undefined = usage
      ? { ctx: usage, enums: this.env.enums ?? new Map(), ...(this.env.master ? { master: this.env.master } : {}), explain: (reason, where) => this.ctx.explainUndetermined(reason, where), text: (value, type) => this.constText(value, type) }
      : undefined;
    const bound = applyBindings(defined, node.bindings, (value, param) => this.constText(value, param.type), at, locals);
    if (!bound.ok) {
      const issues = bound.rejection.reason === "invalid" ? bound.rejection.issues : [{ kind: "argUnbound" as const, message: `함수조항 ${node.clauseCode} 의 인자를 연결할 수 없습니다`, at }];
      this.issues.push(...issues);
      return { ok: false, marker: { kind: "error", id: node.id, issue: issues[0] } };
    }
    const clause = bound.value;
    if (!modes.includes(clause.mode)) {
      return { ok: false, marker: this.error(node.id, { kind: "structure", message: `함수조항 ${node.clauseCode} 은(는) 「${MODE_WORD[clause.mode]}」 유형이라 ${modes.map((m) => `「${MODE_WORD[m]}」`).join(" · ")} 자리에 올 수 없습니다`, at }) };
    }
    const { selection, issues } = resolveOptions(clause, node.options, this.env.overrides.get(node.id), at);
    if (issues.length > 0) {
      this.issues.push(...issues);
      return { ok: false, marker: { kind: "error", id: node.id, issue: issues[0] } };
    }
    const expanded = expandClause(clause, selection, node.id, this.host);
    if (!expanded.ok) {
      const issue: Issue = expanded.rejection.reason === "invalid" ? expanded.rejection.issues[0] : { kind: "optionInvalid", message: "함수조항을 펼칠 수 없습니다", at };
      return { ok: false, marker: this.error(node.id, { ...issue, at: { ...at, ...issue.at } }) };
    }
    return { ok: true, mode: clause.mode, body: expanded.value as (ClauseInline | ClauseBlock)[] };
  }

  /** 상수 연결의 슬롯 글 — 조립의 값 표기 규칙(substitute `formatValue`)을 그대로 쓴다. enum 은 표시명(열거형을 알 때). */
  constText(value: string | number | boolean, type: { kind: string; enumCode?: Code }): string {
    const f = formatValue(value, type.kind === "enum" && this.env.enums && type.enumCode ? { kind: "enum", enumCode: type.enumCode } : undefined, this.env.enums ?? new Map(), this.env.coordinate);
    return f.ok ? f.text : String(value);
  }

  /** 정적 마스터 박스 참조 → 박스(제목 + 고정 글 줄). 줄 id 는 `${참조노드id}/l${n}` (옛 문면 박스와 같은 모양). */
  boxRef(n: BoxRefNode, f: Frame): RStatic<RInline> | ErrorNode {
    const box = this.env.boxes?.get(n.boxCode);
    if (!box) return this.error(n.id, { kind: "brokenRef", message: `박스 ${n.boxCode} 이(가) 정적 마스터에 없습니다`, at: this.at(f, n.id) });
    return { kind: "box", id: n.id, title: box.title, lines: box.lines.map((text, i) => [{ kind: "text", id: `${n.id}/l${i + 1}`, text }]) };
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
        return [{ kind: "articleRef", id: n.id, targets: n.targets.map((target) => ({ ...target })), ...(n.connector !== undefined ? { connector: n.connector } : {}), scope: refScope(n.scope), at }];
      case "appendixRef":
        return [{ kind: "appendixRef", id: n.id, appendixCode: n.appendixCode, at }];
      case "inlineCond": {
        const r = this.select(n.branches, f, n.id);
        if (r.kind === "error") return [this.error(n.id, r.issue)];
        if (r.kind === "none") return [];
        return this.inlines(r.branch.children as AnyInline[], { ...f, path: [...f.path, n.id, r.branch.id] });
      }
      case "inlineSwitch":
        return this.switchOf(n, f, (children, g) => this.inlines(children as AnyInline[], g));
      case "inlineFor":
        return [this.error(n.id, { kind: "structure", message: "인라인 반복은 아직 조립하지 않습니다 (P7)", at })];
      case "clauseInlineRef": {
        const r = this.expand(n, ["inline"], at, f);
        if (!r.ok) return [r.marker];
        return this.inlines(r.body as ClauseInline[], { ...f, path: [...f.path, n.id], clause: n.clauseCode });
      }
      case "optionSlot":
        // expandClause 가 이미 치환했으므로 여기 오면 정의 오류다
        return [this.error(n.id, { kind: "optionInvalid", message: `옵션 자리 ${n.optionCode} 이(가) 치환되지 않았습니다`, at })];
    }
  }

  subitem(n: AnySubitem, f: Frame): RSubitem<RInline> {
    return { kind: "subitem", id: n.id, children: this.inlines(n.children, { ...f, path: [...f.path, n.id] }) };
  }

  subitems(list: readonly AnySubitemSlot[], f: Frame): (RSubitem<RInline> | RBulletList<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RSubitem<RInline> | RBulletList<RInline> | ErrorNode)[] => {
      if (n.kind === "subitem") return [this.subitem(n, f)];
      if (n.kind === "bulletList") return this.static(n, f) as (RBulletList<RInline> | ErrorNode)[];
      if (n.kind === "clauseBlockRef") {
        // 「목」 함수조항 — 목 목록을 이 자리에 펴고 번호는 사용처에서 이어 매긴다 (최종 결정 4)
        const r = this.expand(n, ["subitem"], this.at(f, n.id), f);
        if (!r.ok) return [r.marker];
        return this.subitems(r.body as unknown as AnySubitemSlot[], { ...f, path: [...f.path, n.id], clause: n.clauseCode });
      }
      if (n.kind === "switchBlock") return this.switchOf(n, f, (children, g) => this.subitems(children as AnySubitemSlot[], g));
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.subitems(r.branch.children as AnySubitemSlot[], { ...f, path: [...f.path, n.id, r.branch.id] });
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
    // 옛 문면 박스(글 줄 사본) — 하위호환으로 읽는다. 새 박스는 정적 마스터 박스 참조다 (기능/박스 §3.2)
    if (n.kind === "box") return [{ kind: "box", id: n.id, title: n.title, lines: n.lines.map((text, i) => [{ kind: "text", id: `${n.id}/l${i + 1}`, text }]) }];
    if (n.kind === "bulletList") {
      const inner = { ...f, path: [...f.path, n.id] };
      const errors: ErrorNode[] = [];
      const bullets = (list: readonly (BulletNode | ClauseBulletNode | AnyCond)[], g: Frame): { id: Id; children: RInline[] }[] =>
        list.flatMap((b) => {
          if (b.kind === "bullet") return [{ id: b.id, children: this.inlines(b.children, { ...g, path: [...g.path, b.id] }) }];
          const r = this.select(b.branches, g, b.id);
          if (r.kind === "error") {
            errors.push(this.error(b.id, r.issue));
            return [];
          }
          if (r.kind === "none") return [];
          return bullets(r.branch.children as (BulletNode | ClauseBulletNode | AnyCond)[], { ...g, path: [...g.path, b.id, r.branch.id] });
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

  items(list: readonly AnyItemSlot[], f: Frame): (RItem<RInline> | RStatic<RInline> | ErrorNode)[] {
    return list.flatMap((n): (RItem<RInline> | RStatic<RInline> | ErrorNode)[] => {
      if (n.kind === "item") return [this.item(n, f)];
      if (n.kind === "boxRef") return [this.boxRef(n, f)];
      if (n.kind === "table" || n.kind === "box" || n.kind === "bulletList") return this.static(n, f);
      if (n.kind === "clauseBlockRef") {
        // 「호」 함수조항 — 호 목록(빈 목록 · 여러 호 가능)을 이 자리에 펴고 번호는 사용처에서 이어 매긴다 (최종 결정 4).
        // 다른 유형이면(저장 검사를 거치지 않은 트리) expand 가 자리 유형 오류 마커를 낸다
        const r = this.expand(n, ["item"], this.at(f, n.id), f);
        if (!r.ok) return [r.marker];
        return this.items(r.body as unknown as AnyItemSlot[], { ...f, path: [...f.path, n.id], clause: n.clauseCode });
      }
      if (n.kind === "switchBlock") return this.switchOf(n, f, (children, g) => this.items(children as AnyItemSlot[], g));
      const r = this.select(n.branches, f, n.id);
      if (r.kind === "error") return [this.error(n.id, r.issue)];
      if (r.kind === "none") return [];
      return this.items(r.branch.children as AnyItemSlot[], { ...f, path: [...f.path, n.id, r.branch.id] });
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
        case "boxRef":
          return [this.boxRef(n, f)];
        case "condBlock": {
          const r = this.select(n.branches, f, n.id);
          if (r.kind === "error") return [this.error(n.id, r.issue)];
          if (r.kind === "none") return [];
          return this.blocks(r.branch.children as AnyBlock[], { ...f, path: [...f.path, n.id, r.branch.id] }, excludeFromComparison);
        }
        case "switchBlock":
          return this.switchOf(n, f, (children, g) => this.blocks(children as AnyBlock[], g, excludeFromComparison));
        case "clauseBlockRef": {
          const r = this.expand(n, ["block"], at, f);
          if (!r.ok) return [r.marker];
          return this.blocks(
            r.body as ClauseBlock[],
            { ...f, path: [...f.path, n.id], clause: n.clauseCode },
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
