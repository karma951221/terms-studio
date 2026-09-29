/**
 * 약관 에디터 운전 — 시드 트리 한 벌을 **화면 조작으로** 다시 친다 (문면 저작 · 공용조항 본문 공용).
 *
 * 사람이 하는 것과 같은 길만 쓴다: 툴바 버튼 · 그 자리 팝업 · 문장 칸에 글 치기 · 커서 끝으로 가기 · 글 골라 「조건식」 · 「문장 안 조건」.
 * 편집본을 직접 만지거나 서버 액션을 부르지 않는다.
 *
 * 두 단계로 친다 (조 참조가 뒤 조 · 항을 가리킬 수 있어서 — 고르기 트리는 이미 있는 대상만 보인다):
 * 1. 뼈대 — 조 · 제목 · 항 · 호 · 목 · 표 · 박스 · 공용조항 블록 · 조연결 · 조 자리 조건 (문장은 비워 둔다)
 *    박스는 툴바 「박스」에서 정적 마스터 박스를 고른다(기능/박스 §4.4 — 박스 참조).
 * 2. 문장 — 조마다 문장 칸(항 · 호 · 목 · 표 셀)을 차례로 채운다: 글 · 슬롯 · 조 참조 · 별표 참조 · 공용조항(문장) · 문장 안 조건
 *
 * 화면 자리 ↔ 시드 노드는 **순서**로 맞춘다 — 가운데는 조 하나를 그리고, 그 안의 `[data-block]` · `[data-inline]` 은
 * 문서 순서(전위)다. 시드도 같은 순서로 뽑는다. 공용조항 블록의 본문(읽기 전용)은 셈에서 뺀다.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import { pickCombo } from "../../_lib/combo";
import type { ClauseSpec } from "./seed";

import { parse } from "../../../../src/domain/expression";
import { rowRefPath, toRows, type ConditionRow, type DocumentNode, type InlineNode, type Node } from "../../../../src/domain/document";

/** 문장 칸의 커서를 끝으로 — 칸이 여러 줄로 접혀도 맨 끝. */
const END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";
const SELECT_ALL = process.platform === "darwin" ? "Meta+A" : "Control+A";

type SeedInline = InlineNode | { id: string; kind: "optionSlot"; optionCode: string };
type Branch = { id: string; when?: string; children: SeedInline[] };

export interface RefScopes {
  /** 이 문서의 참조 대상 id → 고르기 트리 줄 표기 경로. */
  selfPaths: Map<string, string[]>;
  /** 보통약관 대상 id → 펴야 할 조상 id. */
  generalAncestors: Map<string, string[]>;
  /** 조 참조 팝업에 범위 고르기가 있는가 (담보약관 · 공용조항). */
  hasScopeSelect: boolean;
  /** 공용조항 에디터인가 — 범위가 보통약관 · 이 공용조항 · 사용처 셋이다 (기능/함수조항 §3.5). 「이 템플릿」 자리에 「이 공용조항」. */
  clauseEditor?: boolean;
}

/** 에디터 한 벌 — 문면(`/documents/<id>`)과 공용조항(`/functions/new`)이 같은 에디터 부품을 쓴다. */
export class Editor {
  constructor(
    readonly page: Page,
    /** 툴바 · 본문을 품은 뿌리 — 문면은 `.ts-l3-body`, 공용조항은 `.ts-clause-editor`. */
    readonly root: Locator,
    readonly refs: RefScopes,
  ) {}

  /** 공용조항 본문의 옵션 코드 → 옵션명 — 「옵션 자리」 메뉴의 줄 이름(「옵션 자리 — <옵션명>」)으로 고른다. */
  optionLabels: ReadonlyMap<string, string> = new Map();

  get toolbar(): Locator {
    return this.root.getByRole("toolbar", { name: "약관 편집 도구" });
  }

  tool(name: string): Locator {
    return this.toolbar.getByRole("button", { name, exact: true });
  }

  async runTool(name: string): Promise<void> {
    const button = this.tool(name);
    try {
      await expect(button).toBeEnabled();
    } catch (error) {
      const where = await this.toolbar.locator(".ts-tool-where").textContent().catch(() => "?");
      throw new Error(`툴바 「${name}」 잠김 — ${where}\n${error instanceof Error ? error.message : String(error)}`);
    }
    await button.click();
  }

  dialog(name: string): Locator {
    return this.page.getByRole("dialog", { name, exact: true });
  }

  /** 팝업 확인 — 닫힐 때까지. */
  async confirm(dialog: Locator, label: string): Promise<void> {
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }

  /** 거부 배너가 없어야 한다 — 명령이 편집본에 들어갔다. */
  async noBanner(): Promise<void> {
    await expect(this.root.locator(".ts-error-banner")).toHaveCount(0);
  }

  // ───────────────────────────── 문장 ─────────────────────────────

  /** 문장 칸 끝에 커서 — 초점만 준다(누르면 칩을 누를 수 있다). */
  async caretEnd(slot: Locator): Promise<void> {
    await slot.focus();
    await this.page.keyboard.press(END);
  }

  /**
   * 문장 칸 하나를 채운다 — 글은 끝에 치고, 칩은 커서 자리(끝)에 툴바로 넣는다. 칩을 넣으면 칸이 새로 그려져 초점을 잃으므로 다시 끝으로 간다.
   * `slot` 은 lazy locator 여야 한다(다시 그려진 칸을 다시 찾는다).
   */
  async fillInline(slot: Locator, nodes: readonly SeedInline[]): Promise<void> {
    for (const node of nodes) {
      await this.caretEnd(slot);
      if (node.kind === "text") {
        await this.page.keyboard.insertText(node.text);
        continue;
      }
      await this.insertChip(slot, node);
    }
    // 초점이 떠나야 편집본에 들어간다
    await slot.blur();
    await this.noBanner();
  }

  private async insertChip(slot: Locator, node: SeedInline): Promise<void> {
    switch (node.kind) {
      case "appendixRef": {
        await this.runTool("별표 참조");
        const d = this.dialog("별표 참조 넣기");
        await pickCombo(d.locator("#pop-appendix"), { value: node.appendixCode });
        return this.confirm(d, "넣기");
      }
      case "slot": {
        await this.runTool("슬롯");
        const d = this.dialog("치환 슬롯 넣기");
        await pickCombo(d.locator("#pop-slot"), { value: node.ref });
        return this.confirm(d, "넣기");
      }
      case "clauseInlineRef": {
        await this.runTool("함수조항(문장)");
        const d = this.dialog("함수조항(문장 안) 넣기");
        await pickCombo(d.locator("#pop-clause"), { value: node.clauseCode });
        for (const [option, value] of Object.entries(node.options)) await d.locator(`#pop-opt-${option}`).selectOption(value);
        return this.confirm(d, "넣기");
      }
      case "articleRef": {
        await this.runTool("조 참조");
        const d = this.dialog("조 참조 넣기");
        await this.pickTargets(d, node);
        return this.confirm(d, "넣기");
      }
      case "optionSlot": {
        // 공용조항 본문 — 옵션이 하나면 곧바로, 여럿이면 버튼 아래 메뉴에서 그 옵션
        await this.runTool("옵션 자리");
        const label = this.optionLabels.get(node.optionCode) ?? node.optionCode;
        const item = this.page.getByRole("menuitem", { name: `옵션 자리 — ${label}`, exact: true });
        if ((await this.page.getByRole("menuitem", { name: /^옵션 자리 — / }).count()) > 0) await item.click();
        return;
      }
      case "inlineCond":
        return this.insertInlineCond(slot, node);
      default:
        throw new Error(`화면으로 넣을 수 없는 문장 노드: ${node.kind}`);
    }
  }

  /**
   * 조 참조 팝업 — 범위 · 대상(트리에서 펴고 고르기) · 연결어.
   * 공용조항 본문의 조 참조는 범위가 셋이다: 없음 = 보통약관 · `clause` = 이 공용조항(항 줄 표기로 찾는다) · `host` = 사용처 위치(줄 id `host:2.1.3`).
   */
  private async pickTargets(d: Locator, node: Extract<InlineNode, { kind: "articleRef" }>): Promise<void> {
    const scope = (node as { scope?: string }).scope;
    const choice = this.refs.clauseEditor ? (scope === "clause" ? "self" : scope === "host" ? "host" : "general") : scope === "general" ? "general" : "self";
    const general = choice === "general";
    if (this.refs.hasScopeSelect) await d.locator("#pop-ref-scope").selectOption(choice);
    for (const { nodeId } of node.targets) {
      let rowId: string;
      if (general) {
        for (const up of this.refs.generalAncestors.get(nodeId) ?? []) await this.expandRow(d, up);
        rowId = nodeId;
      } else if (choice === "host") {
        // 사용처 위치 줄 — 조 · 항 순으로 편다
        const parts = nodeId.split(".");
        for (let k = 1; k < parts.length; k++) await this.expandRow(d, `host:${parts.slice(0, k).join(".")}`);
        rowId = `host:${nodeId}`;
      } else {
        const labels = this.refs.selfPaths.get(nodeId);
        if (!labels) throw new Error(`조 참조 대상 ${nodeId} 가 이 문서 고르기 트리에 없다`);
        rowId = await this.resolveSelfRow(d, labels);
      }
      const box = d.locator(`[data-ref-row="${rowId}"]`).first().locator(":scope > .ts-ref-pick input[type=checkbox]");
      await box.check();
    }
    if (node.targets.length >= 2) await d.getByRole("radio", { name: node.connector, exact: true }).check();
  }

  private async expandRow(d: Locator, rowId: string): Promise<void> {
    const row = d.locator(`[data-ref-row="${rowId}"]`).first();
    if ((await row.getAttribute("aria-expanded")) === "false") await row.locator(":scope > .ts-ref-fold").click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
  }

  /** 「이 템플릿」 묶음에서 줄 표기 경로로 줄을 찾는다 — 이 문서의 노드 id 는 화면이 새로 발급해 시드와 다르다. */
  private async resolveSelfRow(d: Locator, labels: string[]): Promise<string> {
    for (let guard = 0; guard < labels.length + 2; guard++) {
      const found = await d.evaluate((dialog, path) => {
        const scopes = [...dialog.querySelectorAll(".ts-ref-tree > div[role=none]")];
        const self = scopes.find((s) => ["이 템플릿", "이 함수조항"].includes(s.querySelector(":scope > .ts-ref-scope")?.textContent ?? "")) ?? scopes[0];
        if (!self) return { missing: -1 };
        let lis = [...self.querySelectorAll(":scope > div[role=none] > ul > li")];
        let row: HTMLElement | null = null;
        for (const [i, label] of path.entries()) {
          const li = lis.find((l) => l.querySelector(":scope > .ts-ref-row > .ts-ref-pick")?.textContent === label);
          if (!li) return { missing: i };
          row = li.querySelector<HTMLElement>(":scope > .ts-ref-row");
          if (i < path.length - 1) {
            if (row?.getAttribute("aria-expanded") !== "true") return { expand: row?.dataset.refRow ?? "" };
            lis = [...li.querySelectorAll(":scope > ul > li")];
          }
        }
        return { id: row?.dataset.refRow ?? "" };
      }, labels);
      if ("id" in found && found.id) return found.id;
      if ("expand" in found && found.expand) {
        await this.expandRow(d, found.expand);
        continue;
      }
      throw new Error(`조 참조 고르기 트리에 「${labels.join(" › ")}」가 없다 (${JSON.stringify(found)})`);
    }
    throw new Error(`조 참조 줄을 펴지 못했다: ${labels.join(" › ")}`);
  }

  // ───────────────────────────── 조건 ─────────────────────────────

  /**
   * 조건 머리 줄 채우기 — 식을 도메인 줄 모델로 풀어 줄마다 변수 · 연산자 · 값을 고른다 (텍스트 식 입력은 없다 — ADR-0066).
   * `head` 는 그 머리 줄을 품은 요소, `label` 은 IF · ELIF.
   */
  async fillHead(head: Locator, label: string, when: string): Promise<void> {
    const parsed = parse(when);
    if (!parsed.ok) throw new Error(`식을 읽지 못했다: ${when}`);
    const rows = toRows(parsed.value);
    if (!rows) throw new Error(`머리 줄로 풀 수 없는 식: ${when}`);
    for (const [i, row] of rows.rows.entries()) {
      const name = `${label} ${i + 1}번 줄`;
      if (i > 0) {
        await head.getByRole("button", { name: `${label} ${i}번 줄 뒤에 조건 줄 추가`, exact: true }).click();
        await head.getByRole("combobox", { name: `${name} 결합`, exact: true }).selectOption(rows.joins[i - 1]);
      }
      await this.fillRow(head, name, row);
    }
    await expect(head.locator(".ts-cond-issue")).toHaveCount(0);
  }

  private async fillRow(head: Locator, name: string, row: ConditionRow): Promise<void> {
    const left = row.left!;
    const key = left.kind === "attr" ? `attr.${left.code}` : left.kind !== "discriminator" ? rowRefPath(left) : left.node ? `${left.code}@${left.node.id}` : left.code;
    await pickCombo(head.getByRole("combobox", { name: `${name} 변수`, exact: true }), { value: key });
    await head.getByRole("combobox", { name: `${name} 연산자`, exact: true }).selectOption(row.op!);
    const right = row.right;
    if (!right) return;
    if (right.kind !== "literal") throw new Error("구분자 우변은 이 E2E 에 없다");
    const value = head.getByLabel(`${name} 값`, { exact: true });
    const lit = right.literal;
    if ((await value.evaluate((el) => el.tagName)) === "SELECT") await value.selectOption(String(lit.value));
    else {
      await value.fill(String(lit.value));
      await value.press("Enter");
    }
  }

  /**
   * 문장 안 조건 — 사람이 하는 대로: 자리표시 글자를 치고 **그 글을 골라** 「문장 안 조건」(고른 글이 IF 가지 문장이 된다 — 「조건식」은 블록 조건).
   * 팝업(「문장 안 조건」)에서 가지마다 머리 줄 · 문장을 채운다. 가지 문장에 칩이 있으면 그 가지 칸에서 오른쪽 클릭 › 넣기.
   */
  private async insertInlineCond(slot: Locator, node: Extract<InlineNode, { kind: "inlineCond" }>): Promise<void> {
    const PLACEHOLDER = "※";
    await this.page.keyboard.insertText(PLACEHOLDER);
    await this.page.keyboard.press("Shift+ArrowLeft");
    await this.runTool("문장 안 조건");
    const branches = node.branches as Branch[];
    const popup = this.dialog("문장 안 조건");
    await expect(popup).toBeVisible();
    // 막 넣은 칩 — 팝업이 닫히면(가지 칩 넣기) 이 칩을 눌러 다시 연다
    const chip = slot.locator(".ts-doc-inline-chip").last();
    const reopen = async () => {
      if ((await popup.count()) > 0) return;
      await chip.click();
      await expect(popup).toBeVisible();
    };
    if (branches.length !== 2 || branches[1].when !== undefined) throw new Error("이 E2E 의 문장 안 조건은 IF · ELSE 두 가지뿐이다");
    await this.fillHead(popup.locator(".ts-pop-branch").nth(0), "IF", branches[0].when!);
    for (const [i, branch] of branches.entries()) {
      await reopen();
      const editor = () => popup.locator(".ts-pop-branch").nth(i).getByRole("textbox");
      // 자리표시(IF) · 빈 칸(ELSE)을 비우고 가지 문장을 친다
      await editor().focus();
      await this.page.keyboard.press(SELECT_ALL);
      await this.page.keyboard.press("Backspace");
      for (const child of branch.children) {
        await reopen();
        if (child.kind === "text") {
          await this.caretEnd(editor());
          await this.page.keyboard.insertText(child.text);
          continue;
        }
        await this.branchChip(editor(), child);
      }
      await reopen();
      await editor().blur();
    }
    await reopen();
    await popup.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(popup).toHaveCount(0);
    await this.noBanner();
  }

  /** 가지 문장 칸의 끝에서 오른쪽 클릭 › 넣기 — 팝업 안에서는 툴바를 누를 수 없다(모달). 넣기 팝업이 가지 팝업을 대신한다. */
  private async branchChip(editor: Locator, node: SeedInline): Promise<void> {
    const point = await editor.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const rects = [...range.getClientRects()];
      const box = el.getBoundingClientRect();
      const last = el.lastChild;
      if (last && last.nodeType === 3 && (last.textContent ?? "") !== "") {
        const r = document.createRange();
        r.setStart(last, (last.textContent ?? "").length - 1);
        r.setEnd(last, (last.textContent ?? "").length);
        const rr = [...r.getClientRects()].at(-1);
        if (rr) return { x: rr.right - 1, y: rr.top + rr.height / 2 };
      }
      const rect = rects.at(-1) ?? box;
      return { x: Math.max(box.left + 2, rect.right - 1), y: box.top + box.height / 2 };
    });
    await this.page.mouse.click(point.x, point.y, { button: "right" });
    const menu = this.page.getByRole("menu", { name: "편집 메뉴" });
    const label = node.kind === "articleRef" ? "조 참조…" : node.kind === "appendixRef" ? "별표 참조…" : node.kind === "slot" ? "치환 슬롯…" : node.kind === "clauseInlineRef" ? "함수조항(문장 안)…" : undefined;
    if (!label) throw new Error(`가지 문장에 넣을 수 없는 칩: ${node.kind}`);
    await menu.getByRole("menuitem", { name: label, exact: true }).click();
    const title = { "조 참조…": "조 참조 넣기", "별표 참조…": "별표 참조 넣기", "치환 슬롯…": "치환 슬롯 넣기", "함수조항(문장 안)…": "함수조항(문장 안) 넣기" }[label];
    const d = this.dialog(title);
    if (node.kind === "articleRef") await this.pickTargets(d, node);
    else if (node.kind === "appendixRef") await pickCombo(d.locator("#pop-appendix"), { value: node.appendixCode });
    else if (node.kind === "slot") await pickCombo(d.locator("#pop-slot"), { value: node.ref });
    else if (node.kind === "clauseInlineRef") await pickCombo(d.locator("#pop-clause"), { value: node.clauseCode });
    await this.confirm(d, "넣기");
  }
}

// ───────────────────────────── 문면 (담보약관 템플릿) ─────────────────────────────

/** 조 안 블록의 전위 목록 — 화면의 `[data-block]` 순서와 같다. */
interface BlockEntry {
  node: Node;
  /** 같은 목록의 앞 형제 (없으면 첫 자식). */
  prev?: Node;
  /** 부모 — 조 · 항 · 호. */
  parent: Node;
}

function blocksOf(article: Node): BlockEntry[] {
  const out: BlockEntry[] = [];
  const visit = (parent: Node, list: readonly Node[]) => {
    list.forEach((node, i) => {
      out.push({ node, parent, ...(i > 0 ? { prev: list[i - 1] } : {}) });
      const n = node as { items?: Node[]; subitems?: Node[] };
      if (node.kind === "paragraph") visit(node, n.items ?? []);
      if (node.kind === "item") visit(node, n.subitems ?? []);
    });
  };
  visit(article, (article as { children: Node[] }).children);
  return out;
}

/** 조 안 문장 칸의 전위 목록 — 화면의 `[data-inline]` 순서와 같다(항 · 호 · 목 문장, 표 셀은 행 우선). */
function inlineSlotsOf(article: Node): SeedInline[][] {
  const out: SeedInline[][] = [];
  for (const { node } of blocksOf(article)) {
    if (node.kind === "paragraph" || node.kind === "item" || node.kind === "subitem") out.push((node as { children: SeedInline[] }).children);
    if (node.kind === "table") for (const row of node.rows) for (const cell of row.cells) out.push(cell as SeedInline[]);
  }
  return out;
}

/** 문서의 조를 순서대로 — 조 자리 조건 블록 안의 조도 (그 조건과 함께). */
function articlesOf(tree: DocumentNode): { article: Node; wrap?: string }[] {
  const out: { article: Node; wrap?: string }[] = [];
  for (const node of tree.children) {
    if (node.kind === "article") out.push({ article: node });
    else if (node.kind === "condBlock") {
      if (node.branches.length !== 1 || node.branches[0].children.length !== 1 || node.branches[0].children[0].kind !== "article") throw new Error("조 자리 조건은 IF 하나 · 조 하나만 친다");
      out.push({ article: node.branches[0].children[0], wrap: node.branches[0].when });
    } else throw new Error(`문서 자리의 ${node.kind} 는 이 E2E 가 치지 않는다 (관은 보통약관뿐)`);
  }
  return out;
}

const BLOCK_TOOL: Partial<Record<Node["kind"], string>> = { paragraph: "항", item: "호", subitem: "목", table: "표", clauseBlockRef: "함수조항", boxRef: "박스" };

/** 문면 저작 화면 운전 — 담보약관 템플릿 한 벌. */
export class DocumentAuthoring {
  readonly editor: Editor;
  private readonly body: Locator;

  constructor(
    readonly page: Page,
    readonly tree: DocumentNode,
    refs: Omit<RefScopes, "hasScopeSelect">,
    /** 공용조항 코드 → 이름 (공용조항 블록 고르기 메뉴의 줄 이름). */
    private readonly clauseLabels: ReadonlyMap<string, string>,
    /** 박스 코드 → 이름 (툴바 「박스」 고르기 메뉴의 줄 이름). */
    private readonly boxNames: ReadonlyMap<string, string>,
  ) {
    this.body = page.locator(".ts-l3-body");
    this.editor = new Editor(page, this.body, { ...refs, hasScopeSelect: true });
  }

  /** 가운데 조(하나)의 뿌리. */
  private get article(): Locator {
    return this.body.locator("section.ts-doc-article");
  }

  /** 조 안의 블록 — 공용조항 블록의 본문(읽기 전용)은 뺀다. */
  private blockAt(index: number): Locator {
    return this.article.locator("[data-block]:not([data-clause-ref] [data-block])").nth(index);
  }

  private inlineAt(index: number): Locator {
    return this.article.locator("[data-inline]").nth(index);
  }

  /** 목차에서 조를 연다. */
  async openArticle(index: number): Promise<void> {
    await this.page.locator("nav.ts-l3-toc button.ts-toc-article").nth(index).click();
    await expect(this.page.locator("nav.ts-l3-toc button.ts-toc-article").nth(index)).toHaveAttribute("aria-current", "true");
  }

  /** 편집 시작 → 대응 보통약관 지정 (조연결 · 보통약관 조 참조 후보가 여기서 생긴다). */
  async startEdit(generalTitle: string): Promise<void> {
    await this.page.getByRole("button", { name: "편집", exact: true }).click();
    await expect(this.page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
    await this.page.getByRole("button", { name: "더보기", exact: true }).click();
    await this.page.getByRole("menuitem", { name: "대응 보통약관…", exact: true }).click();
    const d = this.editor.dialog("대응 보통약관");
    await pickCombo(d.locator("#pop-general"), { label: generalTitle });
    await this.editor.confirm(d, "확인");
  }

  /** 1단계 — 조마다 뼈대. 조 자리 조건은 모든 조를 세운 뒤 감싼다(감싼 조 아래에 조를 넣으면 가지 안으로 들어간다). */
  async buildSkeleton(): Promise<void> {
    const articles = articlesOf(this.tree);
    for (const [i, { article }] of articles.entries()) {
      if (i === 0) await this.editor.runTool("조");
      else {
        await this.openArticle(i - 1);
        await this.editor.runTool("조");
      }
      const title = this.article.getByRole("textbox", { name: "조 제목" });
      await title.fill((article as { title: string }).title);
      await title.press("Enter");
      await expect(this.article.locator("h3")).toContainText(`(${(article as { title: string }).title})`);
      await this.buildBlocks(article);
      const linked = (article as { linkedArticleId?: string }).linkedArticleId;
      if (linked) {
        await this.article.locator("h3 [role=textbox]").focus();
        await this.editor.runTool("조연결");
        const d = this.editor.dialog("조연결");
        await pickCombo(d.locator("#pop-link"), { value: linked });
        await this.editor.confirm(d, "확인");
      }
    }
    for (const [i, { wrap }] of articles.entries()) {
      if (wrap === undefined) continue;
      await this.openArticle(i);
      // 조 제목의 글을 골라 「조건식」 — 선택이 걸친 블록(조)을 감싼다. 커서만이면 조 맨 앞에 빈 조건 블록이 선다
      await this.article.locator("h3 [role=textbox]").focus();
      await this.page.keyboard.press(SELECT_ALL);
      await this.editor.runTool("조건식");
      const head = this.body.locator("[data-cond-head]").first();
      await expect(head).toBeVisible();
      await this.editor.fillHead(head, "IF", wrap);
    }
    await this.editor.noBanner();
  }

  private async buildBlocks(article: Node): Promise<void> {
    const entries = blocksOf(article);
    for (const [k, entry] of entries.entries()) {
      const tool = BLOCK_TOOL[entry.node.kind];
      if (!tool) throw new Error(`조 안의 ${entry.node.kind} 는 이 E2E 가 치지 않는다`);
      // 자리 — 앞 형제가 있으면 그 블록(「아래에 … 추가」), 없으면 부모(조 제목 → 「항 추가」 · 항 → 「호 추가」 · 호 → 「목 추가」)
      const anchor = entry.prev ? entries.findIndex((e) => e.node === entry.prev) : entry.parent.kind === "article" ? -1 : entries.findIndex((e) => e.node === entry.parent);
      await this.select(anchor);
      await this.addBlock(entry.node, tool);
      await expect(this.article.locator("[data-block]:not([data-clause-ref] [data-block])")).toHaveCount(k + 1);
    }
  }

  /** 자리 고르기 — -1 이면 조 제목, 아니면 k 번째 블록(문장 칸 · 표 첫 셀 · 공용조항 머리). */
  private async select(index: number): Promise<void> {
    if (index < 0) {
      await this.article.locator("h3 [role=textbox]").blur();
      await this.article.locator("h3 [role=textbox]").focus();
      return;
    }
    const block = this.blockAt(index);
    const inline = block.locator("[data-inline]").first();
    if ((await block.getAttribute("data-clause-ref")) !== null) {
      await block.locator(".ts-doc-clause-name").click();
      return;
    }
    // 박스 참조 — 글 칸이 없다. 박스 제목 · 첫 줄을 눌러 그 블록을 자리로 (머리 띠의 이름은 박스 화면 링크라 누르지 않는다).
    // 블록 바로 아래의 박스만 — 항 블록은 호 목록 안에 박스를 품을 수 있다
    const box = block.locator(":scope > aside.ts-doc-box");
    if ((await box.count()) > 0) {
      await box.locator(".ts-doc-box-title, .ts-doc-box-line").first().click();
      return;
    }
    // 이미 초점이 있으면 focus 가 자리를 다시 알리지 않는다 — 한 번 놓았다가 잡는다
    await inline.blur();
    await inline.focus();
  }

  private async addBlock(node: Node, tool: string): Promise<void> {
    if (node.kind === "table") {
      await this.editor.runTool(tool);
      const d = this.editor.dialog("표 넣기");
      await d.locator("#pop-rows").fill(String(node.rows.length));
      await d.locator("#pop-cols").fill(String(node.rows[0].cells.length));
      if (node.title) await d.locator("#pop-table-title").fill(node.title);
      const header = d.getByRole("checkbox", { name: "첫 행을 제목줄로" });
      if (node.rows[0].header) await header.check();
      else await header.uncheck();
      if (node.rows.slice(1).some((r) => r.header)) throw new Error("둘째 행 이후 제목줄은 이 E2E 가 치지 않는다");
      await this.editor.confirm(d, "표 만들기");
      return;
    }
    if (node.kind === "boxRef") {
      await this.editor.runTool(tool);
      await this.page.getByRole("menuitem", { name: `${this.boxNames.get(node.boxCode)}(${node.boxCode})`, exact: true }).click();
      return;
    }
    if (node.kind === "clauseBlockRef") {
      await this.editor.runTool(tool);
      await this.page.getByRole("menuitem", { name: `${this.clauseLabels.get(node.clauseCode)}(${node.clauseCode})`, exact: true }).click();
      if (Object.keys(node.options).length > 0) {
        // 블록 머리의 옵션 단추 → 「함수조항 옵션」 팝업에서 옵션마다 선택지 (인자가 있는 함수조항이면 「함수조항 옵션 · 인자」 — 인자는 기본 연결 그대로)
        const block = this.article.locator("[data-clause-ref]").filter({ hasText: `함수조항 (${this.clauseLabels.get(node.clauseCode)})` }).last();
        await block.locator(".ts-doc-clause-opt").click();
        const d = this.page.getByRole("dialog", { name: /^함수조항 옵션( · 인자)?$/ });
        for (const [option, value] of Object.entries(node.options)) await d.locator(`#pop-opt-${option}`).selectOption(value);
        await this.editor.confirm(d, "확인");
      }
      return;
    }
    await this.editor.runTool(tool);
  }

  /** 2단계 — 조마다 문장 칸을 차례로 채운다. */
  async fillSentences(): Promise<void> {
    const articles = articlesOf(this.tree);
    for (const [i, { article }] of articles.entries()) {
      await this.openArticle(i);
      const slots = inlineSlotsOf(article);
      await expect(this.article.locator("[data-inline]")).toHaveCount(slots.length);
      for (const [k, nodes] of slots.entries()) {
        if (nodes.length === 0) continue;
        await this.editor.fillInline(this.inlineAt(k), nodes);
      }
    }
  }

  /** 저장 한 번 — 읽기 모드로 돌아오고 검증 오류 0. */
  async save(): Promise<void> {
    await this.page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(this.page.getByRole("button", { name: "편집", exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(this.page.locator(".ts-l3-bar .ts-count")).toContainText("검증 오류 0");
  }
}

// ───────────────────────────── 공용조항 ─────────────────────────────

type ClauseOption = { code: string; label: string; values: { label: string; body: { kind: string; text?: string }[] }[] };
type ClauseMode = "inline" | "block";

/** 공용조항 생성 화면 운전 — 이름 · 유형 · 옵션 · 본문 (기능/함수조항 §4.2). */
export class ClauseAuthoringDriver {
  readonly editor: Editor;

  constructor(
    readonly page: Page,
    generalAncestors: Map<string, string[]>,
  ) {
    this.editor = new Editor(page, page.locator(".ts-clause-editor"), { selfPaths: new Map(), generalAncestors, hasScopeSelect: true, clauseEditor: true });
  }

  async open(mode: ClauseMode, label: string): Promise<void> {
    await this.page.goto(`/functions/new?type=${mode}`);
    await this.page.waitForLoadState("networkidle");
    await expect(this.page.getByRole("radio", { name: mode === "inline" ? /^문구/ : /^항/ })).toBeChecked();
    await this.page.getByLabel("함수조항명").fill(label);
  }

  /** 옵션 목록 — 옵션마다 이름, 선택지마다 이름 · 문구. 새 옵션은 빈 선택지 둘을 품고 온다. */
  async options(options: readonly ClauseOption[]): Promise<void> {
    this.editor.optionLabels = new Map(options.map((o) => [o.code, o.label]));
    for (const option of options) {
      await this.page.getByRole("button", { name: "옵션 추가" }).click();
      await this.page.getByLabel("옵션명").last().fill(option.label);
      for (const [i, value] of option.values.entries()) {
        if (i >= 2) await this.page.getByRole("button", { name: `${option.label}에 선택지 추가` }).click();
        await this.page.getByRole("textbox", { name: `${option.label} — 선택지 ${i + 1} 이름`, exact: true }).fill(value.label);
        await this.page.getByRole("textbox", { name: `${option.label} — 선택지 ${i + 1} 문구`, exact: true }).fill(value.body.map((n) => n.text ?? "").join(""));
      }
    }
  }

  /** 인자 표 — 인자마다 이름 · 타입 · 기본 연결(최종 결정 2). 본문의 슬롯 · 조건 고르기가 인자를 보려면 본문보다 먼저. */
  async params(params: NonNullable<ClauseSpec["params"]>): Promise<void> {
    for (const [i, p] of params.entries()) {
      await this.page.getByRole("button", { name: "인자 추가" }).click();
      await this.page.getByLabel(`인자 ${i + 1} 이름`, { exact: true }).fill(p.name);
      const type = p.type.kind === "enum" || p.type.kind === "list<enum>" ? `${p.type.kind}:${p.type.enumCode}` : p.type.kind === "planOptions" ? `planOptions:${p.type.form}` : p.type.kind;
      await this.page.getByLabel(`인자 ${i + 1} 타입`, { exact: true }).selectOption(type);
      if (p.default) await this.page.getByLabel(`인자 ${i + 1} 기본 연결`, { exact: true }).selectOption(`d:${p.default.code}`);
    }
  }

  /**
   * 본문 — 문구면 문장 한 줄, 항이면 항마다 (처음 빈 항 하나가 서 있다 · 다음 항은 툴바 「항」).
   */
  async body(mode: ClauseMode, body: readonly unknown[]): Promise<void> {
    const root = this.editor.root;
    if (mode === "inline") {
      await this.editor.fillInline(root.getByRole("textbox", { name: "문구", exact: true }), body as SeedInline[]);
      return;
    }
    // 「이 공용조항」 조 참조의 줄 표기 — 본문 k 번째 항 = 「제k항」 (고르기 트리는 조 줄 없이 항부터)
    const selfPaths = this.editor.refs.selfPaths;
    selfPaths.clear();
    (body as Node[]).forEach((node, k) => selfPaths.set(node.id, [`제${k + 1}항`]));
    for (const [i, node] of (body as Node[]).entries()) {
      if (node.kind !== "paragraph" || (node.items ?? []).length > 0) throw new Error("이 E2E 의 「항」 함수조항은 호 없는 항뿐이다");
      if (i > 0) {
        await root.getByRole("textbox", { name: "항", exact: true }).nth(i - 1).focus();
        await this.editor.runTool("항");
      }
      await this.editor.fillInline(root.getByRole("textbox", { name: "항", exact: true }).nth(i), node.children as SeedInline[]);
    }
  }

  /** 저장 한 번 — 만들어지고 상세(읽기)로 간다. 코드는 시스템 채번. */
  async save(code: string): Promise<void> {
    await this.page.getByRole("button", { name: "저장", exact: true }).click();
    await this.page.waitForURL(new RegExp(`/functions/${code}$`), { timeout: 30_000 });
    await expect(this.page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  }
}
