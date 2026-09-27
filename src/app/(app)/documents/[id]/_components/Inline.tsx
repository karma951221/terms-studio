"use client";

/**
 * 문장 자리 — 읽기면 명조 글 + 칩, 편집이면 **그 자리 편집기** (기능/문면 §4.3).
 *
 * - 문장 자리 하나(항 · 호 · 목의 문장 · 문장 안 조건의 가지 · 표 셀)가 contentEditable 하나다. 글은 그대로 치고,
 *   칩(슬롯 · 조 참조 · 별표 참조 · 공용조항 · 문장 안 조건 · 구조 표기)은 고칠 수 없는 덩어리로 들어 있다 — 누르면 바로 아래에 팝업.
 * - 초점이 떠나면 DOM 을 읽어 `setInlines` 한 명령으로 편집본에 넣는다(「적용」 단계 없음). 저장은 바의 `저장` 하나.
 * - Enter 는 아래에 새 항(호 · 목), 빈 칸에서 Backspace 는 그 항을 지운다. 붙여넣기는 글만 — 표 셀에 탭 · 줄로 나뉜 글이면 셀을 채운다.
 * - 목록이 바뀌면(적용 · 다른 조작) 편집기를 새로 그린다(key) — 사용자가 고친 DOM 과 React 가 엇갈리지 않게.
 */
import { Fragment, useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";

import { STRUCT_KEY_CHIP } from "@/app/_lib/labels";
import { referenceChunkLabel, type ArticleRefNode, type InlineAt, type InlineNode, type ReferenceTarget } from "@/domain/document";
import type { Id } from "@/domain/types";

import { anchorOf, chipText, encodeAt, type DocCtx } from "./ctx";
import type { Token } from "./inlineRuns";

function articleRefText(node: ArticleRefNode, ctx: DocCtx): string {
  // 편집기 미리보기 — 조립과 같은 덩어리 규칙(기능/문면 §3.5). 전체 뷰 번호라 분기 결과는 반영되지 않는다.
  const index = node.scope === "general" ? ctx.references.general : ctx.references.self;
  const alive: ReferenceTarget[] = [];
  let broken = 0;
  for (const { nodeId } of node.targets) {
    const target = index.get(nodeId);
    if (target) alive.push(target);
    else broken += 1;
  }
  const joined = alive.length === 0 ? (broken > 0 ? "없는 조(연결 끊김)" : "대상 없음") : referenceChunkLabel(alive, node.connector);
  return `${node.scope === "general" ? "보통약관 " : ""}${joined}${alive.length > 0 && broken > 0 ? ` (연결 끊김 ${broken}건)` : ""}`;
}

const CHIP_WHAT: Record<string, string> = {
  slot: "치환 슬롯",
  articleRef: "조 참조",
  appendixRef: "별표 참조",
  clauseInlineRef: "공용조항(문장 안)",
  inlineCond: "문장 안 조건",
  inlineFor: "문장 안 반복",
  structKey: "구조 표기",
};

/** 칩 하나의 글자 · 모양 · tooltip. 읽기와 편집이 같이 쓴다. */
function chipParts(node: InlineNode, ctx: DocCtx): { className: string; title: string; body: ReactNode; what?: string } {
  const custom = ctx.chipOverride?.(node);
  if (custom) return custom;
  switch (node.kind) {
    case "slot": {
      const ev = ctx.slotEval?.get(node.id);
      const shown = ev?.kind === "value" ? String(ev.value) : node.ref;
      const why = ev?.kind === "undetermined" ? ` — 아직 정해지지 않았다 (${ev.reason})` : ev?.kind === "error" ? ` — ${ev.issue.message}` : "";
      return { className: "ts-doc-slot", title: `치환 슬롯 · ${node.ref}${why}`, body: shown };
    }
    case "articleRef":
      return { className: "ts-doc-ref", title: "조 참조 슬롯 — 번호는 계산값이다", body: articleRefText(node, ctx) };
    case "appendixRef":
      return { className: "ts-doc-ref", title: `별표 참조 · ${node.appendixCode}`, body: `【별표 ${ctx.appendixName.get(node.appendixCode) ?? `${node.appendixCode}(없는 별표)`}】` };
    case "clauseInlineRef":
      return {
        className: "ts-doc-ref",
        title: `공용조항(문장 안) · ${node.clauseCode} · ${ctx.optionText(node.clauseCode, node.options)}`,
        body: `〔${ctx.clauseLabel.get(node.clauseCode) ?? `${node.clauseCode}(없는 공용조항)`}〕`,
      };
    case "structKey":
      return { className: "ts-doc-ref", title: "구조 표기 — 행마다 그 행의 노드 이름이 찍힌다", body: STRUCT_KEY_CHIP[node.level] };
    case "inlineFor":
      return { className: "ts-muted", title: "문장 안 반복 — 아직 지원하지 않는다", body: "(문장 안 반복 — 아직 지원하지 않는다)" };
    case "inlineCond":
      // 편집 모드의 문장 안 조건은 칩 하나 — 가지마다 머리(IF … / ELSE) + 그 가지 문장 (§4.3)
      return {
        className: "ts-doc-inline-chip",
        title: `문장 안 조건 — ${node.branches.map((br) => chipText(br.when, "edit", ctx.refLabel).full).join(" │ ")}`,
        body: node.branches.map((br, i) => (
          <Fragment key={br.id}>
            {i > 0 && <span className="ts-doc-inline-sep"> │ </span>}
            <span className="ts-doc-inline-head">{i === 0 ? "IF " : br.when === undefined ? "ELSE " : "ELIF "}{br.when === undefined ? "" : chipText(br.when, "edit", ctx.refLabel).text}</span>{" "}
            <InlineView nodes={br.children} ctx={{ ...ctx, mode: "read", edit: undefined }} />
          </Fragment>
        )),
      };
    default:
      return { className: "", title: "", body: null };
  }
}

/** 읽기 — 글과 칩. 문장 안 조건은 **점선 밑줄만**(칩 · 배경 없음), 조건식은 tooltip. */
export function InlineView({ nodes, ctx }: { nodes: readonly InlineNode[]; ctx: DocCtx }): ReactNode {
  return nodes.map((node) => {
    if (node.kind === "text") return <Fragment key={node.id}>{node.text}</Fragment>;
    if (node.kind === "inlineCond") {
      return (
        <Fragment key={node.id}>
          {node.branches.map((br, i) => {
            const state = ctx.branchEval?.get(br.id)?.state;
            return (
              <span
                key={br.id}
                data-node={br.id}
                className={`ts-doc-inline-cond${i === 0 ? "" : " is-alt"}${state === "notTaken" ? " ts-dim" : ""}${ctx.flashId === br.id ? " is-flash" : ""}`}
                title={`문장 안 조건 — ${chipText(br.when, "edit", ctx.refLabel).full}`}
              >
                <InlineView nodes={br.children} ctx={ctx} />
              </span>
            );
          })}
        </Fragment>
      );
    }
    const { className, title, body } = chipParts(node, ctx);
    return (
      <span key={node.id} data-node={node.id} className={`${className}${ctx.flashId === node.id ? " is-flash" : ""}`} title={title}>
        {body}
      </span>
    );
  });
}

/** 커서 자리 — 화면 좌표에서 (오른쪽 클릭한 곳). */
export function caretFromPoint(x: number, y: number): { node: globalThis.Node; offset: number } | undefined {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: globalThis.Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
}

/**
 * 편집기 DOM → 조각 목록. 칩은 `data-chip`, 그 밖의 요소는 속 글만 읽는다. `caret` 을 주면 그 자리에 커서 조각.
 * `cutTo` 를 주면(같은 글자 노드 안의 끝 자리) 커서부터 거기까지의 글을 빼고 읽는다 — 고른 글을 칩으로 바꿀 때.
 */
export function tokensOf(root: HTMLElement, caret?: { node: globalThis.Node; offset: number }, cutTo?: number): Token[] {
  const out: Token[] = [];
  let placed = false;
  const put = () => {
    if (!placed) {
      out.push({ caret: true });
      placed = true;
    }
  };
  const walk = (el: globalThis.Node) => {
    el.childNodes.forEach((child, i) => {
      if (caret && caret.node === el && caret.offset === i) put();
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (caret && caret.node === child) {
          out.push({ text: text.slice(0, caret.offset) });
          put();
          out.push({ text: text.slice(cutTo !== undefined && cutTo > caret.offset ? cutTo : caret.offset) });
        } else out.push({ text });
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      const chip = child.dataset.chip;
      if (chip) {
        out.push({ chip });
        if (caret && child.contains(caret.node)) put();
        return;
      }
      if (child.tagName === "BR") return;
      walk(child);
    });
    if (caret && caret.node === el && caret.offset >= el.childNodes.length) put();
  };
  walk(root);
  return out;
}

function caretToEnd(el: HTMLElement) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * 문장 자리 하나 — 읽기면 `InlineView`, 편집이면 contentEditable 편집기.
 * `owner` 는 Enter · Backspace 가 다루는 항 · 호 · 목 (가지 · 셀이면 없다). `focusKey` 는 초점 요청을 알아볼 이름(보통 owner).
 */
export function InlineSlot({
  at,
  nodes,
  ctx,
  owner,
  focusKey,
  placeholder = "문장을 쓴다",
}: {
  at: InlineAt;
  nodes: readonly InlineNode[];
  ctx: DocCtx;
  owner?: Id;
  focusKey?: Id;
  placeholder?: string;
}) {
  if (!ctx.edit) return <InlineView nodes={nodes} ctx={ctx} />;
  return <InlineEditor key={JSON.stringify(nodes)} at={at} nodes={nodes} ctx={ctx} owner={owner} focusKey={focusKey ?? owner} placeholder={placeholder} />;
}

function InlineEditor({ at, nodes, ctx, owner, focusKey, placeholder }: { at: InlineAt; nodes: readonly InlineNode[]; ctx: DocCtx; owner?: Id; focusKey?: Id; placeholder: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const edit = ctx.edit!;
  const cell = "tableId" in at ? at : undefined;
  const active = cell && edit.activeCell?.tableId === cell.tableId && edit.activeCell.row === cell.row && edit.activeCell.col === cell.col;

  useEffect(() => {
    if (focusKey && edit.focusRequest === focusKey && ref.current) {
      caretToEnd(ref.current);
      edit.focusDone();
    }
  }, [edit, focusKey]);

  const commit = () => {
    if (ref.current) edit.commitInline(at, tokensOf(ref.current));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    if (e.key === "Enter") {
      e.preventDefault();
      if (owner) {
        commit();
        edit.enter(owner);
      }
      return;
    }
    if (e.key === "Backspace" && owner && (el.textContent ?? "") === "" && !el.querySelector("[data-chip]")) {
      if (edit.removeEmpty(owner)) e.preventDefault();
      return;
    }
    if (e.key === "Escape") el.blur();
  };

  const onPaste = (e: ClipboardEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (cell && edit.pasteGrid(cell, text)) return;
    document.execCommand("insertText", false, text.replace(/\r?\n/g, " "));
  };

  return (
    <span
      ref={ref}
      className={`ts-inl${active ? " is-active" : ""}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={placeholder}
      data-inline={encodeAt(at)}
      data-placeholder={placeholder}
      onBlur={commit}
      onFocus={() => edit.focusInline(at)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      {nodes.map((node) => {
        if (node.kind === "text") return <Fragment key={node.id}>{node.text}</Fragment>;
        const { className, title, body, what } = chipParts(node, ctx);
        const state = node.kind === "inlineCond" ? node.branches.map((br) => ctx.branchEval?.get(br.id)?.state) : [];
        return (
          <span
            key={node.id}
            contentEditable={false}
            data-chip={node.id}
            data-node={node.id}
            className={`${className} ts-chip-inline${state.includes("notTaken") ? " has-dim" : ""}${ctx.flashId === node.id ? " is-flash" : ""}`}
            title={`${what ?? CHIP_WHAT[node.kind] ?? node.kind} — 눌러서 고치기 · 풀기 · 삭제는 툴바 (${title})`}
            onClick={(event) => {
              event.preventDefault();
              if (node.kind !== "structKey" && node.kind !== "inlineFor") edit.popup({ kind: "editChip", nodeId: node.id }, anchorOf(event.currentTarget));
            }}
          >
            {body}
          </span>
        );
      })}
    </span>
  );
}

/**
 * 제목 · 박스 줄처럼 글만 있는 자리 — 읽기면 글, 편집이면 그 자리에서 친다. 초점이 떠나면 `onCommit`.
 * 한 줄이면 Enter 가 마침, 여러 줄이면 Enter 가 줄바꿈. Escape 는 되돌리고 마친다.
 */
export function EditableText({
  value,
  editing,
  onCommit,
  label,
  multiline,
  className,
  placeholder,
}: {
  value: string;
  editing: boolean;
  onCommit: (next: string) => void;
  label: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}) {
  if (!editing) return <span className={className}>{value}</span>;
  return (
    <span
      key={value}
      className={`ts-inl${multiline ? " is-multiline" : ""}${className ? ` ${className}` : ""}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label={label}
      data-placeholder={placeholder ?? label}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.currentTarget.textContent = value;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const raw = multiline ? e.currentTarget.innerText : (e.currentTarget.textContent ?? "");
        const next = multiline ? raw.replace(/ /g, " ") : raw.replace(/ /g, " ").replace(/[\r\n]/g, "");
        if (next !== value) onCommit(next);
      }}
    >
      {value}
    </span>
  );
}
