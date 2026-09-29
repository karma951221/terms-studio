"use client";

/**
 * L3 가운데 — 문면을 **문서 세계**로 그린다 (디자인원칙 §1.1 · 기능/문면 §4.3).
 *
 * - 가운데는 **조 하나**다(`ArticleBody`) — 조 위에 소속 관 머리 줄, 조를 감싼 블록 조건이 있으면 그 띠와 머리 줄.
 *   약관 전체를 이어 읽는 것(`DocBody`)은 더보기 › 미리보기와 사전평가 결과 조문만 쓴다.
 * - 읽기 모드에는 조작이 없다. 편집 모드에서는 **그 자리가 편집기**다 — 제목 · 문장 · 조건 머리 줄은 그 자리에서 고치고, 칩은 누르면
 *   바로 아래에 팝업, 넣기 · 이동 · 복제 · 삭제 · 조건식은 본문 위 툴바(자리는 `data-*` 로 읽는다, 오른쪽 클릭 메뉴는 지름길). 블록마다 붙던 버튼 줄은 없다.
 * - 조건 블록은 테두리 상자(배경 없음)다 — 가지마다 머리 줄(IF / ELIF / ELSE) + 그 아래 내용. 편집 모드의 머리 줄은 늘 열린 조건식 줄
 *   (`CondRows` — 변수 · 연산자 · 값, ⊕ ⊖)과 끝의 작은 버튼(ELIF · ELSE · 풀기 · 삭제)이다. 팝업 없음 (2026-09-28).
 * - 공용조항(조 단위)은 머리 띠 「공용조항 (이름)」 + 🗑 · 그 아래 공용조항의 **모델**(슬롯 · 옵션 자리 · 조건 · 참조, 읽기 전용)을 든 상자다.
 *   미리보기(`clauseView: "text"`)만 고른 선택지를 끼운 문장으로 그린다 — 가운데 = 모델, 오른쪽 = 결과 (2026-09-28).
 * - 노드 id·8자리 접두를 화면에 내보내지 않는다 (리뷰 #25).
 */
import type { MouseEvent, ReactNode } from "react";

import { IconButton, IconTrash } from "@/app/_components/icons";
import { StaticTable } from "@/app/_components/StaticNodes";
import { REPEAT_DEPTH_LABEL } from "@/app/_lib/labels";
import {
  CLAUSE_HOST_ITEM_ID,
  CLAUSE_HOST_PARAGRAPH_ID,
  CLAUSE_LINE_ID,
  clauseBodyToTree,
  numberTree,
  optionCodeOf,
  referenceTargetLabel,
  type ArticleNode,
  type BlockBranch,
  type ClauseBlockRefNode,
  type DocumentNode,
  type InlineNode,
  type Node,
  type TableNode,
  type TreeIndex,
} from "@/domain/document";
import type { Id } from "@/domain/types";

import { BoxView } from "@/app/_components/BoxView";
import { ClauseModel, clauseEditHref } from "@/app/_components/ClauseModel";

import { parseLines } from "../../lib";
import { CondRows } from "./condition/CondRows";
import { anchorOf, chipText, type DocCtx } from "./ctx";
import { EditableText, InlineSlot } from "./Inline";
import type { MenuItem } from "./menus";

const flash = (ctx: DocCtx, id: Id) => `${ctx.flashId === id ? " is-flash" : ""}${ctx.edit?.blockSel?.includes(id) ? " is-block-sel" : ""}`;

/**
 * 블록 손잡이(⠿) — 편집 모드에서 블록 왼쪽 여백에 선다. 끌면 옮기고(`useBlockDrag`), 누르면 그 블록을 고른다 · Shift 면 잇닿은 형제까지.
 * 글자 칸 밖이라 문장 편집(커서 · 선택)과 겹치지 않는다.
 */
function DragHandle({ id, what, ctx }: { id: Id; what: string; ctx: DocCtx }) {
  const select = ctx.edit?.selectBlock;
  if (!select) return null;
  return (
    <span
      className="ts-drag"
      draggable
      data-drag={id}
      role="button"
      aria-label={`${what} 끌어 옮기기`}
      title="끌어 옮기기 — 누르면 고르기 · Shift 로 여럿"
      contentEditable={false}
      onClick={(e) => select(id, e.shiftKey)}
    >
      <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true" focusable="false">
        {[2, 7, 12].flatMap((y) => [1.5, 6.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}
      </svg>
    </span>
  );
}

/** 머리 줄 끝의 작은 버튼 — 그 가지 자리의 목록(툴바와 같은 목록)에서 이름으로 고른다. */
/** IF 머리 줄에만 — 가지 추가 · ELSE · 풀기. 뒤 가지(ELIF · ELSE) 머리 줄은 「이 가지 삭제」만. */
const HEAD_TOOLS: { match: (label: string) => boolean; text: string; title: string }[] = [
  { match: (l) => l === "가지 추가(ELIF)", text: "+ELIF", title: "가지 추가(ELIF) — 빈 조건 줄과 빈 항을 든 가지" },
  { match: (l) => l === "ELSE 가지 추가", text: "+ELSE", title: "ELSE 가지 추가 — 그 밖의 경우" },
  { match: (l) => l.startsWith("조건 풀기"), text: "풀기", title: "조건 풀기 — 이 가지 내용만 남긴다" },
];

function HeadTools({ ctx, branch, first }: { ctx: DocCtx; branch: BlockBranch; first: boolean }) {
  const edit = ctx.edit!;
  const items = edit.headItems(branch.id);
  const run = (item: MenuItem | undefined) => (e: MouseEvent<HTMLElement>) => item && edit.run(item, anchorOf(e.currentTarget));
  const removeBlock = items.find((i) => i.label === "조건 블록 삭제");
  const removeBranch = items.find((i) => i.label === "이 가지 삭제");
  return (
    <span className="ts-cond-tools">
      {(first ? HEAD_TOOLS : []).map((t) => {
        const item = items.find((i) => t.match(i.label) && !i.disabled);
        if (!item) return null;
        return (
          <button key={t.text} type="button" className="ts-cond-mini" title={t.title} onClick={run(item)}>
            {t.text}
          </button>
        );
      })}
      {first ? (
        removeBlock && <IconButton className="ts-cond-rowbtn" icon={<IconTrash />} danger label="조건 블록 삭제" onClick={run(removeBlock)} />
      ) : (
        removeBranch && <IconButton className="ts-cond-rowbtn" icon={<IconTrash />} danger label="이 가지 삭제" onClick={run(removeBranch)} />
      )}
    </span>
  );
}

/**
 * 블록 조건 가지의 머리 줄 — 읽기 모드는 `IF 조건식` 한 줄(글자), 편집 모드는 그 자리에서 고치는 조건식 줄(`CondRows`).
 * `data-cond-head` 는 툴바 · 오른쪽 클릭이 자리(조건 가지)를 읽는 표지다.
 */
function CondHead({ ctx, branch, label, first }: { ctx: DocCtx; branch: BlockBranch; label: string; first: boolean }) {
  const { text, full } = chipText(branch.when, ctx.mode, ctx.refLabel);
  const state = ctx.branchEval?.get(branch.id)?.state;
  const suffix = state === "taken" ? " · 참" : state === "notTaken" ? " · 거짓" : state === "undetermined" ? " · 미결" : state === "error" ? " · 오류" : "";
  const edit = ctx.edit;
  if (!edit || !ctx.conditionFor) {
    return (
      <p className="ts-doc-cond-head" title={full}>
        <span className="ts-cond-badge">{label}</span>
        {branch.when === undefined ? "" : ` ${text}`}
        {suffix}
      </p>
    );
  }
  const tools = <HeadTools ctx={ctx} branch={branch} first={first} />;
  return (
    <div className="ts-doc-cond-head is-edit" data-cond-head={branch.id}>
      {branch.when === undefined ? (
        <div className="ts-cond-rows">
          <div className="ts-cond-line">
            <span className="ts-cond-badge">{label}</span>
            <span className="ts-muted">그 밖의 경우</span>
            {tools}
          </div>
        </div>
      ) : (
        <CondRows
          label={label}
          when={branch.when}
          context={ctx.conditionFor(branch.id)}
          onCommit={(source) => edit.apply([{ type: "setWhen", branchId: branch.id, when: source }])}
          focus={edit.focusRequest === branch.id}
          onFocused={edit.focusDone}
          tools={tools}
        />
      )}
    </div>
  );
}

const branchLabel = (branches: readonly { when?: string }[], i: number) => (i === 0 ? "IF" : branches[i].when === undefined ? "ELSE" : "ELIF");

/** 표 셀의 조작 줄 — 누른 셀의 표 바로 위에 뜬다(셀을 가리지 않게). 담보약관이면 「이 행 반복…」. */
function CellToolbar({ ctx, table, row, col }: { ctx: DocCtx; table: TableNode; row: number; col: number }) {
  const edit = ctx.edit!;
  const header = table.rows[row]?.header === true;
  const run = (ops: Parameters<typeof edit.apply>[0], next?: { row: number; col: number }) => {
    if (edit.apply(ops)) edit.setActiveCell(next ? { tableId: table.id, ...next } : undefined);
  };
  const b = (label: string, onClick: (e: MouseEvent<HTMLButtonElement>) => void, disabled = false, danger = false) => (
    <button type="button" className={danger ? "danger" : undefined} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
  return (
    <span className="ts-cell-bar" role="toolbar" aria-label={`${row + 1}행 ${col + 1}열 셀 조작`}>
      <span className="ts-cell-bar-at">
        {row + 1}행 {col + 1}열
      </span>
      {b("위에 행", () => run([{ type: "insertTableRow", tableId: table.id, index: row }], { row: row + 1, col }))}
      {b("아래에 행", () => run([{ type: "insertTableRow", tableId: table.id, index: row + 1 }], { row, col }))}
      {b("왼쪽 열", () => run([{ type: "insertTableColumn", tableId: table.id, index: col }], { row, col: col + 1 }))}
      {b("오른쪽 열", () => run([{ type: "insertTableColumn", tableId: table.id, index: col + 1 }], { row, col }))}
      {b(header ? "제목줄 해제" : "제목줄로", () => run([{ type: "setTableRowHeader", tableId: table.id, index: row, header: !header }], { row, col }))}
      {b("행 삭제", () => run([{ type: "removeTableRow", tableId: table.id, index: row }]), table.rows.length <= 1, true)}
      {b("열 삭제", () => run([{ type: "removeTableColumn", tableId: table.id, index: col }]), table.columns.length <= 1, true)}
      {ctx.docKind === "special" && !header && b("이 행 반복…", (e) => edit.popup({ kind: "repeat", tableId: table.id }, anchorOf(e.currentTarget)))}
    </span>
  );
}

/**
 * 정적 표 · 행 반복 표 (기능/문면 §3.2 · ADR-0070 결정 6).
 * - 미리보기(`ctx.tables`)에 펼침 결과가 있으면 펼친 표(복제 행 · 병합)를, 행 0 이면 회색 「표 생략됨」 자리를 그린다.
 * - 그 밖에는 템플릿 그대로 — 반복 표면 템플릿 행 왼쪽에 for 띠. 편집 모드면 셀마다 그 자리 편집기.
 */
function Table({ node, ctx }: { node: TableNode; ctx: DocCtx }) {
  const evaluated = ctx.tables?.get(node.id);
  if (evaluated?.kind === "omitted") {
    return (
      <figure id={`node-${node.id}`} className="ts-doc-table-wrap ts-muted" style={{ border: "1px dashed var(--ts-rule-strong)", padding: "8px 12px", color: "var(--ts-ink-3)" }}>
        표 생략됨{node.title ? ` — ${node.title}` : ""} (반복할 행이 없다 — 산출본에는 이 표가 나오지 않는다)
      </figure>
    );
  }
  const source = evaluated?.kind === "expanded" ? evaluated.expansion.table : node;
  const editing = ctx.edit !== undefined && evaluated === undefined;
  const active = ctx.edit?.activeCell?.tableId === node.id ? ctx.edit.activeCell : undefined;
  const shape = {
    ...source,
    rows: source.rows.map((row, ri) => ({
      ...row,
      cells: row.cells.map((cell, ci) =>
        editing ? (
          <span key={ci} className="ts-cell">
            <InlineSlot at={{ tableId: node.id, row: ri, col: ci }} nodes={cell} ctx={ctx} placeholder={`${ri + 1}행 ${ci + 1}열`} />
          </span>
        ) : (
          <InlineSlot key={ci} at={{ tableId: node.id, row: ri, col: ci }} nodes={cell} ctx={ctx} />
        ),
      ),
    })),
  };
  const band = node.repeat && evaluated?.kind !== "expanded" ? REPEAT_DEPTH_LABEL[node.repeat.depth].band : undefined;
  return (
    <div className={editing ? "ts-table-edit" : undefined}>
      {/* 셀 조작 줄은 표 바로 위에 뜬다 — 셀을 가리지 않는다 */}
      {editing && active && node.rows[active.row]?.cells[active.col] && <CellToolbar ctx={ctx} table={node} row={active.row} col={active.col} />}
      <StaticTable node={shape} {...(band ? { band } : {})} />
      {evaluated?.kind === "error" && <p className="ts-error-banner">{evaluated.issue.message}</p>}
    </div>
  );
}

/** 【용어풀이】 박스 — 편집 모드면 제목 · 줄을 그 자리에서. */
function Box({ node, ctx }: { node: Node & { kind: "box" }; ctx: DocCtx }) {
  const edit = ctx.edit;
  return (
    <aside id={`node-${node.id}`} className="ts-doc-box">
      <p className="ts-doc-box-title">
        【<EditableText value={node.title} editing={!!edit} label="박스 제목" onCommit={(title) => edit?.setBox(node.id, title, node.lines)} />】
      </p>
      {edit ? (
        <EditableText value={node.lines.join("\n")} editing multiline label="박스 줄" className="ts-doc-box-line" onCommit={(text) => edit.setBox(node.id, node.title, parseLines(text))} />
      ) : (
        node.lines.map((l, i) => (
          <p key={i} className="ts-doc-box-line">
            {l}
          </p>
        ))
      )}
    </aside>
  );
}

/** 공용조항 옵션 자리(운반체) → 사용처가 고른 선택지 문구. 안 골랐으면 〔옵션명〕. */
function optionChip(clause: { options: readonly { code: string; label: string; values: readonly { code: string; label: string; body: readonly { kind: string; text?: string }[] }[] }[] }, chosen: Record<string, string>) {
  return (node: InlineNode) => {
    const code = optionCodeOf(node);
    if (code === undefined) return undefined;
    const option = clause.options.find((o) => o.code === code);
    const value = option?.values.find((v) => v.code === chosen[code]);
    const text = value ? value.body.map((n) => n.text ?? "").join("") || value.label : undefined;
    return {
      className: "ts-doc-ref",
      what: "옵션 자리",
      title: option ? `옵션 자리 — ${option.label}${value ? ` · ${value.label}` : " · 미선택"}` : "없는 옵션",
      body: text ?? `〔${option?.label ?? code}〕`,
    };
  };
}

/**
 * 공용조항(조 단위) 블록 — 머리 띠 「공용조항 (이름)」 · 옵션 선택(편집이면 눌러서 고치기) · 「공용조항에서 고치기 →」 · 🗑,
 * 그 아래 공용조항의 모델(`ClauseModel` — 읽기 전용). 미리보기(`clauseView: "text"`)는 고른 선택지를 끼운 문장이다.
 * 본문 안은 이 문서의 자리가 아니다 — `data-clause-ref` 가 누른 자리를 이 블록으로 모은다(`place.ts`).
 */
function ClauseBlock({ node, ctx }: { node: ClauseBlockRefNode; ctx: DocCtx }) {
  const edit = ctx.edit;
  const clause = ctx.clauses?.find((c) => c.code === node.clauseCode);
  const label = ctx.clauseLabel.get(node.clauseCode) ?? clause?.label;
  const options = ctx.optionText(node.clauseCode, node.options);
  const hasOptions = !clause || clause.options.length > 0;
  const asText = ctx.clauseView === "text";
  let body: ReactNode = <p className="ts-muted">{label ? "본문을 불러오지 않았다." : `${node.clauseCode} — 없는 함수조항이다(깨진 참조).`}</p>;
  if (clause && asText) {
    // 미리보기 — 고른 선택지 문구를 끼운 문장 (조립 결과와 같은 읽기)
    const tree = clauseBodyToTree(clause.mode, clause.body, clause.label);
    const nodes = tree.children[0]?.kind === "article" ? tree.children[0].children : [];
    const inner: DocCtx = { ...ctx, mode: "read", edit: undefined, numbers: numberTree(tree), branchEval: undefined, flashId: undefined, chipOverride: optionChip(clause, node.options) };
    const line = clause.mode === "inline" ? nodes.find((n) => n.id === CLAUSE_LINE_ID) : undefined;
    // 「호」 · 「목」 — 자리 항(· 자리 호)은 번호 단계가 아니라 그 목록만 그린다
    const host = nodes.find((n) => n.id === CLAUSE_HOST_PARAGRAPH_ID);
    const hostItems = host?.kind === "paragraph" ? (host.items ?? []) : [];
    const hostItem = hostItems.find((n) => n.id === CLAUSE_HOST_ITEM_ID);
    const list = clause.mode === "item" ? hostItems : clause.mode === "subitem" && hostItem?.kind === "item" ? (hostItem.subitems ?? []) : undefined;
    body =
      clause.body.length === 0 ? (
        <p className="ts-muted">본문이 비어 있다.</p>
      ) : line && line.kind === "paragraph" ? (
        <p className="ts-doc-paragraph is-line">
          <InlineSlot at={{ parentId: line.id }} nodes={line.children} ctx={inner} />
        </p>
      ) : list ? (
        <ol className={clause.mode === "item" ? "ts-doc-items" : "ts-doc-subitems"}>
          <Block nodes={list} ctx={inner} inList />
        </ol>
      ) : (
        <Block nodes={nodes} ctx={inner} />
      );
  } else if (clause) {
    // 가운데(모델) — 공용조항이 어떻게 짜였는지: 슬롯 · 옵션 자리(선택지 전부 + 고른 것) · 조건 · 참조 (2026-09-28)
    body = (
      <ClauseModel
        clause={clause}
        selected={node.options}
        references={ctx.docKind === "general" ? ctx.references.self : ctx.references.general}
        appendixName={(code) => ctx.appendixName.get(code)}
        boxOf={ctx.boxOf}
        exprText={(source) => chipText(source, "edit", ctx.refLabel).full}
      />
    );
  }
  return (
    <div className={`ts-doc-clause${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id} data-clause-ref={node.id}>
      <DragHandle id={node.id} what="함수조항" ctx={ctx} />
      <div className="ts-doc-clause-head">
        <span className="ts-doc-clause-name" title={`함수조항(조 단위) · ${node.clauseCode}`}>
          함수조항 ({label ?? `${node.clauseCode} — 없는 함수조항`})
        </span>
        {hasOptions &&
          (edit ? (
            <button type="button" className="ts-doc-clause-opt" title="옵션 고치기" onClick={(e) => edit.popup({ kind: "editChip", nodeId: node.id }, anchorOf(e.currentTarget))}>
              {options}
            </button>
          ) : (
            <span className="ts-doc-clause-opt">{options}</span>
          ))}
        {clause && !asText && (
          <a className="ts-doc-clause-link" href={clauseEditHref(clause.code)} target="_blank" rel="noopener" title="함수조항 화면을 새 탭으로 연다 — 본문 · 옵션은 거기서 고친다">
            함수조항에서 고치기 →
          </a>
        )}
        {edit && (
          <IconButton
            className="ts-doc-clause-del"
            icon={<IconTrash />}
            danger
            label={`함수조항 ${label ?? node.clauseCode} 삭제`}
            onClick={(e) => edit.run({ label: "삭제", action: { do: "remove", nodeId: node.id } }, anchorOf(e.currentTarget))}
          />
        )}
      </div>
      <div className="ts-doc-clause-body">{body}</div>
    </div>
  );
}

/** 블록 조건 — 가지마다 테두리 상자 + 머리 줄. 첫 가지는 실선(IF), 나머지는 파선(ELIF · ELSE). */
function CondBlock({ node, ctx, as }: { node: Node & { kind: "condBlock" }; ctx: DocCtx; as: "div" | "li" }) {
  const Tag = as;
  return (
    <>
      {node.branches.map((br, i) => {
        const dim = ctx.branchEval?.get(br.id)?.state === "notTaken";
        return (
          <Tag
            key={br.id}
            data-node={br.id}
            data-drop-block={node.id}
            className={`ts-doc-cond${i === 0 ? "" : " is-alt"}${dim ? " ts-dim" : ""}${flash(ctx, br.id)}${ctx.edit?.blockSel?.includes(node.id) ? " is-block-sel" : ""}`}
            style={dim ? { textDecoration: "line-through" } : undefined}
          >
            {i === 0 && <DragHandle id={node.id} what="조건 블록" ctx={ctx} />}
            <CondHead ctx={ctx} branch={br} label={branchLabel(node.branches, i)} first={i === 0} />
            <Block nodes={br.children} ctx={ctx} inList={as === "li"} />
          </Tag>
        );
      })}
    </>
  );
}

/**
 * 항·호·목·조건 블록 — 자리에 맞는 태그로. `data-block` 은 툴바 · 오른쪽 클릭 메뉴가 자리를 읽는 표지다(`place.ts`).
 * 공용조항 화면도 이것으로 본문(항 목록)을 그린다 — 조 머리 없이 (기능/함수조항 §4.3).
 */
export function Block({ nodes, ctx, inList }: { nodes: readonly Node[]; ctx: DocCtx; inList?: boolean }): ReactNode {
  return nodes.map((node) => {
    switch (node.kind) {
      case "paragraph": {
        const num = ctx.numbers.get(node.id);
        return (
          <div key={node.id} className={`ts-doc-paragraph${num?.label ? "" : " is-bare"}${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what={num ? `제${num.n}항` : "항"} ctx={ctx} />
            {num?.label ? <span className="ts-doc-num">{num.label}</span> : null} <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="항" />
            {(node.items ?? []).length > 0 && (
              <ol className="ts-doc-items">
                <Block nodes={node.items ?? []} ctx={ctx} inList />
              </ol>
            )}
          </div>
        );
      }

      case "item":
        return (
          <li key={node.id} className={`ts-doc-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="호" ctx={ctx} />
            <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="호" />
            {(node.subitems ?? []).length > 0 && (
              <ol className="ts-doc-subitems">
                <Block nodes={node.subitems ?? []} ctx={ctx} inList />
              </ol>
            )}
          </li>
        );

      case "subitem":
        return (
          <li key={node.id} className={`ts-doc-subitem${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="목" ctx={ctx} />
            <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="목" />
          </li>
        );

      // 글머리 목록 — 번호 없는 「-」 항목(번호 계산에 들지 않는다). 항목마다 그 자리 편집기, Enter 로 다음 항목 (2026-09-28)
      case "bullet":
        return (
          <li key={node.id} className={`ts-doc-bullet${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="항목" ctx={ctx} />
            <InlineSlot at={{ parentId: node.id }} nodes={node.children} ctx={ctx} owner={node.id} placeholder="항목" />
          </li>
        );

      case "bulletList": {
        const body = (
          <ul className="ts-doc-bullets">
            <Block nodes={node.children} ctx={ctx} inList />
          </ul>
        );
        return inList ? (
          <li key={node.id} className={`ts-doc-static-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="글머리 목록" ctx={ctx} />
            {body}
          </li>
        ) : (
          <div key={node.id} className={`ts-doc-static${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="글머리 목록" ctx={ctx} />
            {body}
          </div>
        );
      }

      case "clauseBlockRef":
        // 호 목록 자리(항 · 호 뒤)의 공용조항은 「박스」 — 목록 안이면 <li> 로 감싼다
        return inList ? (
          <li key={node.id} className="ts-doc-static-item">
            <ClauseBlock node={node} ctx={ctx} />
          </li>
        ) : (
          <ClauseBlock key={node.id} node={node} ctx={ctx} />
        );

      case "condBlock":
        return <CondBlock key={node.id} node={node} ctx={ctx} as={inList ? "li" : "div"} />;

      // 정적 표·박스 — 항·호 뒤에 붙는 번호 없는 블록 (기능/문면 §3.2). 목록 자리면 <li> 로 감싼다.
      case "table": {
        const body = <Table node={node} ctx={ctx} />;
        return inList ? (
          <li key={node.id} className={`ts-doc-static-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="표" ctx={ctx} />
            {body}
          </li>
        ) : (
          <div key={node.id} className={`ts-doc-static${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="표" ctx={ctx} />
            {body}
          </div>
        );
      }
      case "box": {
        const body = <Box node={node} ctx={ctx} />;
        return inList ? (
          <li key={node.id} className={`ts-doc-static-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="박스" ctx={ctx} />
            {body}
          </li>
        ) : (
          <div key={node.id} className={`ts-doc-static${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="박스" ctx={ctx} />
            {body}
          </div>
        );
      }

      // 정적 마스터 박스 참조 — 박스 마스터의 내용을 그대로 그린다(여기서 고치지 않는다 — 박스 화면에서, 기능/박스 §4.4)
      case "boxRef": {
        const body = <BoxView code={node.boxCode} box={ctx.boxOf?.(node.boxCode)} />;
        return inList ? (
          <li key={node.id} className={`ts-doc-static-item${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="박스" ctx={ctx} />
            {body}
          </li>
        ) : (
          <div key={node.id} className={`ts-doc-static${flash(ctx, node.id)}`} data-block={node.id} data-node={node.id}>
            <DragHandle id={node.id} what="박스" ctx={ctx} />
            {body}
          </div>
        );
      }

      case "section":
        return (
          <section key={node.id} id={`sec-${node.id}`} className="ts-doc-section">
            <SectionHead node={node} ctx={ctx} />
            <Block nodes={node.children} ctx={ctx} />
          </section>
        );

      case "forBlock":
        return (
          <div key={node.id} className="ts-muted" data-block={node.id} data-node={node.id}>
            (반복 블록 — 아직 지원하지 않는다)
          </div>
        );

      case "article":
        return <Article key={node.id} node={node} ctx={ctx} />;

      default:
        return null;
    }
  });
}

/** 관 머리 줄 — 「제N관 제목」. 편집 모드면 제목을 그 자리에서 고친다. */
function SectionHead({ node, ctx }: { node: Node & { kind: "section" }; ctx: DocCtx }) {
  const num = ctx.numbers.get(node.id);
  return (
    <h2 className={`ts-doc-section-title${flash(ctx, node.id)}`} data-section-title={node.id} data-node={node.id}>
      {num?.label ?? "관"} <EditableText value={node.title} editing={!!ctx.edit} label="관 제목" onCommit={(title) => ctx.edit?.setTitle(node.id, title)} />
    </h2>
  );
}

/** 조연결은 조 바로 위 평문이다 (「이 조가 보통약관 어디를 따라가나」는 조와 같이 읽힌다). 편집 모드면 눌러서 고친다. */
function ArticleLink({ article, ctx }: { article: ArticleNode; ctx: DocCtx }) {
  const target = article.linkedArticleId ? ctx.references.general.get(article.linkedArticleId) : undefined;
  const text = `조연결 — 보통약관 ${target ? referenceTargetLabel(target) : "에 없는 조 (연결이 끊겼다)"}`;
  if (!ctx.edit) {
    return (
      <p className="ts-doc-cond-head" title="조연결 — 이 조가 대응 보통약관의 어느 조를 따라가는가">
        {text}
      </p>
    );
  }
  const edit = ctx.edit;
  return (
    <p>
      <button type="button" className="ts-doc-cond-head ts-doc-cond-btn" title="조연결 고치기" onClick={(e) => edit.popup({ kind: "link", articleId: article.id }, anchorOf(e.currentTarget))}>
        {text}
      </button>
    </p>
  );
}

function Article({ node, ctx }: { node: ArticleNode; ctx: DocCtx }) {
  const num = ctx.numbers.get(node.id);
  const label = num?.label ?? "조";
  return (
    <section id={`art-${node.id}`} className="ts-doc-article" data-article={node.id}>
      {node.linkedArticleId !== undefined && <ArticleLink article={node} ctx={ctx} />}
      <h3 className={`ts-doc-article-title${flash(ctx, node.id)}`} data-article-title={node.id} data-node={node.id}>
        {label}(<EditableText value={node.title} editing={!!ctx.edit} label="조 제목" onCommit={(title) => ctx.edit?.setTitle(node.id, title)} />)
      </h3>
      {node.children.length === 0 && ctx.edit ? (
        <p className="ts-muted ts-doc-hint">항이 없다 — 툴바의 「항」으로 넣는다.</p>
      ) : (
        <Block nodes={node.children} ctx={ctx} />
      )}
    </section>
  );
}

/**
 * 가운데 — 조 하나. 조의 조상(관 · 블록 조건 가지)을 바깥부터 감싼다: 관이면 머리 줄, 가지면 왼쪽 띠 + 머리 줄.
 * 같은 조건 블록의 다른 가지에 든 조는 목차에서 따로 연다.
 */
export function ArticleBody({ index, articleId, ctx }: { index: TreeIndex; articleId: Id; ctx: DocCtx }) {
  const entry = index.nodes.get(articleId);
  if (!entry || entry.node.kind !== "article") return null;
  let content: ReactNode = <Article node={entry.node} ctx={ctx} />;
  const ancestors = entry.path.slice(1, -1);
  for (const id of [...ancestors].reverse()) {
    const br = index.branches.get(id);
    if (br) {
      const owner = index.nodes.get(br.ownerId)?.node as { branches: BlockBranch[] } | undefined;
      const dim = ctx.branchEval?.get(id)?.state === "notTaken";
      content = (
        <div data-node={id} className={`ts-doc-cond${br.index === 0 ? "" : " is-alt"}${dim ? " ts-dim" : ""}${flash(ctx, id)}`}>
          <CondHead ctx={ctx} branch={br.branch as BlockBranch} label={branchLabel(owner?.branches ?? [], br.index)} first={br.index === 0} />
          {content}
        </div>
      );
      continue;
    }
    const n = index.nodes.get(id)?.node;
    if (n?.kind === "section") {
      content = (
        <section id={`sec-${n.id}`} className="ts-doc-section">
          <SectionHead node={n} ctx={ctx} />
          {content}
        </section>
      );
    }
  }
  return <article className="ts-doc">{content}</article>;
}

/** 문서 하나 전체 — 더보기 › 미리보기 · 사전평가 결과 조문 (읽기 전용). */
export function DocBody({ tree, ctx }: { tree: DocumentNode; ctx: DocCtx }) {
  const read: DocCtx = { ...ctx, mode: "read", edit: undefined };
  return (
    <article className="ts-doc">
      <h2 className="ts-doc-title">{tree.title}</h2>
      {tree.children.length === 0 ? <p className="ts-muted">아직 조가 하나도 없다.</p> : <Block nodes={tree.children} ctx={read} />}
    </article>
  );
}

