"use client";

/**
 * 조건 블록 머리 줄 — 그 자리에서 늘 고치는 조건식 (기능/문면 §4.3, 2026-09-28). 팝업 없음.
 *
 * `IF` 배지 + [변수 검색] [연산자 ▾] [값] + ⊕(뒤에 줄) ⊖(줄 빼기). 둘째 줄부터는 [AND ▾ / OR] 결합.
 * 변수는 검색 입력(콤보박스) — 이름 · 코드로 좁히고, 묶음(현재 행 · 노드마다 · 담보속성)은 목록 머리로 (디자인원칙 §1.8).
 * 고른 것은 곧바로 식 소스로 묶여 `onCommit` — 선택 칸은 바꾸는 순간, 값 칸은 칸을 떠날 때(Enter 포함).
 * 줄이 다 차지 않았으면 빈 식을 넘긴다(저장 검증이 그 가지를 오류로 안내한다). 줄로 풀 수 없는 식은 원문 읽기 전용 + 「줄로 다시 만들기」
 * (텍스트 식 입력은 없다 — ADR-0066 결정 7 · 8).
 * 결합이 섞였으면(AND · OR 둘 다) 왼쪽부터 묶이는 순서를 괄호로 보인다 — 첫 줄 변수 앞 `(`, 묶음 끝 줄 값 뒤 `)` (`joinParens`, 2026-09-30).
 * 표시 전용 — 저장 식은 그대로다.
 * 문장 안 조건의 가지 머리(칩 팝업)도 같은 줄을 쓴다.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

import { Combobox, type ComboOption } from "@/app/_components/Combobox";
import { IconButton, IconMinusCircle, IconPlusCircle } from "@/app/_components/icons";
import { emptyRows, isUnaryOp, joinParens, rowIssues, type ConditionRow, type ConditionRows, type Join, type RowOp } from "@/domain/document";
import type { DiscriminatorRef, Literal } from "@/domain/expression";

import { OP_LABEL, addRow, headOf, opsOf, pickerGroups, refKey, refOfKey, removeRow, setLeft, sourceOf, type HeadModel } from "./rows";
import type { ConditionContext, CtxAttribute, CtxDiscriminator } from "./types";

/** 값 칸 — 좌변 타입대로. 우변이 구분자 참조면 칩 + 비우기. 담보속성이면 유효값 목록(있음 · 없음은 값 없음). */
function ValueInput({
  row,
  name,
  def,
  attribute,
  refText,
  onChange,
  onDone,
}: {
  row: ConditionRow;
  name: string;
  def?: CtxDiscriminator;
  attribute?: CtxAttribute;
  refText: (ref: DiscriminatorRef) => string;
  onChange: (right: ConditionRow["right"], commit: boolean) => void;
  onDone: () => void;
}) {
  const label = `${name} 값`;
  if (row.left?.kind === "attr") {
    if (isUnaryOp(row.op)) return <span className="ts-cond-value ts-muted" aria-label={label}>—</span>;
    const chosen = row.right?.kind === "literal" && row.right.literal.type === "string" ? row.right.literal.value : "";
    return (
      <select className="ts-cond-value" aria-label={label} value={chosen} onChange={(e) => onChange(e.target.value === "" ? undefined : { kind: "literal", literal: { type: "string", value: e.target.value } }, true)}>
        <option value="">값</option>
        {(attribute?.values ?? []).map((v) => (
          <option key={v.code} value={v.code}>
            {v.label}
          </option>
        ))}
      </select>
    );
  }
  if (row.right?.kind === "ref") {
    return (
      <span className="ts-cond-value-ref">
        {refText(row.right.ref)}
        <button type="button" className="ts-cond-x" aria-label={`${label} 비우기`} onClick={() => onChange(undefined, true)}>
          ⓧ
        </button>
      </span>
    );
  }
  const lit = row.right?.kind === "literal" ? row.right.literal : undefined;
  const set = (literal: Literal | undefined, commit: boolean) => onChange(literal ? { kind: "literal", literal } : undefined, commit);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };
  const kind = def?.type?.kind;
  if (!row.left || !kind) return <input type="text" className="ts-cond-value" aria-label={label} placeholder="값" disabled />;
  switch (kind) {
    case "boolean":
      return (
        <select className="ts-cond-value" aria-label={label} value={lit?.type === "boolean" ? String(lit.value) : ""} onChange={(e) => set(e.target.value === "" ? undefined : { type: "boolean", value: e.target.value === "true" }, true)}>
          <option value="">값</option>
          <option value="true">참</option>
          <option value="false">거짓</option>
        </select>
      );
    case "enum":
      return (
        <select className="ts-cond-value" aria-label={label} value={lit?.type === "string" ? lit.value : ""} onChange={(e) => set(e.target.value === "" ? undefined : { type: "string", value: e.target.value }, true)}>
          <option value="">값</option>
          {(def?.enumOptions ?? []).map((o) => (
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
          className="ts-cond-value"
          aria-label={label}
          value={lit?.type === "number" ? lit.value : ""}
          onChange={(e) => set(e.target.value === "" ? undefined : { type: "number", value: Number(e.target.value) }, false)}
          onBlur={onDone}
          onKeyDown={onKey}
        />
      );
    case "date":
      return <input type="date" className="ts-cond-value" aria-label={label} value={lit?.type === "date" ? lit.value : ""} onChange={(e) => set(e.target.value === "" ? undefined : { type: "date", value: e.target.value }, true)} />;
    default:
      return (
        <input
          type="text"
          className="ts-cond-value"
          aria-label={label}
          placeholder="값"
          value={lit?.type === "string" ? lit.value : ""}
          onChange={(e) => set({ type: "string", value: e.target.value }, false)}
          onBlur={onDone}
          onKeyDown={onKey}
        />
      );
  }
}

export function CondRows({
  label,
  when,
  context,
  onCommit,
  focus,
  onFocused,
  tools,
}: {
  /** 첫 줄 배지 — IF · ELIF. */
  label: string;
  /** 저장된 식 — 빈 글자면 빈 줄 하나. */
  when: string;
  context: ConditionContext;
  onCommit: (source: string) => void;
  /** 그려지자마자 첫 칸에 초점 (툴바 「조건식」 · 가지 추가 직후). */
  focus?: boolean;
  onFocused?: () => void;
  /** 첫 줄 끝에 붙는 블록 조작(가지 추가 · 풀기 · 삭제). */
  tools?: ReactNode;
}) {
  const [model, setModel] = useState<HeadModel>(() => headOf(when));
  const [seen, setSeen] = useState(when);
  // 밖에서 식이 바뀌었으면(다른 자리에서 고침 · 거부) 다시 푼다 — 렌더 중 상태 조정
  if (seen !== when) {
    setSeen(when);
    const next = headOf(when);
    setModel(next);
  }

  const firstVar = useRef<HTMLInputElement>(null);
  const rawInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = firstVar.current ?? rawInput.current;
    if (focus && el) {
      el.focus();
      onFocused?.();
    }
  }, [focus, onFocused]);

  const defOf = (ref: DiscriminatorRef): CtxDiscriminator | undefined => context.discriminators.find((d) => d.code === ref.code);
  const nodeName = (id: string) => context.coverage?.nodes.find((n) => n.id === id)?.name;
  const refText = (ref: DiscriminatorRef) => `${defOf(ref)?.label ?? ref.code}${ref.node ? ` @${nodeName(ref.node.id) ?? "끊어진 노드"}` : ""}`;
  const attributeOf = (code: string): CtxAttribute | undefined => context.attributes?.find((a) => a.code === code);
  const leftText = (ref: NonNullable<ConditionRow["left"]>) => (ref.kind === "attr" ? (attributeOf(ref.code)?.label ?? `attr.${ref.code}`) : refText(ref));
  const groups = pickerGroups(context);
  const known = new Set(groups.flatMap((g) => g.options.map((o) => o.key)));
  // 변수 후보 — 묶음 머리 그대로, 보조 글자는 코드(한정자 앞)
  const varOptions: ComboOption[] = groups.flatMap((g) => g.options.map((o) => ({ value: o.key, label: o.label, hint: o.key.replace(/^attr\./, "").split("@")[0], group: g.label })));

  const update = (next: HeadModel, commit: boolean) => {
    setModel(next);
    if (!commit) return;
    const source = sourceOf(next);
    if (source === when) return;
    setSeen(source);
    onCommit(source);
  };
  const done = () => update(model, true);

  if (model.kind === "raw") {
    return (
      <div className="ts-cond-rows">
        <div className="ts-cond-line">
          <span className="ts-cond-badge">{label}</span>
          <input
            ref={rawInput}
            type="text"
            readOnly
            className="ts-cond-raw ts-mono"
            aria-label={`${label} 조건식 원문`}
            title="줄로 풀 수 없는 식(괄호 중첩 · not · 집계 직접 사용) — 읽기 전용. 고치려면 줄로 다시 만든다 (ADR-0066 결정 8)"
            value={model.source}
          />
          <button type="button" className="ts-cond-mini" onClick={() => update({ kind: "rows", rows: emptyRows() }, true)}>
            줄로 다시 만들기
          </button>
          {tools}
        </div>
      </div>
    );
  }

  const rows = model.rows;
  const setRows = (next: ConditionRows, commit = true) => update({ kind: "rows", rows: next }, commit);
  const typeOf = (ref: DiscriminatorRef) => defOf(ref)?.type;
  const issues = rowIssues(rows, typeOf, (code) => attributeOf(code)?.values.map((v) => v.code));
  const parens = joinParens(rows.joins);

  return (
    <div className="ts-cond-rows">
      {rows.rows.map((row, i) => {
        const name = `${label} ${i + 1}번 줄`;
        const discriminator = row.left?.kind === "discriminator" ? row.left : undefined;
        const def = discriminator ? defOf(discriminator) : undefined;
        const ops = opsOf(row.left, typeOf);
        const key = row.left ? refKey(row.left) : "";
        const issue = row.left ? issues.find((m) => m.startsWith(`${i + 1}번 줄:`)) : undefined;
        const opened = discriminator?.node ? (context.openedForms[discriminator.node.id] ?? []) : [];
        const alwaysFalse = discriminator?.node && def && def.forms.length > 0 && !def.forms.some((f) => opened.includes(f));
        return (
          <div key={i} className="ts-cond-line">
            {i === 0 ? (
              <span className="ts-cond-badge">{label}</span>
            ) : (
              <select
                className="ts-cond-join"
                aria-label={`${name} 결합`}
                value={rows.joins[i - 1]}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setRows({ ...rows, joins: rows.joins.map((j, idx) => (idx === i - 1 ? (e.target.value as Join) : j)) })}
              >
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            )}
            {parens[i].open > 0 && (
              <span className="ts-cond-paren" aria-hidden="true">
                {"(".repeat(parens[i].open)}
              </span>
            )}
            <Combobox
              inputRef={i === 0 ? firstVar : undefined}
              className="ts-cond-var"
              ariaLabel={`${name} 변수`}
              value={key}
              onChange={(next) => setRows(setLeft(rows, i, refOfKey(next), typeOf))}
              options={varOptions}
              valueLabel={row.left && !known.has(key) ? `${leftText(row.left)} (목록에 없음)` : undefined}
              placeholder="변수 · 구분자 찾기"
            />
            <select
              className="ts-cond-op"
              aria-label={`${name} 연산자`}
              value={row.op ?? ""}
              disabled={!row.left}
              onChange={(e) => {
                const op = e.target.value as RowOp;
                // 있음 · 없음은 우변이 없다 — 고르면 값을 비운다
                setRows({ ...rows, rows: rows.rows.map((r, idx) => (idx === i ? (isUnaryOp(op) ? { left: r.left, op } : { ...r, op }) : r)) });
              }}
            >
              {!row.op && <option value="">연산자</option>}
              {row.op && !ops.includes(row.op) && <option value={row.op}>{OP_LABEL[row.op]}</option>}
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABEL[op]}
                </option>
              ))}
            </select>
            <ValueInput
              row={row}
              name={name}
              def={def}
              attribute={row.left?.kind === "attr" ? attributeOf(row.left.code) : undefined}
              refText={refText}
              onChange={(right, commit) => setRows({ ...rows, rows: rows.rows.map((r, idx) => (idx === i ? { ...r, ...(right ? { right } : { right: undefined }) } : r)) }, commit)}
              onDone={done}
            />
            {parens[i].close > 0 && (
              <span className="ts-cond-paren" aria-hidden="true">
                {")".repeat(parens[i].close)}
              </span>
            )}
            <IconButton className="ts-cond-rowbtn" icon={<IconPlusCircle />} label={`${name} 뒤에 조건 줄 추가`} onClick={() => setRows(addRow(rows, i))} />
            <IconButton className="ts-cond-rowbtn" icon={<IconMinusCircle />} label={`${name} 빼기`} disabled={rows.rows.length <= 1} onClick={() => setRows(removeRow(rows, i))} />
            {issue && (
              <span className="ts-cond-issue" role="status">
                {issue.replace(/^\d+번 줄: /, "")}
              </span>
            )}
            {!issue && alwaysFalse && (
              <span className="ts-cond-warn" role="status" title="이 노드에는 값이 없어 조건이 늘 거짓이다">
                ⚠ 항상 거짓
              </span>
            )}
            {i === 0 && tools}
          </div>
        );
      })}
    </div>
  );
}
