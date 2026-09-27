"use client";

/**
 * 조건 팝업 — 좌변(구분자 칩) · 연산자 · 우변(리터럴 또는 구분자 칩) 줄 + 줄 사이 그리고/또는,
 * 오른쪽에 담보 구분자 트리(또는 전체 구분자 목록) + 빠른 조건 (ADR-0066 §4~§7).
 *
 * 팝업이 못 여는 식(중첩 괄호 · not · 집계 직접 사용)은 원문 읽기 전용 + 「다시 만들기」로 간다.
 * 확인은 `toSource(rows)` 로 만든 소스 문자열 하나를 돌려줄 뿐 — 서버 액션은 그대로 `when` 필드로 받는다.
 */
import { type ChangeEvent, type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";

import { COVERAGE_NODE_LEVELS } from "@/domain/coverage";
import {
  emptyRows,
  operatorsFor,
  rowIssues,
  toRows,
  toSource,
  type ConditionRow,
  type ConditionRows,
  type Join,
  type RowRight,
} from "@/domain/document";
import { parse, type CompareOp, type DiscriminatorRef, type Literal } from "@/domain/expression";
import type { FieldType } from "@/domain/types";

import { DiscriminatorTree } from "./DiscriminatorTree";
import type { ConditionContext, CtxDiscriminator, QuickCondition } from "./types";

type Focus = { row: number; cell: "left" | "right" };

const TREE_LEVELS = new Set<string>(COVERAGE_NODE_LEVELS);

/**
 * 이 팝업은 서버 액션 `<form>` 안에 떠 있다 (BranchForms · AddForm · NodeForms 세 곳 모두) — 버튼은
 * 전부 `type="button"` 이지만 input 위에서 Enter 는 HTML 암시적 제출로 그 form 을 그대로 제출해
 * 버린다(hidden `when` 은 마지막으로 확인한 값 그대로, 편집 중 내용은 버려진다). Escape 는 다이얼로그의
 * 네이티브 동작(닫기)이라 여기서 막지 않는다 — input 위의 Enter 만 막는다.
 */
export function isImplicitSubmitKey(e: { key: string; target: { tagName?: string } | null }): boolean {
  return e.key === "Enter" && e.target?.tagName === "INPUT";
}

function parseInitial(initial: string | undefined): { rows: ConditionRows; readOnlySource?: string } {
  if (!initial) return { rows: emptyRows() };
  const parsed = parse(initial);
  if (!parsed.ok) return { rows: emptyRows(), readOnlySource: initial };
  const rows = toRows(parsed.value);
  return rows ? { rows } : { rows: emptyRows(), readOnlySource: initial };
}

/** 우변 — 좌변 타입으로 입력을 분기. 참조가 들어와 있으면 칩 + 비우기. */
function RightInput({
  row,
  rowIndex,
  leftType,
  leftDef,
  chip,
  isBroken,
  focused,
  onFocus,
  onLiteral,
  onClearRef,
}: {
  row: ConditionRow;
  rowIndex: number;
  leftType?: FieldType;
  leftDef?: CtxDiscriminator;
  chip: (ref: DiscriminatorRef) => string;
  isBroken: (ref: DiscriminatorRef) => boolean;
  focused: string;
  onFocus: () => void;
  onLiteral: (literal: Literal) => void;
  onClearRef: () => void;
}) {
  const label = `${rowIndex + 1}번 줄 우변`;
  if (row.right?.kind === "ref") {
    const broken = isBroken(row.right.ref);
    return (
      <button type="button" className={`ts-chip${focused}${broken ? " ts-chip-broken" : ""}`} onClick={onFocus} aria-label={label}>
        {chip(row.right.ref)}
        <span
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            onClearRef();
          }}
          role="button"
          aria-label={`${rowIndex + 1}번 줄 우변 비우기`}
        >
          ⓧ
        </span>
      </button>
    );
  }
  if (!row.left || !leftType) {
    return <input type="text" aria-label={label} disabled placeholder="좌변을 먼저 고른다" onFocus={onFocus} />;
  }
  const lit = row.right?.kind === "literal" ? row.right.literal : undefined;
  switch (leftType.kind) {
    case "boolean":
      return (
        <select aria-label={label} value={lit?.type === "boolean" ? String(lit.value) : ""} onFocus={onFocus} onChange={(e: ChangeEvent<HTMLSelectElement>) => onLiteral({ type: "boolean", value: e.target.value === "true" })}>
          <option value="">우변 — 고르기</option>
          <option value="true">참</option>
          <option value="false">거짓</option>
        </select>
      );
    case "enum":
      return (
        <select aria-label={label} value={lit?.type === "string" ? lit.value : ""} onFocus={onFocus} onChange={(e: ChangeEvent<HTMLSelectElement>) => onLiteral({ type: "string", value: e.target.value })}>
          <option value="">우변 — 고르기</option>
          {(leftDef?.enumOptions ?? []).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "number":
      return (
        <input
          type="number"
          aria-label={label}
          value={lit?.type === "number" ? lit.value : ""}
          onFocus={onFocus}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onLiteral({ type: "number", value: Number(e.target.value) })}
        />
      );
    case "date":
      return (
        <input
          type="date"
          aria-label={label}
          value={lit?.type === "date" ? lit.value : ""}
          onFocus={onFocus}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onLiteral({ type: "date", value: e.target.value })}
        />
      );
    default:
      return (
        <input
          type="text"
          aria-label={label}
          value={lit?.type === "string" ? lit.value : ""}
          onFocus={onFocus}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onLiteral({ type: "string", value: e.target.value })}
        />
      );
  }
}

/** 「구분자」 탭 — 담보 트리 레벨 밖(상품 · 세목)의 구분자를 이름으로 찾는 평평한 목록. */
function FlatList({ discriminators, query, onPick }: { discriminators: CtxDiscriminator[]; query: string; onPick: (ref: DiscriminatorRef) => void }) {
  const q = query.trim().toLowerCase();
  const filtered = q === "" ? discriminators : discriminators.filter((d) => d.label.toLowerCase().includes(q) || d.code.toLowerCase().includes(q));
  if (filtered.length === 0) return <p className="ts-muted">구분자가 없다.</p>;
  return (
    <ul className="ts-cond-tree-leaves">
      {filtered.map((d) => (
        <li key={d.code}>
          <button type="button" className="ts-cond-tree-leaf" onDoubleClick={() => onPick({ kind: "discriminator", code: d.code })}>
            {d.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ConditionDialog({
  open,
  context,
  initial,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  context: ConditionContext;
  initial?: string;
  onConfirm: (source: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<ConditionRows>(() => parseInitial(initial).rows);
  const [readOnlySource, setReadOnlySource] = useState<string | undefined>(() => parseInitial(initial).readOnlySource);
  const [focus, setFocus] = useState<Focus | undefined>({ row: 0, cell: "left" });
  const [tab, setTab] = useState<"coverage" | "all">(context.coverage ? "coverage" : "all");
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<string | undefined>();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // 열릴 때마다(또는 initial 이 바뀌었을 때) 이전 편집 중 상태를 버리고 다시 판다 — 렌더 중 상태 조정
  // (React 문서의 "prop 이 바뀌면 상태를 조정한다" 패턴), 이펙트 안 setState 는 피한다.
  const [prevOpenInitial, setPrevOpenInitial] = useState<{ open: boolean; initial?: string }>({ open, initial });
  if (prevOpenInitial.open !== open || prevOpenInitial.initial !== initial) {
    setPrevOpenInitial({ open, initial });
    if (open) {
      const init = parseInitial(initial);
      setRows(init.rows);
      setReadOnlySource(init.readOnlySource);
      setFocus({ row: 0, cell: "left" });
      setQuery("");
      setFlash(undefined);
    }
  }

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const typeOf = (ref: DiscriminatorRef): FieldType | undefined => context.discriminators.find((d) => d.code === ref.code)?.type;
  const defOf = (ref: DiscriminatorRef): CtxDiscriminator | undefined => context.discriminators.find((d) => d.code === ref.code);
  const nodeName = (id: string): string | undefined => context.coverage?.nodes.find((n) => n.id === id)?.name;
  const isBroken = (ref: DiscriminatorRef): boolean => ref.node !== undefined && nodeName(ref.node.id) === undefined;
  const chip = (ref: DiscriminatorRef): string => `${defOf(ref)?.label ?? ref.code}${ref.node ? ` @${nodeName(ref.node.id) ?? "끊어진 노드"}` : ""}`;
  const focused = (row: number, cell: "left" | "right"): string => (focus?.row === row && focus.cell === cell ? " is-focus" : "");

  const rebuild = () => {
    setReadOnlySource(undefined);
    setRows(emptyRows());
  };

  const setJoin = (i: number) => (e: ChangeEvent<HTMLSelectElement>) => {
    const join = e.target.value as Join;
    setRows((prev) => ({ ...prev, joins: prev.joins.map((j, idx) => (idx === i ? join : j)) }));
  };

  const clearLeft = (i: number) => (e: MouseEvent) => {
    e.stopPropagation();
    setRows((prev) => ({ ...prev, rows: prev.rows.map((r, idx) => (idx === i ? {} : r)) }));
  };

  const setOp = (i: number) => (e: ChangeEvent<HTMLSelectElement>) => {
    const op = e.target.value as CompareOp;
    setRows((prev) => ({ ...prev, rows: prev.rows.map((r, idx) => (idx === i ? { ...r, op } : r)) }));
  };

  const setRight = (i: number) => (right: RowRight | undefined) => {
    setRows((prev) => ({ ...prev, rows: prev.rows.map((r, idx) => (idx === i ? { ...r, right } : r)) }));
  };

  const addRow = () => {
    setFocus({ row: rows.rows.length, cell: "left" });
    setRows((prev) => ({ rows: [...prev.rows, {}], joins: [...prev.joins, "and" as Join] }));
  };

  const removeRow = (i: number) => () => {
    setRows((prev) => {
      if (prev.rows.length <= 1) return prev;
      const removeIdx = i > 0 ? i - 1 : 0;
      return { rows: prev.rows.filter((_, idx) => idx !== i), joins: prev.joins.filter((_, idx) => idx !== removeIdx) };
    });
  };

  /** 트리·목록 잎 더블클릭 — 포커스가 left 면 좌변을 바꾸고(타입이 바뀌면 우변을 비운다), right 면 같은 타입일 때만 참조를 꽂는다. */
  const pick = (ref: DiscriminatorRef) => {
    if (!focus) return;
    const current = rows.rows[focus.row];
    if (!current) return;
    const newType = typeOf(ref);
    if (focus.cell === "left") {
      const prevType = current.left ? typeOf(current.left) : undefined;
      const sameType = prevType !== undefined && newType !== undefined && prevType.kind === newType.kind;
      const ops = newType ? operatorsFor(newType.kind) : [];
      const nextRow: ConditionRow = { left: ref, op: ops[0], right: sameType ? current.right : undefined };
      setRows((prev) => ({ ...prev, rows: prev.rows.map((r, idx) => (idx === focus.row ? nextRow : r)) }));
      return;
    }
    const leftType = current.left ? typeOf(current.left) : undefined;
    if (leftType && newType && leftType.kind === newType.kind) {
      setRows((prev) => ({ ...prev, rows: prev.rows.map((r, idx) => (idx === focus.row ? { ...r, right: { kind: "ref", ref } } : r)) }));
      return;
    }
    setFlash(`타입이 다르다 (${leftType?.kind ?? "?"} ≠ ${newType?.kind ?? "?"})`);
  };

  const applyQuick = (q: QuickCondition) => {
    const parsed = parse(q.source);
    if (!parsed.ok) return;
    const r = toRows(parsed.value);
    if (r) {
      setReadOnlySource(undefined);
      setRows(r);
    }
  };

  const source = readOnlySource ? undefined : toSource(rows);
  const issues = readOnlySource
    ? []
    : [
        ...rowIssues(rows, typeOf),
        ...rows.rows.flatMap((row, i) => {
          const leftBroken = row.left !== undefined && isBroken(row.left);
          const rightBroken = row.right?.kind === "ref" && isBroken(row.right.ref);
          return leftBroken || rightBroken ? [`${i + 1}번 줄: 끊어진 참조`] : [];
        }),
      ];
  const warnings = readOnlySource
    ? []
    : rows.rows.flatMap((row, i) => {
        if (!row.left?.node) return [];
        const def = defOf(row.left);
        if (!def || def.forms.length === 0) return [];
        const opened = context.openedForms[row.left.node.id] ?? [];
        if (def.forms.some((f) => opened.includes(f))) return [];
        return [`⚠ ${i + 1}번 줄: 「${nodeName(row.left.node.id) ?? "끊어진 노드"}」 에 값이 없어 항상 거짓`];
      });

  return (
    <dialog
      ref={dialogRef}
      className="ts-dialog ts-dialog-wide ts-cond-dialog"
      onClose={onCancel}
      onKeyDown={(e: KeyboardEvent<HTMLDialogElement>) => {
        if (isImplicitSubmitKey({ key: e.key, target: e.target as { tagName?: string } | null })) e.preventDefault();
      }}
    >
      <div className="ts-dialog-body ts-cond-body">
        <div className="ts-cond-rows">
          {readOnlySource ? (
            <>
              <pre className="ts-mono">{readOnlySource}</pre>
              <p className="ts-muted">팝업이 열 수 없는 식이다 (괄호 중첩 · 집계 직접 사용).</p>
              <button type="button" onClick={rebuild}>
                다시 만들기
              </button>
            </>
          ) : (
            rows.rows.map((row, i) => {
              const leftType = row.left ? typeOf(row.left) : undefined;
              const leftBroken = row.left !== undefined && isBroken(row.left);
              return (
                <div key={i} className="ts-cond-row">
                  {i > 0 && (
                    <select aria-label={`${i}번과 ${i + 1}번 사이`} value={rows.joins[i - 1]} onChange={setJoin(i - 1)}>
                      <option value="and">그리고</option>
                      <option value="or">또는</option>
                    </select>
                  )}
                  <button
                    type="button"
                    className={`ts-chip${focused(i, "left")}${leftBroken ? " ts-chip-broken" : ""}`}
                    onClick={() => setFocus({ row: i, cell: "left" })}
                    aria-label={`${i + 1}번 줄 좌변`}
                  >
                    {row.left ? chip(row.left) : "좌변 — 트리에서 고르기"}
                    {row.left && (
                      <span onClick={clearLeft(i)} role="button" aria-label={`${i + 1}번 줄 좌변 비우기`}>
                        ⓧ
                      </span>
                    )}
                  </button>
                  <select aria-label={`${i + 1}번 줄 연산자`} value={row.op ?? ""} disabled={!row.left} onChange={setOp(i)}>
                    <option value="" disabled>
                      —
                    </option>
                    {(leftType ? operatorsFor(leftType.kind) : []).map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                  <RightInput
                    row={row}
                    rowIndex={i}
                    leftType={leftType}
                    leftDef={row.left ? defOf(row.left) : undefined}
                    chip={chip}
                    isBroken={isBroken}
                    focused={focused(i, "right")}
                    onFocus={() => setFocus({ row: i, cell: "right" })}
                    onLiteral={(literal) => setRight(i)({ kind: "literal", literal })}
                    onClearRef={() => setRight(i)(undefined)}
                  />
                  {rows.rows.length > 1 && (
                    <button type="button" onClick={removeRow(i)} aria-label={`${i + 1}번 줄 삭제`}>
                      ⊖
                    </button>
                  )}
                </div>
              );
            })
          )}
          {!readOnlySource && (
            <button type="button" onClick={addRow}>
              + 조건 추가
            </button>
          )}
          {issues.length > 0 && (
            <ul className="ts-form-issues" role="alert">
              {issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {warnings.map((w) => (
            <p key={w} className="ts-muted" role="status">
              {w}
            </p>
          ))}
          {flash && (
            <p className="ts-form-issues" role="alert">
              {flash}
            </p>
          )}
          <div className="ts-form-actions">
            <button type="button" onClick={onCancel}>
              취소
            </button>
            <button type="button" className="primary" disabled={!!readOnlySource || issues.length > 0 || !source} onClick={() => source && onConfirm(source)}>
              확인
            </button>
          </div>
        </div>
        <aside className="ts-cond-tree">
          {context.quick.length > 0 && (
            <div className="ts-cond-quick">
              {context.quick.map((q) => (
                <button key={q.source} type="button" onClick={() => applyQuick(q)}>
                  {q.label}
                </button>
              ))}
            </div>
          )}
          <div className="ts-subtabs">
            {context.coverage && (
              <button type="button" aria-current={tab === "coverage" ? "page" : undefined} onClick={() => setTab("coverage")}>
                담보 구분자
              </button>
            )}
            <button type="button" aria-current={tab === "all" ? "page" : undefined} onClick={() => setTab("all")}>
              구분자
            </button>
          </div>
          <input type="search" placeholder="검색" value={query} onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} />
          {tab === "coverage" && context.coverage ? (
            <DiscriminatorTree context={context} query={query} onPick={pick} />
          ) : (
            <FlatList discriminators={context.discriminators.filter((d) => !TREE_LEVELS.has(d.level))} query={query} onPick={pick} />
          )}
          <p className="ts-muted">잎을 더블클릭하면 포커스 칸에 들어간다.</p>
        </aside>
      </div>
    </dialog>
  );
}
