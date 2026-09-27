"use client";

/**
 * 조문 저작 화면 (L3) — 목차(조만) · 명조 본문 · 모드에 종속된 우측 패널 (디자인원칙 §2 L3 · 리뷰 #43).
 *
 * ADR-0074 「편집 → 저장 한 번」:
 * - 읽기 모드에서 시작한다. `편집` 을 누르면 원본 트리와 그 **판**을 받아 브라우저에 **편집본**을 만들고, 같은 자리 버튼이 `저장` 이 된다.
 * - 편집 중의 모든 명령은 순수 도메인 `applyEdit` 로 편집본에 곧바로 적용되고(명령 단위 검사도 그 자리에서) 명령 목록으로 쌓인다.
 *   본문 · 목차 · 우측 패널 · 조건 팝업 · 검증 목록 · 사전평가는 편집 중이면 편집본을 그린다.
 * - `저장` = 명령 목록 + 시작 판을 서버로. 서버가 판 확인 · 재적용 · 전체 검증 뒤 한 번에 반영한다.
 *   검증 오류면 편집을 계속하고 오류를 노드로 안내, 판이 다르면 「다른 사람이 먼저 저장했습니다」(편집본 유지). 잠금은 없다.
 * - 경로 링크 · ✕ · 화면을 떠나는 링크는 고친 것이 있으면 「고친 내용을 버립니까?」, 새로고침 · 창 닫기는 브라우저 경고.
 *   편집본을 로컬 저장소에 백업하지 않는다 — 떠나면 사라진다.
 * - 템플릿 삭제 · 복제는 읽기 모드의 더보기 메뉴 — 편집 중에는 없다.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { coordinateHref } from "@/app/_components/coordinateHref";
import { DiscardDialog } from "@/app/_components/EditShell";
import { IconButton, IconClose } from "@/app/_components/icons";
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
import type { Code, Coordinate, Id, Impact, Issue } from "@/domain/types";

import { loadGeneralForEditAction, saveDocumentEditAction, startDocumentEditAction, type GeneralForEdit } from "../../edit-actions";
import { docListHref } from "../../lib";
import { refLabelOf } from "./condition/display";
import type { ConditionContext } from "./condition/types";
import { DocBody } from "./DocBody";
import type { DocCtx, DocMode, Selection } from "./ctx";
import { moveOps } from "./formOps";
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
  slotCandidates: readonly { path: string; label: string }[];
  /** 좌표 링크(`?node=`)로 들어왔을 때 고른 자리. */
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
  text: "문장",
  slot: "치환 슬롯",
  inlineCond: "문장 안 조건",
  condBlock: "조건 블록",
  clauseBlockRef: "공용조항 참조",
  clauseInlineRef: "공용조항 참조",
  articleRef: "조 참조 슬롯",
  appendixRef: "별표 참조 슬롯",
};

export function DocumentEditor(props: EditorProps) {
  const { doc } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<DocMode>("read");
  const [draft, setDraftState] = useState<Draft>();
  const draftRef = useRef<Draft | undefined>(undefined);
  const setDraft = (next: Draft | undefined) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const [generalCache, setGeneralCache] = useState<Record<Id, GeneralForEdit>>(() => (props.general ? { [props.general.id]: props.general } : {}));
  const generalRef = useRef(generalCache);
  const [sel, setSel] = useState<Selection>(props.initialNode ? { node: props.initialNode } : {});
  const [art, setArt] = useState<Id>();
  const [removing, setRemoving] = useState<Id>();
  const [banner, setBanner] = useState<Banner>();
  const [conflict, setConflict] = useState<string>();
  const [confirmSave, setConfirmSave] = useState<Impact>();
  const [discard, setDiscard] = useState<{ go: () => void }>();
  const [evalOn, setEvalOn] = useState(Boolean(props.initialEval));
  const [revision, setRevision] = useState(0);

  const dirty = mode === "edit" && (draft?.ops.length ?? 0) > 0;
  const original: DraftState = useMemo(() => ({ tree: doc.tree, ...(doc.generalDocumentId ? { generalDocumentId: doc.generalDocumentId } : {}) }), [doc.tree, doc.generalDocumentId]);
  const current = mode === "edit" && draft ? draft.state : original;
  const tree = current.tree;

  // ── 검증 재료 — 서버 저장 검증과 같은 한 벌(validateDocument)을 서버가 넘긴 정의로 짓는다 ──
  const coordinate: Coordinate = useMemo(() => ({ document: doc.kind, ownerId: doc.ownerId ?? doc.id, documentId: doc.id, ownerName: doc.title }), [doc.kind, doc.ownerId, doc.id, doc.title]);
  const gate = useMemo(() => clauseGateFrom(props.clauses, props.discriminators.map((d) => d.code)), [props.clauses, props.discriminators]);
  const appendixCodes = useMemo(() => new Set(props.appendices.map((a) => a.code)), [props.appendices]);
  /** 보통약관 캐시 → 편집 환경. 렌더는 상태의 캐시로, 명령 적용은 방금 받은 것까지 든 ref 의 캐시로 만든다. */
  const makeEditEnv = useCallback(
    (cache: Readonly<Record<Id, GeneralForEdit>>): EditEnv => ({
      env: { kind: doc.kind, appendixExists: (c: Code) => appendixCodes.has(c), clauseGate: gate, coordinate },
      generalRefs: (id: Id) => {
        const g = cache[id];
        return g ? generalRefsOf(g.tree) : undefined;
      },
    }),
    [doc.kind, appendixCodes, gate, coordinate],
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
  const selectedEntry = sel.node ? index.nodes.get(sel.node) : undefined;
  const selectedBranch = sel.node ? index.branches.get(sel.node) : undefined;
  const currentArticleId = art ?? selectedEntry?.articleId ?? selectedBranch?.articleId;
  const selectedCell = useMemo(
    () => (sel.cell && selectedEntry?.node.kind === "table" && selectedEntry.node.rows[sel.cell.row]?.cells[sel.cell.col] ? { tableId: selectedEntry.node.id, ...sel.cell } : undefined),
    [sel.cell, selectedEntry],
  );

  // 반복 표 템플릿 셀 안이면 조건 팝업 · 슬롯 트리에 「현재 행」 가지 (ADR-0070 · 설계 §3.1) — 담보약관만
  const condition: ConditionContext = useMemo(() => {
    if (!props.condition.coverage || !sel.node) return props.condition;
    let row: ConditionContext["row"];
    if (selectedCell && selectedEntry?.node.kind === "table") {
      const t = selectedEntry.node;
      if (t.repeat && !t.rows[selectedCell.row]?.header) row = { levels: repeatLevels(t), readable: rowReadableLevels(repeatLevels(t)) };
    } else {
      const nodeId = index.nodes.has(sel.node) ? sel.node : selectedBranch?.ownerId;
      const scoped = nodeId ? repeatScopeOf(tree, nodeId) : undefined;
      if (scoped) row = { levels: scoped.levels, readable: scoped.readable };
    }
    return row ? { ...props.condition, row } : props.condition;
  }, [props.condition, sel.node, selectedCell, selectedEntry, selectedBranch, index, tree]);

  // ── 조작 ──
  const select = useCallback((next: Selection) => {
    setSel(next);
    setRemoving(undefined);
  }, []);

  /** 편집본에 명령을 적용한다 — 하나라도 거부되면 아무것도 적용하지 않고 사유 배너. */
  const apply = (ops: readonly EditOp[]): boolean => {
    const d = draftRef.current;
    if (!d) return false;
    let state = d.state;
    const recorded: EditOp[] = [];
    const env = makeEditEnv(generalRef.current);
    for (const op of ops) {
      const r = applyEdit(state, op, env);
      if (!r.ok) {
        const view = describeRejection(r.rejection);
        setBanner({ message: `적용하지 못했다 — ${view.message}`, ...(view.issues && view.issues.length > 1 ? { issues: view.issues } : {}) });
        return false;
      }
      state = r.value.state;
      recorded.push(r.value.op);
    }
    if (recorded.length === 0) return true;
    setDraft({ ...d, state, ops: [...d.ops, ...recorded] });
    setBanner(undefined);
    setRevision((n) => n + 1);
    return true;
  };

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
    setMode("read");
    setDraft(undefined);
    setBanner(undefined);
    setConflict(undefined);
    setRemoving(undefined);
    setConfirmSave(undefined);
  };

  const save = (confirm = false) => {
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
  const leave = useCallback((go: () => void) => (dirty ? setDiscard({ go }) : go()), [dirty]);

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

  // 화면을 떠나는 링크(경로 · 내비 · 「고치러 가기」)는 고친 것이 있으면 확인을 거친다. 같은 화면 안 앵커(#art-…)는 그대로.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
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

  // 좌표 링크로 들어왔으면 그 조로 스크롤 (처음 한 번)
  useEffect(() => {
    if (!props.initialNode) return;
    const ix = indexTree(doc.tree);
    const articleId = ix.nodes.get(props.initialNode)?.articleId ?? ix.branches.get(props.initialNode)?.articleId;
    if (articleId) document.getElementById(`art-${articleId}`)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const ctx: DocCtx = {
    documentId: doc.id,
    docKind: doc.kind,
    mode,
    ...(sel.node && mode === "edit" ? { selectedId: sel.node } : {}),
    ...(selectedCell && mode === "edit" ? { selectedCell } : {}),
    numbers,
    ...(evaluation ? { branchEval: evaluation.branches, slotEval: evaluation.slots } : {}),
    appendixName,
    clauseLabel,
    optionText,
    references,
    select,
    apply,
    fail: (message) => setBanner({ message: `적용하지 못했다 — ${message}` }),
    move: (nodeId, dir) => {
      const ops = moveOps(tree, nodeId, dir);
      if (ops.length > 0) apply(ops);
    },
    askRemove: (nodeId) => setRemoving(nodeId),
    refLabel,
  };

  const panel: PanelData = {
    tree,
    index,
    appendices: props.appendices,
    clauses: props.clauses,
    condition,
    slotCandidates: props.slotCandidates,
    generals: props.generals,
    ...(current.generalDocumentId ? { generalDocumentId: current.generalDocumentId } : {}),
    ...(props.suggestedGeneralId ? { suggestedGeneralId: props.suggestedGeneralId } : {}),
    issues,
    documentTitle: tree.title,
    ...(evaluation ? { branchEval: evaluation.branches } : {}),
    evalRan: evaluation !== undefined,
    evalAvailable,
    ...(props.evalNote ? { evalNote: props.evalNote } : {}),
    ...(evaluation && mode === "read" ? { rendered: <DocBody tree={tree} ctx={{ ...ctx, mode: "read", tables: evaluation.tables }} /> } : {}),
    toggleEval,
    setGeneral,
  };

  // ── 삭제 확인 카드 (편집본) ──
  let removeCard: ReactNode = null;
  if (mode === "edit" && removing) {
    const entry = index.nodes.get(removing);
    if (entry) {
      const num = numbers.get(entry.node.id);
      const ordinal = num && ["paragraph", "item", "subitem"].includes(entry.node.kind) ? `제${num.n}` : "";
      const what = entry.node.kind === "article" ? `${num?.label ?? "조"}(${(entry.node as { title: string }).title})` : `${ordinal}${NODE_WHAT[entry.node.kind] ?? entry.node.kind}`.trim();
      removeCard = (
        <RemoveCard
          documentId={doc.id}
          tree={tree}
          node={entry.node}
          what={what}
          articles={articles}
          inOriginal={indexTree(doc.tree).nodes.has(entry.node.id)}
          onRemove={() => {
            if (apply([{ type: "remove", nodeId: entry.node.id }])) {
              setRemoving(undefined);
              setSel({});
            }
          }}
          onCancel={() => setRemoving(undefined)}
          onGo={(nodeId) => select({ node: nodeId })}
        />
      );
    }
  }

  const panelKey = `${mode}:${sel.node ?? "doc"}:${sel.cell ? `${sel.cell.row}-${sel.cell.col}` : ""}:${revision}`;

  return (
    // 바는 자기 높이만, 나머지 한 줄이 남는 높이를 먹는다 — 열·행 모두 globals.css 의 .ts-l3 가 정한다.
    // L3 는 전폭 화면이다 — `.ts-main:has(> .ts-l3)`(globals.css)가 공통 레이아웃의 최대폭·패딩을 여기서만 푼다.
    <div className="ts-l3" aria-busy={pending || undefined}>
      <div className="ts-l3-bar">
        <Breadcrumb items={[{ label: DOC_TEMPLATE_LABEL[doc.kind], href: docListHref(doc.kind) }, { label: tree.title }]} guard={mode === "edit" ? leave : undefined} />
        <span className="ts-count" title="이 템플릿의 규모와, 저장 검증이 잡은 문제 수">
          조 <b>{articles.length}</b> · 검증 오류 <b>{errorCount}</b> / 노드 {index.nodes.size}
        </span>
        {mode === "edit" && (
          <span className="ts-l3-dirty" title="편집본에 적용한 명령 수 — 저장해야 원본에 반영된다">
            {dirty ? `편집 중 · 고친 것 ${draft!.ops.length}건 — 저장해야 반영` : "편집 중"}
          </span>
        )}
        <span className="ts-l3-bar-actions">
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
            <>
              {props.moreItems.length > 0 && <MoreMenu items={props.moreItems} />}
              <button type="button" onClick={startEdit} disabled={pending}>
                편집
              </button>
            </>
          )}
        </span>
      </div>

      <Toc articles={articles} numbers={numbers} {...(currentArticleId ? { currentArticleId } : {})} onPick={setArt} />

      <div className="ts-l3-body">
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
            {banner.issues && banner.issues.length > 0 && <DraftIssues ctx={{ select }} issues={banner.issues} />}
          </div>
        )}
        {props.notice}
        <datalist id="slot-candidates">
          {props.slotCandidates.map((candidate) => (
            <option key={candidate.path} value={candidate.path}>
              {candidate.label}
            </option>
          ))}
        </datalist>
        <DocBody tree={tree} ctx={ctx} />
      </div>

      {removeCard ? <aside className="ts-l3-side">{removeCard}</aside> : <SidePanel key={panelKey} ctx={ctx} data={panel} />}

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
