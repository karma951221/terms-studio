"use client";

/**
 * 조문 저작 화면 (L3) — 목차(관 › 조) · 가운데 조 하나의 편집기 · 보조 정보 우측 패널 (기능/문면 §4.3).
 *
 * ADR-0074 「편집 → 저장 한 번」:
 * - 읽기 모드에서 시작한다. `편집` 을 누르면 원본 트리와 그 **판**을 받아 브라우저에 **편집본**을 만들고, 같은 자리 버튼이 `저장` 이 된다.
 * - 편집 중의 모든 조작은 순수 도메인 `applyEdit` 로 편집본에 곧바로 적용되고(명령 단위 검사도 그 자리에서) 명령 목록으로 쌓인다.
 * - `저장` = 명령 목록 + 시작 판을 서버로. 서버가 판 확인 · 재적용 · 전체 검증 뒤 한 번에 반영한다.
 *   검증 오류면 편집을 계속하고 오류를 그 자리로 안내, 판이 다르면 「다른 사람이 먼저 저장했습니다」(편집본 유지). 잠금은 없다.
 * - 경로 링크 · ✕ · 화면을 떠나는 링크는 고친 것이 있으면 「고친 내용을 버립니까?」, 새로고침 · 창 닫기는 브라우저 경고.
 *
 * 가운데 = 그 자리 편집 (2026-09-27):
 * - 가운데에는 **조 하나**만 보인다 — 목차에서 고른 조, 처음은 제1조. 약관 전체 이어 읽기는 더보기 › 미리보기.
 * - 조 제목 · 관 제목 · 문장은 그 자리에서 고치고, 초점이 떠나면 편집본에 들어간다(「적용」 단계 없음).
 * - 칩은 누르면 바로 아래에 팝업. 넣기 · 이동 · 복제 · 삭제 · 조건식은 본문 위 **툴바**가 입구다 — 가운데서 마지막으로
 *   누르거나 초점이 간 자리(`place`)로 버튼이 켜지고 꺼진다. 오른쪽 클릭 메뉴는 같은 목록의 지름길(조건 넣기는 툴바에만).
 * - 「조건식」은 팝업 없이 조건 블록(빈 IF 줄)을 세우고, 식은 그 머리 줄에서 그 자리로 고친다 (2026-09-28).
 * - 화면은 100vh 에 고정되고 목차 · 가운데 · 우측 패널이 각자 스크롤한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { DiscardDialog } from "@/app/_components/EditShell";
import { IconButton, IconClose, IconPanel } from "@/app/_components/icons";
import { MoreMenu, type MoreMenuItem } from "@/app/_components/MoreMenu";
import { DOC_TEMPLATE_LABEL } from "@/app/_lib/labels";
import { describeRejection } from "@/app/_lib/rejection";
import type { Discriminator } from "@/domain/catalog";
import type { Clause } from "@/domain/clause";
import { formatCoordinate } from "@/domain/coordinate";
import { coverageRowSource, masterCatalog, masterEvalContext, type Coverage, type MasterValues } from "@/domain/coverage";
import {
  applyEdit,
  blockingIssues,
  catalogTypeResolver,
  clauseGateFrom,
  envAt,
  generalRefsOf,
  indexTree,
  numberTree,
  preEvaluate,
  randomIds,
  referenceTargetIndex,
  repeatLevels,
  repeatScopeOf,
  rowReadableLevels,
  validateDocument,
  type Appendix,
  type BranchState,
  type DraftState,
  type EditEnv,
  type EditOp,
  type ReferenceTarget,
} from "@/domain/document";
import type { Box } from "@/domain/document/box";
import type { Code, Coordinate, Id, Impact, Issue } from "@/domain/types";

import { loadGeneralForEditAction, saveDocumentEditAction, startDocumentEditAction, type GeneralForEdit } from "../../edit-actions";
import { docListHref } from "../../lib";
import { refLabelOf } from "./condition/display";
import type { ConditionContext } from "./condition/types";
import { anchorOf, type Anchor, type CellAt, type DocCtx, type DocMode, type EditHandlers } from "./ctx";
import { ArticleBody, DocBody } from "./DocBody";
import { backspaceOps, enterOps, inlineListAt, moveSelectionOps, pasteGridOps } from "./editOps";
import { caretFromPoint, tokensOf } from "./Inline";
import { identityRuns, runsFromTokens, sameRuns, type Token } from "./inlineRuns";
import { boxPickItems, clausePickItems, condInsertItem, condMenu, inlineCondItem, placeExists, placeMenu, type MenuEnv, type MenuItem, type MenuSections, type Place, type PopupSpec } from "./menus";
import { condInput, placeOf, readInline } from "./place";
import { EditorToolbar } from "./EditorToolbar";
import { DOCUMENT_TOOLS, allTools, itemsFor, type ToolId } from "./tools";
import { useBlockDrag } from "./useBlockDrag";
import { PopupHost, type PopupEnv } from "./Popups";
import { ContextMenu, Popover } from "./Popover";
import { RemoveCard } from "./RemoveCard";
import { DraftIssues, SidePanel, type PanelData } from "./SidePanel";
import { Toc, articlesOf } from "./Toc";

export interface EditorDoc {
  id: Id;
  kind: "special" | "general";
  ownerId?: Id;
  title: string;
  tree: DraftState["tree"];
  version: number;
  generalDocumentId?: Id;
}

export interface EditorProps {
  doc: EditorDoc;
  /** 지금 대응 보통약관 (담보약관이 지정했을 때). */
  general?: GeneralForEdit;
  generals: readonly { id: Id; title: string }[];
  suggestedGeneralId?: Id;
  appendices: readonly Appendix[];
  /** 정적 마스터 박스 — 박스 참조 검사 · 그리기 · 「박스」 고르기 (기능/박스 §4.4). */
  boxes: readonly Box[];
  clauses: readonly Clause[];
  discriminators: readonly Discriminator[];
  /** 담보속성 코드 → 유효값 코드 (식 타입 검사). */
  attributeValues: Readonly<Record<Code, readonly Code[]>>;
  /** 담보약관의 문맥 담보 — `@노드` 식 검사 재료. */
  coverage?: Coverage;
  /** 담보 마스터 값 — 사전평가 문맥 (서버에서 한 번 받는다). */
  master?: { tree: Coverage; values: MasterValues };
  evalNote?: string;
  /** 조건 팝업 문맥(반복 표 「현재 행」 없이) — 담보 트리 · 구분자 · 열린 폼 · 빠른 조건. */
  condition: ConditionContext;
  /** 좌표 링크(`?node=`)로 들어왔을 때 열 자리 — 그 조를 열고 그 자리를 강조한다. */
  initialNode?: Id;
  /** `?view=eval` — 미리보기를 켠 채로. */
  initialEval?: boolean;
  /** 서버가 그린 알림 — 문서 삭제 · 복제 확인 카드, 서버 액션 거부 배너. */
  notice?: ReactNode;
  /** 읽기 모드 더보기 — 복제 · 템플릿 삭제. */
  moreItems: MoreMenuItem[];
}

interface Draft {
  baseVersion: number;
  state: DraftState;
  ops: EditOp[];
}

type Banner = { message: string; issues?: readonly Issue[] };

const NODE_WHAT: Record<string, string> = {
  section: "관",
  article: "조",
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

/** 노드가 든 조 — 조면 자기, 관이면 그 첫 조. */
function articleOfNode(tree: DraftState["tree"], nodeId: Id): Id | undefined {
  const ix = indexTree(tree);
  const e = ix.nodes.get(nodeId);
  if (e?.node.kind === "section") return articlesOf(e.node)[0]?.id;
  return e?.articleId ?? ix.branches.get(nodeId)?.articleId;
}

/** 조 전체 보기(더보기 › 미리보기) — 약관 한 벌을 이어 읽는다. */
function FullPreview({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} className="ts-dialog ts-dialog-full" aria-label="미리보기 — 약관 전체" onClose={onClose}>
      <div className="ts-dialog-full-head">
        <p className="ts-pop-title">미리보기 — 약관 전체</p>
        <IconButton icon={<IconClose />} label="미리보기 닫기" onClick={onClose} />
      </div>
      <div className="ts-dialog-full-body">{children}</div>
    </dialog>
  );
}

export function DocumentEditor(props: EditorProps) {
  const { doc } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<DocMode>("read");
  /** 좁은 폭에서만 뜻이 있다 — 우측 패널을 본문 위에 연다. 넓은 폭에서는 패널이 늘 서 있고 이 버튼도 숨는다. */
  const [sideOpen, setSideOpen] = useState(false);
  const [draft, setDraftState] = useState<Draft>();
  const draftRef = useRef<Draft | undefined>(undefined);
  const setDraft = (next: Draft | undefined) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [generalCache, setGeneralCache] = useState<Record<Id, GeneralForEdit>>(() => (props.general ? { [props.general.id]: props.general } : {}));
  const generalRef = useRef(generalCache);
  const [art, setArt] = useState<Id | undefined>(() => (props.initialNode ? articleOfNode(doc.tree, props.initialNode) : undefined));
  const [flashId, setFlashId] = useState<Id | undefined>(props.initialNode);
  const [menu, setMenu] = useState<{ x: number; y: number; sections: MenuSections }>();
  /** 툴바 · 오른쪽 클릭이 짓는 자리 — 가운데서 마지막으로 누르거나 초점이 간 곳. 없거나 지워졌으면 지금 조. */
  const [place, setPlace] = useState<Place>();
  const [pop, setPop] = useState<{ spec: PopupSpec; anchor: Anchor }>();
  const [removing, setRemoving] = useState<{ nodeId: Id; anchor: Anchor }>();
  const [activeCell, setActiveCell] = useState<CellAt>();
  const [focusRequest, setFocusRequest] = useState<Id>();
  const [fullView, setFullView] = useState(false);
  const [banner, setBanner] = useState<Banner>();
  const [conflict, setConflict] = useState<string>();
  const [confirmSave, setConfirmSave] = useState<Impact>();
  const [discard, setDiscard] = useState<{ go: () => void }>();
  const [evalOn, setEvalOn] = useState(Boolean(props.initialEval));
  const bodyRef = useRef<HTMLDivElement>(null);
  const menuAt = useRef<Anchor>({ x: 0, y: 0 });

  const dirty = mode === "edit" && (draft?.ops.length ?? 0) > 0;
  const original: DraftState = useMemo(() => ({ tree: doc.tree, ...(doc.generalDocumentId ? { generalDocumentId: doc.generalDocumentId } : {}) }), [doc.tree, doc.generalDocumentId]);
  const current = mode === "edit" && draft ? draft.state : original;
  const tree = current.tree;
  /** 누르는 순간의 편집본 트리 — 메뉴를 연 뒤 문장 칸이 초점을 잃으며 글이 먼저 적용될 수 있다. */
  const latest = useCallback(() => draftRef.current?.state.tree ?? doc.tree, [doc.tree]);

  // ── 검증 재료 — 서버 저장 검증과 같은 한 벌(validateDocument)을 서버가 넘긴 정의로 짓는다 ──
  const coordinate: Coordinate = useMemo(() => ({ document: doc.kind, ownerId: doc.ownerId ?? doc.id, documentId: doc.id, ownerName: doc.title }), [doc.kind, doc.ownerId, doc.id, doc.title]);
  const gate = useMemo(() => clauseGateFrom(props.clauses, props.discriminators.map((d) => d.code), catalogTypeResolver(props.discriminators)), [props.clauses, props.discriminators]);
  const appendixCodes = useMemo(() => new Set(props.appendices.map((a) => a.code)), [props.appendices]);
  const boxByCode = useMemo(() => new Map(props.boxes.map((x) => [x.code, x] as const)), [props.boxes]);
  /** 보통약관 캐시 → 편집 환경. 렌더는 상태의 캐시로, 명령 적용은 방금 받은 것까지 든 ref 의 캐시로 만든다. */
  const makeEditEnv = useCallback(
    (cache: Readonly<Record<Id, GeneralForEdit>>): EditEnv => ({
      env: { kind: doc.kind, appendixExists: (c: Code) => appendixCodes.has(c), boxExists: (c: Code) => boxByCode.has(c), clauseGate: gate, coordinate },
      generalRefs: (id: Id) => {
        const g = cache[id];
        return g ? generalRefsOf(g.tree) : undefined;
      },
    }),
    [doc.kind, appendixCodes, boxByCode, gate, coordinate],
  );
  // 읽기 모드는 서버가 방금 넘긴 대응 보통약관이 기준이다 (편집 중에는 편집 시작 때 받은 것 · 새로 고른 것)
  const renderCache = useMemo(() => (mode === "read" && props.general ? { ...generalCache, [props.general.id]: props.general } : generalCache), [mode, props.general, generalCache]);
  const editEnv = useMemo(() => makeEditEnv(renderCache), [makeEditEnv, renderCache]);
  const resolve = useMemo(() => catalogTypeResolver(props.discriminators, (code) => props.attributeValues[code]), [props.discriminators, props.attributeValues]);
  const scope = useMemo(
    () => ({ ...(props.coverage ? { coverage: props.coverage } : {}), levelOf: (code: Code) => props.discriminators.find((d) => d.code === code)?.level }),
    [props.coverage, props.discriminators],
  );
  const issues = useMemo(() => validateDocument(tree, { env: envAt(editEnv, current.generalDocumentId), resolve, scope }), [tree, editEnv, current.generalDocumentId, resolve, scope]);
  const errorCount = blockingIssues(issues).length;

  // ── 사전평가 — 담보약관만, 문맥은 서버가 한 번 넘긴 담보 마스터 값. 편집 중이면 편집본을 평가한다 ──
  const evalAvailable = doc.kind === "special" && props.master !== undefined;
  const evaluation = useMemo(() => {
    if (!evalOn || !props.master) return undefined;
    const mcat = masterCatalog(props.discriminators);
    const ctxEval = masterEvalContext(props.master.tree, props.master.values, mcat);
    return preEvaluate(tree, ctxEval, { coordinate: { ...coordinate, ...(ctxEval.coordinate ?? {}) }, rows: coverageRowSource(props.master.tree, props.master.values, mcat) });
  }, [evalOn, props.master, props.discriminators, tree, coordinate]);

  // ── 번호 · 참조 표기 ──
  const numbers = useMemo(() => {
    const states = evaluation ? new Map([...evaluation.branches].map(([k, v]) => [k, v.state] as [Id, BranchState])) : undefined;
    return numberTree(tree, states ? { branchStates: states } : {});
  }, [tree, evaluation]);
  const currentGeneral = current.generalDocumentId ? renderCache[current.generalDocumentId] : undefined;
  const generalTargets = useMemo(() => (currentGeneral ? referenceTargetIndex(currentGeneral.tree, numberTree(currentGeneral.tree)) : new Map<Id, ReferenceTarget>()), [currentGeneral]);
  const references = useMemo(() => ({ self: referenceTargetIndex(tree, numbers), general: generalTargets }), [tree, numbers, generalTargets]);

  const appendixName = useMemo(() => new Map(props.appendices.map((a) => [a.code, a.name] as const)), [props.appendices]);
  const clauseLabel = useMemo(() => new Map(props.clauses.map((c) => [c.code, c.label] as const)), [props.clauses]);
  const optionText = useCallback(
    (clauseCode: Code, options: Record<Code, Code>): string => {
      const clause = props.clauses.find((c) => c.code === clauseCode);
      const entries = Object.entries(options);
      if (!clause) return entries.length > 0 ? entries.map(([o, v]) => `${o}: ${v}`).join(" · ") : "옵션 선택 없음";
      const parts = clause.options.map((o) => {
        const chosen = options[o.code];
        const value = chosen !== undefined ? o.values.find((v) => v.code === chosen) : undefined;
        return `${o.label}: ${value?.label ?? (chosen !== undefined ? `${chosen}(없는 선택지)` : "미선택")}`;
      });
      return parts.length > 0 ? parts.join(" · ") : "옵션 없음";
    },
    [props.clauses],
  );
  const refLabel = useMemo(() => refLabelOf(props.condition), [props.condition]);

  const index = useMemo(() => indexTree(tree), [tree]);
  const articles = useMemo(() => articlesOf(tree), [tree]);

  // ── 가운데에 열 조 — 고른 조가 사라졌으면(삭제 · 편집 취소) 원래 자리에서 가장 가까운 조, 처음은 제1조 ──
  // 조 목록이 바뀐 렌더에서 상태를 맞춘다 (React 「prop 이 바뀌면 상태를 조정한다」 패턴 — 이펙트 안 setState 는 피한다)
  const articleIds = articles.map((a) => a.id);
  const [seenOrder, setSeenOrder] = useState<Id[]>(articleIds);
  if (seenOrder.join("|") !== articleIds.join("|")) {
    setSeenOrder(articleIds);
    if (art && !articleIds.includes(art)) {
      const at = seenOrder.indexOf(art);
      const after = at >= 0 ? seenOrder.slice(at + 1).find((id) => articleIds.includes(id)) : undefined;
      const before = at >= 0 ? seenOrder.slice(0, at).reverse().find((id) => articleIds.includes(id)) : undefined;
      setArt(after ?? before ?? articleIds[0]);
    }
  }
  const currentArticleId = art && articleIds.includes(art) ? art : articleIds[0];

  // 조를 옮기면 가운데 스크롤은 맨 위로 — 강조할 자리가 있으면 그 자리로
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const target = flashId ? body.querySelector(`[data-node="${CSS.escape(flashId)}"]`) : null;
    if (target) target.scrollIntoView({ block: "center" });
    else body.scrollTop = 0;
  }, [currentArticleId, flashId]);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(undefined), 2500);
    return () => clearTimeout(t);
  }, [flashId]);

  /** 그 자리로 — 그 조를 가운데에 열고 그 자리를 잠깐 강조한다 (검증 목록 「고칠 자리로」 · 참조처). */
  const go = useCallback(
    (nodeId: Id) => {
      const articleId = articleOfNode(latest(), nodeId);
      if (articleId) setArt(articleId);
      setFlashId(nodeId);
    },
    [latest],
  );

  // ── 조작 ──
  /** 편집본에 명령을 적용한다 — 하나라도 거부되면 아무것도 적용하지 않고 사유 배너. 적용한 명령(복제는 사본 id 가 실린)을 돌려준다. */
  const applyRecorded = (ops: readonly EditOp[]): EditOp[] | undefined => {
    const d = draftRef.current;
    if (!d) return undefined;
    let state = d.state;
    const recorded: EditOp[] = [];
    const env = makeEditEnv(generalRef.current);
    for (const op of ops) {
      const r = applyEdit(state, op, env);
      if (!r.ok) {
        const view = describeRejection(r.rejection);
        setBanner({ message: `적용하지 못했다 — ${view.message}`, ...(view.issues && view.issues.length > 1 ? { issues: view.issues } : {}) });
        return undefined;
      }
      state = r.value.state;
      recorded.push(r.value.op);
    }
    if (recorded.length > 0) setDraft({ ...d, state, ops: [...d.ops, ...recorded] });
    setBanner(undefined);
    return recorded;
  };
  const apply = (ops: readonly EditOp[]): boolean => applyRecorded(ops) !== undefined;
  const drag = useBlockDrag({ latest, apply, enabled: mode === "edit" });

  const setGeneral = (generalDocumentId: Id | undefined) => {
    if (generalDocumentId === undefined || generalRef.current[generalDocumentId]) {
      apply([{ type: "setGeneralDocument", ...(generalDocumentId ? { generalDocumentId } : {}) }]);
      return;
    }
    startTransition(async () => {
      const g = await loadGeneralForEditAction(generalDocumentId);
      if (!g) {
        setBanner({ message: "적용하지 못했다 — 그 보통약관 템플릿을 찾을 수 없다." });
        return;
      }
      generalRef.current = { ...generalRef.current, [g.id]: g };
      setGeneralCache(generalRef.current);
      apply([{ type: "setGeneralDocument", generalDocumentId }]);
    });
  };

  const startEdit = () => {
    startTransition(async () => {
      const fresh = await startDocumentEditAction(doc.id);
      if (!fresh) {
        setBanner({ message: "찾을 수 없습니다 — 문서가 지워졌을 수 있다." });
        return;
      }
      if (fresh.general) {
        generalRef.current = { ...generalRef.current, [fresh.general.id]: fresh.general };
        setGeneralCache(generalRef.current);
      }
      setDraft({ baseVersion: fresh.version, state: { tree: fresh.tree, ...(fresh.generalDocumentId ? { generalDocumentId: fresh.generalDocumentId } : {}) }, ops: [] });
      setMode("edit");
      // 편집에 들어가면 평가 결과는 지운다 (§4.3) — 주소의 `view=eval` 도
      setEvalOn(false);
      const url = new URL(window.location.href);
      if (url.searchParams.has("view")) {
        url.searchParams.delete("view");
        window.history.replaceState(null, "", url);
      }
      setBanner(undefined);
      setConflict(undefined);
      // 화면에 있던 원본이 낡았으면 읽기 화면도 새로 받는다 — 편집본은 방금 받은 판에서 시작한다
      if (fresh.version !== doc.version) router.refresh();
    });
  };

  const endEdit = () => {
    drag.clearSel();
    setMode("read");
    setDraft(undefined);
    setBanner(undefined);
    setConflict(undefined);
    setRemoving(undefined);
    setConfirmSave(undefined);
    setMenu(undefined);
    setPop(undefined);
    setActiveCell(undefined);
  };

  const save = (confirm = false) => {
    // 문장 칸에 초점이 남아 있으면 먼저 편집본에 넣는다 (초점이 떠날 때 적용된다)
    (document.activeElement as HTMLElement | null)?.blur?.();
    const d = draftRef.current;
    if (!d) return;
    startTransition(async () => {
      const out = await saveDocumentEditAction(doc.id, { baseVersion: d.baseVersion, ops: d.ops, confirm });
      if (out.ok === true) {
        endEdit();
        router.refresh();
        return;
      }
      setConfirmSave(undefined);
      if (out.ok === "conflict") {
        setConflict(out.message);
        return;
      }
      if (out.ok === "confirm") {
        setConfirmSave(out.impact);
        return;
      }
      setBanner({ message: `저장하지 못했다 — ${out.message}`, ...(out.issues ? { issues: out.issues } : {}) });
    });
  };

  /** 고친 것이 있으면 「고친 내용을 버립니까?」 뒤에, 없으면 바로 (디자인원칙 §1.7). */
  const leave = (go: () => void) => (dirty ? setDiscard({ go }) : go());

  // 새로고침 · 창 닫기 — 브라우저 경고. 편집본은 로컬에 백업하지 않는다.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // 화면을 떠나는 링크(경로 · 내비 · 「고치러 가기」)는 고친 것이 있으면 확인을 거친다.
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

  const toggleEval = () => {
    const next = !evalOn;
    setEvalOn(next);
    // 뷰 상태는 쿼리일 뿐 저장하지 않는다 (§3.9) — 읽기 모드만 주소에 남긴다
    if (mode === "read") {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("view", "eval");
      else url.searchParams.delete("view");
      window.history.replaceState(null, "", url);
    }
  };

  // ── 툴바 · 오른쪽 클릭 메뉴 — 자리(data-*)로 목록을 짓는다 (menus.ts `placeMenu`) ──
  const menuEnv = (): MenuEnv => {
    const t = latest();
    return { tree: t, ix: indexTree(t), docKind: doc.kind, newId: randomIds };
  };

  /** 지금 자리 — 고른 자리가 없거나 편집본에서 사라졌으면 가운데 조(없으면 문서). */
  const placeIn = (ix: MenuEnv["ix"]): Place => {
    if (place && placeExists(ix, place)) return place;
    return currentArticleId && ix.nodes.has(currentArticleId) ? { kind: "article", id: currentArticleId } : { kind: "document" };
  };

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (mode !== "edit") return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target as HTMLElement;
    const env = menuEnv();
    const at = placeOf(target) ?? { kind: "document" as const };
    let tokens: Token[] = [];
    if (at.kind === "inline") {
      const inline = target.closest("[data-inline]") as HTMLElement;
      const caret = caretFromPoint(event.clientX, event.clientY);
      tokens = tokensOf(inline, caret && inline.contains(caret.node) ? caret : undefined);
    }
    if (at.kind !== "document") setPlace(at);
    menuAt.current = { x: event.clientX, y: event.clientY + 4, top: event.clientY };
    setMenu({ x: event.clientX, y: event.clientY, sections: placeMenu(env, at, tokens) });
  };

  /** 툴바 버튼 — 누르는 순간의 편집본 · 문장 칸 조각(커서 · 고른 글)으로 목록을 다시 짓고 그 버튼의 항목을 돌린다. */
  const runTool = (toolId: ToolId, button: HTMLElement) => {
    const env = menuEnv();
    let at = placeIn(env.ix);
    let tokens: Token[] = [];
    let cut: string | undefined;
    if (at.kind === "inline") {
      const read = bodyRef.current ? readInline(bodyRef.current, at) : undefined;
      if (read) ({ tokens, cut } = read);
      // 문장 칸이 화면에 없으면 그 주인 블록 자리로 — 조각 없이 문장에 넣으면 문장이 지워진다
      else at = "tableId" in at.at ? { kind: "block", id: at.at.tableId } : env.ix.nodes.has(at.at.parentId) ? { kind: "block", id: at.at.parentId } : { kind: "head", id: at.at.parentId };
    }
    const sections = placeMenu(env, at, tokens);
    const anchor = anchorOf(button);
    menuAt.current = anchor;
    if (toolId === "cond" || toolId === "inlineCond") {
      const inline = at.kind === "inline" ? { at: at.at, tokens, ...(cut !== undefined ? { cut } : {}) } : undefined;
      const item =
        toolId === "inlineCond"
          ? inline && inlineCondItem(inline.at, inline.tokens, randomIds, inline.cut)
          : condInsertItem(env, sections, condInput(bodyRef.current, at, inline), (id) => env.ix.nodes.get(id)?.allowed.includes("condBlock") ?? false);
      if (!item) return;
      // 넣기 전에 쓰던 문장을 편집본에 넣는다(초점이 떠나며 적용) — 감싸는 블록이 쓰던 글을 두고 가지 않게
      if (item.label !== "문장 안 조건") (document.activeElement as HTMLElement | null)?.blur?.();
      runMenu(item, anchor);
      return;
    }
    // 여러 블록을 골랐으면 위로 · 아래로는 고른 것 전부를 한 칸
    if ((toolId === "up" || toolId === "down") && drag.blockSel.length > 1) {
      const ops = moveSelectionOps(latest(), drag.blockSel, toolId === "up" ? -1 : 1);
      if (ops.length > 0) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        apply(ops);
      }
      return;
    }
    const tool = allTools(DOCUMENT_TOOLS).find((t) => t.id === toolId);
    const items = tool ? itemsFor(tool, sections).filter((i) => !i.disabled && !i.refusal) : [];
    if (items.length === 0) return;
    if (tool?.multi && items.length > 1) {
      setMenu({ x: anchor.x, y: anchor.y, sections: [items] });
      return;
    }
    // 「함수조항」 — 버튼 아래 작은 메뉴에서 함수조항을 고른다(모달 없음). 자리마다(아래에 · 호 목록 · 목 목록) 그 유형의 함수조항을 한 묶음씩,
    // 「아래에」(같은 자리) 묶음이 먼저. 맞는 함수조항이 하나도 없으면 그 사유를 보이는 팝업
    const first = items[0].action;
    if (toolId === "clauseBlock") {
      const ordered = [...items.filter((i) => i.label.startsWith("아래에")), ...items.filter((i) => !i.label.startsWith("아래에"))];
      const groups = ordered.flatMap((i) => (i.action.do === "popup" && i.action.popup.kind === "clauseBlock" ? [clausePickItems(props.clauses, i.action.popup.at, randomIds, i.action.popup.fit)] : [])).filter((g) => g.length > 0);
      if (groups.length > 0) {
        setMenu({ x: anchor.x, y: anchor.y, sections: groups });
        return;
      }
    }
    // 「박스」 — 버튼 아래 작은 메뉴에서 정적 마스터 박스를 고른다. 박스가 없으면 그 사유를 보이는 팝업 (기능/박스 §4.4)
    if (toolId === "box" && first.do === "popup" && first.popup.kind === "boxPick" && props.boxes.length > 0) {
      setMenu({ x: anchor.x, y: anchor.y, sections: [boxPickItems(props.boxes, first.popup.at, randomIds)] });
      return;
    }
    // 바로 적용하는 조작은 쓰던 문장을 먼저 편집본에 넣는다(초점이 떠나며 적용) — 복제 · 이동이 쓰던 글을 두고 가지 않게
    if (items[0].action.do !== "popup") (document.activeElement as HTMLElement | null)?.blur?.();
    runMenu(items[0], anchor);
  };

  /** 툴바 끝의 「자리 — …」 글자. */
  const placeWords = (p: Place): string => {
    const num = (id: Id) => numbers.get(id)?.label;
    switch (p.kind) {
      case "document":
        return "문서";
      case "chip":
        return "칩";
      case "head":
        return "조건 가지";
      case "article":
      case "articleTitle":
        return num(p.id) ?? "조";
      case "sectionTitle":
        return num(p.id) ?? "관";
      case "block": {
        const kind = index.nodes.get(p.id)?.node.kind;
        return `${["paragraph", "item", "subitem"].includes(kind ?? "") ? `${num(p.id) ?? ""} ` : ""}${NODE_WHAT[kind ?? ""] ?? "블록"}`.trim();
      }
      case "inline": {
        if ("tableId" in p.at) return `표 ${p.at.row + 1}행 ${p.at.col + 1}열`;
        const kind = index.nodes.get(p.at.parentId)?.node.kind;
        return kind ? `${num(p.at.parentId) ?? ""} ${NODE_WHAT[kind] ?? ""} 문장`.trim() : "조건 가지 문장";
      }
    }
  };

  const runMenu = (item: MenuItem, anchor: Anchor = menuAt.current) => {
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
    if (ops.length === 0) return;
    const recorded = applyRecorded(ops);
    if (!recorded) return;
    if (a.focus) setFocusRequest(a.focus);
    if (a.openChip) setPop({ spec: { kind: "editChip", nodeId: a.openChip }, anchor });
    if (a.goArticle) {
      setArt(a.goArticle);
      setPlace({ kind: "article", id: a.goArticle });
    }
    if (a.goDuplicate) {
      const dup = recorded.find((op) => op.type === "duplicate");
      const copyId = dup && dup.type === "duplicate" ? dup.ids?.[0] : undefined;
      const target = copyId ? articleOfNode(latest(), copyId) : undefined;
      if (target) setArt(target);
    }
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
  };

  // 조건 머리 줄 · 팝업의 조건 · 슬롯 문맥 — 반복 표 템플릿 셀 안이면 「현재 행」 가지 (ADR-0070 · 설계 §3.1). 담보약관만.
  const withRow = (levels: ReturnType<typeof repeatLevels> | undefined): ConditionContext =>
    props.condition.coverage && levels && levels.length > 0 ? { ...props.condition, row: { levels, readable: rowReadableLevels(levels) } } : props.condition;
  const scopeOf = (id: Id) => {
    const owner = index.branches.get(id)?.ownerId ?? id;
    return repeatScopeOf(tree, owner)?.levels;
  };

  const ctx: DocCtx = {
    documentId: doc.id,
    docKind: doc.kind,
    mode,
    numbers,
    ...(evaluation ? { branchEval: evaluation.branches, slotEval: evaluation.slots } : {}),
    appendixName,
    clauseLabel,
    optionText,
    references,
    refLabel,
    clauses: props.clauses,
    boxOf: (code) => boxByCode.get(code),
    conditionFor: (nodeId) => withRow(scopeOf(nodeId)),
    ...(flashId ? { flashId } : {}),
    ...(mode === "edit" ? { edit } : {}),
  };

  const conditionFor = (spec: PopupSpec): ConditionContext => {
    switch (spec.kind) {
      case "insertInline": {
        if ("tableId" in spec.at) {
          const t = index.nodes.get(spec.at.tableId)?.node;
          return withRow(t?.kind === "table" && t.repeat && !t.rows[spec.at.row]?.header ? repeatLevels(t) : undefined);
        }
        return withRow(scopeOf(spec.at.parentId));
      }
      case "editChip":
        return withRow(scopeOf(spec.nodeId));
      default:
        return props.condition;
    }
  };

  const popupEnv: PopupEnv = {
    ctx,
    tree,
    latest,
    apply,
    newId: randomIds,
    appendices: props.appendices,
    boxes: props.boxes,
    clauses: props.clauses,
    generals: props.generals,
    ...(current.generalDocumentId ? { generalDocumentId: current.generalDocumentId } : {}),
    ...(props.suggestedGeneralId ? { suggestedGeneralId: props.suggestedGeneralId } : {}),
    setGeneral,
    condition: pop ? conditionFor(pop.spec) : props.condition,
  };

  const generalTitle = current.generalDocumentId
    ? (props.generals.find((g) => g.id === current.generalDocumentId)?.title ?? renderCache[current.generalDocumentId]?.title)
    : props.suggestedGeneralId
      ? props.generals.find((g) => g.id === props.suggestedGeneralId)?.title
      : undefined;

  const panel: PanelData = {
    index,
    issues,
    documentTitle: tree.title,
    ...(generalTitle ? { generalTitle } : {}),
    generalProposed: current.generalDocumentId === undefined && props.suggestedGeneralId !== undefined,
    ...(evaluation ? { branchEval: evaluation.branches } : {}),
    evalRan: evaluation !== undefined,
    evalAvailable,
    ...(props.evalNote ? { evalNote: props.evalNote } : {}),
    ...(evaluation && mode === "read" ? { rendered: <DocBody tree={tree} ctx={{ ...ctx, tables: evaluation.tables, clauseView: "text" }} /> } : {}),
    toggleEval,
    go,
  };

  const toolbarPlace = placeIn(index);
  const toolbarSections = mode === "edit" ? placeMenu({ tree, ix: index, docKind: doc.kind, newId: randomIds }, toolbarPlace) : [];

  const popAt = (rect: DOMRect): Anchor => ({ x: rect.left, y: rect.bottom, top: rect.top });
  const moreItems: MoreMenuItem[] =
    mode === "edit"
      ? [
          { label: "미리보기", onSelect: () => setFullView(true) },
          { label: "템플릿 이름…", onSelect: (rect) => setPop({ spec: { kind: "docTitle" }, anchor: popAt(rect) }) },
          ...(doc.kind === "special" ? [{ label: "대응 보통약관…", onSelect: (rect: DOMRect) => setPop({ spec: { kind: "general" }, anchor: popAt(rect) }) }] : []),
        ]
      : [{ label: "미리보기", onSelect: () => setFullView(true) }, ...props.moreItems];

  // ── 삭제 확인 (편집본) — 누른 자리 가까이 ──
  let removeCard: ReactNode = null;
  if (mode === "edit" && removing) {
    const entry = index.nodes.get(removing.nodeId);
    if (entry) {
      const num = numbers.get(entry.node.id);
      const ordinal = num && ["paragraph", "item", "subitem"].includes(entry.node.kind) ? `제${num.n}` : "";
      const what =
        entry.node.kind === "article" ? `${num?.label ?? "조"}(${(entry.node as { title: string }).title})` : entry.node.kind === "section" ? `${num?.label ?? "관"} ${(entry.node as { title: string }).title}` : `${ordinal}${NODE_WHAT[entry.node.kind] ?? entry.node.kind}`.trim();
      removeCard = (
        <Popover anchor={removing.anchor} label={`${what} 삭제`} onClose={() => setRemoving(undefined)}>
          <RemoveCard
            documentId={doc.id}
            tree={tree}
            node={entry.node}
            what={what}
            articles={articles}
            inOriginal={indexTree(doc.tree).nodes.has(entry.node.id)}
            onRemove={() => {
              if (apply([{ type: "remove", nodeId: entry.node.id }])) setRemoving(undefined);
            }}
            onCancel={() => setRemoving(undefined)}
            onGo={(nodeId) => {
              setRemoving(undefined);
              go(nodeId);
            }}
          />
        </Popover>
      );
    }
  }

  return (
    // 화면 높이에 고정 — 바는 위에, 목차 · 가운데 · 우측 패널은 각자 스크롤한다 (globals.css .ts-l3).
    // L3 는 전폭 화면이다 — `.ts-main:has(> .ts-l3)`(globals.css)가 공통 레이아웃의 최대폭·패딩을 여기서만 푼다.
    // 좁은 폭(globals.css `@container l3`)에서는 우측 패널이 접히고 바의 패널 버튼으로 본문 위에 연다 — 가운데 본문 폭이 먼저다.
    <div className={sideOpen ? "ts-l3 is-side-open" : "ts-l3"} aria-busy={pending || undefined}>
      <div className="ts-l3-bar">
        <Breadcrumb items={[{ label: DOC_TEMPLATE_LABEL[doc.kind], href: docListHref(doc.kind) }, { label: tree.title }]} guard={mode === "edit" ? leave : undefined} />
        <span className="ts-count" title="이 템플릿의 규모와, 저장 검증이 잡은 문제 수">
          조 <b>{articles.length}</b> · 검증 오류 <b>{errorCount}</b>
          <span className="ts-count-nodes"> / 노드 {index.nodes.size}</span>
        </span>
        {mode === "edit" && (
          <>
            <span className="ts-l3-dirty" title="편집본에 넣은 명령 수 — 저장해야 원본에 반영된다">
              {dirty ? (
                <>
                  편집 중 · 고친 것 {draft!.ops.length}건<span className="ts-l3-dirty-tail"> — 저장해야 반영</span>
                </>
              ) : (
                "편집 중"
              )}
            </span>
          </>
        )}
        <span className="ts-l3-bar-actions">
          <IconButton
            className="ts-l3-side-toggle"
            icon={<IconPanel />}
            label={sideOpen ? "우측 패널 닫기 — 검증 목록 · 사전평가" : "우측 패널 열기 — 검증 목록 · 사전평가"}
            aria-expanded={sideOpen}
            aria-controls="ts-l3-side"
            onClick={() => setSideOpen((open) => !open)}
          />
          <MoreMenu items={moreItems} />
          {mode === "edit" ? (
            <>
              <IconButton
                icon={<IconClose />}
                label="편집 취소 — 고친 내용을 버리고 읽기 모드로"
                disabled={pending}
                onClick={() =>
                  leave(() => {
                    endEdit();
                    // 읽기 모드는 지금 원본을 보인다 — 편집하는 사이 다른 저장이 있었을 수 있다
                    router.refresh();
                  })
                }
              />
              <button type="button" className="primary" disabled={!dirty || pending} onClick={() => save()}>
                {pending ? "저장 중…" : "저장"}
              </button>
            </>
          ) : (
            <button type="button" onClick={startEdit} disabled={pending}>
              편집
            </button>
          )}
        </span>
      </div>

      <Toc
        tree={tree}
        numbers={numbers}
        {...(mode === "edit" ? { drag } : {})}
        {...(currentArticleId ? { currentArticleId } : {})}
        onPick={(id) => {
          setArt(id);
          setPlace({ kind: "article", id });
          setFlashId(undefined);
          setActiveCell(undefined);
        }}
      />

      <div
        className="ts-l3-body"
        ref={bodyRef}
        onContextMenu={onContextMenu}
        {...(mode === "edit" ? drag.props : {})}
        onPointerDown={(e) => {
          const target = e.target as HTMLElement;
          // 블록 손잡이 밖을 누르면 고른 블록을 푼다(Shift 는 늘리기)
          if (!e.shiftKey && !target.closest("[data-drag], .ts-doc-toolbar")) drag.clearSel();
          // 툴바 · 셀 조작 줄은 자리를 바꾸지 않는다
          if (target.closest(".ts-doc-toolbar, .ts-cell-bar")) return;
          // 표 밖을 누르면 셀 조작 줄을 닫는다
          if (activeCell && !target.closest(".ts-doc-table")) setActiveCell(undefined);
          if (mode === "edit") setPlace(placeOf(target));
        }}
        onFocus={(e) => {
          if (mode !== "edit") return;
          const at = placeOf(e.target as HTMLElement);
          if (at) setPlace(at);
        }}
      >
        {mode === "edit" && <EditorToolbar groups={DOCUMENT_TOOLS} sections={toolbarSections} editing onRun={runTool} where={placeWords(toolbarPlace)} />}
        {conflict && (
          <div className="ts-error-banner" role="alert">
            <p>{conflict}</p>
            <p className="ts-muted">
              편집본은 이 화면에 그대로 있다 — 자동으로 합치지 않는다. 새 원본을{" "}
              <a href={`/documents/${doc.id}`} target="_blank" rel="noreferrer">
                새 창에서 열어
              </a>{" "}
              보고, 편집을 취소한 뒤 다시 편집해 옮겨 적는다.
            </p>
          </div>
        )}
        {banner && (
          <div className="ts-error-banner" role="alert">
            <p>{banner.message}</p>
            {banner.issues && banner.issues.length > 0 && <DraftIssues go={go} issues={banner.issues} />}
          </div>
        )}
        {props.notice}
        {currentArticleId ? (
          <ArticleBody index={index} articleId={currentArticleId} ctx={ctx} />
        ) : (
          <div className="ts-empty" data-doc-empty="true">
            <p className="ts-empty-what">아직 조가 하나도 없다 — 이 템플릿은 조립해도 아무것도 만들지 않는다.</p>
            <p className="ts-empty-example">예: 제1조(보험금의 지급사유) · 제2조(보험금을 지급하지 않는 사유)</p>
            <p className="ts-empty-action">
              {mode === "edit" ? "툴바의 「조」 · 「관」으로 시작한다. 다 쓰면 「저장」." : "위 바의 「편집」을 누르고, 툴바의 「조」로 조를 넣는다. 다 쓰면 「저장」."}
            </p>
          </div>
        )}
      </div>

      <SidePanel ctx={ctx} data={panel} />

      {menu && <ContextMenu x={menu.x} y={menu.y} sections={menu.sections} onPick={runMenu} onClose={() => setMenu(undefined)} />}
      {pop && mode === "edit" && <PopupHost env={popupEnv} spec={pop.spec} anchor={pop.anchor} onClose={() => setPop(undefined)} />}
      {removeCard}
      {fullView && (
        <FullPreview onClose={() => setFullView(false)}>
          <DocBody tree={tree} ctx={{ ...ctx, clauseView: "text" }} />
        </FullPreview>
      )}

      {discard ? (
        <DiscardDialog
          onStay={() => setDiscard(undefined)}
          onDiscard={() => {
            const { go: proceed } = discard;
            setDiscard(undefined);
            endEdit();
            proceed();
          }}
        />
      ) : null}
      {confirmSave ? (
        <dialog open className="ts-dialog">
          <p className="ts-confirm-title">저장하면 다른 문서의 참조 {confirmSave.brokenRefs.length}건이 깨진다</p>
          <ul className="ts-confirm-loss">
            {confirmSave.brokenRefs.map((c, i) => {
              const href = coordinateHref(c);
              return (
                <li key={i}>
                  {formatCoordinate(c, { source: true })}
                  {href && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={href} target="_blank" rel="noreferrer">
                        새 창에서 보기
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="ts-muted">지운 조를 가리키던 조연결 · 보통약관 조 참조는 깨진 참조가 된다.</p>
          <div className="ts-confirm-actions">
            <button type="button" onClick={() => setConfirmSave(undefined)} disabled={pending}>
              취소
            </button>
            <button type="button" className="danger" onClick={() => save(true)} disabled={pending}>
              참조 {confirmSave.brokenRefs.length}건 끊고 저장
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
