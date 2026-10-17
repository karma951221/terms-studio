"use client";

/**
 * 동적표 템플릿 한 줄의 인라인 편집기 (기능/동적표 §4.2 「머리글」 · 「셀 템플릿」) — 함수조항 「문구」 유형의 본문 편집기를 그대로 작게 싼 것.
 *
 * - 템플릿(`Inline[]`)을 편집 트리(문서 › 조 › 한 줄)로 싸고(`clauseBodyToTree("inline")`), 문면의 편집 명령(`applyEdit`) · 렌더러(`InlineSlot`) · 툴바 · 팝업을
 *   쓴 뒤 바뀔 때마다 `Inline[]` 로 되돌려 올린다(`treeToClauseBody`). 편집본은 부모가 든다 — 이 컴포넌트는 상태가 없다(팝업 · 메뉴 · 자리만).
 * - 넣을 수 있는 것은 글 · 슬롯 · 문장 안 조건 · 값별 분기 · 조사뿐(§3.3) — 자리 목록에서 그 밖(조 참조 · 별표 · 함수조항 · 문장 안 반복)은 거른다.
 * - 슬롯 후보 = 그 템플릿에서 쓸 수 있는 표 슬롯(`DYN_TABLE_ALLOWED_SLOTS` → 조건 문맥 `table`) + 선언한 인자(`arg.<이름>`). 조건은 `arg.X` 를 읽고,
 *   셀 템플릿의 「해당보장의」 조건(`count(builtin.subCoverage.name) >= 2`)은 식 칸에 직접 쓴다.
 * - 읽기 모드도 같은 렌더러 — 칩으로 조판(`chipOverride` 가 표 슬롯을 「{경계}」, 인자 슬롯을 「{갱신형}」으로).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { refLabelOf } from "@/app/(app)/documents/[id]/_components/condition/display";
import type { ConditionContext } from "@/app/(app)/documents/[id]/_components/condition/types";
import { anchorOf, type Anchor, type DocCtx, type EditHandlers } from "@/app/(app)/documents/[id]/_components/ctx";
import { EditorToolbar } from "@/app/(app)/documents/[id]/_components/EditorToolbar";
import { insertedChip, inlineListAt } from "@/app/(app)/documents/[id]/_components/editOps";
import { InlineSlot, caretFromPoint, tokensOf } from "@/app/(app)/documents/[id]/_components/Inline";
import { identityRuns, runsFromTokens, sameRuns, type Token } from "@/app/(app)/documents/[id]/_components/inlineRuns";
import { inlineCondItem, type MenuItem, type MenuSections, type Place, type PopupSpec } from "@/app/(app)/documents/[id]/_components/menus";
import { placeOf, readInline } from "@/app/(app)/documents/[id]/_components/place";
import { PopupHost, type PopupEnv } from "@/app/(app)/documents/[id]/_components/Popups";
import { ContextMenu } from "@/app/(app)/documents/[id]/_components/Popover";
import { switchSubjectsOf } from "@/app/(app)/documents/[id]/_components/switchCases";
import { CLAUSE_LINE_TOOLS, allTools, itemsFor, type ToolGroup, type ToolId } from "@/app/(app)/documents/[id]/_components/tools";
import { clauseCondMenu, clausePlaceMenu, type ClauseMenuEnv } from "@/app/(app)/functions/_components/clauseMenus";
import type { Inline } from "@/domain/clause/nodes";
import { CLAUSE_LINE_ID, applyEdit, clauseBodyToTree, indexTree, numberTree, randomIds, treeToClauseBody, type ClauseGate, type DocumentNode, type EditEnv, type EditOp, type InlineNode } from "@/domain/document";
import { DYN_TABLE_SLOT_LABEL, isDynTableSlotRef, type DynTableSlotRef } from "@/domain/dyntable/types";
import type { Id } from "@/domain/types";

/** 템플릿에 서는 도구만 — 슬롯 · 조사 · 문장 안 조건 · 값별 분기 · 조건 편집 · 속성 (기능/동적표 §3.3). */
const TEMPLATE_TOOL_IDS = new Set<ToolId>(["slot", "particle", "inlineCond", "inlineSwitch", "elif", "else", "unwrap", "removeBranch", "switchCase", "edit", "remove"]);
const TEMPLATE_TOOLS: ToolGroup[] = CLAUSE_LINE_TOOLS.map((g) => ({ ...g, tools: g.tools.filter((t) => TEMPLATE_TOOL_IDS.has(t.id)) })).filter((g) => g.tools.length > 0);

/** 자리 목록에서 템플릿에 둘 수 있는 항목만 — 이름으로 거른다(목록 이름 = 툴바 이름, tools.ts). */
const ALLOWED_LABELS = new Set(["치환 슬롯…", "문장 안 조건", "문장 안 값별 분기", "고치기…", "삭제", "가지 추가(ELIF)", "ELSE 가지 추가", "이 가지 삭제", "칸 추가", "이 칸 삭제", "값별 분기 삭제"]);
function allowedItem(item: MenuItem): boolean {
  return ALLOWED_LABELS.has(item.label) || item.label.startsWith("조사 — ") || item.label.startsWith("조건 풀기") || item.label.startsWith("이 가지 삭제");
}
function filterSections(sections: MenuSections): MenuSections {
  return sections.map((s) => s.filter(allowedItem)).filter((s) => s.length > 0);
}

const GATE: ClauseGate = { clauseExists: () => false, requiredCodes: () => [], missingRequired: () => [], validateOptions: () => [] };
const EDIT_ENV: EditEnv = { env: { kind: "special", appendixExists: () => false, boxExists: () => false, clauseGate: GATE, switches: true }, generalRefs: () => undefined };

export interface TemplateEditorProps {
  /** 이 줄의 id — DOM · 팝업 열쇠. */
  id: string;
  value: readonly Inline[];
  onChange: (next: Inline[]) => void;
  editing: boolean;
  /** 조건 · 슬롯 고르기 문맥 — 변수는 인자 칸(`arg.<이름>`)뿐(부모가 `paramEntries` 로 만든다). */
  condition: ConditionContext;
  /** 이 템플릿에서 쓸 수 있는 표 슬롯. */
  slots: readonly DynTableSlotRef[];
  placeholder?: string;
  /** 저장 거부 사유 — 이 줄 아래에 보인다. */
  error?: string;
}

export function TemplateEditor({ id, value, onChange, editing, condition: base, slots, placeholder = "템플릿", error }: TemplateEditorProps) {
  const tree = useMemo(() => clauseBodyToTree("inline", value as Inline[]), [value]);
  // 누르는 순간의 편집본 — 부모가 새 값을 내려주면 따라가고, 적용 직후에는 apply 가 바로 바꾼다(부모의 재렌더 전에도 다음 명령이 최신을 보게)
  const treeRef = useRef(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);
  const latest = useCallback((): DocumentNode => treeRef.current, []);
  const index = useMemo(() => indexTree(tree), [tree]);
  const numbers = useMemo(() => numberTree(tree), [tree]);
  const condition = useMemo((): ConditionContext => ({ ...base, quick: [], table: { slots } }), [base, slots]);
  const switchSubjects = useMemo(() => switchSubjectsOf(condition.discriminators), [condition]);
  const refLabel = useMemo(() => refLabelOf(condition), [condition]);

  const [place, setPlace] = useState<Place>();
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSections }>();
  const [pop, setPop] = useState<{ spec: PopupSpec; anchor: Anchor }>();
  const [focusRequest, setFocusRequest] = useState<Id>();
  const [refusal, setRefusal] = useState<string>();
  const menuAt = useRef<Anchor>({ x: 0, y: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);

  const apply = (ops: readonly EditOp[]): boolean => {
    let state = { tree: treeRef.current };
    for (const op of ops) {
      const r = applyEdit(state, op, EDIT_ENV);
      if (!r.ok) {
        const issues = r.rejection.reason === "invalid" ? r.rejection.issues : undefined;
        setRefusal(`적용하지 못했다 — ${issues?.[0]?.message ?? r.rejection.reason}`);
        return false;
      }
      state = r.value.state;
    }
    if (ops.length === 0) return true;
    const body = treeToClauseBody("inline", state.tree);
    if (!body.ok) {
      setRefusal("템플릿을 읽을 수 없다");
      return false;
    }
    treeRef.current = state.tree;
    onChange(body.value as Inline[]);
    setRefusal(undefined);
    return true;
  };

  const envOf = (t: DocumentNode): ClauseMenuEnv => ({ tree: t, ix: indexTree(t), docKind: "special", newId: randomIds, mode: "inline", options: [], switchSubjects, onRefuse: (m) => setRefusal(`넣을 수 없다 — ${m}`) });
  /** 누르는 순간의 편집본으로 — 메뉴를 연 뒤 문장 칸이 초점을 잃으며 글이 먼저 적용될 수 있다. */
  const menuEnv = (): ClauseMenuEnv => envOf(latest());
  const linePlace: Place = { kind: "inline", at: { parentId: CLAUSE_LINE_ID } };
  const placeNow = (): Place => (place && (place.kind !== "chip" || index.nodes.has(place.id)) ? place : linePlace);

  const focusInserted = (ops: readonly EditOp[]) => {
    const chip = insertedChip(ops);
    if (chip) setFocusRequest(chip);
  };
  const runMenu = (item: MenuItem, anchor: Anchor = menuAt.current) => {
    const a = item.action;
    if (a.do === "popup") return setPop({ spec: a.popup, anchor });
    if (a.do === "remove") return void apply([{ type: "remove", nodeId: a.nodeId }]);
    const ops = typeof a.ops === "function" ? a.ops(latest()) : a.ops;
    if (ops.length === 0 || !apply(ops)) return;
    if (a.focus) setFocusRequest(a.focus);
    if (a.openChip) setPop({ spec: { kind: "editChip", nodeId: a.openChip }, anchor });
    else if (!a.focus) focusInserted(ops);
  };

  const runTool = (toolId: ToolId, button: HTMLElement) => {
    const env = menuEnv();
    const at = placeNow();
    let tokens: Token[] = [];
    let cut: string | undefined;
    if (at.kind === "inline") {
      const read = bodyRef.current ? readInline(bodyRef.current, at) : undefined;
      if (!read) return;
      ({ tokens, cut } = read);
    }
    const anchor = anchorOf(button);
    menuAt.current = anchor;
    if (toolId === "inlineCond" || toolId === "cond") {
      if (at.kind !== "inline") return;
      runMenu(inlineCondItem(at.at, tokens, randomIds, cut), anchor);
      return;
    }
    const sections = filterSections(clausePlaceMenu(env, at, tokens));
    const tool = allTools(TEMPLATE_TOOLS).find((t) => t.id === toolId);
    const items = tool ? itemsFor(tool, sections).filter((i) => !i.disabled && !i.refusal) : [];
    if (items.length === 0) return;
    if (tool?.multi && items.length > 1) return setMenu({ x: anchor.x, y: anchor.y, sections: [items] });
    if (items[0].action.do !== "popup") (document.activeElement as HTMLElement | null)?.blur?.();
    runMenu(items[0], anchor);
  };

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const at = placeOf(target) ?? linePlace;
    let tokens: Token[] = [];
    if (at.kind === "inline") {
      const inline = target.closest("[data-inline]") as HTMLElement | null;
      const caret = caretFromPoint(event.clientX, event.clientY);
      if (inline) tokens = tokensOf(inline, caret && inline.contains(caret.node) ? caret : undefined);
    }
    const sections = filterSections(clausePlaceMenu(menuEnv(), at, tokens));
    if (sections.length === 0) return;
    setPlace(at);
    menuAt.current = { x: event.clientX, y: event.clientY + 4, top: event.clientY };
    setMenu({ x: event.clientX, y: event.clientY, sections });
  };

  const edit: EditHandlers = {
    apply,
    commitInline: (at, tokens) => {
      const list = inlineListAt(latest(), at);
      if (!list) return;
      const runs = runsFromTokens(list, tokens, randomIds);
      if (sameRuns(runs, identityRuns(list))) return;
      apply([{ type: "setInlines", at, runs }]);
    },
    enter: () => undefined,
    removeEmpty: () => false,
    pasteGrid: () => false,
    setTitle: () => undefined,
    setBox: () => undefined,
    popup: (spec, anchor) => setPop({ spec, anchor }),
    focusInline: () => undefined,
    setActiveCell: () => undefined,
    ...(focusRequest ? { focusRequest } : {}),
    focusDone: () => setFocusRequest(undefined),
    contextMenu: onContextMenu,
    headItems: (branchId) => filterSections(clauseCondMenu(menuEnv(), branchId)).flat(),
    run: (item, anchor) => runMenu(item, anchor),
  };

  /** 표 슬롯은 「{경계}」, 인자 슬롯은 「{갱신형}」 — 템플릿 §3.3 표기 그대로. */
  const chipOverride = useCallback(
    (node: InlineNode) => {
      if (node.kind !== "slot") return undefined;
      if (isDynTableSlotRef(node.ref)) return { className: "ts-doc-slot", what: "표 슬롯", title: `표 슬롯 — 펼칠 때 ${DYN_TABLE_SLOT_LABEL[node.ref]} 값이 글로 찍힌다`, body: `{${DYN_TABLE_SLOT_LABEL[node.ref]}}` };
      if (node.ref.startsWith("arg.")) return { className: "ts-doc-slot", what: "인자 슬롯", title: `인자 슬롯 — 사용처가 연결한 값이 찍힌다 · ${node.ref}`, body: `{${node.ref.slice(4)}}` };
      return undefined;
    },
    [],
  );

  const ctx: DocCtx = {
    documentId: id,
    docKind: "special",
    mode: editing ? "edit" : "read",
    numbers,
    appendixName: new Map(),
    clauseLabel: new Map(),
    optionText: () => "",
    references: { self: new Map(), general: new Map() },
    refLabel,
    chipOverride,
    conditionFor: () => condition,
    switchSubjects,
    ...(editing ? { edit } : {}),
  };
  const popupEnv: PopupEnv = {
    ctx,
    tree,
    latest,
    apply: (ops) => {
      if (!apply(ops)) return false;
      focusInserted(ops);
      return true;
    },
    newId: randomIds,
    appendices: [],
    boxes: [],
    clauses: [],
    generals: [],
    setGeneral: () => undefined,
    condition,
  };

  const line = tree.children[0]?.kind === "article" ? tree.children[0].children[0] : undefined;
  const lineNodes = line?.kind === "paragraph" ? line.children : [];
  const toolbarSections = editing ? filterSections(clausePlaceMenu(envOf(tree), placeNow())) : [];

  return (
    <div className="ts-dyn-template">
      <div
        ref={bodyRef}
        className={`ts-clause-editor ts-dyn-template-editor${editing ? " is-editing" : ""}`}
        onContextMenu={onContextMenu}
        onPointerDown={(e) => {
          if (!editing) return;
          const target = e.target as HTMLElement;
          if (target.closest(".ts-doc-toolbar")) return;
          const at = placeOf(target);
          if (at) setPlace(at);
        }}
        onFocus={(e) => {
          if (!editing) return;
          const at = placeOf(e.target as HTMLElement);
          if (at) setPlace(at);
        }}
      >
        {editing && <EditorToolbar groups={TEMPLATE_TOOLS} sections={toolbarSections} editing onRun={runTool} where={placeNow().kind === "inline" ? "템플릿" : placeNow().kind === "chip" ? "칩" : "조건 가지"} />}
        <article className="ts-doc">
          <div className="ts-doc-paragraph is-line">
            {!editing && lineNodes.length === 0 ? <span className="ts-muted">(비어 있음)</span> : <InlineSlot at={{ parentId: CLAUSE_LINE_ID }} nodes={lineNodes} ctx={ctx} placeholder={placeholder} />}
          </div>
        </article>
      </div>
      {refusal && (
        <p className="ts-form-error" role="alert">
          {refusal}
        </p>
      )}
      {error && (
        <p className="ts-form-error" role="alert">
          {error}
        </p>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} sections={menu.sections} onPick={(item) => runMenu(item)} onClose={() => setMenu(undefined)} />}
      {pop && editing && <PopupHost env={popupEnv} spec={pop.spec} anchor={pop.anchor} onClose={() => setPop(undefined)} />}
    </div>
  );
}
