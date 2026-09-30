"use client";

/**
 * 그 자리 팝업들 (기능/문면 §4.3) — 칩 · 조건 머리를 누르거나 오른쪽 클릭 메뉴에서 고르면 그 자리 바로 아래에 뜬다.
 *
 * 팝업의 확인은 편집본에 곧바로 명령을 적용한다(서버로 가지 않는다 — ADR-0074). 원본 반영은 바의 `저장` 한 번.
 * 조건식에는 팝업이 없다 — 조건 블록 머리 줄에서 그 자리로 고친다(2026-09-28). 문장 안 조건 칩의 팝업만 가지마다 같은 머리 줄(`CondRows`)을 쓴다.
 * 우측 패널에는 입력칸이 없다 — 여기가 입력칸이 뜨는 유일한 자리다.
 */
import { useState, type FormEvent, type ReactNode } from "react";

import { Combobox, type ComboOption } from "@/app/_components/Combobox";
import { IconButton, IconTrash } from "@/app/_components/icons";
import { DOC_KIND_LABEL, REPEAT_DEPTH_LABEL, STRUCT_KEY_CHIP, SWITCH_WORD } from "@/app/_lib/labels";
import { bindingLabel, bindingOfValue, bindingOptions, bindingValue, planFormChoices, type LoopChoice } from "@/app/(app)/functions/_components/params";
import type { EnumDef } from "@/domain/catalog";
import type { Bindings, Clause } from "@/domain/clause";
import {
  HOST_TARGET_PREFIX,
  indexTree,
  isRepeatSource,
  multiTarget,
  nodeBuilders,
  parseRefKey,
  repeatElementEnums,
  referenceKeyIndex,
  referenceTargetLabel,
  refKey,
  refTargetOf,
  type Appendix,
  type ArticleRefNode,
  type DocumentNode,
  type EditOp,
  type IdSource,
  type InlineBranch,
  type InlineNode,
  type Node,
  type ReferenceTarget,
  type RefRestrict,
  type RefTarget,
} from "@/domain/document";
import type { Box } from "@/domain/document/box";
import { ATTACH_LEVEL_LABEL, REFERENCE_CONNECTORS, isReferenceConnector, type Code, type Id, type ReferenceConnector } from "@/domain/types";

import { str } from "../../lib";
import { CondRows } from "./condition/CondRows";
import { SlotRefInput } from "./condition/SlotRefInput";
import type { ConditionContext } from "./condition/types";
import type { Anchor, DocCtx } from "./ctx";
import { emptyNode, inlineListAt, newTable } from "./editOps";
import { InlineSlot } from "./Inline";
import { runsFromTokens } from "./inlineRuns";
import { clausesFitting, type PopupSpec } from "./menus";
import { PopActions, Popover } from "./Popover";
import { RefTargetTree } from "./RefTargetTree";
import { loopChoices, loopsAround, repeatChoices, sourceOfValue, sourceValue } from "./repeatSources";
import { CaseControls } from "./SwitchControls";
import { unassignedValues } from "./switchCases";

export interface PopupEnv {
  ctx: DocCtx;
  /** 지금 편집본 트리 (그리기용). */
  tree: DocumentNode;
  /** 누르는 순간의 편집본 트리 — 확인 때 명령을 만든다. */
  latest: () => DocumentNode;
  apply: (ops: readonly EditOp[]) => boolean;
  newId: IdSource;
  appendices: readonly Appendix[];
  /** 정적 마스터 박스 — 「박스」 고르기 팝업. */
  boxes: readonly Box[];
  clauses: readonly Clause[];
  generals: readonly { id: Id; title: string }[];
  generalDocumentId?: Id;
  suggestedGeneralId?: Id;
  setGeneral: (generalDocumentId: Id | undefined) => void;
  /** 이 자리에서 여는 조건 팝업 · 슬롯 트리의 문맥 (반복 표 템플릿 셀이면 「현재 행」 가지). */
  condition: ConditionContext;
  /** 열거형 — 반복 원천 이름(합집합 거름 필드) · 현재 원소 후보 이름. */
  enumOf?: (code: Code) => EnumDef | undefined;
}

/** 확인이면 FormData → 명령, 적용되면 닫는다. 명령을 못 만들면(빈 칸) 그 사유를 팝업 안에 보인다. */
function PopForm({ env, onClose, build, children }: { env: PopupEnv; onClose: () => void; build: (fd: FormData) => EditOp[] | string; children: ReactNode }) {
  const [message, setMessage] = useState<string>();
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const built = build(new FormData(event.currentTarget));
    if (typeof built === "string") {
      setMessage(built);
      return;
    }
    if (built.length === 0 || env.apply(built)) onClose();
  };
  return (
    <form onSubmit={onSubmit}>
      {children}
      {message && (
        <p className="ts-form-issues" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

/**
 * 값 한정 칸의 재료 (ADR-0077 결정 7) — 참조 자리를 감싼 열거값 반복(「현재 값」 후보)과 반복 원소 열거형의 값(「해당 값들」 후보).
 * 값이 없으면(열거형 모름) 값 한정 칸을 그리지 않는다.
 */
export interface RestrictChoices {
  loops: readonly { id: Id; label: string }[];
  values: readonly { code: Code; label: string }[];
}

/** 저장된 값 한정 → 칸 값 (`""` 없음 · `values` 해당 값들 · `current:<반복 id>` 현재 값). */
function restrictMode(r: RefRestrict | undefined): string {
  if (!r) return "";
  return "current" in r ? `current:${r.current}` : "values";
}

/** 조 참조 칸 — 범위 · 대상(여럿) · 값 한정 · 연결어. 넣기와 고치기가 같이 쓴다. */
function ArticleRefFields({ ctx, node, restrict }: { ctx: DocCtx; node?: ArticleRefNode; restrict?: RestrictChoices }) {
  const [count, setCount] = useState(node?.targets.length ?? 0);
  // 고른 연결어 — 기본값 없이 시작한다(결정 14). 대상이 하나로 줄었다 다시 늘어도 기억한다 (고치기면 저장된 값에서 시작)
  const [connector, setConnector] = useState<ReferenceConnector | undefined>(node?.connector);
  // 반복 블록 안 대상 · 반복 블록 · 함수조항 참조는 하나여도 펼치면 여러 번호가 될 수 있다 — 연결어를 켠다 (결정 14 확장 · ADR-0077 결정 7)
  const [repeatedPicked, setRepeatedPicked] = useState(() => (node ? node.targets.some((t) => multiTarget({ ...t, restrict: undefined }, ctx.repeatedKeys)) : false));
  // 값 한정 — 모든 대상에 같이 건다. 고르면 하나여도 연결어가 켜진다
  const saved = node?.targets.find((t) => t.restrict)?.restrict;
  const [mode, setMode] = useState(() => restrictMode(saved));
  const savedValues = saved && "values" in saved ? saved.values : [];
  const keyOfRow = (rowId: Id): string | undefined => {
    for (const index of [ctx.references.self, ctx.references.general, ...(ctx.articleRefChoices ?? []).map((c) => c.index)]) {
      const t = index.get(rowId);
      if (t) return refKey(refTargetOf(t));
    }
    return undefined;
  };
  const onPicked = (n: number, ids: readonly Id[]) => {
    setCount(n);
    setRepeatedPicked(ids.some((rowId) => {
      const key = keyOfRow(rowId);
      return key !== undefined && multiTarget(parseRefKey(key), ctx.repeatedKeys);
    }));
  };
  const joins = count >= 2 || repeatedPicked || mode !== "";
  // 범위를 화면이 정하면(공용조항 — 보통약관 · 이 공용조항 · 사용처) 그 목록이 범위 고르기, 고른 범위의 후보만 선다
  const choices = ctx.articleRefChoices;
  const [choice, setChoice] = useState(() => initialChoice(choices, node));
  const picked = choices?.find((c) => c.value === choice);
  return (
    <>
      {choices && (
        <div className="ts-form-row">
          <label htmlFor="pop-ref-scope">범위</label>
          <select
            id="pop-ref-scope"
            name="scope"
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              setCount(0);
            }}
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {!choices && ctx.docKind === "special" && (
        <div className="ts-form-row">
          <label htmlFor="pop-ref-scope">범위</label>
          <select id="pop-ref-scope" name="scope" defaultValue={node?.scope ?? "self"}>
            <option value="self">이 템플릿</option>
            <option value="general">대응 보통약관</option>
          </select>
        </div>
      )}
      <div className="ts-form-row ts-form-full">
        <label htmlFor="pop-ref-targets">참조 대상 (여럿 고를 수 있다)</label>
        <RefTargetTree
          key={choice}
          id="pop-ref-targets"
          defaultSelected={node && initialChoice(choices, node) === choice ? selectedIds(node, picked ? [picked.index] : ctx.docKind === "special" ? [ctx.references.self, ctx.references.general] : [ctx.references.self]) : []}
          onCountChange={onPicked}
          scopes={
            picked
              ? [{ key: picked.value, label: picked.label, index: picked.index, ...(picked.rootless ? { rootless: true } : {}) }]
              : ctx.docKind === "special"
                ? [
                    { key: "self", label: "이 템플릿", index: ctx.references.self },
                    { key: "general", label: "대응 보통약관", index: ctx.references.general },
                  ]
                : [{ key: "self", index: ctx.references.self }]
          }
        />
      </div>
      {restrict && restrict.values.length > 0 && (
        <div className="ts-form-row">
          <label htmlFor="pop-ref-restrict">값 한정</label>
          <div>
            <select id="pop-ref-restrict" name="restrictMode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">없음 — 펼친 것 전부</option>
              <option value="values">해당 값들</option>
              {restrict.loops.map((l) => (
                <option key={l.id} value={`current:${l.id}`}>
                  현재 값 — {l.label}
                </option>
              ))}
            </select>
            {mode === "values" && (
              <div className="ts-radio-group" role="group" aria-label="한정할 값">
                {restrict.values.map((v) => (
                  <label key={v.code} className="ts-form-radio">
                    <input type="checkbox" name="restrictValue" value={v.code} defaultChecked={savedValues.includes(v.code)} />
                    {v.label}
                  </label>
                ))}
              </div>
            )}
            <p className="ts-form-hint">반복(사유)으로 생긴 노드를 그 값이 낸 것만으로 좁힌다 — 펼친 뒤 0개면 조립 오류다. 대상은 사유 반복 안의 노드여야 한다.</p>
          </div>
        </div>
      )}
      <div className="ts-form-row">
        <span className="ts-form-label">연결어</span>
        <div>
          <div className="ts-radio-group" role="radiogroup" aria-label="연결어" aria-disabled={!joins}>
            {REFERENCE_CONNECTORS.map((c) => (
              <label key={c} className="ts-form-radio">
                <input type="radio" name="connector" value={c} disabled={!joins} checked={joins && connector === c} onChange={() => setConnector(c)} />
                {c}
              </label>
            ))}
          </div>
          <p className="ts-form-hint">
            {joins
              ? `골라야 적용된다 — 기본값이 없다.${count < 2 ? " 반복 · 함수조항으로 펼치면 여러 번호가 될 수 있다." : ""} 마지막 대상 앞에 붙는다. 번호가 잇달아 셋 이상이면 「제3조부터 제5조까지」로 묶이고, 분기로 빠진 대상은 산출 때 제외된다.`
              : "대상을 둘 이상(또는 반복 블록 · 함수조항 참조 · 그 안 대상을) 고르거나 값 한정을 걸면 고를 수 있다."}
          </p>
        </div>
      </div>
    </>
  );
}

/** 범위 목록이 있을 때 처음 고른 범위 — 고치기면 그 참조의 범위(`host:` 대상이면 사용처), 넣기면 첫 범위. */
function initialChoice(choices: DocCtx["articleRefChoices"], node?: ArticleRefNode): string {
  if (!choices || choices.length === 0) return "";
  if (!node) return choices[0].value;
  const host = node.targets.length > 0 && node.targets.every((t) => t.articleId.startsWith(HOST_TARGET_PREFIX));
  const want = node.scope === "self" ? "self" : host ? "host" : "general";
  return choices.some((c) => c.value === want) ? want : choices[0].value;
}

/** 연결어 미선택 — 대상이 둘 이상이거나 펼치면 여럿이 될 수 있으면 적용 전에 고른다 (결정 14 · 기능/문면 §3.5). */
const CONNECTOR_PICK_MESSAGE = "대상이 둘 이상이거나 반복 · 함수조항 · 값 한정으로 여러 번호가 될 수 있으면 연결어(및 · 또는)를 고른다.";

/** 연결어가 필요한 대상인가 — 둘 이상 · 여러 번호가 될 수 있는 대상 하나 (문서 저장 검사와 같은 규칙 — `multiTarget`). */
function needsConnector(ctx: DocCtx, targets: readonly RefTarget[]): boolean {
  return targets.length >= 2 || targets.some((t) => multiTarget(t, ctx.repeatedKeys));
}

/** 저장된 대상 → 고르기 트리의 줄 id (같은 코드의 분기 짝이면 문서 순 첫 줄). 범위의 색인들에서 찾는다. */
function selectedIds(node: ArticleRefNode, indexes: readonly ReadonlyMap<Id, ReferenceTarget>[]): Id[] {
  return node.targets.flatMap((t) => {
    for (const index of indexes) {
      const found = referenceKeyIndex(index).get(refKey(t)); // 값 한정은 열쇠에 들지 않는다 — 같은 줄
      if (found) return [found.id];
    }
    return [];
  });
}

function articleRefOf(fd: FormData): { targets: RefTarget[]; connector: ReferenceConnector | undefined; scope: ArticleRefNode["scope"] } {
  // 고르기 트리가 참조 대상 열쇠(조 id · 조#P코드 · 조#참조코드/안쪽코드)를 싣는다 (ADR-0072 결정 3 · ADR-0077 결정 6)
  const keys = [...new Set(fd.getAll("targets").map((v) => String(v).trim()).filter(Boolean))];
  // 값 한정 — 고른 대상 모두에 같이 (ADR-0077 결정 7). 해당 값들을 하나도 안 고르면 빈 목록(저장 검사가 알린다)
  const mode = str(fd, "restrictMode");
  const restrict: RefRestrict | undefined = mode === "values" ? { values: fd.getAll("restrictValue").map(String) } : mode.startsWith("current:") ? { current: mode.slice("current:".length) } : undefined;
  const targets = keys.map((k) => ({ ...parseRefKey(k), ...(restrict ? { restrict } : {}) }));
  // 라디오가 꺼져 있으면(대상 하나 · 반복 밖) 값이 오지 않는다 — 연결어를 싣지 않는다(표기에 안 나온다, 결정 14)
  const connector = str(fd, "connector");
  // 사용처 위치(`host`)는 편집 트리에서 보통약관 참조 자리로 운반한다 (clauseTree)
  const scope = str(fd, "scope");
  return { targets, connector: isReferenceConnector(connector) ? (connector as ReferenceConnector) : undefined, scope: scope === "general" || scope === "host" ? "general" : "self" };
}

/**
 * 함수조항 칸 — 함수조항을 고르면 그 옵션마다 선택지 · 인자마다 연결. 옵션 선택 · 인자 연결은 사용처(이 문서) 소유다 (기능/함수조항 §3.2 · §3.7).
 * 인자 연결 칸은 「기본 연결」(비움 — 선언의 기본을 쓴다)이 처음 값이다. 기본 연결이 없으면 골라야 저장된다(연결 누락 = 저장 오류).
 */
function ClauseFields({ clauses, code, options, bindings, condition, loops = [], enumOf }: { clauses: readonly Clause[]; code?: Code; options?: Record<Code, Code>; bindings?: Bindings; condition: ConditionContext; loops?: readonly LoopChoice[]; enumOf?: (code: Code) => EnumDef | undefined }) {
  const [picked, setPicked] = useState<Code>(code ?? "");
  const clause = clauses.find((c) => c.code === picked);
  const forms = planFormChoices();
  // 목록값 인자의 상수 연결 후보 — 그 열거형의 값(기능/함수조항 §5 「상수 연결은 참거짓 · 열거값만」)
  const enumsOf = (t: { kind: string; enumCode?: Code }): EnumDef[] => {
    const def = t.enumCode !== undefined ? enumOf?.(t.enumCode) : undefined;
    return def ? [def] : [];
  };
  return (
    <>
      {code === undefined ? (
        <div className="ts-form-row">
          <label htmlFor="pop-clause">함수조항</label>
          <Combobox
            id="pop-clause"
            name="clauseCode"
            value={picked}
            onChange={setPicked}
            options={clauses.map((c) => ({ value: c.code, label: c.label, hint: c.code }))}
            placeholder={clauses.length === 0 ? "함수조항 없음" : "이름 · 코드로 찾기"}
            disabled={clauses.length === 0}
          />
        </div>
      ) : (
        !clause && <p className="ts-error-banner">함수조항 {code} 이(가) 없다 — 깨진 참조다.</p>
      )}
      {clause && clause.options.length === 0 && (clause.params ?? []).length === 0 && <p className="ts-muted">고를 옵션 · 연결할 인자가 없는 함수조항이다.</p>}
      {(clause?.params ?? []).map((p) => (
        <div key={`${clause!.code}-arg-${p.name}`} className="ts-form-row">
          <label htmlFor={`pop-arg-${p.name}`}>인자 {p.name}</label>
          <select id={`pop-arg-${p.name}`} name={`arg:${p.name}`} defaultValue={bindingValue(bindings?.[p.name])}>
            <option value="">{p.default ? `기본 연결 — ${bindingLabel(p.default, p.type, condition.discriminators, enumsOf(p.type), forms)}` : "— 연결 안 함(기본 연결 없음) —"}</option>
            {bindingOptions(p.type, condition.discriminators, enumsOf(p.type), forms, true, loops).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      {clause?.options.map((o) => (
        <div key={`${clause.code}-${o.code}`} className="ts-form-row">
          <label htmlFor={`pop-opt-${o.code}`}>{o.label}</label>
          <select id={`pop-opt-${o.code}`} name={`option:${o.code}`} defaultValue={options?.[o.code] ?? ""}>
            <option value="">— 미선택 —</option>
            {o.values.map((v) => (
              <option key={v.code} value={v.code}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </>
  );
}

/** 인자 연결 칸 → 연결 맵. 비운 칸(기본 연결)은 싣지 않는다. */
function bindingsOf(fd: FormData, clauses: readonly Clause[], code: Code = str(fd, "clauseCode")): Bindings {
  const clause = clauses.find((c) => c.code === code);
  const out: Bindings = {};
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("arg:")) continue;
    const name = key.slice("arg:".length);
    const param = clause?.params?.find((p) => p.name === name);
    const b = param ? bindingOfValue(String(value), param.type) : undefined;
    if (b) out[name] = b;
  }
  return out;
}

/** 연결 맵을 노드에 — 비었으면 키 없음. */
function withBindings<T extends object>(node: T, bindings: Bindings): T {
  return Object.keys(bindings).length > 0 ? { ...node, bindings } : node;
}

function optionsOf(fd: FormData): Record<Code, Code> {
  const out: Record<Code, Code> = {};
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("option:")) continue;
    const chosen = String(value).trim();
    if (chosen !== "") out[key.slice("option:".length)] = chosen;
  }
  return out;
}

/** 별표 고르기 — 이름 · 코드로 찾는다. 고치기로 열었는데 그 별표가 없어졌으면 코드 그대로 보인다. */
function AppendixSelect({ appendices, value }: { appendices: readonly Appendix[]; value?: Code }) {
  return (
    <div className="ts-form-row">
      <label htmlFor="pop-appendix">별표</label>
      <Combobox
        id="pop-appendix"
        name="appendixCode"
        defaultValue={value ?? ""}
        options={appendices.map((a) => ({ value: a.code, label: a.name, hint: a.code }))}
        placeholder={appendices.length === 0 ? "별표 없음" : "이름 · 코드로 찾기"}
        disabled={appendices.length === 0}
      />
    </div>
  );
}

const INSERT_TITLE = { slot: "치환 슬롯 넣기", articleRef: "조 참조 넣기", appendixRef: "별표 참조 넣기", clauseInlineRef: "함수조항(문장 안) 넣기", structKey: "구조 표기 넣기" } as const;

/**
 * 문장 안 조건 — 가지마다 머리 줄(`CondRows`, 그 자리에서 고친다) · 그 가지 문장(그 자리 편집기) · 가지 삭제, 아래에 가지 추가.
 * 툴바 「조건식」으로 막 넣은 칩이면 IF 머리 줄 첫 칸에 초점이 간다.
 */
function InlineCondPopup({ env, nodeId, anchor, onClose }: { env: PopupEnv; nodeId: Id; anchor: Anchor; onClose: () => void }) {
  const [focusFirst, setFocusFirst] = useState(true);
  const node = indexTree(env.tree).nodes.get(nodeId)?.node;
  if (!node || node.kind !== "inlineCond") return null;
  const hasElse = node.branches.some((b) => b.when === undefined);
  const b = nodeBuilders(env.newId);
  const elseIndex = node.branches.findIndex((br) => br.when === undefined);
  return (
    <Popover anchor={anchor} label="문장 안 조건" onClose={onClose} wide>
      <div onContextMenu={env.ctx.edit?.contextMenu}>
        {node.branches.map((br: InlineBranch, i) => {
          const label = i === 0 ? "IF" : br.when === undefined ? "ELSE" : "ELIF";
          const remove = (
            <IconButton className="ts-cond-rowbtn" icon={<IconTrash />} danger label={`${label} 가지 삭제`} disabled={node.branches.length <= 1} onClick={() => env.apply([{ type: "removeBranch", branchId: br.id }])} />
          );
          return (
            <div key={br.id} className="ts-pop-branch">
              {br.when === undefined ? (
                <div className="ts-cond-line">
                  <span className="ts-cond-badge">ELSE</span>
                  <span className="ts-muted">그 밖의 경우</span>
                  {remove}
                </div>
              ) : (
                <CondRows
                  label={label}
                  when={br.when}
                  context={env.condition}
                  onCommit={(source) => env.apply([{ type: "setWhen", branchId: br.id, when: source }])}
                  focus={i === 0 && focusFirst && br.when === ""}
                  onFocused={() => setFocusFirst(false)}
                  tools={remove}
                />
              )}
              <div className="ts-pop-branch-body ts-doc">
                <InlineSlot at={{ parentId: br.id }} nodes={br.children} ctx={env.ctx} placeholder={br.when === undefined ? "그 밖의 경우" : "참일 때"} />
              </div>
            </div>
          );
        })}
        <div className="ts-form-actions">
          <button type="button" onClick={() => env.apply([{ type: "addBranch", condId: node.id, branch: b.inlineBranch("", []), ...(elseIndex >= 0 ? { index: elseIndex } : {}) }])}>
            가지 추가(ELIF)
          </button>
          {!hasElse && (
            <button type="button" onClick={() => env.apply([{ type: "addBranch", condId: node.id, branch: b.inlineBranch(undefined, []) }])}>
              ELSE 가지 추가
            </button>
          )}
          <button type="button" className="primary" onClick={onClose}>
            닫기
          </button>
        </div>
        <p className="ts-muted">식은 머리 줄에서, 가지 문장은 그 자리에서 고친다 — 오른쪽 클릭으로 슬롯 · 참조를 넣는다. 고친 것은 편집본에 들어가고 저장해야 반영된다.</p>
      </div>
    </Popover>
  );
}

/**
 * 문장 안 값별 분기 (최종 결정 5) — 대상 고르기 · 칸 없는 값, 칸마다 머리(값 칩 · + 값 · 「문구 없음」 · 칸 삭제) + 그 칸 문장(그 자리 편집기), 아래에 칸 추가.
 * 모양은 블록 분기의 칸 머리와 같다(`CaseControls`).
 */
function InlineSwitchPopup({ env, nodeId, anchor, onClose }: { env: PopupEnv; nodeId: Id; anchor: Anchor; onClose: () => void }) {
  const node = indexTree(env.tree).nodes.get(nodeId)?.node;
  if (!node || node.kind !== "inlineCond" || node.switchOn === undefined) return null;
  const subjects = env.ctx.switchSubjects ?? [];
  const subject = subjects.find((s) => s.code === node.switchOn);
  const missing = unassignedValues(subject, node.branches);
  const onSubject = (code: string) => {
    const next = subjects.find((s) => s.code === code);
    if (!next) return;
    const keep = new Set(next.values.map((v) => v.code));
    env.apply([{ type: "setSwitch", nodeId: node.id, on: code }, ...node.branches.map((br) => ({ type: "setCase" as const, branchId: br.id, values: (br.values ?? []).filter((v) => keep.has(v)), empty: br.empty === true }))]);
  };
  return (
    <Popover anchor={anchor} label={SWITCH_WORD.inlineSwitch} onClose={onClose} wide>
      <div onContextMenu={env.ctx.edit?.contextMenu}>
        <div className="ts-doc-cond-head ts-switch-on is-edit">
          <span className="ts-cond-badge">{SWITCH_WORD.switch}</span>
          <select aria-label="값별 분기 대상" value={node.switchOn} onChange={(e) => onSubject(e.target.value)}>
            {!subject && <option value={node.switchOn}>{node.switchOn} (없는 대상)</option>}
            {subjects.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          {missing.length > 0 && (
            <span className="ts-cond-issue ts-switch-missing" role="note">
              {SWITCH_WORD.unassigned}: {missing.map((v) => v.label).join(" · ")}
            </span>
          )}
        </div>
        {node.branches.map((br: InlineBranch) => (
          <div key={br.id} className="ts-pop-branch">
            <div className="ts-doc-cond-head is-edit ts-switch-case">
              <span className="ts-cond-badge">{SWITCH_WORD.case}</span>
              <CaseControls subject={subject} branch={br} branches={node.branches} apply={env.apply} />
              <span className="ts-cond-tools">
                <IconButton className="ts-cond-rowbtn" icon={<IconTrash />} danger label="이 칸 삭제" disabled={node.branches.length <= 1} onClick={() => env.apply([{ type: "removeBranch", branchId: br.id }])} />
              </span>
            </div>
            {!br.empty && (
              <div className="ts-pop-branch-body ts-doc">
                <InlineSlot at={{ parentId: br.id }} nodes={br.children} ctx={env.ctx} placeholder="이 칸의 문구" />
              </div>
            )}
          </div>
        ))}
        <div className="ts-form-actions">
          <button type="button" onClick={() => env.apply([{ type: "addBranch", condId: node.id, branch: { id: env.newId(), values: missing[0] ? [missing[0].code] : [], children: [] } }])}>
            칸 추가
          </button>
          <button type="button" className="primary" onClick={onClose}>
            닫기
          </button>
        </div>
        <p className="ts-muted">칸마다 값을 고르고 그 칸 문구를 그 자리에서 쓴다 — 모든 값이 한 칸에 서야 저장된다. 아무것도 내지 않는 칸은 「{SWITCH_WORD.empty}」를 켠다.</p>
      </div>
    </Popover>
  );
}

/**
 * 블록 반복 넣기 · 원천 고치기 (ADR-0077 · 기능/문면 §4.3) — 원천 칸(자리에 맞는 후보만: 반복 밖 = 세목 선택지 · 합집합, 종 반복 안 = 현재 종의 목록) + 이름(비우면 원천에서).
 * 조 자리면 빈 항 하나를 든 반복, 호 목록 자리면 빈 반복이 선다(본문은 머리 줄 메뉴 「이 반복에 …」로).
 */
function RepeatBlockPopup({ env, spec, anchor, onClose }: { env: PopupEnv; spec: Extract<PopupSpec, { kind: "repeatBlock" }>; anchor: Anchor; onClose: () => void }) {
  const ix = indexTree(env.tree);
  const editing = spec.nodeId !== undefined ? ix.nodes.get(spec.nodeId)?.node : undefined;
  const node = editing?.kind === "forBlock" ? editing : undefined;
  const placeId = node ? node.id : spec.at?.parentId;
  const around = placeId !== undefined ? loopsAround(ix, placeId).filter((l) => l.id !== node?.id) : [];
  const choices = repeatChoices({ ...(around.at(-1) ? { outer: around.at(-1)! } : {}), depth: around.length, ...(env.enumOf ? { enumOf: env.enumOf } : {}) });
  const current = node && isRepeatSource(node.source) ? sourceValue(node.source) : "";
  const b = nodeBuilders(env.newId);
  // 호 목록 자리인가 — 항의 호 목록 · 호 목록 자리의 반복 블록 · 가지 안
  const parent = spec.at ? ix.nodes.get(spec.at.parentId) : undefined;
  const inItems = spec.at?.slot === "items" || (parent?.node.kind === "forBlock" && parent.allowed.includes("item")) || (spec.at ? ix.branches.get(spec.at.parentId)?.allowed.includes("item") === true : false);
  return (
    <Popover anchor={anchor} label={node ? "반복 원천" : "반복 블록 넣기"} onClose={onClose}>
      <PopForm
        env={env}
        onClose={onClose}
        build={(fd) => {
          const source = sourceOfValue(str(fd, "source"));
          if (!source) return "반복 원천을 고른다.";
          const alias = str(fd, "alias");
          if (node) return [{ type: "setFor", nodeId: node.id, source, alias }];
          if (!spec.at) return [];
          // 조 자리 반복은 쓸 항 하나를 든 채, 호 목록 자리 반복은 빈 채로 선다 — 호 목록 반복의 본문은 대개 「호」 함수조항이라 머리 줄 메뉴 「이 반복에 함수조항(호) 추가…」로 넣는다
          const children = inItems ? [] : [emptyNode("paragraph", env.newId) as never];
          return [{ type: "insert", node: b.forBlock(source, children, alias || undefined), at: spec.at }];
        }}
      >
        {choices.length === 0 ? (
          <p className="ts-muted">이 자리에는 반복 원천이 없다 — 반복 안 반복은 한 단계까지(안쪽은 바깥 종의 목록만).</p>
        ) : (
          <div className="ts-form-row">
            <label htmlFor="pop-repeat-source">반복 원천</label>
            <select id="pop-repeat-source" name="source" defaultValue={choices.some((c) => c.value === current) ? current : ""}>
              <option value="">— 고른다 —</option>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="ts-form-row">
          <label htmlFor="pop-repeat-alias">이름</label>
          <input id="pop-repeat-alias" type="text" name="alias" defaultValue={node?.alias ?? ""} placeholder="비우면 원천에서 짓는다(예: 납입면제종마다)" />
        </div>
        <p className="ts-muted">원소마다 본문을 복제한다 — 원소가 0 이면 블록이 없다. 반복 안에서는 현재 원소만 읽는다(함수조항 인자에 「현재 종 · 현재 원소」로 연결).</p>
        <PopActions onCancel={onClose} confirmLabel={node ? "적용" : "넣기"} />
      </PopForm>
    </Popover>
  );
}

/** 팝업 하나 — 종류대로. */
export function PopupHost({ env, spec, anchor, onClose }: { env: PopupEnv; spec: PopupSpec; anchor: Anchor; onClose: () => void }) {
  const { ctx } = env;
  const ix = indexTree(env.tree);
  const b = nodeBuilders(env.newId);
  /** 자리를 감싼 반복 → 인자 연결 칸의 「반복의 현재 원소」 후보 (ADR-0077 결정 3). */
  const loopsAt = (id: Id) => loopChoices(loopsAround(ix, id), env.enumOf ? { enumOf: env.enumOf } : {});
  /** 조 참조 자리의 값 한정 후보 — 감싼 열거값 반복(현재 값) · 반복 원소 열거형의 값(해당 값들, ADR-0077 결정 7). */
  const restrictAt = (id: Id | undefined): RestrictChoices => ({
    loops: id === undefined ? [] : loopsAt(id).filter((l) => l.type.kind === "enum").map((l) => ({ id: l.id, label: l.label })),
    values: [...repeatElementEnums()].flatMap((code) => (env.enumOf?.(code)?.values ?? []).map((v) => ({ code: v.code, label: v.label }))),
  });

  switch (spec.kind) {
    case "repeatBlock":
      return <RepeatBlockPopup env={env} spec={spec} anchor={anchor} onClose={onClose} />;

    case "insertInline": {
      const make = (fd: FormData): InlineNode | string => {
        switch (spec.what) {
          case "slot": {
            const ref = str(fd, "ref");
            return ref ? b.slot(ref) : "참조 경로(구분자)를 고른다.";
          }
          case "articleRef": {
            const r = articleRefOf(fd);
            if (r.targets.length === 0) return "참조할 대상을 하나 이상 고른다.";
            if (needsConnector(ctx, r.targets) && !r.connector) return CONNECTOR_PICK_MESSAGE;
            return { ...b.articleRef(r.targets, r.scope, r.connector) };
          }
          case "appendixRef": {
            const code = str(fd, "appendixCode");
            return code ? b.appendixRef(code) : "별표를 고른다.";
          }
          case "clauseInlineRef": {
            const code = str(fd, "clauseCode");
            return code ? withBindings(b.clauseInline(code, optionsOf(fd)), bindingsOf(fd, env.clauses)) : "함수조항을 고른다.";
          }
          case "structKey": {
            const level = str(fd, "structLevel");
            return level === "plan" || level === "coverage" || level === "subCoverage" || level === "benefit" ? b.structKey(level) : "구조 표기 레벨을 고른다.";
          }
        }
      };
      return (
        <Popover anchor={anchor} label={INSERT_TITLE[spec.what]} onClose={onClose} wide={spec.what === "articleRef"}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const node = make(fd);
              if (typeof node === "string") return node;
              const list = inlineListAt(env.latest(), spec.at);
              if (!list) return "문장 자리를 찾을 수 없다 — 다시 오른쪽 클릭한다.";
              return [{ type: "setInlines", at: spec.at, runs: runsFromTokens(list, spec.tokens, env.newId, node) }];
            }}
          >
            {spec.what === "slot" && (
              <div className="ts-form-row">
                <label htmlFor="pop-slot">참조 경로</label>
                <SlotRefInput id="pop-slot" name="ref" context={env.condition} />
              </div>
            )}
            {spec.what === "articleRef" && <ArticleRefFields ctx={ctx} restrict={restrictAt("tableId" in spec.at ? undefined : spec.at.parentId)} />}
            {spec.what === "appendixRef" && <AppendixSelect appendices={env.appendices} />}
            {spec.what === "clauseInlineRef" && <ClauseFields clauses={env.clauses} condition={env.condition} {...(env.enumOf ? { enumOf: env.enumOf } : {})} loops={"tableId" in spec.at ? [] : loopsAt(spec.at.parentId)} />}
            {spec.what === "structKey" && (
              <div className="ts-form-row">
                <label htmlFor="pop-struct">구조 표기</label>
                <select id="pop-struct" name="structLevel" defaultValue={spec.structLevels?.[0]}>
                  {(spec.structLevels ?? []).map((l) => (
                    <option key={l} value={l}>
                      {ATTACH_LEVEL_LABEL[l]} {STRUCT_KEY_CHIP[l]}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <PopActions onCancel={onClose} confirmLabel="넣기" />
          </PopForm>
        </Popover>
      );
    }

    case "editChip": {
      const node = ix.nodes.get(spec.nodeId)?.node as Node | undefined;
      if (!node) return null;
      if (node.kind === "inlineCond" && node.switchOn !== undefined) return <InlineSwitchPopup env={env} nodeId={node.id} anchor={anchor} onClose={onClose} />;
      if (node.kind === "inlineCond") return <InlineCondPopup env={env} nodeId={node.id} anchor={anchor} onClose={onClose} />;
      const title =
        node.kind === "slot" ? "치환 슬롯" : node.kind === "articleRef" ? "조 참조" : node.kind === "appendixRef" ? "별표 참조" : node.kind === "clauseInlineRef" || node.kind === "clauseBlockRef" ? (env.clauses.find((c) => c.code === node.clauseCode)?.params?.length ? "함수조항 옵션 · 인자" : "함수조항 옵션") : "고치기";
      return (
        <Popover anchor={anchor} label={title} onClose={onClose} wide={node.kind === "articleRef"}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd): EditOp[] | string => {
              switch (node.kind) {
                case "slot":
                  return [{ type: "setSlotRef", nodeId: node.id, ref: str(fd, "ref") }];
                case "articleRef": {
                  const r = articleRefOf(fd);
                  if (needsConnector(ctx, r.targets) && !r.connector) return CONNECTOR_PICK_MESSAGE;
                  return [{ type: "setArticleRef", nodeId: node.id, ...r }];
                }
                case "appendixRef":
                  return [{ type: "setAppendixRef", nodeId: node.id, appendixCode: str(fd, "appendixCode") }];
                case "clauseInlineRef":
                case "clauseBlockRef":
                  return [{ type: "setClauseOptions", nodeId: node.id, options: optionsOf(fd), bindings: bindingsOf(fd, env.clauses, node.clauseCode) }];
                default:
                  return [];
              }
            }}
          >
            {node.kind === "slot" && (
              <div className="ts-form-row">
                <label htmlFor="pop-slot">참조 경로</label>
                <SlotRefInput id="pop-slot" name="ref" initial={node.ref} context={env.condition} />
              </div>
            )}
            {node.kind === "articleRef" && <ArticleRefFields ctx={ctx} node={node} restrict={restrictAt(node.id)} />}
            {node.kind === "appendixRef" && <AppendixSelect appendices={env.appendices} value={node.appendixCode} />}
            {(node.kind === "clauseInlineRef" || node.kind === "clauseBlockRef") && <ClauseFields clauses={env.clauses} code={node.clauseCode} options={node.options} {...(node.bindings ? { bindings: node.bindings } : {})} condition={env.condition} {...(env.enumOf ? { enumOf: env.enumOf } : {})} loops={loopsAt(node.id)} />}
            <PopActions onCancel={onClose} />
          </PopForm>
        </Popover>
      );
    }

    case "newTable":
      return (
        <Popover anchor={anchor} label="표 넣기" onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => [{ type: "insert", node: newTable(Number(str(fd, "rows")), Number(str(fd, "cols")), fd.get("header") !== null, env.newId, str(fd, "title") || undefined), at: spec.at }]}
          >
            <div className="ts-form-row">
              <label htmlFor="pop-rows">행 수</label>
              <input id="pop-rows" type="number" name="rows" min={1} max={50} defaultValue={3} />
            </div>
            <div className="ts-form-row">
              <label htmlFor="pop-cols">열 수</label>
              <input id="pop-cols" type="number" name="cols" min={1} max={12} defaultValue={2} />
            </div>
            <div className="ts-form-row">
              <label htmlFor="pop-table-title">표 제목</label>
              <input id="pop-table-title" type="text" name="title" placeholder="없으면 비운다" />
            </div>
            <label className="ts-form-radio">
              <input type="checkbox" name="header" defaultChecked /> 첫 행을 제목줄로
            </label>
            <PopActions onCancel={onClose} confirmLabel="표 만들기" />
          </PopForm>
        </Popover>
      );

    case "clauseBlock":
      return (
        <Popover anchor={anchor} label={`함수조항(${spec.fit === "item" ? "호" : spec.fit === "subitem" ? "목" : "조 단위"}) 넣기`} onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const code = str(fd, "clauseCode");
              return code ? [{ type: "insert", node: withBindings(b.clauseBlock(code, optionsOf(fd)), bindingsOf(fd, env.clauses)), at: spec.at }] : "함수조항을 고른다.";
            }}
          >
            <ClauseFields clauses={clausesFitting(env.clauses, spec.fit)} condition={env.condition} {...(env.enumOf ? { enumOf: env.enumOf } : {})} loops={loopsAt(spec.at.parentId)} />
            <PopActions onCancel={onClose} confirmLabel="넣기" />
          </PopForm>
        </Popover>
      );

    case "boxPick":
      return (
        <Popover anchor={anchor} label="박스 넣기" onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const code = str(fd, "boxCode");
              return code ? [{ type: "insert", node: b.boxRef(code), at: spec.at }] : "박스를 고른다.";
            }}
          >
            {env.boxes.length === 0 ? (
              <p className="ts-muted">박스가 없다 — 정적 마스터 › 박스에서 만든다.</p>
            ) : (
              <div className="ts-form-row">
                <label htmlFor="pop-box">박스</label>
                <Combobox id="pop-box" name="boxCode" defaultValue="" options={env.boxes.map((x) => ({ value: x.code, label: x.name, hint: x.code }))} placeholder="이름 · 코드로 찾기" />
              </div>
            )}
            <PopActions onCancel={onClose} confirmLabel="넣기" />
          </PopForm>
        </Popover>
      );

    case "tableProps": {
      const t = ix.nodes.get(spec.tableId)?.node;
      if (!t || t.kind !== "table") return null;
      return (
        <Popover anchor={anchor} label="표 속성" onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const raw = str(fd, "widths");
              const widths = raw === "" ? [] : raw.split(",").map((w) => Math.round(Number(w.trim())));
              const columns = t.columns.map((_c, i) => (Number.isFinite(widths[i]) && widths[i] >= 1 && widths[i] <= 100 ? { width: widths[i] } : {}));
              return [{ type: "setTable", nodeId: t.id, ...(str(fd, "title") ? { title: str(fd, "title") } : {}), columns }];
            }}
          >
            <div className="ts-form-row">
              <label htmlFor="pop-t-title">표 제목</label>
              <input id="pop-t-title" type="text" name="title" defaultValue={t.title ?? ""} placeholder="없으면 비운다" />
            </div>
            <div className="ts-form-row">
              <label htmlFor="pop-t-widths">열 너비 %</label>
              <input id="pop-t-widths" type="text" name="widths" className="ts-mono" defaultValue={t.columns.map((c) => c.width ?? "").join(",")} placeholder="예: 30,70 (빈칸은 자동)" />
            </div>
            <p className="ts-muted">행 · 열 · 제목줄은 셀을 누르면 뜨는 조작 줄에서 바꾼다.</p>
            <PopActions onCancel={onClose} />
          </PopForm>
        </Popover>
      );
    }

    case "repeat": {
      const t = ix.nodes.get(spec.tableId)?.node;
      if (!t || t.kind !== "table") return null;
      return (
        <Popover anchor={anchor} label="행 반복" onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const depth = str(fd, "repeat");
              return [{ type: "setTableRepeat", nodeId: t.id, ...(depth === "1" || depth === "2" ? { repeat: { depth: Number(depth) as 1 | 2 } } : {}) }];
            }}
          >
            <div className="ts-form-row">
              <label htmlFor="pop-repeat">행 반복</label>
              <select id="pop-repeat" name="repeat" defaultValue={t.repeat ? String(t.repeat.depth) : ""}>
                <option value="">없음</option>
                <option value="1">{REPEAT_DEPTH_LABEL[1].option}</option>
                <option value="2">{REPEAT_DEPTH_LABEL[2].option}</option>
              </select>
            </div>
            <p className="ts-muted">머리글이 아닌 행이 템플릿이 되어 담보의 세부보장(› 급부)마다 복제된다.</p>
            <PopActions onCancel={onClose} />
          </PopForm>
        </Popover>
      );
    }

    case "link": {
      const a = ix.nodes.get(spec.articleId)?.node;
      if (!a || a.kind !== "article") return null;
      return (
        <Popover anchor={anchor} label="조연결" onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const linked = str(fd, "linkedArticleId");
              return [{ type: "link", articleId: a.id, ...(linked ? { linkedArticleId: linked } : {}) }];
            }}
          >
            <div className="ts-form-row">
              <label htmlFor="pop-link">보통약관의 조</label>
              <Combobox
                id="pop-link"
                name="linkedArticleId"
                defaultValue={a.linkedArticleId ?? ""}
                placeholder="— 연결 없음 — (조 번호 · 제목으로 찾기)"
                options={[
                  { value: "", label: "연결 없음" },
                  ...[...ctx.references.general].filter(([, t]) => t.kind === "article").map(([nodeId, target]): ComboOption => ({ value: nodeId, label: referenceTargetLabel(target) })),
                ]}
              />
            </div>
            {ctx.references.general.size === 0 && <p className="ts-muted">대응 보통약관을 먼저 고른다 — 더보기 › 대응 보통약관.</p>}
            <PopActions onCancel={onClose} />
          </PopForm>
        </Popover>
      );
    }

    case "docTitle":
      return (
        <Popover anchor={anchor} label="템플릿 이름" onClose={onClose}>
          <PopForm env={env} onClose={onClose} build={(fd) => (str(fd, "title") ? [{ type: "setTitle", nodeId: env.tree.id, title: str(fd, "title") }] : "이름을 쓴다.")}>
            <div className="ts-form-row">
              <label htmlFor="pop-doc-title">템플릿 이름</label>
              <input id="pop-doc-title" type="text" name="title" defaultValue={env.tree.title} />
            </div>
            <PopActions onCancel={onClose} />
          </PopForm>
        </Popover>
      );

    case "general": {
      const proposed = env.generalDocumentId === undefined && env.suggestedGeneralId !== undefined;
      return (
        <Popover anchor={anchor} label="대응 보통약관" onClose={onClose}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const picked = str(new FormData(e.currentTarget), "generalDocumentId");
              env.setGeneral(picked === "" ? undefined : picked);
              onClose();
            }}
          >
            <div className="ts-form-row">
              <label htmlFor="pop-general">대응 보통약관</label>
              <span className="ts-form-control">
                <Combobox
                  id="pop-general"
                  name="generalDocumentId"
                  defaultValue={env.generalDocumentId ?? env.suggestedGeneralId ?? ""}
                  placeholder="— 해제 — (이름으로 찾기)"
                  options={[{ value: "", label: "해제" }, ...env.generals.map((g) => ({ value: g.id, label: g.title, hint: DOC_KIND_LABEL.general }))]}
                />
                {proposed && <span className="ts-badge proposed">제안값 — 확인하고 저장해야 확정</span>}
              </span>
            </div>
            <p className="ts-muted">조연결 · 보통약관 조 참조의 대상이 이 템플릿의 조로 바뀐다. 해제는 그 둘이 하나도 없을 때만.</p>
            <PopActions onCancel={onClose} />
          </form>
        </Popover>
      );
    }
  }
}
