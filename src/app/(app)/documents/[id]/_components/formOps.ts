/**
 * 우측 패널 폼 → 편집 명령 (순수 — React 없음. `formOps.test.ts`).
 *
 * ADR-0074: 폼의 「적용」은 서버로 가지 않고 이 명령을 브라우저 편집본에 적용한다(`applyEdit`). 저장은 바의 `저장` 하나다.
 * 명령 자체의 검증은 도메인 `applyCommand` 몫 — 여기는 FormData → 명령 인자 변환만 한다.
 */
import { nodeBuilders, type ArticleRefNode, type BlockNode, type DocumentNode, type EditOp, type IdSource, type InlineNode } from "@/domain/document";
import { indexTree } from "@/domain/document";
import { isReferenceConnector, type Id, type ReferenceConnector } from "@/domain/types";

import { moveTarget, parseLines, parseOptions, parseTableForm, str } from "../../lib";

/** 폼 → 새 노드. 모르는 종류면 undefined. 「여기에 추가」(자리) · 셀 추가가 같이 쓴다. */
export function nodeFromForm(formData: FormData, newId?: IdSource): BlockNode | InlineNode | undefined {
  const kind = str(formData, "kind");
  const b = nodeBuilders(newId);
  switch (kind) {
    case "article":
      return b.article(str(formData, "title") || "새 조", []);
    case "section":
      return b.section(str(formData, "title") || "새 관", []);
    case "table": {
      const form = parseTableForm(formData);
      return b.textTable({ ...form, rows: form.rows ?? [] });
    }
    case "box":
      return b.box(str(formData, "title") || "용어풀이", parseLines(String(formData.get("lines") ?? "")));
    case "paragraph":
      return b.paragraph([]);
    case "item":
      return b.item([]);
    case "subitem":
      return b.subitem([]);
    case "text":
      return b.text(str(formData, "text"));
    case "slot":
      return b.slot(str(formData, "ref"));
    case "articleRef": {
      const [scope, ...targetParts] = str(formData, "articleTarget").split(":");
      return b.articleRef(targetParts.join(":"), scope === "general" ? "general" : "self");
    }
    case "appendixRef":
      return b.appendixRef(str(formData, "appendixCode"));
    case "clauseBlockRef":
      return b.clauseBlock(str(formData, "clauseCode"), parseOptions(str(formData, "options")));
    case "clauseInlineRef":
      return b.clauseInline(str(formData, "clauseCode"), parseOptions(str(formData, "options")));
    case "inlineCond": {
      const when = str(formData, "when") || undefined;
      const thenText = str(formData, "thenText");
      const elseText = str(formData, "elseText");
      return b.inlineCond([b.inlineBranch(when, thenText ? [b.text(thenText)] : []), b.inlineBranch(undefined, elseText ? [b.text(elseText)] : [])]);
    }
    case "condBlock":
      return b.condBlock([b.branch(str(formData, "when") || undefined, [])]);
    // 구조 표기 — 반복 표 셀 전용 (ADR-0070 결정 6). 레벨 검사는 저장 검증(`repeatTableIssues`)이 한다.
    case "structKey": {
      const level = str(formData, "structLevel");
      if (level === "plan" || level === "coverage" || level === "subCoverage" || level === "benefit") return b.structKey(level);
      return undefined;
    }
    default:
      return undefined;
  }
}

/** 명령을 만들지 못한 사유 — 화면이 배너로 보인다. */
export type FormOps = { ok: true; ops: EditOp[] } | { ok: false; message: string };

const unknownKind = (formData: FormData): FormOps => ({ ok: false, message: `지원하지 않는 노드 종류입니다: ${str(formData, "kind")}` });

/** 「여기에 추가」 — 자리(부모 · 목록)에 새 노드. */
export function insertOps(parentId: Id, slot: "children" | "items" | "subitems" | undefined, formData: FormData, newId?: IdSource): FormOps {
  const node = nodeFromForm(formData, newId);
  if (!node) return unknownKind(formData);
  return { ok: true, ops: [{ type: "insert", node, at: { parentId, ...(slot ? { slot } : {}) } }] };
}

/** 표 셀 끝에 인라인 노드 하나 — 셀의 「여기에 추가」(구조 표기 포함). */
export function insertCellOps(tableId: Id, row: number, col: number, formData: FormData, newId?: IdSource): FormOps {
  const node = nodeFromForm(formData, newId);
  if (!node) return unknownKind(formData);
  return { ok: true, ops: [{ type: "insertCell", tableId, row, col, node: node as InlineNode }] };
}

/** 한 칸 위/아래 — 경계면 명령 없음(아무 일 없음). */
export function moveOps(tree: DocumentNode, nodeId: Id, dir: -1 | 1): EditOp[] {
  const to = moveTarget(tree, nodeId, dir);
  return to ? [{ type: "move", nodeId, to }] : [];
}

/**
 * 문장 — **좌우 공백을 자르지 않는다.** 텍스트런은 슬롯·참조 앞뒤의 한 칸을 스스로 들고 있어서
 * (「계약일부터 」 + 슬롯 + 「 이내에는」), 자르면 조립 문면에서 글자가 붙어 버린다.
 */
export function textOps(nodeId: Id, formData: FormData): EditOp[] {
  return [{ type: "setText", nodeId, text: String(formData.get("text") ?? "") }];
}

/** 조 명 · 관 제목 · 템플릿 이름(루트) — 같은 setTitle 명령. */
export function titleOps(nodeId: Id, formData: FormData): EditOp[] {
  return [{ type: "setTitle", nodeId, title: str(formData, "title") }];
}

/**
 * 표 — 제목 · 열 너비 · 제목줄 수 · 행 (기능/문면 §3.2) + 행 반복(담보약관만 칸이 있다, ADR-0070 결정 6).
 * 행 반복은 `repeat` 만 바꾸고 행은 그대로 둔다.
 */
export function tableOps(nodeId: Id, formData: FormData): EditOp[] {
  const ops: EditOp[] = [{ type: "setTable", nodeId, ...parseTableForm(formData) }];
  const repeat = formData.get("repeat");
  if (repeat !== null) {
    const depth = String(repeat);
    ops.push({ type: "setTableRepeat", nodeId, ...(depth === "1" || depth === "2" ? { repeat: { depth: Number(depth) as 1 | 2 } } : {}) });
  }
  return ops;
}

export function boxOps(nodeId: Id, formData: FormData): EditOp[] {
  return [{ type: "setBox", nodeId, title: str(formData, "title"), lines: parseLines(String(formData.get("lines") ?? "")) }];
}

export function slotOps(nodeId: Id, formData: FormData): EditOp[] {
  return [{ type: "setSlotRef", nodeId, ref: str(formData, "ref") }];
}

export function articleRefOps(nodeId: Id, formData: FormData): EditOp[] {
  const targets = formData
    .getAll("targets")
    .flatMap((value) => String(value).split(","))
    .map((targetId) => targetId.trim())
    .filter(Boolean)
    .map((targetId) => ({ nodeId: targetId }));
  const connector = str(formData, "connector");
  return [
    {
      type: "setArticleRef",
      nodeId,
      targets,
      connector: isReferenceConnector(connector) ? (connector as ReferenceConnector) : "및",
      scope: (str(formData, "scope") || "self") as ArticleRefNode["scope"],
    },
  ];
}

export function appendixRefOps(nodeId: Id, formData: FormData): EditOp[] {
  return [{ type: "setAppendixRef", nodeId, appendixCode: str(formData, "appendixCode") }];
}

/** 공용조항 옵션 — 옵션마다 `option:<옵션코드>` select. 「— 미선택 —」(빈 값)은 싣지 않는다. */
export function clauseOptionsOps(nodeId: Id, formData: FormData): EditOp[] {
  const options: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("option:")) continue;
    const chosen = String(value).trim();
    if (chosen !== "") options[key.slice("option:".length)] = chosen;
  }
  return [{ type: "setClauseOptions", nodeId, options }];
}

/** 가지 추가 — 비우면 ELSE. 문장 안 조건이면 첫 문장을 함께. */
export function addBranchOps(tree: DocumentNode, condId: Id, formData: FormData, newId?: IdSource): FormOps {
  const entry = indexTree(tree).nodes.get(condId);
  if (!entry) return { ok: false, message: "조건 노드를 찾을 수 없습니다." };
  const when = str(formData, "when") || undefined;
  const text = str(formData, "text");
  const b = nodeBuilders(newId);
  const branch = entry.node.kind === "inlineCond" ? b.inlineBranch(when, text ? [b.text(text)] : []) : b.branch(when, []);
  return { ok: true, ops: [{ type: "addBranch", condId, branch }] };
}

export function whenOps(branchId: Id, formData: FormData): EditOp[] {
  const when = str(formData, "when");
  return [{ type: "setWhen", branchId, ...(when ? { when } : {}) }];
}

export function linkOps(articleId: Id, formData: FormData): EditOp[] {
  const linkedArticleId = str(formData, "linkedArticleId");
  return [{ type: "link", articleId, ...(linkedArticleId ? { linkedArticleId } : {}) }];
}
