/**
 * 공용조항 에디터의 오른쪽 클릭 메뉴 · 인스펙터 조작 — 문면 저작 메뉴(`documents/[id]/_components/menus.ts`)를 그대로 짓고
 * 공용조항 자리에 맞게 거른다 (순수 — React 없음. `clauseMenus.test.ts`).
 *
 * 기능/공용조항 §4.3 「에디터 도구」:
 * - 같은 도구 — 조건 블록 · 인라인 조건 · 값 슬롯 · 참조 슬롯(별표 · 보통약관 조 · 항 · 호 · 목) + **옵션 자리 넣기**(옵션 목록 단의 옵션마다 한 줄).
 * - 막는 것 — 조 · 관 추가(조는 사용처 소유) · 공용조항 참조 넣기(중첩 금지). 그 도구 자리는 남기되 누르면 거부 배너(`refuse`).
 * - 공용조항 본문에 없는 것(표 · 박스 · 행 반복 · 조연결 · 구조 표기 · 호/목 자리의 조건 블록)은 싣지 않는다.
 */
import { blockMenu, chipMenu, condMenu, inlineInsertItems, type MenuEnv, type MenuItem, type MenuSections } from "@/app/(app)/documents/[id]/_components/menus";
import { emptyNode, inlineListAt } from "@/app/(app)/documents/[id]/_components/editOps";
import { runsFromTokens, type Token } from "@/app/(app)/documents/[id]/_components/inlineRuns";
import { CLAUSE_ARTICLE_ID, optionCarrier, type EditOp, type IdSource, type InlineAt } from "@/domain/document";
import type { Id } from "@/domain/types";

export const REFUSE = {
  article: "공용조항에는 조 · 관을 둘 수 없다 — 조는 늘 사용처(약관 템플릿) 소유다 (기능/공용조항 §3.1).",
  clauseRef: "공용조항 안에 공용조항 참조를 둘 수 없다 — 중첩 금지 (기능/공용조항 §3.1).",
} as const;

/** 누르면 거부 배너만 띄우는 도구 자리 — 명령은 없다. */
export function refusing(label: string, message: string, onRefuse: (message: string) => void): MenuItem {
  return {
    label,
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
function adapt(item: MenuItem, env: MenuEnv, onRefuse: (message: string) => void): MenuItem | undefined {
  const a = item.action;
  if (a.do === "popup") {
    const p = a.popup;
    if (DROPPED_POPUPS.has(p.kind)) return undefined;
    if (p.kind === "clauseBlock") return refusing(item.label.replace("(조 단위) ", " 참조 "), REFUSE.clauseRef, onRefuse);
    if (p.kind === "insertInline" && p.what === "clauseInlineRef") return refusing(item.label, REFUSE.clauseRef, onRefuse);
    if (p.kind === "insertInline" && p.what === "structKey") return undefined;
    // 조건 블록은 항 자리에만 선다 — 공용조항의 호 · 목 목록에는 조건 블록이 없다 (clause/nodes.ts)
    if (p.kind === "wrap") {
      const kind = env.ix.nodes.get(p.nodeId)?.node.kind;
      return kind === "paragraph" || kind === "condBlock" ? item : undefined;
    }
    return item;
  }
  if (a.do === "ops" && Array.isArray(a.ops) && a.ops.some((op) => op.type === "insert" && DROPPED_NODES.has(op.node.kind))) return undefined;
  return item;
}

function adaptAll(sections: MenuSections, env: MenuEnv, onRefuse: (message: string) => void): MenuSections {
  return sections.map((section) => section.flatMap((item) => adapt(item, env, onRefuse) ?? [])).filter((section) => section.length > 0);
}

export interface ClauseMenuEnv extends MenuEnv {
  mode: "inline" | "block";
  /** 옵션 목록 단의 옵션 — 옵션 자리 넣기 항목이 옵션마다 한 줄. */
  options: readonly { code: string; label: string }[];
  onRefuse: (message: string) => void;
}

export function clauseBlockMenu(env: ClauseMenuEnv, nodeId: Id): MenuSections {
  return adaptAll(blockMenu(env, nodeId), env, env.onRefuse);
}

export function clauseCondMenu(env: ClauseMenuEnv, branchId: Id): MenuSections {
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
  const insert = adaptAll([inlineInsertItems(at, tokens, { inInlineCond })], env, env.onRefuse);
  const options = optionInsertItems(at, tokens, env.options, env.newId);
  const block = env.mode === "block" && owner ? clauseBlockMenu(env, at.parentId) : [];
  return [...insert, ...(options.length > 0 ? [options] : []), ...block];
}

/** 본문 빈 자리(「항」 유형) — 항 추가 + 막힌 도구(조 · 관). */
export function clauseBodyMenu(env: ClauseMenuEnv): MenuSections {
  if (env.mode === "inline") return [];
  const paragraph = emptyNode("paragraph", env.newId);
  return [
    [{ label: "항 추가", action: { do: "ops", ops: [{ type: "insert", node: paragraph, at: { parentId: CLAUSE_ARTICLE_ID } }], focus: paragraph.id } }],
    [refusing("조 추가", REFUSE.article, env.onRefuse), refusing("관 추가", REFUSE.article, env.onRefuse), refusing("공용조항 참조 추가…", REFUSE.clauseRef, env.onRefuse)],
  ];
}
