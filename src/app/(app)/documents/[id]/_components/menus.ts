/**
 * 자리별 조작 목록 — 툴바와 오른쪽 클릭 메뉴가 같은 목록을 쓴다 (기능/문면 §4.3). 순수 — React 없음 (`menus.test.ts`).
 *
 * 툴바(`tools.ts`)가 입구다 — 모든 항목이 툴바 버튼 하나에 대응한다. 오른쪽 클릭 메뉴는 같은 목록의 지름길이고,
 * 조건 넣기(`toolbarOnly` — 조건으로 감싸기 · 조건 블록 넣기 · 문장 안 조건)는 툴바 「조건식」에만 있다 (2026-09-27).
 * 조건 넣기는 팝업 없이 곧바로 명령이다 — 빈 IF 줄 하나를 든 조건 블록(또는 문장 안 조건 칩)이 서고, 식은 그 머리 줄에서 고친다 (2026-09-28).
 *
 * 메뉴 항목은 **허용 자식 규칙**(§3.2 — 도메인 `allowedIn` · 색인의 `allowed`)과 중첩 제한(§3.2 · §3.3)을 따른다.
 * 규칙상 불가한 넣기는 싣지 않고, 할 일이 없는 조작(맨 위에서 「위로」)은 잠근다.
 * 항목이 하는 일은 셋 — 명령을 바로 적용(`ops`) · 그 자리에 팝업(`popup`) · 삭제 확인(`remove`).
 */
import type { DocumentNode, EditOp, IdSource, InlineAt, NodeKind, Position, TreeIndex } from "@/domain/document";
import type { AttachLevel, Id } from "@/domain/types";

import { nodeBuilders, repeatLevels as repeatLevelsOf } from "@/domain/document";

import { afterOf, emptyNode, inlineListAt, moveOps, removeChipOps, siblingPlace, unwrapOps, wrapOps } from "./editOps";
import { runsFromTokens, type Token } from "./inlineRuns";

/** 문장 안에 팝업으로 넣는 칩 종류 (문장 안 조건은 팝업 없이 곧바로 선다 — `inlineCondItem`). */
export type InlineInsertKind = "slot" | "articleRef" | "appendixRef" | "clauseInlineRef" | "structKey";

/** 그 자리에 뜨는 팝업 — 무엇을 고치거나 넣는가. 조건식은 팝업이 없다(블록 머리 줄에서 고친다). */
export type PopupSpec =
  | { kind: "insertInline"; what: InlineInsertKind; at: InlineAt; tokens: Token[]; structLevels?: readonly Exclude<AttachLevel, "product">[] }
  | { kind: "editChip"; nodeId: Id }
  | { kind: "newTable"; at: Position }
  | { kind: "clauseBlock"; at: Position }
  | { kind: "tableProps"; tableId: Id }
  | { kind: "repeat"; tableId: Id }
  | { kind: "link"; articleId: Id }
  | { kind: "docTitle" }
  | { kind: "general" };

export type MenuAction =
  /**
   * 명령을 바로 적용 — `focus` 는 적용 뒤 초점을 둘 노드(문장 칸의 주인 · 조건 가지면 그 머리 줄 첫 칸), `goArticle` 은 가운데에 열 조 (새 조 · 새 관),
   * `openChip` 은 적용 뒤 그 칩의 팝업을 연다(문장 안 조건 — 가지 문장 · 식을 거기서 쓴다).
   */
  | { do: "ops"; ops: EditOp[] | ((tree: DocumentNode) => EditOp[]); focus?: Id; goArticle?: Id; goDuplicate?: boolean; openChip?: Id }
  | { do: "popup"; popup: PopupSpec }
  | { do: "remove"; nodeId: Id };

export interface MenuItem {
  label: string;
  action: MenuAction;
  disabled?: boolean;
  danger?: boolean;
  /** 툴바에만 — 오른쪽 클릭 메뉴에는 싣지 않는다 (조건 넣기는 툴바 「조건식」, 기능/문면 §6.2). */
  toolbarOnly?: boolean;
  /** 이 자리에서 막힌 도구 — 툴바는 잠그고 이 사유를 tooltip 으로, 오른쪽 클릭 메뉴는 누르면 거부 배너. */
  refusal?: string;
  /** 조건으로 감싸기가 감쌀 노드 — 공용조항 메뉴가 자리를 거른다. */
  wrapTarget?: Id;
}

/** 오른쪽 클릭 메뉴에 싣는 것 — 툴바 전용(조건 넣기)을 뺀다. */
export function forContextMenu(sections: MenuSections): MenuSections {
  return sections.map((section) => section.filter((item) => !item.toolbarOnly)).filter((section) => section.length > 0);
}

/** 메뉴는 구획(구분선으로 나뉜 묶음)의 목록이다. 빈 구획은 그리지 않는다. */
export type MenuSections = MenuItem[][];

const KIND_WORD: Partial<Record<NodeKind, string>> = { paragraph: "항", item: "호", subitem: "목", article: "조", section: "관", table: "표", box: "박스", clauseBlockRef: "공용조항" };

/**
 * 위로 · 아래로 · 복제 · 삭제 — 모든 블록이 같은 네 줄을 쓴다.
 * 명령은 누르는 순간의 편집본으로 만든다 — 메뉴를 연 뒤 문장 칸이 초점을 잃으며 글이 먼저 적용될 수 있다.
 */
function arrangeItems(ix: TreeIndex, nodeId: Id): MenuItem[] {
  const place = siblingPlace(ix, nodeId);
  const kind = ix.nodes.get(nodeId)?.node.kind;
  return [
    { label: "위로", action: { do: "ops", ops: (t) => moveOps(t, nodeId, -1) }, disabled: !place || place.index === 0 },
    { label: "아래로", action: { do: "ops", ops: (t) => moveOps(t, nodeId, 1) }, disabled: !place || place.index >= place.count - 1 },
    { label: "복제", action: { do: "ops", ops: [{ type: "duplicate", nodeId }], goDuplicate: kind === "article" || kind === "section" } },
    { label: "삭제", action: { do: "remove", nodeId }, danger: true },
  ];
}

/** 새 가지 · 새 조건 블록 안의 첫 칸 — 그 자리에 설 수 있는 항 · 호 · 목 중 먼저 것(없으면 빈 가지). */
function firstChild(allowed: readonly NodeKind[], newId: IdSource) {
  const kind = (["paragraph", "item", "subitem"] as const).find((k) => allowed.includes(k));
  return kind ? [emptyNode(kind, newId)] : [];
}

/**
 * 조건으로 감싸기 — 툴바 「조건식」만 (오른쪽 클릭 메뉴에는 없다). 팝업 없이 곧바로 감싸고 빈 IF 줄에 초점 (2026-09-28).
 * `wrapTarget` 은 공용조항 메뉴가 감쌀 자리를 거르는 표지.
 */
function wrapItem(env: MenuEnv, nodeId: Id): MenuItem {
  const branchId = env.newId();
  return { label: "조건으로 감싸기", action: { do: "ops", ops: (t) => wrapOps(t, nodeId, "", env.newId, branchId), focus: branchId }, toolbarOnly: true, wrapTarget: nodeId };
}

/** 조건 블록 넣기 — 감쌀 블록이 없는 자리(조 본문 · 공용조항 본문)의 「조건식」. 빈 IF 줄 + 빈 항 하나를 든 조건 블록을 끝에 넣는다. */
export function condBlockItem(env: MenuEnv, at: Position, allowed: readonly NodeKind[]): MenuItem {
  const b = nodeBuilders(env.newId);
  const branch = b.branch("", firstChild(allowed, env.newId));
  return { label: "조건 블록 넣기", action: { do: "ops", ops: [{ type: "insert", node: b.condBlock([branch]), at }], focus: branch.id }, toolbarOnly: true };
}

export interface MenuEnv {
  tree: DocumentNode;
  ix: TreeIndex;
  docKind: "special" | "general";
  newId: IdSource;
}

/** 항 · 호 · 목 · 표 · 박스 · 공용조항(조 단위) 블록의 메뉴. */
export function blockMenu(env: MenuEnv, nodeId: Id): MenuSections {
  const { ix } = env;
  const e = ix.nodes.get(nodeId);
  if (!e) return [];
  const after = afterOf(ix, nodeId);
  const add: MenuItem[] = [];
  if (after) {
    for (const k of ["paragraph", "item", "subitem"] as const) {
      if (!e.allowed.includes(k)) continue;
      const node = emptyNode(k, env.newId);
      add.push({ label: `아래에 ${KIND_WORD[k]} 추가`, action: { do: "ops", ops: [{ type: "insert", node, at: after }], focus: node.id } });
    }
  }
  if (e.node.kind === "paragraph") {
    const node = emptyNode("item", env.newId);
    add.push({ label: "호 추가", action: { do: "ops", ops: [{ type: "insert", node, at: { parentId: nodeId, slot: "items" } }], focus: node.id } });
  }
  if (e.node.kind === "item") {
    const node = emptyNode("subitem", env.newId);
    add.push({ label: "목 추가", action: { do: "ops", ops: [{ type: "insert", node, at: { parentId: nodeId, slot: "subitems" } }], focus: node.id } });
  }
  if (after && e.allowed.includes("table")) add.push({ label: "아래에 표 추가…", action: { do: "popup", popup: { kind: "newTable", at: after } } });
  if (after && e.allowed.includes("box")) add.push({ label: "아래에 박스 추가", action: { do: "ops", ops: [{ type: "insert", node: emptyNode("box", env.newId), at: after }] } });
  if (after && e.allowed.includes("clauseBlockRef")) add.push({ label: "아래에 공용조항(조 단위) 추가…", action: { do: "popup", popup: { kind: "clauseBlock", at: after } } });

  const own: MenuItem[] = [];
  if (e.node.kind === "table") {
    own.push({ label: "표 속성…", action: { do: "popup", popup: { kind: "tableProps", tableId: nodeId } } });
    if (env.docKind === "special") own.push({ label: "행 반복…", action: { do: "popup", popup: { kind: "repeat", tableId: nodeId } } });
  }
  if (e.node.kind === "clauseBlockRef") own.push({ label: "옵션 고치기…", action: { do: "popup", popup: { kind: "editChip", nodeId } } });
  if (e.allowed.includes("condBlock")) own.push(wrapItem(env, nodeId));

  return [add, own, arrangeItems(ix, nodeId)];
}

/**
 * 툴바 「공용조항」의 고르기 목록 — 버튼 아래 작은 메뉴에 공용조항마다 한 줄, 고르면 그 자리에 공용조항 블록(옵션은 블록 머리 띠에서 고른다).
 * 모달 없이 고른다 (2026-09-28). 오른쪽 클릭 메뉴의 「…추가…」는 옵션까지 한 번에 고르는 그 자리 팝업 그대로.
 */
export function clausePickItems(clauses: readonly { code: string; label: string }[], at: Position, newId: IdSource): MenuItem[] {
  const b = nodeBuilders(newId);
  return clauses.map((c) => ({ label: `${c.label}(${c.code})`, action: { do: "ops", ops: [{ type: "insert", node: b.clauseBlock(c.code, {}), at }] } }));
}

/**
 * 조의 메뉴 — 조 추가 · (문서 자리면) 관 추가 · 항 추가 · 조연결 · 조건 · 이동 · 복제 · 삭제.
 * 조건은 자리대로 — 조 제목을 골랐으면(`title`) 그 조를 감싸고, 조 본문(고른 블록 없음)이면 조 끝에 새 조건 블록.
 */
export function articleMenu(env: MenuEnv, articleId: Id, title = true): MenuSections {
  const { ix } = env;
  const e = ix.nodes.get(articleId);
  if (!e || e.node.kind !== "article") return [];
  const after = afterOf(ix, articleId);
  const add: MenuItem[] = [];
  if (after) {
    const article = emptyNode("article", env.newId);
    add.push({ label: "아래에 조 추가", action: { do: "ops", ops: [{ type: "insert", node: article, at: after }], goArticle: article.id } });
    if (e.allowed.includes("section")) {
      const section = emptyNode("section", env.newId) as { id: Id; children: { id: Id }[] } & ReturnType<typeof emptyNode>;
      add.push({ label: "아래에 관 추가", action: { do: "ops", ops: [{ type: "insert", node: section, at: after }], goArticle: section.children[0].id } });
    }
  }
  const paragraph = emptyNode("paragraph", env.newId);
  add.push({ label: "항 추가", action: { do: "ops", ops: [{ type: "insert", node: paragraph, at: { parentId: articleId } }], focus: paragraph.id } });

  const own: MenuItem[] = [];
  if (env.docKind === "special") own.push({ label: "조연결…", action: { do: "popup", popup: { kind: "link", articleId } } });
  if (title && e.allowed.includes("condBlock")) own.push(wrapItem(env, articleId));
  if (!title) own.push(condBlockItem(env, { parentId: articleId }, ["paragraph"]));
  return [add, own, arrangeItems(ix, articleId)];
}

/** 관 머리의 메뉴 — 이 관에 조 추가 · 아래에 관 추가 · 감싸기 · 이동 · 복제 · 삭제. */
export function sectionMenu(env: MenuEnv, sectionId: Id): MenuSections {
  const { ix } = env;
  const e = ix.nodes.get(sectionId);
  if (!e || e.node.kind !== "section") return [];
  const after = afterOf(ix, sectionId);
  const article = emptyNode("article", env.newId);
  const add: MenuItem[] = [{ label: "이 관에 조 추가", action: { do: "ops", ops: [{ type: "insert", node: article, at: { parentId: sectionId } }], goArticle: article.id } }];
  if (after && e.allowed.includes("section")) {
    const section = emptyNode("section", env.newId) as ReturnType<typeof emptyNode> & { children: { id: Id }[] };
    add.push({ label: "아래에 관 추가", action: { do: "ops", ops: [{ type: "insert", node: section, at: after }], goArticle: section.children[0].id } });
  }
  const own: MenuItem[] = e.allowed.includes("condBlock") ? [wrapItem(env, sectionId)] : [];
  return [add, own, arrangeItems(ix, sectionId)];
}

/** 빈 문서(조가 하나도 없다)의 메뉴. */
export function documentMenu(env: MenuEnv): MenuSections {
  const at: Position = { parentId: env.tree.id };
  const article = emptyNode("article", env.newId);
  const section = emptyNode("section", env.newId) as ReturnType<typeof emptyNode> & { children: { id: Id }[] };
  return [
    [
      { label: "조 추가", action: { do: "ops", ops: [{ type: "insert", node: article, at }], goArticle: article.id } },
      { label: "관 추가", action: { do: "ops", ops: [{ type: "insert", node: section, at }], goArticle: section.children[0].id } },
    ],
  ];
}

/** 조건 머리(가지 하나)의 메뉴 — 가지 추가 · ELSE 추가 · 가지 삭제 · 풀기 · 블록 삭제. 식은 머리 줄에서 그 자리로 고친다(메뉴 항목 없음). */
export function condMenu(env: MenuEnv, branchId: Id): MenuSections {
  const { ix } = env;
  const br = ix.branches.get(branchId);
  if (!br) return [];
  const owner = ix.nodes.get(br.ownerId);
  if (!owner) return [];
  const branches = (owner.node as { branches: { when?: string }[] }).branches;
  const hasElse = branches.some((b) => b.when === undefined);
  // 조 자리(문서 · 관) 조건 블록은 켜고 끄기(IF 하나)만 넣게 한다 — 가지를 더하면 빈 가지가 목차 · 가운데 어디에도 안 보인다 (§3.3 · ADR-0072 결정 2b)
  const articleLevel = br.allowed.includes("article");
  const branch: MenuItem[] = [];
  const b = nodeBuilders(env.newId);
  const elseAt = branches.findIndex((x) => x.when === undefined);
  // 새 가지는 빈 IF 줄(식 "")과 그 자리의 빈 항 · 호 · 목 하나를 들고 선다 — 곧바로 그 머리 줄에서 식을 고른다
  if (!articleLevel && owner.node.kind === "condBlock") {
    const elif = b.branch("", firstChild(br.allowed, env.newId));
    branch.push({ label: "가지 추가(ELIF)", action: { do: "ops", ops: [{ type: "addBranch", condId: owner.node.id, branch: elif, ...(elseAt >= 0 ? { index: elseAt } : {}) }], focus: elif.id } });
  }
  if (!hasElse && !articleLevel && owner.node.kind === "condBlock") {
    const elseBranch = b.branch(undefined, firstChild(br.allowed, env.newId));
    const first = elseBranch.children[0];
    branch.push({ label: "ELSE 가지 추가", action: { do: "ops", ops: [{ type: "addBranch", condId: owner.node.id, branch: elseBranch }], ...(first ? { focus: first.id } : {}) } });
  }
  branch.push({ label: "이 가지 삭제", action: { do: "ops", ops: [{ type: "removeBranch", branchId }] }, disabled: branches.length <= 1, danger: true });
  // 가지 안 끝에 넣기 — 가지의 허용 집합은 조건 블록이 선 자리와 같다(투명). 빈 가지(새 ELSE)에 첫 내용을 넣는 입구다.
  const into: MenuItem[] = [];
  if (owner.node.kind === "condBlock") {
    const at: Position = { parentId: branchId };
    for (const k of ["paragraph", "item", "subitem"] as const) {
      if (!br.allowed.includes(k)) continue;
      const node = emptyNode(k, env.newId);
      into.push({ label: `이 가지에 ${KIND_WORD[k]} 추가`, action: { do: "ops", ops: [{ type: "insert", node, at }], focus: node.id } });
    }
    if (br.allowed.includes("article")) {
      const article = emptyNode("article", env.newId);
      into.push({ label: "이 가지에 조 추가", action: { do: "ops", ops: [{ type: "insert", node: article, at }], goArticle: article.id } });
    }
    if (br.allowed.includes("table")) into.push({ label: "이 가지에 표 추가…", action: { do: "popup", popup: { kind: "newTable", at } } });
  }
  return [
    branch,
    into,
    [
      { label: "조건 풀기 — 이 가지 내용만 남긴다", action: { do: "ops", ops: (t) => unwrapOps(t, branchId) } },
      { label: "조건 블록 삭제", action: { do: "remove", nodeId: owner.node.id }, danger: true },
    ],
  ];
}

/** 칩(슬롯 · 참조 · 공용조항 · 구조 표기 · 문장 안 조건)의 메뉴 — 고치기 · 풀기(조건) · 삭제. */
export function chipMenu(env: MenuEnv, chipId: Id): MenuSections {
  const e = env.ix.nodes.get(chipId);
  if (!e) return [];
  const items: MenuItem[] = [];
  if (e.node.kind !== "structKey") items.push({ label: "고치기…", action: { do: "popup", popup: { kind: "editChip", nodeId: chipId } } });
  if (e.node.kind === "inlineCond") {
    const first = e.node.branches[0];
    if (first) items.push({ label: "조건 풀기 — 첫 가지 문장만 남긴다", action: { do: "ops", ops: (t) => unwrapOps(t, first.id) } });
  }
  items.push({ label: "삭제", action: { do: "ops", ops: (t) => removeChipOps(t, chipId) }, danger: true });
  return [items];
}

/**
 * 문장 안 조건 넣기 — 팝업 없이 커서 자리에 칩(빈 IF 줄 + ELSE)을 세우고 그 칩의 팝업을 연다(가지 문장 · 머리 줄을 거기서 쓴다, 2026-09-28).
 * 고른 글(`cut`)이 있으면 그 글이 IF 가지 문장이 된다 — 조각(`tokens`)에서는 이미 빠져 있다.
 */
export function inlineCondItem(at: InlineAt, tokens: Token[], newId: IdSource, cut?: string): MenuItem {
  const b = nodeBuilders(newId);
  const node = b.inlineCond([b.inlineBranch("", cut ? [b.text(cut)] : []), b.inlineBranch(undefined, [])]);
  return {
    label: "문장 안 조건",
    toolbarOnly: true,
    action: {
      do: "ops",
      ops: (tree): EditOp[] => {
        const list = inlineListAt(tree, at);
        return list ? [{ type: "setInlines", at, runs: runsFromTokens(list, tokens, newId, node) }] : [];
      },
      openChip: node.id,
    },
  };
}

/**
 * 문장 속(커서 자리)의 넣기 — 슬롯 · 조 참조 · 별표 참조 · 공용조항(문장 안) · 문장 안 조건 (+ 반복 표 템플릿 셀이면 구조 표기).
 * 문장 안 조건의 가지 안이면 문장 안 조건은 싣지 않는다 (중첩 금지 §3.2).
 */
export function inlineInsertItems(at: InlineAt, tokens: Token[], opts: { inInlineCond: boolean; newId: IdSource; structLevels?: readonly Exclude<AttachLevel, "product">[] }): MenuItem[] {
  const pop = (what: InlineInsertKind, label: string): MenuItem => ({
    label,
    action: { do: "popup", popup: { kind: "insertInline", what, at, tokens, ...(what === "structKey" && opts.structLevels ? { structLevels: opts.structLevels } : {}) } },
  });
  const items = [pop("slot", "치환 슬롯…"), pop("articleRef", "조 참조…"), pop("appendixRef", "별표 참조…"), pop("clauseInlineRef", "공용조항(문장 안)…")];
  if (!opts.inInlineCond) items.push(inlineCondItem(at, tokens, opts.newId));
  if (opts.structLevels && opts.structLevels.length > 0) items.push(pop("structKey", "구조 표기…"));
  return items;
}

/**
 * 조작의 자리 — 가운데서 마지막으로 누르거나 초점이 간 곳. 툴바 · 오른쪽 클릭 메뉴가 이 자리로 목록을 짓는다.
 * DOM 에서 읽는 것은 `place.ts`(`placeOf`), 여기는 순수.
 */
export type Place =
  | { kind: "chip"; id: Id }
  | { kind: "head"; id: Id }
  | { kind: "articleTitle"; id: Id }
  | { kind: "sectionTitle"; id: Id }
  | { kind: "inline"; at: InlineAt }
  | { kind: "block"; id: Id }
  | { kind: "article"; id: Id }
  | { kind: "document" };

/** 문장 속 자리의 목록 — 넣기 도구 + (그 문장의 주인이 블록이면) 그 블록의 조작. */
function inlineSections(env: MenuEnv, at: InlineAt, tokens: Token[]): MenuSections {
  if ("tableId" in at) {
    const t = env.ix.nodes.get(at.tableId)?.node;
    const template = t?.kind === "table" && t.repeat !== undefined && !t.rows[at.row]?.header ? repeatLevelsOf(t) : undefined;
    return [inlineInsertItems(at, tokens, { inInlineCond: false, newId: env.newId, ...(template ? { structLevels: template } : {}) }), ...blockMenu(env, at.tableId)];
  }
  const branch = env.ix.branches.get(at.parentId);
  if (branch) return [inlineInsertItems(at, tokens, { inInlineCond: env.ix.nodes.get(branch.ownerId)?.node.kind === "inlineCond", newId: env.newId })];
  const owner = env.ix.nodes.get(at.parentId);
  return [inlineInsertItems(at, tokens, { inInlineCond: owner?.inInlineCond ?? false, newId: env.newId }), ...(owner ? blockMenu(env, at.parentId) : [])];
}

/** 자리가 편집본에 아직 있는가 — 지워졌으면 툴바는 기본 자리(지금 조 · 문서)로 돌아간다. */
export function placeExists(ix: TreeIndex, place: Place): boolean {
  switch (place.kind) {
    case "document":
      return true;
    case "head":
      return ix.branches.has(place.id);
    case "inline":
      return "tableId" in place.at ? ix.nodes.has(place.at.tableId) : ix.nodes.has(place.at.parentId) || ix.branches.has(place.at.parentId);
    default:
      return ix.nodes.has(place.id);
  }
}

/** 자리 하나의 목록 — 오른쪽 클릭 메뉴와 툴바가 같은 것을 쓴다. `tokens` 는 문장 자리의 DOM 조각(커서 포함). */
export function placeMenu(env: MenuEnv, place: Place, tokens: Token[] = []): MenuSections {
  switch (place.kind) {
    case "chip":
      return chipMenu(env, place.id);
    case "head":
      return condMenu(env, place.id);
    case "articleTitle":
      return articleMenu(env, place.id);
    case "article":
      return articleMenu(env, place.id, false);
    case "sectionTitle":
      return sectionMenu(env, place.id);
    case "inline":
      return inlineSections(env, place.at, tokens);
    case "block":
      return blockMenu(env, place.id);
    case "document":
      return documentMenu(env);
  }
}
