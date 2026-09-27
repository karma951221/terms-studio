"use client";

/**
 * 담보 상세 — 헤더(편집 흐름) + 탭 넷 (기능/담보 §4 「상세」).
 *
 * - 탭은 **객체(층) 단위**로 가른다. 한 객체의 필드를 탭으로 쪼개지 않는다.
 * - **탭을 옮겨도 편집 모드와 변경분이 유지**된다 — 그래서 탭은 링크가 아니라 클라이언트 상태다.
 *   URL `?tab=` 은 history.replaceState 로 따라만 간다 (내비게이션이 나면 초안이 날아간다).
 * - 저장 하나가 네 탭의 변경을 다 담는다. 변경이 있는 탭 이름에 점(•).
 * - **값 폼은 노드마다 따로 뜨고, 노드별 초안은 여기(Tabs)가 편집 세션 동안 보관한다** (점검 H4 · `value-drafts.ts`) —
 *   노드 · 탭을 오가도 각 노드의 미저장 입력이 남고, 저장 한 번에 전부 실린다. 취소하면 걷혀 읽기 화면이 저장값을 보인다.
 * - **구조(세부보장 · 급부의 추가 · 삭제 · 순서)는 탑재 수로 갈린다** (ADR-0052) — 미탑재(N=0)면 편집 모드의 트리가 편집기가 되고
 *   저장 하나에 담긴다 (삭제가 섞이면 영향 확인 · 관리자만). 탑재됐으면(N≥1) 이름만 고치고, 구조는 트리 머리의 「구조 편집 →」 로
 *   별도 화면(`/coverages/[id]/structure`)에서 — 편집 중 변경이 있으면 ✕ 와 같은 확인 뒤 이동.
 * - `?node=` · `?field=` 는 마스터 화면 · 오류 메시지의 진입 좌표 (기능/마스터 §3.5) — 그 노드를 골라 두고
 *   그 필드 행을 강조한다. 관리자(`showCodes`)에게는 필드 옆에 `폼키.필드키` 칩이 마스터로 이어진다 (§6).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState } from "react";

import { EditShell, Field, useEditField, useEditLeave } from "@/app/_components/EditShell";
import { InfoTip } from "@/app/_components/InfoTip";
import { isDirty } from "@/app/_lib/edit";
import { ENTITY_LABEL, FIELD_LABEL, NAME_LABEL } from "@/app/_lib/labels";
import { decodeNodeKey, savedStructureOf, structureIssues, type CoverageNodeLevel, type StructureDraftSub, type StructureSavedSub } from "@/domain/coverage";
import { StructForm, type FormModel, type FormState, type Submission } from "@/forms";

import { StructureTree } from "../_components/StructureTree";
import { createSpecialDocumentAction } from "../actions";
import { removeCoverageEditAction, saveCoverageEditAction } from "../edit-actions";
import type { CoverageEditData } from "../edit-types";

import { formKeyOf, initValueDrafts, valueDraftsReducer, type ValueDrafts } from "./value-drafts";

export interface EditorNode {
  key: string;
  level: CoverageNodeLevel;
  id: string;
  name: string;
  /** 세부보장이면 급부 수. 트리에 「급부 N」으로 선다. */
  benefitCount?: number;
  /** 형제 중 순번 (1부터). 담보 자신은 없다. */
  order?: number;
  /** 급부의 소속 세부보장 이름 — 급부 탭 왼쪽 목록을 「세부보장 › 급부」로 묶는다. */
  parentName?: string;
}

export interface CoverageEditorProps {
  id: string;
  initial: CoverageEditData;
  nodes: EditorNode[];
  /** 노드 키 → 그 레벨 마스터 값 폼 (ADR-0037: 레벨 하나에 폼 하나). */
  formByNode: Record<string, FormModel>;
  usageCount: number;
  documentId?: string;
  /** 담보약관에 남은 미결정 공용조항 옵션 수 — 0 이면 아무것도 띄우지 않는다 (기능/담보 §3.5). */
  unresolvedOptionCount?: number;
  /** 담보속성 유효값 표시명 — 담보명에 섞이면 경고한다 (Q-C: 경고까지, 거부 아님). */
  attributeValueLabels: string[];
  /** 처음 열 탭 — 서버가 `?tab=` 을 읽어 넘긴다. 이후 전환은 클라이언트 상태다. */
  initialTab?: string;
  /** 처음 골라 둘 노드 (`encodeNodeKey` 형식) — 서버가 `?node=` 을 읽어 넘긴다. 그 레벨의 선택만 잡는다. */
  initialNode?: string;
  /** 강조할 값 자리 `폼키.필드키` — 서버가 `?field=` 를 읽어 넘긴다. */
  highlightPath?: string;
  /** 관리자 — 값 폼 필드 옆에 코드 칩. */
  showCodes?: boolean;
}

type Tab = "basic" | CoverageNodeLevel;

const TAB_LABEL: Record<Tab, string> = { basic: "기본", coverage: "담보", subCoverage: "세부보장", benefit: "급부" };
const TABS: Tab[] = ["basic", "coverage", "subCoverage", "benefit"];

function isTab(value: string | undefined): value is Tab {
  return value === "basic" || value === "coverage" || value === "subCoverage" || value === "benefit";
}

// ───────────────────────────── 기본 탭 ─────────────────────────────

const STRUCTURE_TIP_UNMOUNTED = "미탑재 담보 — 세부보장 · 급부의 추가 · 순서 · 이름은 저장 하나에 담긴다. 삭제(✕)가 섞이면 저장 전 영향을 확인하고 관리자만 저장된다 (ADR-0052).";
const STRUCTURE_TIP_MOUNTED = "탑재된 담보의 구조는 상품에 영향을 준다 — 별도 「구조 편집」 화면에서 영향을 확인하고 고친다.";

/** 탑재된 담보(N≥1)의 트리 머리 「구조 편집 →」 — 편집 중 변경이 있으면 ✕ 와 같은 확인 뒤 이동 (기능/담보 §4 「상세」 기본 탭 구조 트리). */
function StructureEditLink({ coverageId }: { coverageId: string }) {
  const leave = useEditLeave();
  const router = useRouter();
  const href = `/coverages/${coverageId}/structure`;
  return (
    <Link href={href} className="ts-h2-action" onClick={(e) => { e.preventDefault(); leave(() => router.push(href)); }}>
      구조 편집 →
    </Link>
  );
}

function BasicTab({ coverageId, nodes, original, usageCount, documentId, attributeValueLabels, onPick }: { coverageId: string; nodes: EditorNode[]; original: StructureSavedSub[]; usageCount: number; documentId?: string; attributeValueLabels: string[]; onPick: (node: EditorNode) => void }) {
  const label = useEditField<string>("label");
  const structure = useEditField<StructureDraftSub[]>("structure");
  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));
  // Q-C — 담보속성은 상품에 탑재할 때 정한다. 경고까지만 하고 저장은 막지 않는다 (거부 아님).
  // 「기본계약」이 「기본」에 먼저 걸리지 않게 긴 값부터 본다. 이름을 고치는 자리에서만 띄운다.
  const hit =
    label.mode === "edit"
      ? [...attributeValueLabels].sort((a, b) => b.length - a.length).find((value) => value && label.value.includes(value))
      : undefined;

  return (
    <div className="ts-detail-split">
      <div className="ts-detail-main">
        <Field name="label" label={NAME_LABEL.coverage} />
        {hit ? <p className="ts-warn">담보명에 담보속성 값이 들어 있다 — 「{hit}」. 담보속성은 상품에 탑재할 때 정하므로 담보명에서 빼는 것이 좋다.</p> : null}
        <Field name="description" label={FIELD_LABEL.note} type="textarea" />
      </div>
      <dl className="ts-detail-side">
        <dt>사용처</dt>
        <dd>
          탑재 상품담보 <b>{usageCount}</b>
          <InfoTip text="마스터 값을 고쳐도 이미 탑재된 상품담보의 값에는 소급되지 않는다 (ADR-0002)." />
        </dd>
        <dt>{ENTITY_LABEL.coverageTemplate}</dt>
        <dd>
          {documentId ? (
            <Link href={`/documents/${documentId}`}>{ENTITY_LABEL.coverageTemplate} 열기 →</Link>
          ) : label.mode === "edit" ? (
            <form action={createSpecialDocumentAction.bind(null, coverageId)} className="ts-inline-form">
              <input type="text" name="title" placeholder="템플릿 제목" defaultValue={`${label.value} 특별약관`} />
              <button type="submit">템플릿 생성</button>
            </form>
          ) : (
            <span className="ts-muted">없음</span>
          )}
        </dd>
      </dl>
      <div className="ts-detail-full">
        <StructureTree
          mode={structure.mode}
          label={label.value}
          onLabel={label.setValue}
          value={structure.value}
          onChange={structure.setValue}
          structural={usageCount === 0}
          original={original}
          onPick={(key) => { const node = nodeByKey.get(key); if (node) onPick(node); }}
          tip={usageCount === 0 ? STRUCTURE_TIP_UNMOUNTED : STRUCTURE_TIP_MOUNTED}
          headerAction={usageCount > 0 ? <StructureEditLink coverageId={coverageId} /> : undefined}
        />
      </div>
    </div>
  );
}

// ───────────────────────────── 값 탭 ─────────────────────────────

function ValueTab({ level, nodes, formByNode, selected, onSelect, drafts, onDraft, showCodes, highlightPath }: {
  level: CoverageNodeLevel;
  nodes: EditorNode[];
  formByNode: Record<string, FormModel>;
  selected: string | undefined;
  onSelect: (key: string) => void;
  /** 이 편집 세션의 노드별 초안 — 노드를 다시 열 때 복원한다. */
  drafts: ValueDrafts;
  onDraft: (node: string, state: FormState) => void;
  showCodes?: boolean;
  highlightPath?: string;
}) {
  const values = useEditField<Record<string, Submission>>("values");
  const structure = useEditField<StructureDraftSub[]>("structure");
  // 이름은 구조 초안이 정본 — 기본 탭에서 고친 이름이 저장 전에도 여기 따라온다. 새 노드는 저장 뒤에야 목록에 선다.
  const draftName = new Map<string, string>(structure.value.flatMap((sub) => [[sub.key, sub.name], ...sub.benefits.map((b): [string, string] => [b.key, b.name])]));
  const nameOf = (node: EditorNode) => draftName.get(node.key) ?? node.name;
  const levelNodes = nodes.filter((n) => n.level === level);
  const current = levelNodes.find((n) => n.key === selected) ?? levelNodes[0];

  if (!current) return <p className="ts-form-empty">이 층에 노드가 없다.</p>;

  const form = formByNode[current.key];

  const body = (
    <div className="ts-detail-main">
      <h2 className="ts-h2">{nameOf(current)} — 값</h2>
      {!form || form.fields.length === 0 ? (
        <p className="ts-form-empty">이 층에 묻는 값이 없다.</p>
      ) : (
        <div className="ts-value-block">
          {/* 노드마다 인스턴스를 나눈다 — 같은 인스턴스를 이어 쓰면 초안이 다른 노드로 새거나 사라진다 (점검 H4). */}
          <StructForm
            key={formKeyOf(drafts, current.key)}
            model={form}
            initialState={drafts.byNode[current.key]}
            embedded
            readOnly={values.mode === "read"}
            showCodes={showCodes}
            highlightPath={highlightPath}
            onChange={(submission, state) => {
              onDraft(current.key, state);
              values.setValue({ ...values.value, [current.key]: submission });
            }}
          />
        </div>
      )}
    </div>
  );

  // 담보 탭은 노드가 하나(담보 자신)라 왼쪽 열이 없다.
  if (level === "coverage") return body;

  return (
    <div className="ts-node-split">
      <ul className="ts-node-list">
        {levelNodes.map((node) => (
          <li key={node.key}>
            <button type="button" onClick={() => onSelect(node.key)} aria-current={node.key === current.key ? "true" : undefined}>
              <span className="ts-tree-num">{node.order}</span>
              <span className="ts-node-name">{node.parentName ? `${node.parentName} › ${nameOf(node)}` : nameOf(node)}</span>
            </button>
          </li>
        ))}
      </ul>
      {body}
    </div>
  );
}

// ───────────────────────────── 탭 + 껍데기 ─────────────────────────────

function Tabs(props: Omit<CoverageEditorProps, "id"> & { coverageId: string }) {
  const { coverageId, nodes, formByNode, usageCount, documentId, attributeValueLabels, initial, initialTab, initialNode, highlightPath, showCodes } = props;
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : "basic");
  // `?node=` 는 그 레벨 슬롯에만 들어간다 — 다른 레벨은 첫 노드로 연다.
  const [selected, setSelected] = useState<Record<CoverageNodeLevel, string | undefined>>(() => {
    const slots: Record<CoverageNodeLevel, string | undefined> = { coverage: undefined, subCoverage: undefined, benefit: undefined };
    const node = decodeNodeKey(initialNode);
    if (node && initialNode) slots[node.level] = initialNode;
    return slots;
  });
  const label = useEditField<string>("label");
  const description = useEditField<string>("description");
  const structure = useEditField<StructureDraftSub[]>("structure");
  const values = useEditField<Record<string, Submission>>("values");
  // 노드별 값 초안 — 편집 세션 경계를 따라간다(취소면 걷고, 저장이면 새 저장값이 올 때까지 둔다).
  // 렌더 중 상태 조정 (StructForm 의 지문 reset 과 같은 패턴).
  const [drafts, dispatchDrafts] = useReducer(valueDraftsReducer, values.mode, initValueDrafts);
  if (drafts.mode !== values.mode) dispatchDrafts({ type: "mode", mode: values.mode, values: values.value });

  // URL 은 따라만 간다 — router 로 옮기면 서버 컴포넌트가 다시 그려져 초안이 날아간다.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === "basic") url.searchParams.delete("tab"); else url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }, [tab]);

  const basicDirty =
    label.value !== initial.label ||
    description.value !== initial.description ||
    isDirty(initial.structure, structure.value);
  const dirtyOf = (candidate: Tab): boolean => {
    if (candidate === "basic") return basicDirty;
    return nodes.some((n) => n.level === candidate && values.value[n.key] !== undefined);
  };

  const pick = (node: EditorNode) => {
    setSelected((current) => ({ ...current, [node.level]: node.key }));
    setTab(node.level);
  };

  return (
    <>
      <nav className="ts-subtabs" aria-label="담보 상세 탭">
        {TABS.map((candidate) => (
          <button key={candidate} type="button" aria-current={candidate === tab ? "page" : undefined} onClick={() => setTab(candidate)}>
            {TAB_LABEL[candidate]}
            {dirtyOf(candidate) ? <span className="ts-dot" aria-label="변경됨">•</span> : null}
          </button>
        ))}
      </nav>
      {tab === "basic" ? (
        <BasicTab coverageId={coverageId} nodes={nodes} original={savedStructureOf(initial.structure)} usageCount={usageCount} documentId={documentId} attributeValueLabels={attributeValueLabels} onPick={pick} />
      ) : (
        <ValueTab
          level={tab}
          nodes={nodes}
          formByNode={formByNode}
          selected={selected[tab]}
          onSelect={(key) => setSelected((current) => ({ ...current, [tab]: key }))}
          drafts={drafts}
          onDraft={(node, state) => dispatchDrafts({ type: "draft", node, state })}
          showCodes={showCodes}
          highlightPath={highlightPath}
        />
      )}
    </>
  );
}

export function CoverageEditor(props: CoverageEditorProps) {
  const { id, initial, ...rest } = props;
  return (
    <EditShell
      initial={initial}
      title={initial.label}
      path={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }]}
      saveAction={saveCoverageEditAction.bind(null, id)}
      saveDisabled={(data) => structureIssues(data.structure).length > 0}
      deleteAction={removeCoverageEditAction.bind(null, id)}
      deleteLabel={`${initial.label} 삭제`}
      deleteTooltip={`담보 ${initial.label} 삭제`}
      deleteSuccessHref="/coverages"
      headerMeta={
        <>
          <span className="ts-count">탑재 상품담보 <b>{rest.usageCount}</b></span>
          {/* 담보약관 옵션은 담보 마스터 안에서 다 정해야 한다 (기능/담보 §3.5) — 남았으면 문면으로 보낸다. */}
          {rest.documentId && (rest.unresolvedOptionCount ?? 0) > 0 ? (
            <Link className="ts-badge warning" href={`/documents/${rest.documentId}`}>
              공용조항 옵션 미결정 {rest.unresolvedOptionCount}
            </Link>
          ) : null}
        </>
      }
    >
      <Tabs {...rest} initial={initial} coverageId={id} />
    </EditShell>
  );
}
