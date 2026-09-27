"use client";

/**
 * 공용조항 에디터 — `/clauses/new`(생성) · `/clauses/<code>`(상세) 한 벌 (기능/공용조항 §4.2 · §4.3).
 *
 * 한 화면 두 단 — 왼쪽은 위에서 아래로 「공용조항명 · 유형」 → 「본문」(툴바 + 약관 에디터), 오른쪽은 옵션 목록. 좁으면 옵션이 아래로 내려간다.
 * - 본문은 **문면 저작 에디터를 그대로 쓴다**(§6.2) — 본문을 편집 트리(문서 › 조 하나)로 싸서(`clauseBodyToTree`) 문면의 편집 명령
 *   (`applyEdit`) · 렌더러(`Block` · `InlineSlot`) · 툴바 · 팝업을 쓰고, 저장 때 공용조항 본문으로 되돌린다(`treeToClauseBody`).
 *   다른 점은 자리뿐이다 — 조 · 관 · 공용조항 참조는 툴바에서 잠기고(사유 tooltip), 조 참조는 보통약관 대상만, 옵션 자리 넣기가 더해진다(`clauseMenus`).
 *   「문구」 유형은 문장 한 줄(항 · 호 · 목 없음), 「항」 유형은 빈 항 하나에서 시작한다 — 어디에 쓰는지가 처음부터 보인다.
 * - 유형은 생성 화면에서만 고른다(본문이 비어 있을 때) — 목록 `+` 메뉴의 고름은 처음 값일 뿐이다.
 * - 옵션 목록: 본문 옆에 늘 보이는 단(`OptionsPane`).
 *
 * 저장 한 번: 상세는 읽기로 시작 → `편집` → 가운데 · 인스펙터 · 옵션 목록을 함께 고치고 → `저장` 한 번이 한 트랜잭션(`saveClauseEditAction`).
 * 생성은 처음부터 편집 중이고, 저장하는 순간 검사 ① 을 통과해야 만들어진다(`createClauseAction`) — 실패면 아무것도 만들지 않고 오류 배너.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { DiscardDialog } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconTrash } from "@/app/_components/icons";
import { ENTITY_LABEL, MODE_LABEL, MODE_OPTIONS, NAME_LABEL, newLabel } from "@/app/_lib/labels";
import { refLabelOf } from "@/app/(app)/documents/[id]/_components/condition/display";
import { anchorOf, type Anchor, type DocCtx, type EditHandlers } from "@/app/(app)/documents/[id]/_components/ctx";
import { Block } from "@/app/(app)/documents/[id]/_components/DocBody";
import { EditorToolbar } from "@/app/(app)/documents/[id]/_components/EditorToolbar";
import { afterOf, emptyNode, inlineAtOf, inlineListAt } from "@/app/(app)/documents/[id]/_components/editOps";
import { InlineSlot, caretFromPoint, tokensOf } from "@/app/(app)/documents/[id]/_components/Inline";
import { identityRuns, runsFromTokens, runsReplacing, sameRuns, type Token } from "@/app/(app)/documents/[id]/_components/inlineRuns";
import { inlineCondItem, placeExists, type MenuItem, type MenuSections, type Place, type PopupSpec } from "@/app/(app)/documents/[id]/_components/menus";
import { placeOf, readInline } from "@/app/(app)/documents/[id]/_components/place";
import { PopupHost, type PopupEnv } from "@/app/(app)/documents/[id]/_components/Popups";
import { ContextMenu, PopActions, Popover } from "@/app/(app)/documents/[id]/_components/Popover";
import { DraftIssues } from "@/app/(app)/documents/[id]/_components/SidePanel";
import { CLAUSE_LINE_TOOLS, CLAUSE_TOOLS, allTools, condItem, itemsFor, type ToolId } from "@/app/(app)/documents/[id]/_components/tools";
import type { ClauseBody, ClauseMode, RequiredRefs } from "@/domain/clause";
import { formatCoordinate } from "@/domain/coordinate";
import {
  CLAUSE_LINE_ID,
  applyEdit,
  clauseBodyToTree,
  indexTree,
  numberTree,
  optionCarrier,
  optionCodeOf,
  randomIds,
  referenceTargetIndex,
  treeToClauseBody,
  type ClauseGate,
  type DocumentNode,
  type DraftState,
  type EditEnv,
  type EditOp,
  type GeneralRefs,
  type InlineNode,
  type ReferenceTarget,
} from "@/domain/document";
import type { Id, Impact, Issue } from "@/domain/types";

import { createClauseAction } from "../actions";
import { removeClauseEditAction, saveClauseEditAction } from "../edit-actions";
import type { ClauseEditOption } from "../edit-types";
import type { ClauseEditorData } from "../editorData";
import { clauseCondMenu, clauseDefaultPlace, clausePlaceMenu, withClauseRefusals, type ClauseMenuEnv } from "./clauseMenus";
import { OptionsPane } from "./OptionsPane";

export interface ClauseAuthoringProps {
  /** 없으면 생성 화면(`/clauses/new`). */
  code?: string;
  label: string;
  mode: ClauseMode;
  body: ClauseBody;
  options: ClauseEditOption[];
  required?: RequiredRefs;
  data: ClauseEditorData;
  /** 생성 화면 — 「항」 유형의 첫 빈 항 id. 서버가 정해 넘긴다(서버 · 브라우저 렌더가 같은 id 를 써야 한다). */
  startId?: string;
}

type Banner = { message: string; issues?: readonly Issue[] };

/** 편집 트리의 대응 보통약관 자리 — 공용조항의 조 참조는 보통약관 마스터 전체가 대상이다 (§3.5 · 기능/문면 `scope: "general"`). */
const GENERALS = "clause-generals";

/** 새 공용조항의 첫 본문 — 「항」은 빈 항 하나에서 시작해 쓸 자리가 처음부터 보인다. */
function startBody(mode: ClauseMode, id: string = randomIds()): ClauseBody {
  return mode === "block" ? [{ id, kind: "paragraph", children: [] }] : [];
}

/** 쓴 것이 없는 본문 — 빈 항(글 · 칩 · 호 없음)만 있거나 아무것도 없다. 유형을 바꿔도 잃을 것이 없다. 빈 항은 저장하지 않는다. */
export function blankBody(body: ClauseBody): boolean {
  return body.every((node) => {
    if (node.kind === "text") return node.text.trim() === "";
    if (node.kind !== "paragraph") return false;
    const items = (node as { items?: unknown[] }).items ?? [];
    return items.length === 0 && node.children.every((c) => c.kind === "text" && c.text.trim() === "");
  });
}

function unionRefs(generals: ClauseEditorData["generals"]): GeneralRefs {
  const articleIds = new Set<Id>();
  const referenceIds = new Set<Id>();
  for (const g of generals) {
    for (const e of indexTree(g.tree).nodes.values()) {
      if (e.node.kind === "article") articleIds.add(e.node.id);
      if (["article", "paragraph", "item", "subitem"].includes(e.node.kind)) referenceIds.add(e.node.id);
    }
  }
  return { articleIds, referenceIds };
}

/**
 * 조 참조 후보 — 보통약관의 조 · 항 · 호 · 목. 이 공용조항이 실려 있는 사용처 자신의 조(와 그 아래)는 뺀다 (§3.5 — 문맥 의존 참조 금지).
 */
function generalTargets(generals: ClauseEditorData["generals"], code: string | undefined): Map<Id, ReferenceTarget> {
  const out = new Map<Id, ReferenceTarget>();
  for (const g of generals) {
    const ix = indexTree(g.tree);
    const own = new Set<Id>();
    if (code) {
      for (const e of ix.nodes.values()) {
        if ((e.node.kind === "clauseBlockRef" || e.node.kind === "clauseInlineRef") && e.node.clauseCode === code && e.articleId) own.add(e.articleId);
      }
    }
    for (const [id, target] of referenceTargetIndex(g.tree, numberTree(g.tree))) {
      const articleId = ix.nodes.get(id)?.articleId;
      if (articleId && own.has(articleId)) continue;
      out.set(id, target);
    }
  }
  return out;
}

export function ClauseAuthoring(props: ClauseAuthoringProps) {
  const { code, data } = props;
  const isNew = code === undefined;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** 유형 — 생성 화면에서는 본문이 비어 있는 동안 바꿀 수 있다, 상세는 고정 (§3.1). */
  const [clauseMode, setClauseMode] = useState<ClauseMode>(props.mode);

  // ── 원본 (읽기 모드가 보이는 것) ──
  const originalTree = useMemo(() => clauseBodyToTree(props.mode, props.body, props.label), [props.mode, props.body, props.label]);

  // ── 편집본 — 생성 화면은 처음부터 편집 중 ──
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraftState] = useState<{ state: DraftState; ops: number }>(() => ({
    state: { tree: isNew ? clauseBodyToTree(props.mode, startBody(props.mode, props.startId), props.label) : originalTree, generalDocumentId: GENERALS },
    ops: 0,
  }));
  const draftRef = useRef(draft);
  const setDraft = (next: typeof draft) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [label, setLabel] = useState(props.label);
  const [options, setOptionsState] = useState<ClauseEditOption[]>(props.options);
  const optionsRef = useRef(options);
  const setOptions = (next: ClauseEditOption[]) => {
    optionsRef.current = next;
    setOptionsState(next);
  };
  const nextCode = useRef(1);
  const newCode = () => `new:${nextCode.current++}`;

  /** 툴바 · 오른쪽 클릭이 짓는 자리 — 본문에서 마지막으로 누르거나 초점이 간 곳. */
  const [place, setPlace] = useState<Place>();
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSections }>();
  const [pop, setPop] = useState<{ spec: PopupSpec; anchor: Anchor }>();
  const [focusRequest, setFocusRequest] = useState<Id>();
  const [flashId, setFlashId] = useState<Id>();
  const [banner, setBanner] = useState<Banner>();
  const [discard, setDiscard] = useState<{ go: () => void }>();
  const [removal, setRemoval] = useState<Impact>();
  const menuAt = useRef<Anchor>({ x: 0, y: 0 });
  const bodyRef = useRef<HTMLDivElement>(null);

  const tree = editing ? draft.state.tree : originalTree;
  const shownOptions = editing ? options : props.options;
  const latest = useCallback((): DocumentNode => draftRef.current.state.tree, []);
  const dirty =
    editing && (isNew ? label.trim() !== "" || draft.ops > 0 || options.length > 0 : draft.ops > 0 || label !== props.label || JSON.stringify(options) !== JSON.stringify(props.options));

  // ── 편집 환경 — 문면 저작과 같은 명령 검사. 공용조항 참조 자리는 옵션 운반체만 통과한다(진짜 참조는 중첩 금지) ──
  const appendixCodes = useMemo(() => new Set(data.appendices.map((a) => a.code)), [data.appendices]);
  const refs = useMemo(() => unionRefs(data.generals), [data.generals]);
  const editEnv = useMemo((): EditEnv => {
    const gate: ClauseGate = {
      clauseExists: (c) => {
        const optionCode = optionCodeOf({ id: "", kind: "clauseInlineRef", clauseCode: c, options: {} });
        return optionCode !== undefined && optionsRef.current.some((o) => o.code === optionCode);
      },
      requiredCodes: () => [],
      missingRequired: () => [],
      validateOptions: () => [],
    };
    return { env: { kind: "special", appendixExists: (c) => appendixCodes.has(c), clauseGate: gate }, generalRefs: (id) => (id === GENERALS ? refs : undefined) };
  }, [appendixCodes, refs]);

  // ── 표기 ──
  const index = useMemo(() => indexTree(tree), [tree]);
  const numbers = useMemo(() => numberTree(tree), [tree]);
  const general = useMemo(() => generalTargets(data.generals, code), [data.generals, code]);
  const appendixName = useMemo(() => new Map(data.appendices.map((a) => [a.code, a.name] as const)), [data.appendices]);
  const refLabel = useMemo(() => refLabelOf(data.condition), [data.condition]);
  const used = useMemo(() => {
    const out = new Set<string>();
    for (const e of index.nodes.values()) {
      const optionCode = e.node.kind === "clauseInlineRef" ? optionCodeOf(e.node) : undefined;
      if (optionCode) out.add(optionCode);
    }
    return out;
  }, [index]);
  const chipOverride = useCallback(
    (node: InlineNode) => {
      const optionCode = optionCodeOf(node);
      if (optionCode === undefined) return undefined;
      const option = shownOptions.find((o) => o.code === optionCode);
      const values = option?.values.map((v) => v.label).join(" · ");
      return {
        className: "ts-doc-ref",
        what: "옵션 자리",
        title: option ? `옵션 자리 — 사용처가 고른 선택지 문구가 여기 들어간다 (선택지: ${values || "없음"})` : "없는 옵션 — 옵션 목록에서 빠졌다",
        body: `〔${option ? option.label || "이름 없는 옵션" : `${optionCode}(없는 옵션)`}〕`,
      };
    },
    [shownOptions],
  );

  useEffect(() => {
    if (!flashId) return;
    bodyRef.current?.querySelector(`[data-node="${CSS.escape(flashId)}"]`)?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setFlashId(undefined), 2500);
    return () => clearTimeout(t);
  }, [flashId]);

  // ── 조작 ──
  const apply = (ops: readonly EditOp[]): boolean => {
    let state = draftRef.current.state;
    for (const op of ops) {
      const r = applyEdit(state, op, editEnv);
      if (!r.ok) {
        const view = r.rejection.reason === "invalid" ? r.rejection.issues : undefined;
        setBanner({ message: `적용하지 못했다 — ${view?.[0]?.message ?? r.rejection.reason}`, ...(view && view.length > 1 ? { issues: view } : {}) });
        return false;
      }
      state = r.value.state;
    }
    if (ops.length > 0) setDraft({ state, ops: draftRef.current.ops + ops.length });
    setBanner(undefined);
    return true;
  };

  const refuse = (message: string) => setBanner({ message: `넣을 수 없다 — ${message}` });

  const envOf = (t: DocumentNode, opts: readonly ClauseEditOption[]): ClauseMenuEnv => ({ tree: t, ix: indexTree(t), docKind: "special", newId: randomIds, mode: clauseMode, options: opts, onRefuse: refuse });
  /** 누르는 순간의 편집본으로 — 메뉴를 연 뒤 문장 칸이 초점을 잃으며 글이 먼저 적용될 수 있다. */
  const menuEnv = (): ClauseMenuEnv => envOf(latest(), optionsRef.current);

  /** 지금 자리 — 고른 자리가 없거나 지워졌으면 유형의 기본 자리. */
  const placeIn = (ix: ReturnType<typeof indexTree>): Place => (place && placeExists(ix, place) ? place : clauseDefaultPlace(clauseMode));

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const env = menuEnv();
    const at = placeOf(target) ?? clauseDefaultPlace(clauseMode);
    let tokens: Token[] = [];
    if (at.kind === "inline") {
      const inline = target.closest("[data-inline]") as HTMLElement | null;
      const caret = caretFromPoint(event.clientX, event.clientY);
      if (inline) tokens = tokensOf(inline, caret && inline.contains(caret.node) ? caret : undefined);
      else {
        const read = bodyRef.current ? readInline(bodyRef.current, at) : undefined;
        if (!read) return;
        tokens = read.tokens;
      }
    }
    const sections = clausePlaceMenu(env, at, tokens);
    if (sections.length === 0) return;
    setPlace(at);
    menuAt.current = { x: event.clientX, y: event.clientY + 4, top: event.clientY };
    setMenu({ x: event.clientX, y: event.clientY, sections });
  };

  /** 툴바 버튼 — 누르는 순간의 편집본 · 문장 칸 조각(커서 · 고른 글)으로 목록을 다시 짓고 그 버튼의 항목을 돌린다. */
  const runTool = (toolId: ToolId, button: HTMLElement) => {
    const env = menuEnv();
    const at = placeIn(env.ix);
    let tokens: Token[] = [];
    let cut: string | undefined;
    if (at.kind === "inline") {
      const read = bodyRef.current ? readInline(bodyRef.current, at) : undefined;
      if (!read) return;
      ({ tokens, cut } = read);
    }
    const sections = clausePlaceMenu(env, at, tokens);
    const anchor = anchorOf(button);
    menuAt.current = anchor;
    if (toolId === "cond") {
      const item = condItem(sections, cut !== undefined);
      if (!item) return;
      // 고른 글은 문장 안 조건의 IF 가지 문장이 된다 — 조각에서는 이미 빠져 있다
      const chosen = item.label === "문장 안 조건" && cut !== undefined && at.kind === "inline" ? inlineCondItem(at.at, tokens, randomIds, cut) : item;
      if (chosen.label !== "문장 안 조건") (document.activeElement as HTMLElement | null)?.blur?.();
      runMenu(chosen, anchor);
      return;
    }
    const tool = allTools(CLAUSE_TOOLS).find((t) => t.id === toolId);
    const items = tool ? itemsFor(tool, sections).filter((i) => !i.disabled && !i.refusal) : [];
    if (items.length === 0) return;
    if (tool?.multi && items.length > 1) {
      setMenu({ x: anchor.x, y: anchor.y, sections: [items] });
      return;
    }
    // 바로 적용하는 조작은 쓰던 문장을 먼저 편집본에 넣는다(초점이 떠나며 적용) — 복제 · 이동이 쓰던 글을 두고 가지 않게
    if (items[0].action.do !== "popup") (document.activeElement as HTMLElement | null)?.blur?.();
    runMenu(items[0], anchor);
  };

  const runMenu = (item: MenuItem, anchor: Anchor = menuAt.current) => {
    const a = item.action;
    if (a.do === "popup") {
      setPop({ spec: a.popup, anchor });
      return;
    }
    if (a.do === "remove") {
      apply([{ type: "remove", nodeId: a.nodeId }]);
      return;
    }
    const ops = typeof a.ops === "function" ? a.ops(latest()) : a.ops;
    if (ops.length === 0) return;
    if (!apply(ops)) return;
    if (a.focus) setFocusRequest(a.focus);
    if (a.openChip) setPop({ spec: { kind: "editChip", nodeId: a.openChip }, anchor });
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
    enter: (ownerId) => {
      const ix = indexTree(latest());
      const kind = ix.nodes.get(ownerId)?.node.kind;
      const after = afterOf(ix, ownerId);
      if (clauseMode === "inline" || !after || (kind !== "paragraph" && kind !== "item" && kind !== "subitem")) return;
      const node = emptyNode(kind, randomIds);
      if (apply([{ type: "insert", node, at: after }])) setFocusRequest(node.id);
    },
    removeEmpty: (ownerId) => {
      if (clauseMode === "inline") return false;
      const ix = indexTree(latest());
      const e = ix.nodes.get(ownerId);
      if (!e) return false;
      const n = e.node as { items?: unknown[]; subitems?: unknown[] };
      if ((n.items?.length ?? 0) > 0 || (n.subitems?.length ?? 0) > 0) return false;
      const prev = [...ix.nodes.values()].find((o) => o.parentId === e.parentId && o.slot === e.slot && o.index === e.index - 1);
      if (!apply([{ type: "remove", nodeId: ownerId }])) return false;
      if (prev && (prev.node.kind === "paragraph" || prev.node.kind === "item" || prev.node.kind === "subitem")) setFocusRequest(prev.node.id);
      return true;
    },
    pasteGrid: () => false,
    setTitle: () => undefined,
    setBox: () => undefined,
    popup: (spec, anchor) => setPop({ spec, anchor }),
    focusInline: () => undefined,
    setActiveCell: () => undefined,
    ...(focusRequest ? { focusRequest } : {}),
    focusDone: () => setFocusRequest(undefined),
    contextMenu: onContextMenu,
    headItems: (branchId) => clauseCondMenu(menuEnv(), branchId).flat(),
    run: (item, anchor) => runMenu(item, anchor),
  };

  const ctx: DocCtx = {
    documentId: code ?? "new",
    docKind: "special",
    mode: editing ? "edit" : "read",
    numbers,
    appendixName,
    clauseLabel: new Map(),
    optionText: () => "",
    references: { self: new Map(), general },
    refLabel,
    chipOverride,
    articleRefScope: "general",
    conditionFor: () => data.condition,
    ...(flashId ? { flashId } : {}),
    ...(editing ? { edit } : {}),
  };

  const popupEnv: PopupEnv = {
    ctx,
    tree,
    latest,
    apply,
    newId: randomIds,
    appendices: data.appendices,
    clauses: [],
    generals: [],
    setGeneral: () => undefined,
    condition: data.condition,
  };

  // ── 편집 시작 · 끝 · 저장 · 삭제 ──
  const startEdit = () => {
    setPlace(undefined);
    setDraft({ state: { tree: originalTree, generalDocumentId: GENERALS }, ops: 0 });
    setLabel(props.label);
    setOptions(props.options);
    setEditing(true);
    setBanner(undefined);
  };

  const endEdit = () => {
    setEditing(false);
    setPlace(undefined);
    setMenu(undefined);
    setPop(undefined);
    setBanner(undefined);
  };

  const save = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const body = treeToClauseBody(clauseMode, latest());
    if (!body.ok) {
      setBanner({ message: `저장하지 못했다 — ${body.rejection.reason === "invalid" ? body.rejection.issues[0]?.message : body.rejection.reason}` });
      return;
    }
    // 쓴 것이 없는 본문(처음 빈 항 하나)은 빈 본문으로 — 빈 항을 저장하지 않는다
    const payload = { label: label.trim(), body: blankBody(body.value) ? [] : body.value, options: optionsRef.current };
    startTransition(async () => {
      const out = code === undefined ? await createClauseAction({ ...payload, mode: clauseMode }) : await saveClauseEditAction(code, payload);
      if (!out.ok) {
        setBanner({ message: `저장하지 못했다 — ${out.message}`, ...(out.issues && out.issues.length > 1 ? { issues: out.issues } : {}) });
        const first = out.issues?.[0]?.at.nodePath?.at(-1);
        if (first) setFlashId(first);
        return;
      }
      if (isNew) {
        // 만들어진 공용조항의 상세(읽기)로 — 편집 중 표시를 먼저 내려 「버립니까?」가 뜨지 않게 한다
        setEditing(false);
        router.push(`/clauses/${out.code}`);
        return;
      }
      endEdit();
      router.refresh();
    });
  };

  const remove = (confirm = false) => {
    if (!code) return;
    startTransition(async () => {
      const out = await removeClauseEditAction(code, confirm);
      if (out.ok === true) {
        router.push("/clauses");
        return;
      }
      if (out.ok === "confirm") {
        setRemoval(out.impact);
        return;
      }
      setRemoval(undefined);
      setBanner({ message: out.message });
    });
  };

  /** 고친 것이 있으면 「고친 내용을 버립니까?」 뒤에 (디자인원칙 §1.7). */
  const leave = (go: () => void) => (dirty ? setDiscard({ go }) : go());

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 화면을 떠나는 링크(내비 등)는 고친 것이 있으면 확인을 거친다 — 문면 저작 화면과 같다
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: globalThis.MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      const href = url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
      setDiscard({ go: () => (url.origin === window.location.origin ? router.push(href) : window.location.assign(href)) });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, router]);

  // ── 유형 고르기 (생성 화면만) — 본문이 비어 있을 때만. 바꾸면 그 유형의 빈 본문에서 다시 시작한다 ──
  const draftBody = editing ? treeToClauseBody(clauseMode, tree) : undefined;
  const modeLocked = draftBody !== undefined && !(draftBody.ok && blankBody(draftBody.value));
  const changeMode = (next: ClauseMode) => {
    if (next === clauseMode || modeLocked) return;
    setClauseMode(next);
    setPlace(undefined);
    setBanner(undefined);
    setDraft({ state: { tree: clauseBodyToTree(next, startBody(next), label), generalDocumentId: GENERALS }, ops: 0 });
  };

  const toolbarPlace = placeIn(index);
  const toolbarEnv = envOf(tree, options);
  const toolbarSections = editing ? withClauseRefusals(toolbarEnv, clausePlaceMenu(toolbarEnv, toolbarPlace)) : [];
  const placeWords = (p: Place): string => {
    if (p.kind === "chip") return "칩";
    if (p.kind === "head") return "조건 가지";
    if (p.kind === "document") return "본문";
    const id = p.kind === "inline" ? ("tableId" in p.at ? undefined : p.at.parentId) : p.id;
    if (!id || id === CLAUSE_LINE_ID) return "문구";
    const node = index.nodes.get(id)?.node;
    if (!node) return "조건 가지 문장";
    const word = node.kind === "paragraph" ? "항" : node.kind === "item" ? "호" : node.kind === "subitem" ? "목" : node.kind === "condBlock" ? "조건 블록" : "블록";
    return `${numbers.get(id)?.label ?? ""} ${word}${p.kind === "inline" ? " 문장" : ""}`.trim();
  };

  const clauseName = isNew ? label.trim() || newLabel(ENTITY_LABEL.clause) : props.label;
  const blockNodes = tree.children[0]?.kind === "article" ? tree.children[0].children : [];
  const line = clauseMode === "inline" ? blockNodes[0] : undefined;
  const lineNodes = line?.kind === "paragraph" ? line.children : [];
  const readEmpty = !editing && (clauseMode === "inline" ? lineNodes.length === 0 : blockNodes.length === 0);
  const modeHint = MODE_OPTIONS.find((o) => o.value === clauseMode)?.hint;

  return (
    <div className="ts-l3 is-clause" aria-busy={pending || undefined}>
      <div className="ts-l3-bar">
        <Breadcrumb items={[{ label: ENTITY_LABEL.clause, href: "/clauses" }, { label: clauseName }]} guard={editing ? leave : undefined} />
        {editing && <span className="ts-l3-dirty">{isNew ? "새 공용조항 — 저장하면 만들어진다" : dirty ? "편집 중 · 저장해야 반영" : "편집 중"}</span>}
        <span className="ts-l3-bar-actions">
          {editing ? (
            <>
              {isNew ? (
                <IconButton icon={<IconClose />} label="만들기 취소 — 공용조항 목록으로" disabled={pending} onClick={() => leave(() => router.push("/clauses"))} />
              ) : (
                <IconButton icon={<IconClose />} label="편집 취소 — 고친 내용을 버리고 읽기 모드로" disabled={pending} onClick={() => leave(endEdit)} />
              )}
              <button type="button" className="primary" disabled={pending || (!isNew && !dirty)} onClick={save}>
                {pending ? "저장 중…" : "저장"}
              </button>
            </>
          ) : (
            <button type="button" onClick={startEdit} disabled={pending}>
              편집
            </button>
          )}
          {!isNew && (
            <IconButton
              icon={<IconTrash />}
              danger
              label={editing ? "저장하거나 취소한 뒤 실행" : `공용조항 ${props.label}(${code}) 삭제`}
              disabled={editing || pending}
              onClick={() => remove(false)}
            />
          )}
        </span>
      </div>

      <div className="ts-l3-body ts-clause-page" ref={bodyRef}>
        {banner && (
          <div className="ts-error-banner" role="alert">
            <p>{banner.message}</p>
            {banner.issues && banner.issues.length > 0 && <DraftIssues go={setFlashId} issues={banner.issues} />}
          </div>
        )}
        <datalist id="slot-candidates">
          {data.slotCandidates.map((candidate) => (
            <option key={candidate.path} value={candidate.path}>
              {candidate.label}
            </option>
          ))}
        </datalist>
        <div className="ts-clause-grid">
          <div className="ts-clause-main">
            <section className="ts-clause-meta" aria-label="공용조항 정보">
              <div className="ts-form-row">
                <label htmlFor="clause-label">{NAME_LABEL.clause}</label>
                {editing ? (
                  <input id="clause-label" className="ts-field-direct" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 특별약관의 소멸" autoFocus={isNew} />
                ) : (
                  <span className="ts-clause-meta-value">{props.label}</span>
                )}
              </div>
              <div className="ts-form-row">
                <span className="ts-form-label" id="clause-mode-label">
                  유형
                </span>
                {isNew ? (
                  <div className="ts-clause-mode" role="radiogroup" aria-labelledby="clause-mode-label">
                    {MODE_OPTIONS.map((o) => (
                      <label key={o.value} className={`ts-clause-mode-option${clauseMode === o.value ? " is-on" : ""}`}>
                        <input type="radio" name="clause-mode" value={o.value} checked={clauseMode === o.value} disabled={modeLocked && clauseMode !== o.value} onChange={() => changeMode(o.value)} />
                        <span className="ts-clause-mode-name">{o.label}</span>
                        <span className="ts-clause-mode-hint">{o.hint}</span>
                      </label>
                    ))}
                    {modeLocked ? <p className="ts-muted ts-clause-sec-note">본문을 쓰기 시작해서 유형이 잠겼다 — 바꾸려면 본문을 비운다.</p> : null}
                  </div>
                ) : (
                  <span className="ts-clause-meta-value" title="유형은 생성 때 정하고 그 뒤 바꾸지 않는다">
                    {MODE_LABEL[clauseMode]} <span className="ts-muted">— {modeHint}</span>
                  </span>
                )}
              </div>
              {!isNew && (
                <>
                  <div className="ts-form-row">
                    <span className="ts-form-label">코드</span>
                    <span className="ts-clause-meta-value ts-mono">{code}</span>
                  </div>
                  <div className="ts-form-row">
                    <span className="ts-form-label">요구 구분자</span>
                    <span className="ts-clause-meta-value ts-mono">
                      {props.required && props.required.discriminators.length > 0 ? props.required.discriminators.join(" · ") : <span className="ts-muted">없음 — 저장 때 식에서 뽑는다</span>}
                    </span>
                  </div>
                  <div className="ts-form-row">
                    <span className="ts-form-label">사용처</span>
                    <span className="ts-clause-meta-value">
                      <a href={`/relations?kind=clause&code=${code}`}>관계정보에서 보기</a>
                    </span>
                  </div>
                </>
              )}
            </section>

            <section className="ts-clause-body-sec" aria-label="본문">
              <h2 className="ts-clause-sec">본문</h2>
              <p className="ts-muted ts-clause-sec-note">
                {clauseMode === "inline"
                  ? "사용처 문장 중간에 들어갈 문구 한 줄을 쓴다. 조건 · 슬롯 · 옵션 자리는 커서를 두고 툴바에서 넣는다."
                  : "사용처 조 안에 들어갈 항을 쓴다. Enter 로 다음 항, 호 · 목 · 조건은 툴바에서 넣는다."}
              </p>
              <div
                className={`ts-clause-editor${editing ? " is-editing" : ""}`}
                onContextMenu={onContextMenu}
                onPointerDown={(e) => {
                  if (!editing) return;
                  const target = e.target as HTMLElement;
                  if (target.closest(".ts-doc-toolbar")) return;
                  setPlace(placeOf(target));
                }}
                onFocus={(e) => {
                  if (!editing) return;
                  const at = placeOf(e.target as HTMLElement);
                  if (at) setPlace(at);
                }}
              >
                {editing && <EditorToolbar groups={clauseMode === "inline" ? CLAUSE_LINE_TOOLS : CLAUSE_TOOLS} sections={toolbarSections} editing onRun={runTool} where={placeWords(toolbarPlace)} />}
                <article className="ts-doc">
                  {readEmpty ? (
                    <EmptyBody mode={clauseMode} />
                  ) : clauseMode === "inline" ? (
                    <div className="ts-doc-paragraph is-line">
                      <InlineSlot at={{ parentId: CLAUSE_LINE_ID }} nodes={lineNodes} ctx={ctx} placeholder="여기에 문구를 쓴다 — 예: 보험금을 지급하지 않습니다" />
                    </div>
                  ) : blockNodes.length === 0 ? (
                    <div className="ts-empty">
                      <p className="ts-empty-what">항이 없다.</p>
                      <p className="ts-empty-action">툴바의 「항」으로 첫 항을 넣는다.</p>
                    </div>
                  ) : (
                    <Block nodes={blockNodes} ctx={ctx} />
                  )}
                </article>
              </div>
            </section>
          </div>

          <OptionsPane options={shownOptions} editing={editing} used={used} onChange={setOptions} newCode={newCode} />
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} sections={menu.sections} onPick={(item) => runMenu(item)} onClose={() => setMenu(undefined)} />}
      {pop && editing && (optionChip(pop.spec, index) ? <OptionSlotPopup env={popupEnv} nodeId={optionChip(pop.spec, index)!} options={options} anchor={pop.anchor} onClose={() => setPop(undefined)} /> : <PopupHost env={popupEnv} spec={pop.spec} anchor={pop.anchor} onClose={() => setPop(undefined)} />)}

      {discard ? (
        <DiscardDialog
          onStay={() => setDiscard(undefined)}
          onDiscard={() => {
            const { go } = discard;
            setDiscard(undefined);
            endEdit();
            go();
          }}
        />
      ) : null}
      {removal ? (
        <dialog open className="ts-dialog">
          <p className="ts-confirm-title">
            {props.label} 삭제 — 사용처 {removal.brokenRefs.length}건의 참조가 깨진다
          </p>
          {removal.brokenRefs.length > 0 && (
            <ul className="ts-confirm-loss">
              {removal.brokenRefs.map((c, i) => (
                <li key={i}>{formatCoordinate(c, { source: true })}</li>
              ))}
            </ul>
          )}
          {removal.cascade.length > 0 && <p className="ts-muted">함께 사라지는 것: {removal.cascade.join(" · ")}</p>}
          <div className="ts-confirm-actions">
            <button type="button" onClick={() => setRemoval(undefined)} disabled={pending}>
              취소
            </button>
            <button type="button" className="danger" onClick={() => remove(true)} disabled={pending}>
              {props.label} 삭제
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}

/** 칩 고치기 팝업이 옵션 자리 운반체를 가리키면 그 노드 id. */
function optionChip(spec: PopupSpec, index: ReturnType<typeof indexTree>): Id | undefined {
  if (spec.kind !== "editChip") return undefined;
  const node = index.nodes.get(spec.nodeId)?.node;
  return node && node.kind === "clauseInlineRef" && optionCodeOf(node) !== undefined ? node.id : undefined;
}

/** 옵션 자리 고치기 — 어느 옵션의 자리인가를 바꾼다. */
function OptionSlotPopup({ env, nodeId, options, anchor, onClose }: { env: PopupEnv; nodeId: Id; options: readonly ClauseEditOption[]; anchor: Anchor; onClose: () => void }) {
  const tree = env.latest();
  const node = indexTree(tree).nodes.get(nodeId)?.node;
  const current = node && node.kind === "clauseInlineRef" ? optionCodeOf(node) : undefined;
  return (
    <Popover anchor={anchor} label="옵션 자리" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const picked = String(new FormData(e.currentTarget).get("option") ?? "");
          const t = env.latest();
          const loc = inlineAtOf(t, indexTree(t), nodeId);
          if (!picked || !loc) return onClose();
          if (env.apply([{ type: "setInlines", at: loc.at, runs: runsReplacing(loc.list, nodeId, [optionCarrier(nodeId, picked)]) }])) onClose();
        }}
      >
        <div className="ts-form-row">
          <label htmlFor="pop-option">옵션</label>
          <select id="pop-option" name="option" defaultValue={current}>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label || "이름 없는 옵션"}
              </option>
            ))}
          </select>
        </div>
        <p className="ts-muted">사용처가 고른 선택지의 문구가 이 자리에 들어간다. 선택지는 옵션 목록에서 고친다.</p>
        <PopActions onCancel={onClose} />
      </form>
    </Popover>
  );
}

function EmptyBody({ mode, editing }: { mode: ClauseMode; editing?: boolean }) {
  return (
    <div className="ts-empty">
      <p className="ts-empty-what">본문이 비어 있다 — 참조해도 아무 조문도 나오지 않는다.</p>
      <p className="ts-empty-example">예: {mode === "block" ? "① 이 특별약관은 보험계약자의 청약과 보험회사의 승낙으로 이루어집니다." : "보험금을 지급하지 않습니다"}</p>
      <p className="ts-empty-action">{editing ? "툴바의 「항」으로 시작한다. 다 쓰면 「저장」." : "「편집」을 눌러 본문을 쓴다."}</p>
    </div>
  );
}
