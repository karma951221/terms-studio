"use client";

/**
 * 문장 자리 — 읽기면 명조 글 + 칩, 편집이면 **그 자리 편집기** (기능/문면 §4.3).
 *
 * - 문장 자리 하나(항 · 호 · 목의 문장 · 문장 안 조건의 가지 · 표 셀)가 contentEditable 하나다. 글은 그대로 치고,
 *   칩(슬롯 · 조 참조 · 별표 참조 · 함수조항 · 문장 안 조건 · 구조 표기)은 고칠 수 없는 덩어리로 들어 있다 — 누르면 바로 아래에 팝업.
 * - 초점이 떠나면 DOM 을 읽어 `setInlines` 한 명령으로 편집본에 넣는다(「적용」 단계 없음). 저장은 바의 `저장` 하나.
 * - Enter 는 아래에 새 항(호 · 목), 빈 칸에서 Backspace 는 그 항을 지운다. 붙여넣기는 글만 — 표 셀에 탭 · 줄로 나뉜 글이면 셀을 채운다.
 * - 목록이 바뀌면(적용 · 다른 조작) 편집기를 새로 그린다(key) — 사용자가 고친 DOM 과 React 가 엇갈리지 않게.
 */
import { Fragment, useEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";

import { STRUCT_KEY_CHIP, SWITCH_WORD } from "@/app/_lib/labels";
import { referenceChunkLabel, referenceKeyIndex, refKey, type ArticleRefNode, type InlineAt, type InlineNode, type ReferenceTarget } from "@/domain/document";
import type { Id, WorkMark } from "@/domain/types";

import { anchorOf, chipText, encodeAt, type DocCtx } from "./ctx";
import type { Token } from "./inlineRuns";
import { caseValueLabel } from "./SwitchControls";

function articleRefText(node: ArticleRefNode, ctx: DocCtx): string {
  // 편집기 미리보기 — 조립과 같은 덩어리 규칙(기능/문면 §3.5). 전체 뷰 번호라 분기 결과는 반영되지 않는다.
  const index = node.scope === "general" ? ctx.references.general : ctx.references.self;
  const alive: ReferenceTarget[] = [];
  let broken = 0;
  const byKey = referenceKeyIndex(index);
  for (const t of node.targets) {
    const found = byKey.get(refKey(t));
    if (found) alive.push(found.target);
    else broken += 1;
  }
  const joined = alive.length === 0 ? (broken > 0 ? "없는 조(연결 끊김)" : "대상 없음") : referenceChunkLabel(alive, node.connector);
  // 값 한정 — 반복(사유)으로 생긴 노드 중 그 값이 낸 것만 (ADR-0077 결정 7). 번호는 조립이 펼친 뒤 매긴다
  const restrict = node.targets.find((t) => t.restrict)?.restrict;
  const narrowed = !restrict ? "" : "current" in restrict ? ` ⟨현재 값 — ${ctx.repeatLabelOf?.(restrict.current) ?? "반복"}⟩` : ` ⟨값 = ${restrict.values.map((v) => ctx.enumValueLabel?.(v) ?? v).join(" · ")}⟩`;
  return `${node.scope === "general" ? "보통약관 " : ""}${joined}${narrowed}${alive.length > 0 && broken > 0 ? ` (연결 끊김 ${broken}건)` : ""}`;
}

const CHIP_WHAT: Record<string, string> = {
  slot: "치환 슬롯",
  articleRef: "조 참조",
  appendixRef: "별표 참조",
  clauseInlineRef: "함수조항(문장 안)",
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
      return { className: "ts-doc-slot", title: `치환 슬롯 · ${node.ref}`, body: node.ref };
    }
    case "articleRef":
      return { className: "ts-doc-ref", title: "조 참조 슬롯 — 번호는 계산값이다", body: articleRefText(node, ctx) };
    case "appendixRef":
      return { className: "ts-doc-ref", title: `별표 참조 · ${node.appendixCode}`, body: `【별표 ${ctx.appendixName.get(node.appendixCode) ?? `${node.appendixCode}(없는 별표)`}】` };
    case "clauseInlineRef":
      return {
        className: "ts-doc-ref",
        title: `함수조항(문장 안) · ${node.clauseCode} · ${ctx.optionText(node.clauseCode, node.options)}`,
        body: `〔${ctx.clauseLabel.get(node.clauseCode) ?? `${node.clauseCode}(없는 함수조항)`}〕`,
      };
    case "structKey":
      return { className: "ts-doc-ref", title: "구조 표기 — 행마다 그 행의 노드 이름이 찍힌다", body: STRUCT_KEY_CHIP[node.level] };
    case "inlineFor":
      return { className: "ts-muted", title: "문장 안 반복 — 아직 지원하지 않는다", body: "(문장 안 반복 — 아직 지원하지 않는다)" };
    case "inlineCond":
      if (node.switchOn !== undefined) {
        // 문장 안 값별 분기 — 칩 하나: 대상 + 칸마다 머리(값 · 문구 없음) + 그 칸 문장 (최종 결정 5)
        const subject = ctx.switchSubjects?.find((s) => s.code === node.switchOn);
        const head = (br: (typeof node.branches)[number]) => `${(br.values ?? []).map((v) => caseValueLabel(subject, v)).join(" · ") || "값 없음"}${br.empty ? ` — ${SWITCH_WORD.empty}` : ""}`;
        return {
          className: "ts-doc-inline-chip is-switch",
          what: SWITCH_WORD.inlineSwitch,
          title: `${SWITCH_WORD.inlineSwitch} — ${subject?.label ?? node.switchOn} │ ${node.branches.map(head).join(" │ ")}`,
          body: (
            <>
              <span className="ts-doc-inline-head">
                {SWITCH_WORD.switch} {subject?.label ?? node.switchOn}
              </span>
              {node.branches.map((br) => (
                <Fragment key={br.id}>
                  <span className="ts-doc-inline-sep"> │ </span>
                  <span className="ts-doc-inline-head">{head(br)}</span> {!br.empty && <InlineView nodes={br.children} ctx={{ ...ctx, mode: "read", edit: undefined }} />}
                </Fragment>
              ))}
            </>
          ),
        };
      }
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

/**
 * 문장 조각 — 작업용 글자색이 있으면 색 조각(`data-mark`)으로 싼다 (§3.2 작업 표시). 산출물 서식이 아니다 —
 * 「수정 흔적 보기」를 끄면 화면이 `.is-marks-off` 로 보통 글색을 입힌다. 산출물 꼴(미리보기 탭)은 조립 결과라 색이 없다.
 */
function TextRun({ node }: { node: { text: string; mark?: WorkMark } }): ReactNode {
  if (!node.mark) return node.text;
  return (
    <span className="ts-mark" data-mark={node.mark}>
      {node.text}
    </span>
  );
}

/** 읽기 — 글과 칩. 문장 안 조건은 **점선 밑줄만**(칩 · 배경 없음), 조건식은 tooltip. */
export function InlineView({ nodes, ctx }: { nodes: readonly InlineNode[]; ctx: DocCtx }): ReactNode {
  return nodes.map((node) => {
    if (node.kind === "text") return <TextRun key={node.id} node={node} />;
    if (node.kind === "inlineCond" && node.switchOn !== undefined) {
      // 문장 안 값별 분기 읽기 — 칸마다 점선 밑줄 조각, 칸 머리(값)는 tooltip
      const subject = ctx.switchSubjects?.find((s) => s.code === node.switchOn);
      return (
        <Fragment key={node.id}>
          {node.branches.map((br, i) => (
            <span key={br.id} data-node={br.id} className={`ts-doc-inline-cond${i === 0 ? "" : " is-alt"}${ctx.flashId === br.id ? " is-flash" : ""}`} title={`${SWITCH_WORD.inlineSwitch} — ${SWITCH_WORD.case} ${(br.values ?? []).map((v) => caseValueLabel(subject, v)).join(" · ")}${br.empty ? ` — ${SWITCH_WORD.empty}` : ""}`}>
              {br.empty ? `〔${SWITCH_WORD.empty}〕` : <InlineView nodes={br.children} ctx={ctx} />}
            </span>
          ))}
        </Fragment>
      );
    }
    if (node.kind === "inlineCond") {
      return (
        <Fragment key={node.id}>
          {node.branches.map((br, i) => {
            return (
              <span
                key={br.id}
                data-node={br.id}
                className={`ts-doc-inline-cond${i === 0 ? "" : " is-alt"}${ctx.flashId === br.id ? " is-flash" : ""}`}
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

/** 글 조각 — 색이 있으면 싣는다. */
const textToken = (text: string, mark: WorkMark | undefined): Token => (mark ? { text, mark } : { text });

/** 색 조각 요소의 색 — 없으면 바깥 색을 물려받는다. */
const markOf = (el: HTMLElement, outer: WorkMark | undefined): WorkMark | undefined => (el.dataset.mark as WorkMark | undefined) ?? outer;

/**
 * 편집기 DOM → 조각 목록. 칩은 `data-chip`, 그 밖의 요소는 속 글만 읽는다(색 조각 `data-mark` 는 글에 색을 싣는다). `caret` 을 주면 그 자리에 커서 조각.
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
  const walk = (el: globalThis.Node, mark: WorkMark | undefined) => {
    el.childNodes.forEach((child, i) => {
      if (caret && caret.node === el && caret.offset === i) put();
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (caret && caret.node === child) {
          out.push(textToken(text.slice(0, caret.offset), mark));
          put();
          out.push(textToken(text.slice(cutTo !== undefined && cutTo > caret.offset ? cutTo : caret.offset), mark));
        } else out.push(textToken(text, mark));
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
      walk(child, markOf(child, mark));
    });
    if (caret && caret.node === el && caret.offset >= el.childNodes.length) put();
  };
  walk(root, undefined);
  return out;
}

/**
 * 고른 글에 작업용 글자색을 칠한 조각 목록 (툴바 「글자색」, §3.2 작업 표시). `mark` 가 없으면 색 지우기.
 * 이 문장 칸 안의 글 중 `range` 에 든 부분만 색을 바꾸고, 칩은 그대로 둔다(칩은 색을 갖지 않는다).
 * 칸 안에 고른 글이 없으면 undefined.
 */
export function markedTokensOf(root: HTMLElement, range: Range, mark: WorkMark | undefined): Token[] | undefined {
  const out: Token[] = [];
  let touched = false;
  const walk = (el: globalThis.Node, outer: WorkMark | undefined) => {
    el.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (!range.intersectsNode(child)) {
          out.push(textToken(text, outer));
          return;
        }
        const from = range.startContainer === child ? range.startOffset : 0;
        const to = range.endContainer === child ? range.endOffset : text.length;
        if (from >= to) {
          out.push(textToken(text, outer));
          return;
        }
        touched = true;
        out.push(textToken(text.slice(0, from), outer), textToken(text.slice(from, to), mark), textToken(text.slice(to), outer));
        return;
      }
      if (!(child instanceof HTMLElement)) return;
      const chip = child.dataset.chip;
      if (chip) {
        out.push({ chip });
        return;
      }
      if (child.tagName === "BR") return;
      walk(child, markOf(child, outer));
    });
  };
  walk(root, undefined);
  return touched ? out : undefined;
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
  placeholder = "문장",
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
        if (node.kind === "text") return <TextRun key={node.id} node={node} />;
        const { className, title, body, what } = chipParts(node, ctx);
        return (
          <span
            key={node.id}
            contentEditable={false}
            data-chip={node.id}
            data-node={node.id}
            className={`${className} ts-chip-inline${ctx.flashId === node.id ? " is-flash" : ""}`}
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
