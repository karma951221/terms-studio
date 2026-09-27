"use client";

/**
 * 그 자리 팝업들 (기능/문면 §4.3) — 칩 · 조건 머리를 누르거나 오른쪽 클릭 메뉴에서 고르면 그 자리 바로 아래에 뜬다.
 *
 * 팝업의 확인은 편집본에 곧바로 명령을 적용한다(서버로 가지 않는다 — ADR-0074). 원본 반영은 바의 `저장` 한 번.
 * 조건식은 지금의 구조화 팝업(`ConditionDialog`)을 그대로 쓴다 — 텍스트 식 입력은 없다(ADR-0066). 바뀐 것은 뜨는 자리뿐이다.
 * 우측 패널에는 입력칸이 없다 — 여기가 입력칸이 뜨는 유일한 자리다.
 */
import { useState, type FormEvent, type ReactNode } from "react";

import { DOC_KIND_LABEL, REPEAT_DEPTH_LABEL, STRUCT_KEY_CHIP } from "@/app/_lib/labels";
import type { Clause } from "@/domain/clause";
import {
  indexTree,
  nodeBuilders,
  referenceTargetLabel,
  type Appendix,
  type ArticleRefNode,
  type DocumentNode,
  type EditOp,
  type IdSource,
  type InlineBranch,
  type InlineNode,
  type Node,
} from "@/domain/document";
import { ATTACH_LEVEL_LABEL, REFERENCE_CONNECTORS, isReferenceConnector, type Code, type Id, type ReferenceConnector } from "@/domain/types";

import { str } from "../../lib";
import { ConditionDialog } from "./condition/ConditionDialog";
import { ConditionEditor } from "./condition/ConditionEditor";
import { SlotRefInput } from "./condition/SlotRefInput";
import type { ConditionContext } from "./condition/types";
import { anchorOf, chipText, type Anchor, type DocCtx } from "./ctx";
import { inlineListAt, newTable, wrapOps } from "./editOps";
import { InlineSlot } from "./Inline";
import { runsFromTokens } from "./inlineRuns";
import type { PopupSpec } from "./menus";
import { PopActions, Popover } from "./Popover";
import { RefTargetTree } from "./RefTargetTree";

export interface PopupEnv {
  ctx: DocCtx;
  /** 지금 편집본 트리 (그리기용). */
  tree: DocumentNode;
  /** 누르는 순간의 편집본 트리 — 확인 때 명령을 만든다. */
  latest: () => DocumentNode;
  apply: (ops: readonly EditOp[]) => boolean;
  newId: IdSource;
  appendices: readonly Appendix[];
  clauses: readonly Clause[];
  generals: readonly { id: Id; title: string }[];
  generalDocumentId?: Id;
  suggestedGeneralId?: Id;
  setGeneral: (generalDocumentId: Id | undefined) => void;
  /** 이 자리에서 여는 조건 팝업 · 슬롯 트리의 문맥 (반복 표 템플릿 셀이면 「현재 행」 가지). */
  condition: ConditionContext;
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

/** 조 참조 칸 — 범위 · 대상(여럿) · 연결어. 넣기와 고치기가 같이 쓴다. */
function ArticleRefFields({ ctx, node }: { ctx: DocCtx; node?: ArticleRefNode }) {
  const [count, setCount] = useState(node?.targets.length ?? 0);
  // 고른 연결어 — 대상이 하나로 줄었다 다시 늘어도 기억한다 (고치기면 저장된 값에서 시작)
  const [connector, setConnector] = useState<ReferenceConnector>(node?.connector ?? "및");
  const joins = count >= 2;
  // 범위가 고정이면(공용조항 — 보통약관 조만) 범위 고르기 · 이 템플릿 후보가 없다
  const fixed = ctx.articleRefScope;
  return (
    <>
      {fixed && <input type="hidden" name="scope" value={fixed} />}
      {!fixed && ctx.docKind === "special" && (
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
          id="pop-ref-targets"
          defaultSelected={node?.targets.map((t) => t.nodeId) ?? []}
          onCountChange={setCount}
          scopes={
            fixed
              ? [{ key: "general", label: "보통약관", index: ctx.references.general }]
              : ctx.docKind === "special"
                ? [
                    { key: "self", label: "이 템플릿", index: ctx.references.self },
                    { key: "general", label: "대응 보통약관", index: ctx.references.general },
                  ]
                : [{ key: "self", index: ctx.references.self }]
          }
        />
      </div>
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
              ? "마지막 대상 앞에 붙는다. 번호가 잇달아 셋 이상이면 「제3조부터 제5조까지」로 묶이고, 분기로 빠진 대상은 산출 때 제외된다."
              : "대상을 둘 이상 고르면 고를 수 있다."}
          </p>
        </div>
      </div>
    </>
  );
}

function articleRefOf(fd: FormData): { targets: { nodeId: Id }[]; connector: ReferenceConnector; scope: ArticleRefNode["scope"] } {
  const targets = fd
    .getAll("targets")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .map((nodeId) => ({ nodeId }));
  // 대상이 하나 이하면 라디오가 꺼져 값이 오지 않는다 — 도메인 기본값 「및」(표기에 안 나온다)을 둔다
  const connector = targets.length >= 2 ? str(fd, "connector") : "";
  return { targets, connector: isReferenceConnector(connector) ? (connector as ReferenceConnector) : "및", scope: str(fd, "scope") === "general" ? "general" : "self" };
}

/** 공용조항 칸 — 공용조항을 고르면 그 옵션마다 선택지. 옵션 선택은 사용처(이 문서) 소유다 (기능/공용조항 §3.2). */
function ClauseFields({ clauses, code, options }: { clauses: readonly Clause[]; code?: Code; options?: Record<Code, Code> }) {
  const [picked, setPicked] = useState<Code>(code ?? clauses[0]?.code ?? "");
  const clause = clauses.find((c) => c.code === picked);
  return (
    <>
      {code === undefined ? (
        <div className="ts-form-row">
          <label htmlFor="pop-clause">공용조항</label>
          <select id="pop-clause" name="clauseCode" value={picked} onChange={(e) => setPicked(e.target.value)}>
            {clauses.length === 0 && <option value="">공용조항 없음</option>}
            {clauses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}({c.code})
              </option>
            ))}
          </select>
        </div>
      ) : (
        !clause && <p className="ts-error-banner">공용조항 {code} 이(가) 없다 — 깨진 참조다.</p>
      )}
      {clause && clause.options.length === 0 && <p className="ts-muted">고를 옵션이 없는 공용조항이다.</p>}
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

function optionsOf(fd: FormData): Record<Code, Code> {
  const out: Record<Code, Code> = {};
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("option:")) continue;
    const chosen = String(value).trim();
    if (chosen !== "") out[key.slice("option:".length)] = chosen;
  }
  return out;
}

function AppendixSelect({ appendices, value }: { appendices: readonly Appendix[]; value?: Code }) {
  return (
    <div className="ts-form-row">
      <label htmlFor="pop-appendix">별표</label>
      <select id="pop-appendix" name="appendixCode" defaultValue={value ?? appendices[0]?.code ?? ""}>
        {appendices.length === 0 && <option value="">별표 없음</option>}
        {appendices.map((a) => (
          <option key={a.code} value={a.code}>
            {a.name}({a.code})
          </option>
        ))}
      </select>
    </div>
  );
}

const INSERT_TITLE = { slot: "치환 슬롯 넣기", articleRef: "조 참조 넣기", appendixRef: "별표 참조 넣기", clauseInlineRef: "공용조항(문장 안) 넣기", inlineCond: "문장 안 조건 넣기", structKey: "구조 표기 넣기" } as const;

/** 문장 안 조건 고치기 — 가지마다 조건(누르면 조건 팝업) · 그 가지 문장(그 자리 편집기) · 가지 삭제, 아래에 가지 추가. */
function InlineCondPopup({ env, nodeId, anchor, onClose }: { env: PopupEnv; nodeId: Id; anchor: Anchor; onClose: () => void }) {
  const [cond, setCond] = useState<{ branchId?: Id; anchor: Anchor }>();
  const node = indexTree(env.tree).nodes.get(nodeId)?.node;
  if (!node || node.kind !== "inlineCond") return null;
  const hasElse = node.branches.some((b) => b.when === undefined);
  const b = nodeBuilders(env.newId);
  const elseIndex = node.branches.findIndex((br) => br.when === undefined);
  return (
    <Popover anchor={anchor} label="문장 안 조건" onClose={onClose} wide>
      <div onContextMenu={env.ctx.edit?.contextMenu}>
        {node.branches.map((br: InlineBranch, i) => (
          <div key={br.id} className="ts-pop-branch">
            <span className="ts-doc-cond-head">{i === 0 ? "IF" : br.when === undefined ? "ELSE" : "ELIF"}</span>{" "}
            {br.when !== undefined && (
              <button type="button" className="ts-cond-chip-edit ts-mono" onClick={(e) => setCond({ branchId: br.id, anchor: anchorOf(e.currentTarget) })}>
                {chipText(br.when, "edit", env.ctx.refLabel).full}
              </button>
            )}
            <div className="ts-pop-branch-body ts-doc">
              <InlineSlot at={{ parentId: br.id }} nodes={br.children} ctx={env.ctx} placeholder={i === 0 ? "참일 때 문장" : "그 밖의 경우 문장"} />
            </div>
            <button type="button" className="danger" disabled={node.branches.length <= 1} onClick={() => env.apply([{ type: "removeBranch", branchId: br.id }])}>
              가지 삭제
            </button>
          </div>
        ))}
        <div className="ts-form-actions">
          <button type="button" onClick={(e) => setCond({ anchor: anchorOf(e.currentTarget) })}>
            가지 추가(ELIF)…
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
        <p className="ts-muted">가지 문장은 그 자리에서 고친다 — 오른쪽 클릭으로 슬롯 · 참조를 넣는다. 고친 것은 편집본에 들어가고 저장해야 반영된다.</p>
      </div>
      {cond && (
        <ConditionDialog
          open
          anchor={cond.anchor}
          context={env.condition}
          initial={cond.branchId ? node.branches.find((x) => x.id === cond.branchId)?.when : undefined}
          onCancel={() => setCond(undefined)}
          onConfirm={(source) => {
            const ok = cond.branchId
              ? env.apply([{ type: "setWhen", branchId: cond.branchId, when: source }])
              : env.apply([{ type: "addBranch", condId: node.id, branch: b.inlineBranch(source, []), ...(elseIndex >= 0 ? { index: elseIndex } : {}) }]);
            if (ok) setCond(undefined);
          }}
        />
      )}
    </Popover>
  );
}

/** 팝업 하나 — 종류대로. */
export function PopupHost({ env, spec, anchor, onClose }: { env: PopupEnv; spec: PopupSpec; anchor: Anchor; onClose: () => void }) {
  const { ctx } = env;
  const ix = indexTree(env.tree);
  const b = nodeBuilders(env.newId);

  switch (spec.kind) {
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
            return { ...b.articleRef(r.targets.map((t) => t.nodeId), r.scope, r.connector) };
          }
          case "appendixRef": {
            const code = str(fd, "appendixCode");
            return code ? b.appendixRef(code) : "별표를 고른다.";
          }
          case "clauseInlineRef": {
            const code = str(fd, "clauseCode");
            return code ? b.clauseInline(code, optionsOf(fd)) : "공용조항을 고른다.";
          }
          case "inlineCond": {
            const when = str(fd, "when");
            if (!when) return "조건식을 만든다.";
            // 넣는 문장은 앞뒤 공백을 자르지 않는다 — 슬롯 앞뒤 한 칸을 문장이 들고 있다 (§3.8)
            const thenText = String(fd.get("thenText") ?? "");
            const elseText = String(fd.get("elseText") ?? "");
            return b.inlineCond([b.inlineBranch(when, thenText ? [b.text(thenText)] : []), b.inlineBranch(undefined, elseText ? [b.text(elseText)] : [])]);
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
            {spec.what === "articleRef" && <ArticleRefFields ctx={ctx} />}
            {spec.what === "appendixRef" && <AppendixSelect appendices={env.appendices} />}
            {spec.what === "clauseInlineRef" && <ClauseFields clauses={env.clauses} />}
            {spec.what === "inlineCond" && (
              <>
                <div className="ts-form-row">
                  <span className="ts-form-label">조건식</span>
                  <ConditionEditor name="when" context={env.condition} startOpen />
                </div>
                <div className="ts-form-row">
                  <label htmlFor="pop-then">참일 때</label>
                  <input id="pop-then" type="text" name="thenText" placeholder="조건이 맞을 때 문장" defaultValue={spec.prefill} />
                </div>
                <div className="ts-form-row">
                  <label htmlFor="pop-else">아닐 때</label>
                  <input id="pop-else" type="text" name="elseText" placeholder="그 밖의 경우 문장" />
                </div>
              </>
            )}
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
      if (node.kind === "inlineCond") return <InlineCondPopup env={env} nodeId={node.id} anchor={anchor} onClose={onClose} />;
      const title =
        node.kind === "slot" ? "치환 슬롯" : node.kind === "articleRef" ? "조 참조" : node.kind === "appendixRef" ? "별표 참조" : node.kind === "clauseInlineRef" || node.kind === "clauseBlockRef" ? "공용조항 옵션" : "고치기";
      return (
        <Popover anchor={anchor} label={title} onClose={onClose} wide={node.kind === "articleRef"}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd): EditOp[] | string => {
              switch (node.kind) {
                case "slot":
                  return [{ type: "setSlotRef", nodeId: node.id, ref: str(fd, "ref") }];
                case "articleRef":
                  return [{ type: "setArticleRef", nodeId: node.id, ...articleRefOf(fd) }];
                case "appendixRef":
                  return [{ type: "setAppendixRef", nodeId: node.id, appendixCode: str(fd, "appendixCode") }];
                case "clauseInlineRef":
                case "clauseBlockRef":
                  return [{ type: "setClauseOptions", nodeId: node.id, options: optionsOf(fd) }];
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
            {node.kind === "articleRef" && <ArticleRefFields ctx={ctx} node={node} />}
            {node.kind === "appendixRef" && <AppendixSelect appendices={env.appendices} value={node.appendixCode} />}
            {(node.kind === "clauseInlineRef" || node.kind === "clauseBlockRef") && <ClauseFields clauses={env.clauses} code={node.clauseCode} options={node.options} />}
            <PopActions onCancel={onClose} />
          </PopForm>
        </Popover>
      );
    }

    case "when": {
      const br = ix.branches.get(spec.branchId);
      if (!br) return null;
      return (
        <ConditionDialog
          open
          anchor={anchor}
          context={env.condition}
          initial={br.branch.when}
          onCancel={onClose}
          onConfirm={(source) => {
            if (env.apply([{ type: "setWhen", branchId: spec.branchId, when: source }])) onClose();
          }}
        />
      );
    }

    case "wrap":
      return (
        <ConditionDialog
          open
          anchor={anchor}
          context={env.condition}
          onCancel={onClose}
          onConfirm={(source) => {
            const ops = wrapOps(env.latest(), spec.nodeId, source, env.newId);
            if (ops.length > 0 && env.apply(ops)) onClose();
          }}
        />
      );

    case "addBranch": {
      const owner = ix.nodes.get(spec.condId)?.node;
      if (!owner || (owner.kind !== "condBlock" && owner.kind !== "inlineCond")) return null;
      const elseIndex = owner.branches.findIndex((x) => x.when === undefined);
      return (
        <ConditionDialog
          open
          anchor={anchor}
          context={env.condition}
          onCancel={onClose}
          onConfirm={(source) => {
            const branch = owner.kind === "inlineCond" ? b.inlineBranch(source, []) : b.branch(source, []);
            if (env.apply([{ type: "addBranch", condId: spec.condId, branch, ...(elseIndex >= 0 ? { index: elseIndex } : {}) }])) onClose();
          }}
        />
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
        <Popover anchor={anchor} label="공용조항(조 단위) 넣기" onClose={onClose}>
          <PopForm
            env={env}
            onClose={onClose}
            build={(fd) => {
              const code = str(fd, "clauseCode");
              return code ? [{ type: "insert", node: b.clauseBlock(code, optionsOf(fd)), at: spec.at }] : "공용조항을 고른다.";
            }}
          >
            <ClauseFields clauses={env.clauses} />
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
              <select id="pop-link" name="linkedArticleId" defaultValue={a.linkedArticleId ?? ""}>
                <option value="">— 연결 없음 —</option>
                {[...ctx.references.general]
                  .filter(([, t]) => t.kind === "article")
                  .map(([nodeId, target]) => (
                    <option key={nodeId} value={nodeId}>
                      {referenceTargetLabel(target)}
                    </option>
                  ))}
              </select>
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
                <select id="pop-general" name="generalDocumentId" defaultValue={env.generalDocumentId ?? env.suggestedGeneralId ?? ""}>
                  <option value="">— 해제 —</option>
                  {env.generals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}({DOC_KIND_LABEL.general})
                    </option>
                  ))}
                </select>
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
