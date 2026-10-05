"use client";

/**
 * 조 편집 패널 — 상품 보통약관 탭 편집 중 목차에서 고른 **조 하나**를 문면 저작 편집기로 고친다 (ADR-0079 · 기능/상품 §3.10 · §4.6).
 *
 * - 문면 편집기를 새로 쓰지 않는다 — `documents/[id]/_components` 의 본문(`ArticleBody`) · 툴바(`EditorToolbar` — 항 · 호 · 목 · 조건 · 함수조항 ·
 *   조 · 별표 참조 · 박스 …) · 팝업 · 오른쪽 클릭 메뉴 · 삭제 카드를 그대로 쓴다(함수조항 화면 `ClauseAuthoring` 과 같은 길).
 *   다른 점은 범위뿐이다 — 조 · 관 넣기, 조 자체의 이동 · 복제 · 삭제 · 감싸기는 잠긴다(`copyScopeMenu`), 목록이 놓친 것은
 *   `articleOnlyChange` 안전망이 거부한다. 다른 조가 가리키는 항 · 호 · 목도 지울 수 있다 — 깨지는 곳은 패널 위 목록(ADR-0081).
 * - 편집 트리 = 템플릿 + 초안의 조 사본(`applyArticleCopies`). 명령은 순수 `applyEdit` 로 그 트리에 적용하고, 바뀐 조를 초안의
 *   사본으로 넣는다(`editArticle` — 템플릿과 같아지면 사본이 빠진다). 번호 · 조 참조 대상은 그 트리 전체로 셈한다.
 * - 저장은 탭 첫 줄의 `저장` 한 번(보통약관 탭 초안) — 여기에는 저장 버튼이 없다. 검사는 서버 저장 검증과 같은 `validateDocument` 를
 *   사본이 있는 조에만 보이고, 저장 거부(`errors.copies`)도 그 자리로 안내한다.
 * - 사본 표시 — 사본이면 「템플릿대로 되돌리기」, 사본을 만든 뒤 템플릿의 같은 조가 바뀌었으면(노랑) 「템플릿 현재 본문」 · 「이 상품 본문」을
 *   나란히 놓고 「템플릿대로 되돌리기」 · 「사본 유지」를 고른다. 자동으로 합치지 않는다.
 * - 함수조항 옵션 오버라이드는 본문 아래 「함수조항 옵션」 줄에서 고른다(이 조 안의 함수조항 자리마다 — 사본에 새로 넣은 자리도).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { describeRejection } from "@/app/_lib/rejection";
import { refLabelOf } from "@/app/(app)/documents/[id]/_components/condition/display";
import type { ConditionContext } from "@/app/(app)/documents/[id]/_components/condition/types";
import { anchorOf, type Anchor, type CellAt, type DocCtx, type EditHandlers } from "@/app/(app)/documents/[id]/_components/ctx";
import { ArticleBody } from "@/app/(app)/documents/[id]/_components/DocBody";
import { backspaceOps, enterOps, inlineListAt, moveSelectionOps, pasteGridOps } from "@/app/(app)/documents/[id]/_components/editOps";
import { EditorToolbar } from "@/app/(app)/documents/[id]/_components/EditorToolbar";
import { caretFromPoint, tokensOf } from "@/app/(app)/documents/[id]/_components/Inline";
import { identityRuns, runsFromTokens, sameRuns, type Token } from "@/app/(app)/documents/[id]/_components/inlineRuns";
import { boxPickItems, clausePickItems, condInsertItem, condMenu, inlineCondItem, placeBlockId, placeExists, placeMenu, type MenuEnv, type MenuItem, type MenuSections, type Place, type PopupSpec } from "@/app/(app)/documents/[id]/_components/menus";
import { condInput, placeOf, readInline } from "@/app/(app)/documents/[id]/_components/place";
import { ContextMenu, Popover } from "@/app/(app)/documents/[id]/_components/Popover";
import { PopupHost, type PopupEnv } from "@/app/(app)/documents/[id]/_components/Popups";
import { RemoveCard } from "@/app/(app)/documents/[id]/_components/RemoveCard";
import { loopsAround } from "@/app/(app)/documents/[id]/_components/repeatSources";
import { DraftIssues } from "@/app/(app)/documents/[id]/_components/SidePanel";
import { articlesOf } from "@/app/(app)/documents/[id]/_components/Toc";
import { DOCUMENT_TOOLS, allTools, itemsFor, type ToolId } from "@/app/(app)/documents/[id]/_components/tools";
import { useBlockDrag } from "@/app/(app)/documents/[id]/_components/useBlockDrag";
import { markSelectionOps } from "@/app/(app)/documents/[id]/_components/workMarks";
import type { Discriminator, EnumDef } from "@/domain/catalog";
import { switchValueLabeler, type Clause } from "@/domain/clause";
import {
  applyEdit,
  catalogTypeResolver,
  clauseGateFrom,
  clauseSpanBy,
  indexTree,
  isRepeatSource,
  numberTree,
  randomIds,
  referenceTargetIndex,
  repeatElementEnums,
  repeatLabel,
  repeatLevels,
  repeatScopeOf,
  repeatedKeys,
  rowReadableLevels,
  validateDocument,
  type Appendix,
  type ArticleNode,
  type DocumentNode,
  type EditEnv,
  type EditOp,
  type ForBlockNode,
  type Node,
} from "@/domain/document";
import type { Box } from "@/domain/document/box";
import { applyArticleCopies, articleHash, articleOnlyChange, articlesById } from "@/domain/product";
import type { Code, Coordinate, Id, Issue, WorkMark } from "@/domain/types";

import { COPY_REFUSAL, copyScopeMenu } from "./copyMenus";
import { useGeneralEdit } from "./GeneralEdit";
import { draftCopies } from "./generalDraft";
import { ClauseOptionPicker } from "./TemplateSource";

/** 조 편집 패널의 재료 — 서버가 한 번 넘긴다(직렬화 가능). */
export interface CopyEditorData {
  templateId: Id;
  /** 지금 템플릿 트리 — 사본은 이 위에 갈아 끼운다. */
  template: DocumentNode;
  appendices: readonly Appendix[];
  boxes: readonly Box[];
  clauses: readonly Clause[];
  discriminators: readonly Discriminator[];
  enums: readonly EnumDef[];
  /** 조건 머리 줄 · 슬롯 고르기 문맥 (보통약관 — 담보 트리 없음). */
  condition: ConditionContext;
  /** 담보속성 코드 → 유효값 코드 (식 타입 검사). */
  attributeValues?: Readonly<Record<Code, readonly Code[]>>;
  /**
   * 기본계약 대치 자리 — 보통약관 조 id → 그 조를 대치하는 기본계약 상품담보 이름. 조립은 이 조를 늘 기본계약 조로 찍으므로
   * (ADR-0021) 여기서 고친 본문은 미리보기 · 산출에 나오지 않는다 — 패널이 그것을 말한다.
   */
  replacedBy?: Readonly<Record<Id, string>>;
}

const NODE_WHAT: Record<string, string> = {
  table: "표",
  box: "박스",
  paragraph: "항",
  item: "호",
  subitem: "목",
  condBlock: "조건 블록",
  clauseBlockRef: "함수조항 참조",
  forBlock: "반복 블록",
  boxRef: "박스",
};

/** 조 하나만 든 색인 — 가운데에 그 조만 그린다(관 머리 · 조를 감싼 조건 머리는 조 밖이라 그리지 않는다). */
function articleOnlyIndex(tree: DocumentNode, article: ArticleNode) {
  return indexTree({ id: tree.id, kind: "document", title: tree.title, children: [article] });
}

/** 조 안의 함수조항 자리 — 문서 순. */
function clauseRefsIn(tree: DocumentNode, articleId: Id): { id: Id; clauseCode: Code; options: Record<Code, Code> }[] {
  const out: { id: Id; clauseCode: Code; options: Record<Code, Code> }[] = [];
  for (const e of indexTree(tree).nodes.values()) {
    if (e.articleId !== articleId) continue;
    const n = e.node as Node;
    if (n.kind === "clauseBlockRef" || n.kind === "clauseInlineRef") out.push({ id: n.id, clauseCode: n.clauseCode, options: n.options });
  }
  return out;
}

export function ArticleCopyEditor({ data, articleId, label }: { data: CopyEditorData; articleId: Id; label: string }) {
  const edit = useGeneralEdit();
  const copies = edit?.current.copies;
  const copy = copies?.[articleId];
  const templateArticle = useMemo(() => articlesById(data.template).get(articleId), [data.template, articleId]);
  const tree = useMemo(() => (copies ? applyArticleCopies(data.template, draftCopies({ hidden: [], overrides: {}, copies })) : data.template), [data.template, copies]);
  // 방금 적용한 트리 — 초안 반영(다음 렌더) 전에 이어지는 명령이 그 위에서 돈다. 트리가 바뀌어 다시 그려지면 비운다.
  const pendingRef = useRef<DocumentNode | undefined>(undefined);
  useEffect(() => {
    pendingRef.current = undefined;
  }, [tree]);
  const latest = useCallback(() => pendingRef.current ?? tree, [tree]);

  const [place, setPlace] = useState<Place>();
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSections }>();
  const [pop, setPop] = useState<{ spec: PopupSpec; anchor: Anchor }>();
  const [removing, setRemoving] = useState<{ nodeId: Id; anchor: Anchor }>();
  const [activeCell, setActiveCell] = useState<CellAt>();
  const [focusRequest, setFocusRequest] = useState<Id>();
  const [flashId, setFlashId] = useState<Id>();
  const [banner, setBanner] = useState<string>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuAt = useRef<Anchor>({ x: 0, y: 0 });

  // ── 검증 재료 — 문면 저장 검증과 같은 한 벌(validateDocument). 좌표는 템플릿 문서 ──
  const coordinate: Coordinate = useMemo(() => ({ document: "general", ownerId: data.templateId, documentId: data.templateId, ownerName: data.template.title }), [data.templateId, data.template.title]);
  const gate = useMemo(() => clauseGateFrom(data.clauses, data.discriminators.map((d) => d.code), catalogTypeResolver(data.discriminators), data.enums), [data.clauses, data.discriminators, data.enums]);
  const enumByCode = useMemo(() => new Map(data.enums.map((e) => [e.code, e] as const)), [data.enums]);
  const appendixCodes = useMemo(() => new Set(data.appendices.map((a) => a.code)), [data.appendices]);
  const boxByCode = useMemo(() => new Map(data.boxes.map((x) => [x.code, x] as const)), [data.boxes]);
  const editEnv: EditEnv = useMemo(
    () => ({
      // 다른 조가 가리키는 항도 지울 수 있다 — 깨지는 곳은 패널 위 목록이 띄우고 저장이 거부한다 (ADR-0081 결정 2)
      env: { kind: "general", appendixExists: (c: Code) => appendixCodes.has(c), boxExists: (c: Code) => boxByCode.has(c), clauseGate: gate, enumOf: (c: Code) => enumByCode.get(c), coordinate, allowDanglingRefs: true },
      generalRefs: () => undefined,
    }),
    [appendixCodes, boxByCode, gate, enumByCode, coordinate],
  );
  const resolve = useMemo(() => catalogTypeResolver(data.discriminators, (code) => data.attributeValues?.[code]), [data.discriminators, data.attributeValues]);
  const scope = useMemo(() => ({ levelOf: (code: Code) => data.discriminators.find((d) => d.code === code)?.level }), [data.discriminators]);
  // 사본이 있는 조만 — 템플릿 그대로인 조의 문제는 템플릿의 일이다
  const liveIssues = useMemo(
    () => (copy ? validateDocument(tree, { env: editEnv.env, resolve, scope }).filter((i) => i.at.articleId === articleId) : []),
    [copy, tree, editEnv, resolve, scope, articleId],
  );
  const savedIssues = (edit?.errors.copies ?? []).filter((i) => i.at.articleId === articleId);

  // ── 번호 · 참조 표기 — 트리 전체로 ──
  const clauseSpan = useMemo(() => clauseSpanBy((code) => data.clauses.find((c) => c.code === code)), [data.clauses]);
  const numbers = useMemo(() => numberTree(tree, { clauseSpan }), [tree, clauseSpan]);
  const indexOpts = useMemo(
    () => ({ clauseOf: (c: Code) => data.clauses.find((x) => x.code === c), repeatCaption: (n: ForBlockNode, outer?: ForBlockNode) => n.alias ?? repeatLabel(n.source, { ...(outer && isRepeatSource(outer.source) ? { outer: outer.source } : {}), enumOf: (c) => enumByCode.get(c) }) }),
    [data.clauses, enumByCode],
  );
  const references = useMemo(() => ({ self: referenceTargetIndex(tree, numbers, indexOpts), general: new Map() }), [tree, numbers, indexOpts]);
  const repeated = useMemo(() => new Set(repeatedKeys(indexTree(tree))), [tree]);
  const index = useMemo(() => indexTree(tree), [tree]);
  const article = index.nodes.get(articleId)?.node;
  const articleIndex = useMemo(() => (article?.kind === "article" ? articleOnlyIndex(tree, article) : undefined), [tree, article]);
  const appendixName = useMemo(() => new Map(data.appendices.map((a) => [a.code, a.name] as const)), [data.appendices]);
  const clauseLabel = useMemo(() => new Map(data.clauses.map((c) => [c.code, c.label] as const)), [data.clauses]);
  const switchLabelers = useMemo(() => new Map(data.clauses.filter((c) => (c.params ?? []).length > 0).map((c) => [c.code, switchValueLabeler(c, data.enums)] as const)), [data.clauses, data.enums]);
  const refLabel = useMemo(() => refLabelOf(data.condition), [data.condition]);
  const optionText = useCallback(
    (clauseCode: Code, options: Record<Code, Code>): string => {
      const clause = data.clauses.find((c) => c.code === clauseCode);
      if (!clause) return Object.entries(options).map(([o, v]) => `${o}: ${v}`).join(" · ") || "옵션 선택 없음";
      const parts = clause.options.map((o) => {
        const chosen = options[o.code];
        return `${o.label}: ${o.values.find((v) => v.code === chosen)?.label ?? (chosen !== undefined ? `${chosen}(없는 선택지)` : "미선택")}`;
      });
      return parts.length > 0 ? parts.join(" · ") : "옵션 없음";
    },
    [data.clauses],
  );

  useEffect(() => {
    if (!flashId) return;
    bodyRef.current?.querySelector(`[data-node="${CSS.escape(flashId)}"]`)?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setFlashId(undefined), 2500);
    return () => clearTimeout(t);
  }, [flashId]);

  // ── 조작 — 명령을 트리에 적용하고, 그 조만 바뀌었으면 초안의 사본으로 ──
  const apply = (ops: readonly EditOp[]): boolean => {
    if (!edit || !templateArticle) return false;
    const before = latest();
    let next = before;
    for (const op of ops) {
      const r = applyEdit({ tree: next }, op, editEnv);
      if (!r.ok) {
        setBanner(`적용하지 못했다 — ${describeRejection(r.rejection).message}`);
        return false;
      }
      next = r.value.state.tree;
    }
    if (next === before) return true;
    if (!articleOnlyChange(before, next, articleId)) {
      setBanner(`적용하지 못했다 — ${COPY_REFUSAL}`);
      return false;
    }
    const changed = articlesById(next).get(articleId)!;
    pendingRef.current = next;
    edit.dispatch({ type: "editArticle", article: changed, template: templateArticle });
    setBanner(undefined);
    return true;
  };
  const markSelection = (mark: WorkMark | undefined) => {
    const ops = markSelectionOps(latest(), mark, randomIds);
    if (ops.length === 0) {
      setBanner("글자색을 칠하지 못했다 — 칠할 글을 먼저 끌어서 고른다. 칩(슬롯 · 참조 · 조건)에는 색이 없다.");
      return;
    }
    apply(ops);
  };
  const drag = useBlockDrag({ latest, apply, enabled: true });

  const menuEnv = (): MenuEnv => {
    const t = latest();
    return { tree: t, ix: indexTree(t), docKind: "general", newId: randomIds };
  };
  /** 지금 자리 — 고른 자리가 없거나 사라졌으면 이 조. */
  const placeIn = (ix: MenuEnv["ix"]): Place => (place && placeExists(ix, place) ? place : { kind: "article", id: articleId });
  const scoped = (env: MenuEnv, at: Place, tokens: Token[] = []) => copyScopeMenu(placeMenu(env, at, tokens), at, articleId);

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const env = menuEnv();
    const at = placeOf(target) ?? ({ kind: "article", id: articleId } as const);
    let tokens: Token[] = [];
    if (at.kind === "inline") {
      const inline = target.closest("[data-inline]") as HTMLElement;
      const caret = caretFromPoint(event.clientX, event.clientY);
      tokens = tokensOf(inline, caret && inline.contains(caret.node) ? caret : undefined);
    }
    setPlace(at);
    menuAt.current = { x: event.clientX, y: event.clientY + 4, top: event.clientY };
    setMenu({ x: event.clientX, y: event.clientY, sections: scoped(env, at, tokens) });
  };

  const runMenu = (item: MenuItem, anchor: Anchor = menuAt.current) => {
    if (item.refusal) {
      setBanner(`적용하지 못했다 — ${item.refusal}`);
      return;
    }
    const a = item.action;
    if (a.do === "popup") {
      setPop({ spec: a.popup, anchor });
      return;
    }
    if (a.do === "remove") {
      setRemoving({ nodeId: a.nodeId, anchor });
      return;
    }
    const ops = typeof a.ops === "function" ? a.ops(latest()) : a.ops;
    if (ops.length === 0 || !apply(ops)) return;
    if (a.focus) setFocusRequest(a.focus);
    if (a.openChip) setPop({ spec: { kind: "editChip", nodeId: a.openChip }, anchor });
  };

  const pickMenu = (item: MenuItem) => {
    if ((item.label === "위로" || item.label === "아래로") && drag.blockSel.length > 1 && !item.refusal) {
      const ops = moveSelectionOps(latest(), drag.blockSel, item.label === "위로" ? -1 : 1);
      if (ops.length > 0) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        apply(ops);
      }
      return;
    }
    runMenu(item);
  };

  /** 툴바 버튼 — 문면 편집기(`DocumentEditor.runTool`)와 같은 길, 목록만 조 범위로 거른다. */
  const runTool = (toolId: ToolId, button: HTMLElement, onPlace?: Place) => {
    const env = menuEnv();
    let at = onPlace ?? placeIn(env.ix);
    let tokens: Token[] = [];
    let cut: string | undefined;
    if (at.kind === "inline") {
      const read = bodyRef.current ? readInline(bodyRef.current, at) : undefined;
      if (read) ({ tokens, cut } = read);
      else at = "tableId" in at.at ? { kind: "block", id: at.at.tableId } : env.ix.nodes.has(at.at.parentId) ? { kind: "block", id: at.at.parentId } : { kind: "head", id: at.at.parentId };
    }
    const sections = scoped(env, at, tokens);
    const anchor = anchorOf(button);
    menuAt.current = anchor;
    if (toolId === "cond" || toolId === "inlineCond") {
      const inline = at.kind === "inline" ? { at: at.at, tokens, ...(cut !== undefined ? { cut } : {}) } : undefined;
      const item =
        toolId === "inlineCond"
          ? inline && inlineCondItem(inline.at, inline.tokens, randomIds, inline.cut)
          : condInsertItem(env, sections, condInput(bodyRef.current, at, inline), (id) => env.ix.nodes.get(id)?.allowed.includes("condBlock") ?? false);
      if (!item) return;
      if (item.label !== "문장 안 조건") (document.activeElement as HTMLElement | null)?.blur?.();
      runMenu(item, anchor);
      return;
    }
    const tool = allTools(DOCUMENT_TOOLS).find((t) => t.id === toolId);
    const items = tool ? itemsFor(tool, sections).filter((i) => !i.disabled && !i.refusal) : [];
    if (items.length === 0) return;
    if (tool?.multi && items.length > 1) {
      setMenu({ x: anchor.x, y: anchor.y, sections: [items] });
      return;
    }
    const first = items[0].action;
    if (toolId === "clauseBlock") {
      const ordered = [...items.filter((i) => i.label.startsWith("아래에")), ...items.filter((i) => !i.label.startsWith("아래에"))];
      const groups = ordered.flatMap((i) => (i.action.do === "popup" && i.action.popup.kind === "clauseBlock" ? [clausePickItems(data.clauses, i.action.popup.at, randomIds, i.action.popup.fit)] : [])).filter((g) => g.length > 0);
      if (groups.length > 0) {
        setMenu({ x: anchor.x, y: anchor.y, sections: groups });
        return;
      }
    }
    if (toolId === "box" && first.do === "popup" && first.popup.kind === "boxPick" && data.boxes.length > 0) {
      setMenu({ x: anchor.x, y: anchor.y, sections: [boxPickItems(data.boxes, first.popup.at, randomIds)] });
      return;
    }
    if (items[0].action.do !== "popup") (document.activeElement as HTMLElement | null)?.blur?.();
    runMenu(items[0], anchor);
  };

  const handlers: EditHandlers = {
    apply,
    commitInline: (at, tokens) => {
      const list = inlineListAt(latest(), at);
      if (!list) return;
      const runs = runsFromTokens(list, tokens, randomIds);
      if (sameRuns(runs, identityRuns(list))) return;
      apply([{ type: "setInlines", at, runs }]);
    },
    enter: (ownerId) => {
      const k = enterOps(latest(), ownerId, randomIds);
      if (k && apply(k.ops) && k.focus) setFocusRequest(k.focus);
    },
    removeEmpty: (ownerId) => {
      const k = backspaceOps(latest(), ownerId);
      if (!k || !apply(k.ops)) return false;
      if (k.focus) setFocusRequest(k.focus);
      return true;
    },
    pasteGrid: (cell, text) => {
      const t = indexTree(latest()).nodes.get(cell.tableId)?.node;
      if (!t || t.kind !== "table") return false;
      const ops = pasteGridOps(t, cell.row, cell.col, text, randomIds);
      if (!ops) return false;
      apply(ops);
      return true;
    },
    setTitle: (nodeId, title) => {
      apply([{ type: "setTitle", nodeId, title: title.trim() }]);
    },
    setBox: (nodeId, title, lines) => {
      apply([{ type: "setBox", nodeId, title: title.trim(), lines }]);
    },
    popup: (spec, anchor) => setPop({ spec, anchor }),
    focusInline: (at) => setActiveCell("tableId" in at ? at : undefined),
    ...(activeCell ? { activeCell } : {}),
    setActiveCell,
    ...(focusRequest ? { focusRequest } : {}),
    focusDone: () => setFocusRequest(undefined),
    contextMenu: onContextMenu,
    headItems: (branchId) => condMenu(menuEnv(), branchId).flat(),
    run: (item, anchor) => runMenu(item, anchor),
    blockSel: drag.blockSel,
    selectBlock: drag.selectBlock,
    blockAct: (nodeId, act, button) => {
      const kind = index.nodes.get(nodeId)?.node.kind;
      const at: Place = kind === "article" ? { kind: "articleTitle", id: nodeId } : { kind: "block", id: nodeId };
      setPlace(at);
      runTool(act, button, at);
    },
    ...(placeBlockId(place) ? { currentBlock: placeBlockId(place) } : {}),
  };

  const withRow = (levels: ReturnType<typeof repeatLevels> | undefined): ConditionContext => (levels && levels.length > 0 ? { ...data.condition, row: { levels, readable: rowReadableLevels(levels) } } : data.condition);
  const scopeOf = (id: Id) => repeatScopeOf(tree, index.branches.get(id)?.ownerId ?? id)?.levels;
  const repeatLabelOf = (nodeId: Id): string => {
    const loops = loopsAround(index, nodeId);
    const self = loops.at(-1);
    if (!self || self.id !== nodeId) return "반복";
    const outer = loops.at(-2)?.source;
    return self.alias ?? repeatLabel(self.source, { ...(outer && isRepeatSource(outer) ? { outer } : {}), enumOf: (c) => enumByCode.get(c) });
  };

  const ctxBase: DocCtx = {
    documentId: data.templateId,
    docKind: "general",
    mode: "edit",
    numbers,
    appendixName,
    clauseLabel,
    optionText,
    references,
    repeatedKeys: repeated,
    refLabel,
    clauses: data.clauses,
    boxOf: (code) => boxByCode.get(code),
    repeatLabelOf,
    enumValueLabel: (code: Code) => {
      for (const e of data.enums) {
        const v = e.values.find((x) => x.code === code);
        if (v && repeatElementEnums().has(e.code)) return v.label;
      }
      return undefined;
    },
    enumOf: (c: Code) => enumByCode.get(c),
    switchValueLabel: (clause, on, code) => switchLabelers.get(clause.code)?.(on, code),
    conditionFor: (nodeId) => withRow(scopeOf(nodeId)),
    ...(flashId ? { flashId } : {}),
  };
  const ctx: DocCtx = { ...ctxBase, edit: handlers };

  const conditionFor = (spec: PopupSpec): ConditionContext => {
    if (spec.kind === "insertInline") {
      if ("tableId" in spec.at) {
        const t = index.nodes.get(spec.at.tableId)?.node;
        return withRow(t?.kind === "table" && t.repeat && !t.rows[spec.at.row]?.header ? repeatLevels(t) : undefined);
      }
      return withRow(scopeOf(spec.at.parentId));
    }
    return spec.kind === "editChip" ? withRow(scopeOf(spec.nodeId)) : data.condition;
  };
  const popupEnv: PopupEnv = {
    ctx,
    tree,
    latest,
    apply,
    newId: randomIds,
    appendices: data.appendices,
    boxes: data.boxes,
    clauses: data.clauses,
    generals: [],
    setGeneral: () => undefined,
    condition: pop ? conditionFor(pop.spec) : data.condition,
    enumOf: (c) => enumByCode.get(c),
  };

  const toolbarPlace = placeIn(index);
  const toolbarSections = scoped({ tree, ix: index, docKind: "general", newId: randomIds }, toolbarPlace);
  const placeWords = (p: Place): string => {
    const num = (id: Id) => numbers.get(id)?.label;
    if (p.kind === "block") {
      const kind = index.nodes.get(p.id)?.node.kind;
      return `${["paragraph", "item", "subitem"].includes(kind ?? "") ? `${num(p.id) ?? ""} ` : ""}${NODE_WHAT[kind ?? ""] ?? "블록"}`.trim();
    }
    if (p.kind === "inline") {
      if ("tableId" in p.at) return `표 ${p.at.row + 1}행 ${p.at.col + 1}열`;
      const kind = index.nodes.get(p.at.parentId)?.node.kind;
      return kind ? `${num(p.at.parentId) ?? ""} ${NODE_WHAT[kind] ?? ""} 문장`.trim() : "조건 가지 문장";
    }
    return p.kind === "head" ? "조건 가지" : p.kind === "chip" ? "칩" : (num(articleId) ?? "조");
  };

  let removeCard: ReactNode = null;
  if (removing) {
    const entry = index.nodes.get(removing.nodeId);
    if (entry && entry.node.kind !== "article") {
      const num = numbers.get(entry.node.id);
      const what = `${num && ["paragraph", "item", "subitem"].includes(entry.node.kind) ? `제${num.n}` : ""}${NODE_WHAT[entry.node.kind] ?? entry.node.kind}`;
      removeCard = (
        <Popover anchor={removing.anchor} label={`${what} 삭제`} onClose={() => setRemoving(undefined)}>
          <RemoveCard
            documentId={data.templateId}
            tree={tree}
            node={entry.node}
            what={what}
            articles={articlesOf(tree)}
            inOriginal={false}
            allowBroken
            onRemove={() => {
              if (apply([{ type: "remove", nodeId: entry.node.id }])) setRemoving(undefined);
            }}
            onCancel={() => setRemoving(undefined)}
            onGo={(nodeId) => {
              setRemoving(undefined);
              setFlashId(nodeId);
            }}
          />
        </Popover>
      );
    }
  }

  if (!edit || !templateArticle || !articleIndex) return <p className="ts-muted">고른 조가 템플릿에 없다 — 목차에서 다른 조를 고른다.</p>;

  const stale = copy !== undefined && copy.templateHash !== articleHash(templateArticle);
  const issues: Issue[] = [...savedIssues, ...liveIssues.filter((i) => !savedIssues.some((s) => s.message === i.message && s.at.nodePath?.at(-1) === i.at.nodePath?.at(-1)))];
  const editorBody = (
    <div
      className="ts-copy-editor-body"
      ref={bodyRef}
      onContextMenu={onContextMenu}
      {...drag.props}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.button !== 2 && !e.shiftKey && !target.closest("[data-drag], .ts-doc-toolbar")) drag.clearSel();
        if (target.closest(".ts-doc-toolbar, .ts-cell-bar")) return;
        if (activeCell && !target.closest(".ts-doc-table")) setActiveCell(undefined);
        setPlace(placeOf(target) ?? { kind: "article", id: articleId });
      }}
      onFocus={(e) => {
        const at = placeOf(e.target as HTMLElement);
        if (at) setPlace(at);
      }}
    >
      <ArticleBody index={articleIndex} articleId={articleId} ctx={ctx} />
    </div>
  );
  const clauseRefs = clauseRefsIn(tree, articleId);

  return (
    <div className="ts-copy-editor" aria-label={`조 편집 · ${label}`}>
      {copy ? (
        <div className={stale ? "ts-copy-status is-stale" : "ts-copy-status"} role="status">
          <span>
            {stale ? (
              <>
                <b>템플릿이 바뀌었습니다</b> — 사본을 만든 뒤 템플릿의 이 조가 고쳐졌다. 나란히 보고 고른다(자동으로 합치지 않는다).
              </>
            ) : (
              <>
                <b>이 상품 사본</b> — 템플릿과 다른 본문이다. 템플릿을 고쳐도 이 조는 따라가지 않는다.
              </>
            )}
          </span>
          <span className="ts-copy-status-actions">
            <button type="button" onClick={() => edit.dispatch({ type: "revertArticle", articleId })}>
              템플릿대로 되돌리기
            </button>
            {stale && (
              <button type="button" onClick={() => edit.dispatch({ type: "keepCopy", articleId, templateHash: articleHash(templateArticle) })}>
                사본 유지
              </button>
            )}
          </span>
        </div>
      ) : (
        <p className="ts-muted ts-copy-note">템플릿 조 그대로다 — 고치면 이 상품만의 사본이 된다(저장해야 반영). 조를 넣거나 옮기거나 지우는 일은 템플릿에서 한다.</p>
      )}
      {data.replacedBy?.[articleId] !== undefined && (
        <p className="ts-warn ts-copy-replaced" role="status">
          이 조는 기본계약 「{data.replacedBy[articleId]}」의 조로 대치된다 — 조립(미리보기 · 산출)에는 기본계약 본문이 찍히고, 여기서 고친 본문은 나오지 않는다. 문장을 바꾸려면 기본계약 담보약관을 고친다.
        </p>
      )}
      {banner && (
        <p className="ts-error-banner" role="alert">
          {banner}
        </p>
      )}
      {issues.length > 0 && <DraftIssues go={setFlashId} issues={issues} />}
      <EditorToolbar groups={DOCUMENT_TOOLS} sections={toolbarSections} editing onRun={runTool} onMark={markSelection} where={placeWords(toolbarPlace)} />
      {stale ? (
        <div className="ts-copy-compare">
          <section aria-label="템플릿 현재 본문">
            <h4 className="ts-copy-compare-title">템플릿 현재 본문</h4>
            <ArticleBody index={articleOnlyIndex(data.template, templateArticle)} articleId={articleId} ctx={{ ...ctxBase, mode: "read", numbers: numberTree(data.template, { clauseSpan }) }} />
          </section>
          <section aria-label="이 상품 본문">
            <h4 className="ts-copy-compare-title">이 상품 본문</h4>
            {editorBody}
          </section>
        </div>
      ) : (
        editorBody
      )}
      {clauseRefs.length > 0 && (
        <section className="ts-copy-options" aria-label="함수조항 옵션">
          <h4 className="ts-copy-compare-title">함수조항 옵션 — 이 상품</h4>
          {clauseRefs.map((r) => {
            const clause = data.clauses.find((c) => c.code === r.clauseCode);
            const name = `${clause?.label ?? r.clauseCode}(${r.clauseCode})`;
            const errors = edit.errors.nodes.get(r.id) ?? [];
            return (
              <div key={r.id} className="ts-clause-use" data-clause-box={r.id}>
                <p>
                  <b>{name}</b> <span className="ts-muted">마스터 기본 — {optionText(r.clauseCode, r.options)}</span>
                  {edit.changes.nodes.has(r.id) && <span className="ts-badge ts-changed-mark">변경</span>}
                </p>
                <ClauseOptionPicker nodeId={r.id} clauseCode={r.clauseCode} baseOptions={r.options} options={(clause?.options ?? []).map((o) => ({ code: o.code, label: o.label, values: o.values.map((v) => ({ code: v.code, label: v.label })) }))} label={name} />
                {errors.map((message, i) => (
                  <p key={i} className="ts-error" role="alert">
                    {message}
                  </p>
                ))}
              </div>
            );
          })}
        </section>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} sections={menu.sections} onPick={pickMenu} onClose={() => setMenu(undefined)} />}
      {pop && <PopupHost env={popupEnv} spec={pop.spec} anchor={pop.anchor} onClose={() => setPop(undefined)} />}
      {removeCard}
    </div>
  );
}
