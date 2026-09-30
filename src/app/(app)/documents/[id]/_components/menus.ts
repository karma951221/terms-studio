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

import { allowedIn, nodeBuilders, repeatLevels as repeatLevelsOf } from "@/domain/document";

import { afterOf, emptyNode, inlineListAt, moveOps, removeChipOps, selectionRange, siblingPlace, unwrapOps, wrapOps, wrapRangeOps } from "./editOps";
import { runsFromTokens, type Token } from "./inlineRuns";

/** 문장 안에 팝업으로 넣는 칩 종류 (문장 안 조건은 팝업 없이 곧바로 선다 — `inlineCondItem`). */
export type InlineInsertKind = "slot" | "articleRef" | "appendixRef" | "clauseInlineRef" | "structKey";

/** 그 자리에 뜨는 팝업 — 무엇을 고치거나 넣는가. 조건식은 팝업이 없다(블록 머리 줄에서 고친다). */
export type PopupSpec =
  | { kind: "insertInline"; what: InlineInsertKind; at: InlineAt; tokens: Token[]; structLevels?: readonly Exclude<AttachLevel, "product">[] }
  | { kind: "editChip"; nodeId: Id }
  | { kind: "newTable"; at: Position }
  /** 함수조항 넣기 — `fit` 은 그 자리에 맞는 유형(항 = 조 자리 · 호 = 호 목록 · 목 = 목 목록). 없으면 항. */
  | { kind: "clauseBlock"; at: Position; fit?: ClauseFit }
  /** 정적 마스터 박스 고르기 — 고르면 그 자리에 박스 참조 (기능/박스 §4.4). */
  | { kind: "boxPick"; at: Position }
  /** 블록 반복 — `at` 이면 넣기(원천 고르기 → 빈 항 · 호 하나를 든 반복), `nodeId` 면 그 반복의 원천 · 이름 고치기 (ADR-0077). */
  | { kind: "repeatBlock"; at?: Position; nodeId?: Id }
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
  /** 조건으로 감싸기가 감쌀 노드 — 함수조항 메뉴가 자리를 거른다. */
  wrapTarget?: Id;
}

/** 오른쪽 클릭 메뉴에 싣는 것 — 툴바 전용(조건 넣기)을 뺀다. */
export function forContextMenu(sections: MenuSections): MenuSections {
  return sections.map((section) => section.filter((item) => !item.toolbarOnly)).filter((section) => section.length > 0);
}

/** 메뉴는 구획(구분선으로 나뉜 묶음)의 목록이다. 빈 구획은 그리지 않는다. */
export type MenuSections = MenuItem[][];

const KIND_WORD: Partial<Record<NodeKind, string>> = { paragraph: "항", item: "호", subitem: "목", bullet: "항목", bulletList: "글머리 목록", article: "조", section: "관", table: "표", box: "박스", clauseBlockRef: "함수조항", boxRef: "박스", forBlock: "반복 블록" };

/** 반복 깊이 한도 — 반복 안 반복 하나 (ADR-0077 결정 4). 도메인 `REPEAT_MAX_DEPTH` 와 같다. */
const MAX_REPEAT_DEPTH = 2;

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

/** 새 가지 · 새 조건 블록 안의 첫 칸 — 그 자리에 설 수 있는 항 · 호 · 목 · 글머리 항목 중 먼저 것(없으면 빈 가지). */
function firstChild(allowed: readonly NodeKind[], newId: IdSource) {
  const kind = (["paragraph", "item", "subitem", "bullet"] as const).find((k) => allowed.includes(k));
  return kind ? [emptyNode(kind, newId)] : [];
}

/** 글머리 목록 넣기 — 빈 항목 하나를 든 목록을 그 자리에, 커서는 그 항목으로 (Enter 로 다음 항목, 빈 항목에서 Enter 면 목록 끝). */
function bulletListItem(label: string, at: Position, newId: IdSource): MenuItem {
  const b = nodeBuilders(newId);
  const bullet = b.bullet([]);
  return { label, action: { do: "ops", ops: [{ type: "insert", node: b.bulletList([bullet]), at }], focus: bullet.id } };
}

/**
 * 조건으로 감싸기 — 툴바 「조건식」만 (오른쪽 클릭 메뉴에는 없다). 팝업 없이 곧바로 감싸고 빈 IF 줄에 초점 (2026-09-28).
 * `wrapTarget` 은 함수조항 메뉴가 감쌀 자리를 거르는 표지.
 */
function wrapItem(env: MenuEnv, nodeId: Id): MenuItem {
  const branchId = env.newId();
  return { label: "조건으로 감싸기", action: { do: "ops", ops: (t) => wrapOps(t, nodeId, "", env.newId, branchId), focus: branchId }, toolbarOnly: true, wrapTarget: nodeId };
}

/** 조건 블록 넣기 — 감쌀 블록이 없는 자리(조 본문 · 함수조항 본문)의 「조건식」. 빈 IF 줄 + 빈 항 하나를 든 조건 블록을 끝에 넣는다. */
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

/** 항 · 호 · 목 · 표 · 박스 · 함수조항(조 단위) · 박스 참조 블록의 메뉴. */
export function blockMenu(env: MenuEnv, nodeId: Id): MenuSections {
  const { ix } = env;
  const e = ix.nodes.get(nodeId);
  if (!e) return [];
  const after = afterOf(ix, nodeId);
  const add: MenuItem[] = [];
  if (after) {
    for (const k of ["paragraph", "item", "subitem", "bullet"] as const) {
      if (!e.allowed.includes(k)) continue;
      const node = emptyNode(k, env.newId);
      add.push({ label: `아래에 ${KIND_WORD[k]} 추가`, action: { do: "ops", ops: [{ type: "insert", node, at: after }], focus: node.id } });
    }
  }
  if (e.node.kind === "paragraph") {
    const node = emptyNode("item", env.newId);
    add.push({ label: "호 추가", action: { do: "ops", ops: [{ type: "insert", node, at: { parentId: nodeId, slot: "items" } }], focus: node.id } });
  }
  if (e.node.kind === "paragraph") add.push({ label: "함수조항(호) 추가…", action: { do: "popup", popup: { kind: "clauseBlock", at: { parentId: nodeId, slot: "items" }, fit: "item" } } });
  if (e.node.kind === "item") {
    const node = emptyNode("subitem", env.newId);
    add.push({ label: "목 추가", action: { do: "ops", ops: [{ type: "insert", node, at: { parentId: nodeId, slot: "subitems" } }], focus: node.id } });
    add.push({ label: "함수조항(목) 추가…", action: { do: "popup", popup: { kind: "clauseBlock", at: { parentId: nodeId, slot: "subitems" }, fit: "subitem" } } });
  }
  if (after && e.allowed.includes("table")) add.push({ label: "아래에 표 추가…", action: { do: "popup", popup: { kind: "newTable", at: after } } });
  if (after && e.allowed.includes("bulletList")) add.push(bulletListItem("아래에 글머리 목록 추가", after, env.newId));
  // 함수조항 — 그 자리에 맞는 유형만(유형 = 출력 모양, 최종 결정 4): 조 자리는 「항」, 호 목록은 「호」, 목 목록은 「목」
  if (after && e.allowed.includes("clauseBlockRef")) {
    const fit = fitOf(e.allowed);
    add.push({ label: `아래에 함수조항(${FIT_WORD[fit]}) 추가…`, action: { do: "popup", popup: { kind: "clauseBlock", at: after, ...(fit === "block" ? {} : { fit }) } } });
  }
  // 정적 마스터 박스 — 조 자리 · 항 · 호 뒤(호 목록 자리). 박스는 잎이라 함수조항 본문에서도 같다 (기능/박스 §3.2)
  if (after && e.allowed.includes("boxRef")) add.push({ label: "아래에 박스 추가…", action: { do: "popup", popup: { kind: "boxPick", at: after } } });
  // 블록 반복 — 조 자리 · 호 목록 자리, 반복 안 반복은 한 단계까지 (ADR-0077)
  if (after && e.allowed.includes("forBlock") && e.forDepth < MAX_REPEAT_DEPTH) add.push({ label: "아래에 반복 블록 추가…", action: { do: "popup", popup: { kind: "repeatBlock", at: after } } });
  if (e.node.kind === "paragraph" && e.forDepth < MAX_REPEAT_DEPTH) add.push({ label: "반복 블록(호) 추가…", action: { do: "popup", popup: { kind: "repeatBlock", at: { parentId: nodeId, slot: "items" } } } });
  if (e.node.kind === "forBlock") add.push(...repeatIntoItems(env, nodeId, e.allowed, e.forDepth + 1));

  const own: MenuItem[] = [];
  if (e.node.kind === "table") {
    own.push({ label: "표 속성…", action: { do: "popup", popup: { kind: "tableProps", tableId: nodeId } } });
    if (env.docKind === "special") own.push({ label: "행 반복…", action: { do: "popup", popup: { kind: "repeat", tableId: nodeId } } });
  }
  if (e.node.kind === "clauseBlockRef") own.push({ label: "옵션 고치기…", action: { do: "popup", popup: { kind: "editChip", nodeId } } });
  if (e.node.kind === "forBlock") own.push({ label: "반복 원천…", action: { do: "popup", popup: { kind: "repeatBlock", nodeId } } });
  if (e.allowed.includes("condBlock")) own.push(wrapItem(env, nodeId));

  return [add, own, arrangeItems(ix, nodeId)];
}

/**
 * 반복 블록 안 끝에 넣기 — 본문 자리는 반복이 선 자리의 허용 집합(표 · 옛 박스 제외, 투명)이다. 빈 반복(원소 본문 없음)에 첫 내용을 넣는 입구.
 * `depth` = 이 반복 자신까지의 깊이 — 한 단계 중첩 한도 안이면 안쪽 반복도 넣는다.
 */
function repeatIntoItems(env: MenuEnv, forId: Id, allowed: readonly NodeKind[], depth: number): MenuItem[] {
  const at: Position = { parentId: forId };
  const out: MenuItem[] = [];
  for (const k of ["paragraph", "item"] as const) {
    if (!allowed.includes(k)) continue;
    const node = emptyNode(k, env.newId);
    out.push({ label: `이 반복에 ${KIND_WORD[k]} 추가`, action: { do: "ops", ops: [{ type: "insert", node, at }], focus: node.id } });
  }
  if (allowed.includes("clauseBlockRef")) {
    const fit = fitOf(allowed);
    out.push({ label: `이 반복에 함수조항(${FIT_WORD[fit]}) 추가…`, action: { do: "popup", popup: { kind: "clauseBlock", at, ...(fit === "block" ? {} : { fit }) } } });
  }
  if (allowed.includes("forBlock") && depth < MAX_REPEAT_DEPTH) out.push({ label: "이 반복에 반복 블록 추가…", action: { do: "popup", popup: { kind: "repeatBlock", at } } });
  return out;
}

/**
 * 툴바 「함수조항」의 고르기 목록 — 버튼 아래 작은 메뉴에 함수조항마다 한 줄, 고르면 그 자리에 함수조항 블록(옵션은 블록 머리 띠에서 고른다).
 * 모달 없이 고른다 (2026-09-28). 오른쪽 클릭 메뉴의 「…추가…」는 옵션까지 한 번에 고르는 그 자리 팝업 그대로.
 */
export function clausePickItems(clauses: readonly { code: string; label: string; mode?: string }[], at: Position, newId: IdSource, fit: ClauseFit = "block"): MenuItem[] {
  const b = nodeBuilders(newId);
  return clausesFitting(clauses, fit).map((c) => ({ label: `${c.label}(${c.code})`, action: { do: "ops", ops: [{ type: "insert", node: b.clauseBlock(c.code, {}), at }] } }));
}

/**
 * 툴바 「박스」의 고르기 목록 — 정적 마스터 박스마다 한 줄(「이름(코드)」), 고르면 그 자리에 박스 참조를 곧바로 넣는다 (기능/박스 §4.4).
 * 박스는 조 자리 · 호 목록 자리 어디서나 같아 자리로 거르지 않는다.
 */
export function boxPickItems(boxes: readonly { code: string; name: string }[], at: Position, newId: IdSource): MenuItem[] {
  const b = nodeBuilders(newId);
  return boxes.map((x) => ({ label: `${x.name}(${x.code})`, action: { do: "ops", ops: [{ type: "insert", node: b.boxRef(x.code), at }] } }));
}

/** 블록 자리에 넣는 함수조항 유형 — 조 자리 「항」 · 호 목록 「호」 · 목 목록 「목」. */
export type ClauseFit = "block" | "item" | "subitem";

const FIT_WORD: Record<ClauseFit, string> = { block: "조 단위", item: "호", subitem: "목" };

/** 자리(허용 집합)에 맞는 유형 — 조건 가지는 서 있는 자리를 물려받는다 (문서 `clausePlacement` 와 같은 판정). */
export function fitOf(allowed: readonly NodeKind[]): ClauseFit {
  if (allowed.includes("item")) return "item";
  if (allowed.includes("subitem")) return "subitem";
  return "block";
}

/**
 * 그 자리에 설 수 있는 함수조항 — 유형 = 출력 모양 (기능/함수조항 §3.1): 조 자리는 「항」, 호 목록은 「호」, 목 목록은 「목」.
 * 유형을 모르면(옛 호출) 조 자리 함수조항으로 본다.
 */
export function clausesFitting<C extends { mode?: string }>(clauses: readonly C[], fit: ClauseFit = "block"): C[] {
  return clauses.filter((c) => (c.mode ?? "block") === fit);
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
  // 조 끝에 함수조항(조 단위) — 조의 첫 자리가 함수조항인 조(「준용규정」 = 〔항 함수조항〕 하나)를 항 없이 세운다 (2026-09-28, 실물재현 E2E)
  add.push({ label: "함수조항 참조 추가…", action: { do: "popup", popup: { kind: "clauseBlock", at: { parentId: articleId } } } });
  add.push({ label: "박스 추가…", action: { do: "popup", popup: { kind: "boxPick", at: { parentId: articleId } } } });
  add.push({ label: "반복 블록 추가…", action: { do: "popup", popup: { kind: "repeatBlock", at: { parentId: articleId } } } });
  add.push(bulletListItem("글머리 목록 추가", { parentId: articleId }, env.newId));

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
    for (const k of ["paragraph", "item", "subitem", "bullet"] as const) {
      if (!br.allowed.includes(k)) continue;
      const node = emptyNode(k, env.newId);
      into.push({ label: `이 가지에 ${KIND_WORD[k]} 추가`, action: { do: "ops", ops: [{ type: "insert", node, at }], focus: node.id } });
    }
    if (br.allowed.includes("bulletList")) into.push(bulletListItem("이 가지에 글머리 목록 추가", at, env.newId));
    if (br.allowed.includes("article")) {
      const article = emptyNode("article", env.newId);
      into.push({ label: "이 가지에 조 추가", action: { do: "ops", ops: [{ type: "insert", node: article, at }], goArticle: article.id } });
    }
    if (br.allowed.includes("table")) into.push({ label: "이 가지에 표 추가…", action: { do: "popup", popup: { kind: "newTable", at } } });
    if (br.allowed.includes("boxRef")) into.push({ label: "이 가지에 박스 추가…", action: { do: "popup", popup: { kind: "boxPick", at } } });
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

/** 칩(슬롯 · 참조 · 함수조항 · 구조 표기 · 문장 안 조건)의 메뉴 — 고치기 · 풀기(조건) · 삭제. */
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
 * 문장 속(커서 자리)의 넣기 — 슬롯 · 조 참조 · 별표 참조 · 함수조항(문장 안) · 문장 안 조건 (+ 반복 표 템플릿 셀이면 구조 표기).
 * 문장 안 조건의 가지 안이면 문장 안 조건은 싣지 않는다 (중첩 금지 §3.2).
 */
export function inlineInsertItems(at: InlineAt, tokens: Token[], opts: { inInlineCond: boolean; newId: IdSource; structLevels?: readonly Exclude<AttachLevel, "product">[] }): MenuItem[] {
  const pop = (what: InlineInsertKind, label: string): MenuItem => ({
    label,
    action: { do: "popup", popup: { kind: "insertInline", what, at, tokens, ...(what === "structKey" && opts.structLevels ? { structLevels: opts.structLevels } : {}) } },
  });
  const items = [pop("slot", "치환 슬롯…"), pop("articleRef", "조 참조…"), pop("appendixRef", "별표 참조…"), pop("clauseInlineRef", "함수조항(문장 안)…")];
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

/** 자리가 가리키는 블록 — 블록 · 조 · 관 제목이면 그 노드, 문장 칸이면 그 주인(표 셀이면 표). 블록 오른쪽 위 복제 · 삭제를 늘 보일 블록이다. */
export function placeBlockId(place: Place | undefined): Id | undefined {
  if (!place) return undefined;
  switch (place.kind) {
    case "block":
    case "articleTitle":
    case "sectionTitle":
      return place.id;
    case "inline":
      return "tableId" in place.at ? place.at.tableId : place.at.parentId;
    default:
      return undefined;
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

/**
 * 툴바 「조건식」을 누른 순간 — 무엇을 넣나 (기능/문면 §4.3 「조건식」, 2026-09-28). **기본은 블록 조건**이다.
 * - `selection`(드래그로 고른 글의 두 끝 블록) — 그 선택이 걸친 블록을 다 덮는 가장 작은 잇닿은 형제 블록들을 조건 블록 하나로 감싼다
 *   (제1항 일부 → 제1항 · 제1항과 그 호 → 호를 품은 제1항 · 제1항~제2항 → 둘 다). 조 제목의 글을 골랐으면 그 조를 감싼다.
 * - `caret`(고른 글 없이 커서가 선 블록) — 그 블록 **바로 뒤**에 빈 조건 블록(빈 IF 줄 + 그 자리의 빈 항 · 호 · 목). 조 제목이면 그 조 맨 앞.
 * - 둘 다 없으면(본문 빈 자리 · 블록을 누른 자리) 자리의 목록대로 — 고른 블록 감싸기 · 조 끝에 새 블록.
 * - 조건 블록을 둘 수 없는 자리뿐이면(「문구」 함수조항의 한 줄) 문장 안 조건 — `inline` 이 그 입구(고른 글이 IF 가지 문장).
 * 새 블록 · 감싼 블록의 IF 줄에 초점이 간다. 팝업은 없다 — 무엇을 넣을지 묻지 않는다.
 * `canHold(nodeId)` — 그 노드 자리(형제 목록)에 조건 블록이 설 수 있는가 (함수조항은 항 자리뿐).
 */
export interface CondInput {
  selection?: { start: Id; end: Id };
  caret?: Id;
  inline?: { at: InlineAt; tokens: Token[]; cut?: string };
}

export function condInsertItem(env: MenuEnv, sections: MenuSections, input: CondInput, canHold: (nodeId: Id) => boolean): MenuItem | undefined {
  const { ix } = env;
  const inlineFallback = (): MenuItem | undefined => {
    if (!input.inline) return undefined;
    const allowed = sections.flat().some((i) => i.label === "문장 안 조건" && !i.refusal);
    return allowed ? inlineCondItem(input.inline.at, input.inline.tokens, env.newId, input.inline.cut) : undefined;
  };
  if (input.selection) {
    const range = selectionRange(ix, input.selection.start, input.selection.end, canHold);
    if (!range) return inlineFallback();
    const branchId = env.newId();
    return { label: "조건으로 감싸기", toolbarOnly: true, action: { do: "ops", ops: (t) => wrapRangeOps(t, range.ids, "", env.newId, branchId), focus: branchId } };
  }
  if (input.caret !== undefined) {
    const e = ix.nodes.get(input.caret);
    if (e?.node.kind === "article") {
      const allowed = allowedIn("article", "children") ?? [];
      return allowed.includes("condBlock") ? condBlockItem(env, { parentId: e.node.id, slot: "children", index: 0 }, allowed) : inlineFallback();
    }
    // 커서가 선 블록에서 위로 — 조건 블록이 설 수 있는 첫 자리의 바로 뒤
    let id: Id | undefined = input.caret;
    while (id !== undefined && ix.nodes.has(id) && !canHold(id)) id = ix.nodes.get(id)?.parentId;
    const owner = id !== undefined ? ix.nodes.get(id) : undefined;
    const at = owner ? afterOf(ix, owner.node.id) : undefined;
    return owner && at ? condBlockItem(env, at, owner.allowed) : inlineFallback();
  }
  const items = sections.flat().filter((i) => !i.refusal);
  return items.find((i) => i.label === "조건으로 감싸기") ?? items.find((i) => i.label === "조건 블록 넣기") ?? inlineFallback() ?? items.find((i) => i.label === "문장 안 조건");
}
