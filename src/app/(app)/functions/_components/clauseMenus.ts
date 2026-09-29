/**
 * 공용조항 에디터의 툴바 · 오른쪽 클릭 메뉴 목록 — 문면 저작 메뉴(`documents/[id]/_components/menus.ts`)를 그대로 짓고
 * 공용조항 자리에 맞게 거른다 (순수 — React 없음. `clauseMenus.test.ts`).
 *
 * 기능/함수조항 §4.3 「에디터 도구」:
 * - 같은 도구 — 조건 블록 · 인라인 조건 · 값 슬롯 · 참조 슬롯(별표 · 보통약관 조 · 항 · 호 · 목) + **옵션 자리 넣기**(옵션 목록 단의 옵션마다 한 줄).
 *   「조건식」은 문면과 같다 — 항을 골랐으면 감싸고, 본문 빈 자리면 빈 항을 든 조건 블록을 끝에, 「문구」면 문장 안 조건 (2026-09-28).
 * - 막는 것 — 조 · 관 추가(조는 사용처 소유) · 공용조항 참조 넣기(중첩 금지). 그 도구 자리는 남는다 — 툴바는 잠그고 사유를 tooltip 으로,
 *   오른쪽 클릭 메뉴는 누르면 거부 배너(`refusing`).
 * - **값별 분기**(최종 결정 5) — 「값별 분기 넣기」는 조건 블록이 설 수 있는 자리(유형의 목록 자리)에 대상 = 목록값 인자 · 내부 변수 첫째,
 *   칸 = 값마다 하나(각 칸에 그 자리의 빈 항 · 호 · 목)로 선다. 대상 후보가 없으면 거부 자리. 칸 머리의 목록은 칸 추가 · 이 칸 삭제 · 이 칸에 넣기 · 분기 삭제.
 * - 공용조항 본문에 없는 것(표 · 옛 문면 박스 · 행 반복 · 조연결 · 구조 표기 · 호/목 자리의 조건 블록)은 싣지 않는다.
 *   정적 마스터 박스(박스 참조)는 잎이라 싣는다 — 항 자리 · 호 뒤 (기능/박스 §3.2).
 */
import { blockMenu, chipMenu, condBlockItem, condMenu, inlineInsertItems, type MenuEnv, type MenuItem, type MenuSections, type Place } from "@/app/(app)/documents/[id]/_components/menus";
import { afterOf, emptyNode, inlineListAt } from "@/app/(app)/documents/[id]/_components/editOps";
import { unassignedValues, type SwitchSubject } from "@/app/(app)/documents/[id]/_components/switchCases";
import { runsFromTokens, type Token } from "@/app/(app)/documents/[id]/_components/inlineRuns";
import type { ClauseMode } from "@/domain/clause";
import {
  CLAUSE_ARTICLE_ID,
  CLAUSE_HOST_ITEM_ID,
  CLAUSE_HOST_PARAGRAPH_ID,
  CLAUSE_LINE_ID,
  isSwitchCarrier,
  optionCarrier,
  type BlockBranch,
  type CondBlockNode,
  type EditOp,
  type IdSource,
  type InlineCondNode,
  type InlineAt,
  type NodeKind,
  type Position,
  type TreeIndex,
} from "@/domain/document";
import type { Id } from "@/domain/types";

/** 거절 안내 — 화면에 그대로 보이므로 문서 번호를 넣지 않는다 (규칙: 기능/함수조항 §3.1). */
export const REFUSE = {
  article: "함수조항에는 조 · 관을 둘 수 없다 — 조는 늘 사용처(약관 템플릿) 소유다.",
  clauseRef: "함수조항 안에 함수조항 참조를 둘 수 없다 — 중첩 금지.",
  switchSubject: "값별 분기의 대상이 없다 — 인자 표에 목록값(열거형) 인자를 먼저 선언한다(내부 변수도 된다).",
} as const;

/** 그 자리의 첫 칸 — 항 · 호 · 목 중 설 수 있는 것 하나. */
function firstOf(allowed: readonly NodeKind[], newId: IdSource) {
  const kind = (["paragraph", "item", "subitem"] as const).find((k) => allowed.includes(k));
  return kind ? [emptyNode(kind, newId)] : [];
}

/** 값별 분기 넣기 — 대상 = 후보 첫째, 칸 = 값마다 하나(그 자리의 빈 칸을 든). 후보가 없으면 거부 자리. */
export function switchInsertItem(env: ClauseMenuEnv, at: Position, allowed: readonly NodeKind[]): MenuItem {
  const subject = env.switchSubjects?.[0];
  if (!subject) return refusing("값별 분기 넣기", REFUSE.switchSubject, env.onRefuse);
  const branches: BlockBranch[] = subject.values.map((v) => ({ id: env.newId(), values: [v.code], children: firstOf(allowed, env.newId) as BlockBranch["children"] }));
  if (branches.length === 0) branches.push({ id: env.newId(), values: [], children: firstOf(allowed, env.newId) as BlockBranch["children"] });
  const node: CondBlockNode = { id: env.newId(), kind: "condBlock", switchOn: subject.code, branches };
  const first = branches[0].children[0];
  return { label: "값별 분기 넣기", action: { do: "ops", ops: [{ type: "insert", node, at }], ...(first ? { focus: first.id } : {}) } };
}

/** 문장 안 값별 분기 — 커서 자리에 칩(대상 = 후보 첫째, 칸 = 값마다 하나 · 빈 문구), 곧바로 그 팝업을 연다. 문장 안 조건 · 분기 안이면 싣지 않는다. */
export function inlineSwitchItem(env: ClauseMenuEnv, at: InlineAt, tokens: Token[]): MenuItem {
  const subject = env.switchSubjects?.[0];
  if (!subject) return refusing("문장 안 값별 분기", REFUSE.switchSubject, env.onRefuse);
  const cases = subject.values.length > 0 ? subject.values.map((v) => [v.code]) : [[]];
  const node: InlineCondNode = { id: env.newId(), kind: "inlineCond", switchOn: subject.code, branches: cases.map((values) => ({ id: env.newId(), values, children: [] })) };
  return {
    label: "문장 안 값별 분기",
    action: {
      do: "ops",
      ops: (tree): EditOp[] => {
        const list = inlineListAt(tree, at);
        return list ? [{ type: "setInlines", at, runs: runsFromTokens(list, tokens, env.newId, node) }] : [];
      },
      openChip: node.id,
    },
  };
}

/** 값별 분기 칸 머리의 목록 — 칸 추가(칸 없는 값 첫째를 든) · 이 칸 삭제 · 이 칸에 넣기(조건 가지와 같은 항목) · 분기 삭제. */
export function switchHeadMenu(env: ClauseMenuEnv, branchId: Id): MenuSections {
  const br = env.ix.branches.get(branchId);
  const owner = br ? env.ix.nodes.get(br.ownerId) : undefined;
  if (!br || !owner || owner.node.kind !== "condBlock" || owner.node.switchOn === undefined) return [];
  const node = owner.node;
  const subject = env.switchSubjects?.find((s) => s.code === node.switchOn);
  const next = unassignedValues(subject, node.branches)[0];
  const added: BlockBranch = { id: env.newId(), values: next ? [next.code] : [], children: firstOf(br.allowed, env.newId) as BlockBranch["children"] };
  const into = (condMenu(env, branchId)[1] ?? []).filter((i) => !i.label.includes("조 추가"));
  const sections: MenuSections = [
    [
      { label: "칸 추가", action: { do: "ops", ops: [{ type: "addBranch", condId: node.id, branch: added }], ...(added.children[0] ? { focus: added.children[0].id } : {}) } },
      { label: "이 칸 삭제", action: { do: "ops", ops: [{ type: "removeBranch", branchId }] }, disabled: node.branches.length <= 1, danger: true },
    ],
    into,
    [{ label: "값별 분기 삭제", action: { do: "remove", nodeId: node.id }, danger: true }],
  ];
  return sections.filter((s) => s.length > 0);
}

/** 누르면 거부 배너만 띄우는 도구 자리 — 명령은 없다. */
export function refusing(label: string, message: string, onRefuse: (message: string) => void): MenuItem {
  return {
    label,
    refusal: message,
    action: {
      do: "ops",
      ops: () => {
        onRefuse(message);
        return [];
      },
    },
  };
}

const DROPPED_POPUPS = new Set(["newTable", "tableProps", "repeat", "link", "docTitle", "general"]);
const DROPPED_NODES = new Set(["table", "box", "article", "section", "forBlock"]);

/** 문면 메뉴 항목 하나를 공용조항 자리로 — 그대로 · 거부 자리로 바꿈 · 뺌(undefined). */
function adapt(item: MenuItem, env: ClauseMenuEnv, onRefuse: (message: string) => void): MenuItem | undefined {
  const a = item.action;
  if (a.do === "popup") {
    const p = a.popup;
    if (DROPPED_POPUPS.has(p.kind)) return undefined;
    // 함수조항 넣기는 거부 자리 하나로 — 호 · 목 자리의 같은 도구(「함수조항(호) 추가…」 등)는 뺀다(거부 사유가 같다)
    if (p.kind === "clauseBlock") return p.fit ? undefined : refusing(item.label.replace(/\((조 단위|호|목)\) /, " 참조 "), REFUSE.clauseRef, onRefuse);
    if (p.kind === "insertInline" && p.what === "clauseInlineRef") return refusing(item.label, REFUSE.clauseRef, onRefuse);
    if (p.kind === "insertInline" && p.what === "structKey") return undefined;
    return item;
  }
  // 조건 블록은 유형의 목록 자리에만 선다 — 「항」은 항 자리, 「호」는 호 목록, 「목」은 목 목록 (clause/nodes.ts)
  if (item.wrapTarget !== undefined) return clauseCanHold(env.ix, env.mode)(item.wrapTarget) ? item : undefined;
  if (a.do === "ops" && Array.isArray(a.ops) && a.ops.some((op) => op.type === "insert" && DROPPED_NODES.has(op.node.kind))) return undefined;
  // 글머리 목록은 항 자리 · 호 뒤(항의 호 목록)에만 — 목 뒤(호의 목 목록) · 조건 가지 안 항목은 공용조항 본문에 없다 (clause/nodes.ts)
  if (
    a.do === "ops" &&
    Array.isArray(a.ops) &&
    a.ops.some((op) => op.type === "insert" && ((op.node.kind === "bulletList" && op.at.slot === "subitems") || (op.node.kind === "bullet" && env.ix.branches.has(op.at.parentId))))
  )
    return undefined;
  return item;
}

function adaptAll(sections: MenuSections, env: ClauseMenuEnv, onRefuse: (message: string) => void): MenuSections {
  return sections.map((section) => section.flatMap((item) => adapt(item, env, onRefuse) ?? [])).filter((section) => section.length > 0);
}

export interface ClauseMenuEnv extends MenuEnv {
  mode: ClauseMode;
  /** 옵션 목록 단의 옵션 — 옵션 자리 넣기 항목이 옵션마다 한 줄. */
  options: readonly { code: string; label: string }[];
  /** 값별 분기 대상 후보 — 목록값 인자 · 내부 변수. 없으면 「값별 분기 넣기」가 거부 자리. */
  switchSubjects?: readonly SwitchSubject[];
  onRefuse: (message: string) => void;
}

/** 블록 뒤에 값별 분기 — 조건 블록이 설 수 있는 자리(유형의 목록 자리)의 블록만. */
function switchAfter(env: ClauseMenuEnv, nodeId: Id): MenuItem[] {
  const e = env.ix.nodes.get(nodeId);
  const after = afterOf(env.ix, nodeId);
  if (!e || !after || !clauseCanHold(env.ix, env.mode)(nodeId)) return [];
  return [switchInsertItem(env, after, e.allowed)];
}

export function clauseBlockMenu(env: ClauseMenuEnv, nodeId: Id): MenuSections {
  const sections = adaptAll(blockMenu(env, nodeId), env, env.onRefuse);
  const sw = switchAfter(env, nodeId);
  return sw.length > 0 ? [...sections, sw] : sections;
}

export function clauseCondMenu(env: ClauseMenuEnv, branchId: Id): MenuSections {
  const br = env.ix.branches.get(branchId);
  const owner = br ? env.ix.nodes.get(br.ownerId) : undefined;
  if (owner && isSwitchCarrier(owner.node)) return adaptAll(switchHeadMenu(env, branchId), env, env.onRefuse);
  return adaptAll(condMenu(env, branchId), env, env.onRefuse);
}

export function clauseChipMenu(env: ClauseMenuEnv, chipId: Id): MenuSections {
  return adaptAll(chipMenu(env, chipId), env, env.onRefuse);
}

/** 옵션 자리 넣기 — 커서 자리에 그 옵션의 자리를 끼운다. */
export function optionInsertItems(at: InlineAt, tokens: Token[], options: ClauseMenuEnv["options"], newId: IdSource): MenuItem[] {
  return options.map((option) => ({
    label: `옵션 자리 — ${option.label || "이름 없는 옵션"}`,
    action: {
      do: "ops",
      ops: (tree): EditOp[] => {
        const list = inlineListAt(tree, at);
        return list ? [{ type: "setInlines", at, runs: runsFromTokens(list, tokens, newId, optionCarrier(newId(), option.code)) }] : [];
      },
    },
  }));
}

/** 문장 속(커서 자리)의 메뉴 — 넣기(문면 도구 + 옵션 자리) · 그 항 · 호 · 목의 블록 조작(「항」 유형만). */
export function clauseInlineMenu(env: ClauseMenuEnv, at: InlineAt, tokens: Token[]): MenuSections {
  if ("tableId" in at) return [];
  const branch = env.ix.branches.get(at.parentId);
  const owner = branch ? undefined : env.ix.nodes.get(at.parentId);
  const inInlineCond = branch ? env.ix.nodes.get(branch.ownerId)?.node.kind === "inlineCond" : (owner?.inInlineCond ?? false);
  const insert = adaptAll([inlineInsertItems(at, tokens, { inInlineCond, newId: env.newId })], env, env.onRefuse);
  // 문장 안 값별 분기 — 문장 안 조건과 같은 제약(그 안에 두지 않는다, 최종 결정 5)
  if (!inInlineCond) insert.push([inlineSwitchItem(env, at, tokens)]);
  const options = optionInsertItems(at, tokens, env.options, env.newId);
  const block = env.mode !== "inline" && owner ? clauseBlockMenu(env, at.parentId) : [];
  return [...insert, ...(options.length > 0 ? [options] : []), ...block];
}

/**
 * 본문 빈 자리 — 유형의 목록 끝에 넣기: 「항」은 항 추가 · 박스 추가 · 조건 블록(빈 항을 든), 「호」는 자리 항의 호 목록에 호 · 박스 · 조건 블록(빈 호를 든),
 * 「목」은 자리 호의 목 목록에 목 · 조건 블록(빈 목을 든). 막힌 도구(조 · 관 · 함수조항 참조)는 늘 붙는다.
 */
export function clauseBodyMenu(env: ClauseMenuEnv): MenuSections {
  if (env.mode === "inline") return [];
  const refused = [refusing("조 추가", REFUSE.article, env.onRefuse), refusing("관 추가", REFUSE.article, env.onRefuse), refusing("함수조항 참조 추가…", REFUSE.clauseRef, env.onRefuse)];
  if (env.mode === "item") {
    const at = { parentId: CLAUSE_HOST_PARAGRAPH_ID, slot: "items" } as const;
    const item = emptyNode("item", env.newId);
    return [
      [
        { label: "호 추가", action: { do: "ops", ops: [{ type: "insert", node: item, at }], focus: item.id } },
        { label: "박스 추가…", action: { do: "popup", popup: { kind: "boxPick", at } } },
      ],
      [condBlockItem(env, at, ["item"]), switchInsertItem(env, at, ["item"])],
      refused,
    ];
  }
  if (env.mode === "subitem") {
    const at = { parentId: CLAUSE_HOST_ITEM_ID, slot: "subitems" } as const;
    const subitem = emptyNode("subitem", env.newId);
    return [[{ label: "목 추가", action: { do: "ops", ops: [{ type: "insert", node: subitem, at }], focus: subitem.id } }], [condBlockItem(env, at, ["subitem"]), switchInsertItem(env, at, ["subitem"])], refused];
  }
  const paragraph = emptyNode("paragraph", env.newId);
  return [
    [
      { label: "항 추가", action: { do: "ops", ops: [{ type: "insert", node: paragraph, at: { parentId: CLAUSE_ARTICLE_ID } }], focus: paragraph.id } },
      // 정적 마스터 박스는 잎이라 공용조항 본문에도 놓는다 (기능/박스 §3.2)
      { label: "박스 추가…", action: { do: "popup", popup: { kind: "boxPick", at: { parentId: CLAUSE_ARTICLE_ID } } } },
    ],
    [condBlockItem(env, { parentId: CLAUSE_ARTICLE_ID }, ["paragraph"]), switchInsertItem(env, { parentId: CLAUSE_ARTICLE_ID }, ["paragraph"])],
    refused,
  ];
}

/** 자리의 기본값 — 「문구」는 그 한 줄 문장(넣으면 끝에), 나머지는 본문 빈 자리(그 유형의 목록 끝에 넣기). */
export function clauseDefaultPlace(mode: ClauseMenuEnv["mode"]): Place {
  return mode === "inline" ? { kind: "inline", at: { parentId: CLAUSE_LINE_ID } } : { kind: "document" };
}

/** 자리 하나의 목록 — 툴바와 오른쪽 클릭 메뉴가 같은 것을 쓴다 (문면 `placeMenu` 의 공용조항 판). */
export function clausePlaceMenu(env: ClauseMenuEnv, place: Place, tokens: Token[] = []): MenuSections {
  switch (place.kind) {
    case "chip":
      return clauseChipMenu(env, place.id);
    case "head":
      return clauseCondMenu(env, place.id);
    case "inline":
      return clauseInlineMenu(env, place.at, tokens);
    case "block":
      if (place.id === CLAUSE_HOST_PARAGRAPH_ID || place.id === CLAUSE_HOST_ITEM_ID) return clauseBodyMenu(env);
      return place.id === CLAUSE_LINE_ID ? [] : clauseBlockMenu(env, place.id);
    default:
      return clauseBodyMenu(env);
  }
}

/**
 * 툴바의 막힌 도구 — 어느 자리에서든 조 · 관 · 공용조항 참조 버튼이 잠긴 채 사유를 보이도록, 목록에 없으면 거부 자리를 덧붙인다.
 */
export function withClauseRefusals(env: ClauseMenuEnv, sections: MenuSections): MenuSections {
  const labels = new Set(sections.flat().map((i) => i.label));
  const extra = [
    refusing("조 추가", REFUSE.article, env.onRefuse),
    refusing("관 추가", REFUSE.article, env.onRefuse),
    refusing("함수조항 참조 추가…", REFUSE.clauseRef, env.onRefuse),
    refusing("함수조항(문장 안)…", REFUSE.clauseRef, env.onRefuse),
  ].filter((i) => !labels.has(i.label) && !(i.label === "함수조항 참조 추가…" && labels.has("아래에 함수조항 참조 추가…")));
  return extra.length > 0 ? [...sections, extra] : sections;
}

/**
 * 공용조항 본문에서 조건 블록이 설 수 있는 자리 — 유형의 목록 자리뿐(clause/nodes.ts): 「항」은 항 자리(항의 호 · 목 목록에는 없다),
 * 「호」는 호 목록(호 · 글머리 목록 · 박스 · 조건 블록 — 호 안의 목 목록에는 없다), 「목」은 목 목록.
 * 「문구」 유형은 없다 — 조건식은 문장 안 조건이 된다. 툴바 「조건식」(`condInsertItem`)이 쓴다.
 */
export function clauseCanHold(ix: TreeIndex, mode: ClauseMenuEnv["mode"]) {
  return (nodeId: Id): boolean => {
    if (mode === "inline" || nodeId === CLAUSE_LINE_ID || nodeId === CLAUSE_HOST_PARAGRAPH_ID || nodeId === CLAUSE_HOST_ITEM_ID) return false;
    const e = ix.nodes.get(nodeId);
    const kind = e?.node.kind;
    if (!e || !kind) return false;
    if (mode === "item") return e.allowed.includes("item") && ["item", "condBlock", "bulletList", "boxRef"].includes(kind);
    if (mode === "subitem") return e.allowed.includes("subitem") && (kind === "subitem" || kind === "condBlock");
    // 글머리 목록은 항 자리에 선 것만(호 뒤 목록은 조건 블록으로 감쌀 수 없다)
    return kind === "paragraph" || kind === "condBlock" || (kind === "bulletList" && e.slot !== "items");
  };
}
