"use client";

/**
 * 구조 트리 · 편집기 — 들여쓰기 + 순번으로 담보 › 세부보장 › 급부 세 층을 한눈에 (기능/담보 §4 「상세」 기본 탭 구조 트리).
 *
 * 읽기 모드는 이름이 링크(그 탭의 그 노드로 — `onPick`), 편집 모드는 이름 인라인 입력.
 * `structural` 이면 편집 모드에서 추가(`+ 세부보장` · `+ 급부`) · 순서(↑ ↓) · 삭제(✕)까지 초안에 담는다 — 미탑재 담보의 상세 화면(ADR-0052 결정 1)과
 * 탑재된 담보의 「구조 편집」 화면(결정 2)이 같은 편집기를 쓴다. `✕` 로 뺀 기존 노드는 초안에서 사라진다 — 되돌리려면 편집 취소.
 * 새 노드는 id 가 없고 저장 뒤에야 값 탭에 선다. 최소 구조 하한은 마지막 하나의 ✕ 를 잠그고, 빈 이름 · 형제 중복은 행 옆에 인라인.
 *
 * EditShell 문맥을 직접 읽지 않는다 — 값과 변경을 props 로 받아 두 화면이 각자의 초안 필드에 잇는다.
 */
import { useRef, useState, type ReactNode } from "react";

import { IconButton, IconClose, IconDown, IconPlus, IconUp } from "@/app/_components/icons";
import { InfoTip } from "@/app/_components/InfoTip";
import { structureIssues, structureRemovals, type StructureDraftBenefit, type StructureDraftSub, type StructureSavedSub } from "@/domain/coverage";

export const MIN_STRUCTURE = "최소 구조 — 세부보장 1개 · 급부 1개는 있어야 한다";

/** 편집 중인 행 하나의 조작 — 이름 입력 · 이슈 · ↑ ↓ ✕. 세부보장 · 급부가 같은 모양을 쓴다 (같은 조작군은 통일). */
function DraftRow({ row, index, count, what, issue, autoFocus, onName, onMove, onRemove }: {
  row: { key: string; name: string };
  index: number;
  count: number;
  what: string;
  issue?: string;
  autoFocus: boolean;
  onName: (value: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const label = row.name.trim() || what;
  return (
    <>
      <span className="ts-tree-num">{index + 1}</span>
      <input value={row.name} autoFocus={autoFocus} onChange={(e) => onName(e.target.value)} className="ts-field-direct ts-tree-input" aria-label={`${what}명 · ${index + 1}번`} aria-invalid={issue ? true : undefined} />
      {issue ? <span className="ts-form-error ts-tree-issue">{issue}</span> : null}
      <span className="ts-row-actions">
        <IconButton icon={<IconUp />} label={`${label} 위로`} disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon={<IconDown />} label={`${label} 아래로`} disabled={index === count - 1} onClick={() => onMove(1)} />
        <IconButton icon={<IconClose />} label={count <= 1 ? MIN_STRUCTURE : `${label} 빼기`} danger disabled={count <= 1} onClick={onRemove} />
      </span>
    </>
  );
}

function moved<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export interface StructureTreeProps {
  mode: "read" | "edit";
  /** 담보명 — `onLabel` 이 있으면 편집 모드에서 인라인 입력, 없으면 글자 (구조 편집 화면은 담보명을 여기서 안 고친다). */
  label: string;
  onLabel?: (value: string) => void;
  value: StructureDraftSub[];
  onChange: (value: StructureDraftSub[]) => void;
  /** 편집 모드에서 추가 · 순서 · 삭제까지 — 미탑재 담보 상세 · 「구조 편집」 화면. 거짓이면 이름만. */
  structural: boolean;
  /** 저장된 원본 — 「저장 시 삭제 N개」 셈과 aria 의 원래 이름. */
  original: StructureSavedSub[];
  /** 읽기 모드에서 행 이름을 눌렀을 때 (키 = `encodeNodeKey`). 없으면 이름은 글자. */
  onPick?: (key: string) => void;
  /** 제목 옆 ⓘ 문구. */
  tip: string;
  /** 제목 줄 오른쪽 — 탑재된 담보의 「구조 편집 →」 등. */
  headerAction?: ReactNode;
}

export function StructureTree({ mode, label, onLabel, value, onChange, structural, original, onPick, tip, headerAction }: StructureTreeProps) {
  const nextKey = useRef(0);
  const [focusKey, setFocusKey] = useState<string>();
  const editing = mode === "edit";
  const editable = editing && structural;
  const originalName = new Map<string, string>(original.flatMap((sub) => [[sub.key, sub.name], ...sub.benefits.map((b): [string, string] => [b.key, b.name])]));
  const issues = editing ? structureIssues(value) : [];
  const issueOf = (key: string) => issues.find((i) => i.key === key)?.message;
  const removed = editable ? structureRemovals(original, value).length : 0;

  const fresh = (prefix: string) => `new:${prefix}${nextKey.current++}`;
  const update = (subs: StructureDraftSub[]) => onChange(subs);
  const updateSub = (key: string, change: (sub: StructureDraftSub) => StructureDraftSub) => update(value.map((sub) => (sub.key === key ? change(sub) : sub)));
  const addSub = () => {
    const key = fresh("s");
    setFocusKey(key);
    update([...value, { key, name: "", benefits: [{ key: fresh("b"), name: "" }] }]);
  };
  const addBenefit = (subKey: string) => {
    const key = fresh("b");
    setFocusKey(key);
    updateSub(subKey, (sub) => ({ ...sub, benefits: [...sub.benefits, { key, name: "" }] }));
  };

  const setSubName = (key: string, name: string) => updateSub(key, (s) => ({ ...s, name }));
  const setBenefitName = (subKey: string, key: string, name: string) => updateSub(subKey, (s) => ({ ...s, benefits: s.benefits.map((b) => (b.key === key ? { ...b, name } : b)) }));

  /** 구조 조작 없는 행(탑재된 담보의 상세)의 편집 · 읽기 모드 공통 — 이름 입력 또는 그 탭으로 가는 링크. aria 는 원래 이름으로 (고치는 중에도 안 흔들리게). */
  const nameCell = (row: { key: string; name: string }, what: string, onName: (name: string) => void) =>
    editing ? (
      <input value={row.name} onChange={(e) => onName(e.target.value)} className="ts-field-direct ts-tree-input" aria-label={`${what}명 · ${originalName.get(row.key) ?? row.name}`} />
    ) : onPick ? (
      <button type="button" className="ts-tree-name ts-linklike" onClick={() => onPick(row.key)}>{row.name}</button>
    ) : (
      <span className="ts-tree-name">{row.name}</span>
    );

  return (
    <section className="ts-tree-block">
      <h2 className="ts-h2">
        구조
        <InfoTip text={tip} />
        {headerAction}
      </h2>
      {removed > 0 ? <p className="ts-warn">저장 시 삭제 {removed}개 — 영향을 확인한 뒤 저장된다 (관리자).</p> : null}
      <ul className="ts-tree">
        <li>
          <div className="ts-tree-row">
            {editing && onLabel ? <input value={label} onChange={(e) => onLabel(e.target.value)} className="ts-field-direct ts-tree-input" aria-label="담보명" /> : <span className="ts-tree-name">{label}</span>}
          </div>
          <ul className="ts-tree">
            {value.map((sub, subIndex) => (
              <li key={sub.key}>
                <div className="ts-tree-row">
                  {editable ? (
                    <DraftRow
                      row={sub}
                      index={subIndex}
                      count={value.length}
                      what="세부보장"
                      issue={issueOf(sub.key)}
                      autoFocus={sub.key === focusKey}
                      onName={(name) => setSubName(sub.key, name)}
                      onMove={(delta) => update(moved(value, subIndex, delta))}
                      onRemove={() => update(value.filter((s) => s.key !== sub.key))}
                    />
                  ) : (
                    <>
                      <span className="ts-tree-num">{subIndex + 1}</span>
                      {nameCell(sub, "세부보장", (name) => setSubName(sub.key, name))}
                      {editing && issueOf(sub.key) ? <span className="ts-form-error ts-tree-issue">{issueOf(sub.key)}</span> : null}
                    </>
                  )}
                  <span className="ts-count">급부 <b>{sub.benefits.length}</b></span>
                </div>
                <ul className="ts-tree">
                  {sub.benefits.map((benefit: StructureDraftBenefit, benefitIndex) => (
                    <li key={benefit.key}>
                      <div className="ts-tree-row">
                        {editable ? (
                          <DraftRow
                            row={benefit}
                            index={benefitIndex}
                            count={sub.benefits.length}
                            what="급부"
                            issue={issueOf(benefit.key)}
                            autoFocus={benefit.key === focusKey}
                            onName={(name) => setBenefitName(sub.key, benefit.key, name)}
                            onMove={(delta) => updateSub(sub.key, (s) => ({ ...s, benefits: moved(s.benefits, benefitIndex, delta) }))}
                            onRemove={() => updateSub(sub.key, (s) => ({ ...s, benefits: s.benefits.filter((b) => b.key !== benefit.key) }))}
                          />
                        ) : (
                          <>
                            <span className="ts-tree-num">{benefitIndex + 1}</span>
                            {nameCell(benefit, "급부", (name) => setBenefitName(sub.key, benefit.key, name))}
                            {editing && issueOf(benefit.key) ? <span className="ts-form-error ts-tree-issue">{issueOf(benefit.key)}</span> : null}
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                  {editable ? (
                    <li>
                      <div className="ts-tree-row">
                        <button type="button" className="ts-linklike ts-tree-add" onClick={() => addBenefit(sub.key)}><IconPlus /> 급부</button>
                      </div>
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
            {editable ? (
              <li>
                <div className="ts-tree-row">
                  <button type="button" className="ts-linklike ts-tree-add" onClick={addSub}><IconPlus /> 세부보장</button>
                </div>
              </li>
            ) : null}
          </ul>
        </li>
      </ul>
    </section>
  );
}
