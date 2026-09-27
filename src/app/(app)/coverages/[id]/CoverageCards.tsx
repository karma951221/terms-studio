"use client";

/**
 * 담보 상세의 구조 = 중첩 카드 (기능/담보 §3.6 · §4 「상세」) — 담보 카드 ⊃ 세부보장 카드(그리드) ⊃ 급부 카드.
 *
 * - 카드마다 **이름 + 그 노드 레벨의 마스터 값 폼**(StructForm). 담보명은 담보 카드의 이름이다. 필드가 없는 레벨은 이름만.
 *   값 폼은 `flat` — 폼마다 상자를 두르지 않고 필드 행이 카드 본문에 바로 선다(「담보 기본」 상자 없음, 2026-09-27).
 * - **접지 않는다** (2026-09-27) — 모든 카드가 늘 보인다. 세부보장 카드는 담보 카드 안에서 반응형 그리드(넓으면 2열)로 서고,
 *   급부 카드는 제 세부보장 카드 안에 쌓인다.
 * - **편집 모드의 구조 조작** — 카드 머리 왼쪽 ⊖(빼기, 마지막 하나면 잠김 · 최소 구조) · 오른쪽 ↑ ↓(순서) · 이름 인라인.
 *   「+ 세부보장」은 그리드 마지막 칸의 점선 타일, 「+ 급부」는 세부보장 카드 맨 아래 작은 버튼. 읽기 모드에는 구조 조작이 하나도 없다.
 *   빈 이름 · 형제 중복은 이름 옆에. 새 카드는 값 폼이 없다 — 저장 뒤에야 값 자리가 생긴다. ⊖ 로 뺀 기존 노드는 초안에서 사라진다(되돌리려면 편집 취소).
 * - **진입 좌표** — 필드 좌표가 있으면 그 행을(StructForm), 없으면 `target` 카드를 스크롤 · 강조한다.
 */
import { useEffect, useReducer, useRef, type ReactNode } from "react";

import { useEditField } from "@/app/_components/EditShell";
import { IconButton, IconDown, IconMinusCircle, IconPlus, IconUp } from "@/app/_components/icons";
import { NAME_LABEL } from "@/app/_lib/labels";
import { structureIssues, structureRemovals, type StructureDraftBenefit, type StructureDraftSub, type StructureSavedSub } from "@/domain/coverage";
import { StructForm, type FormModel, type Submission } from "@/forms";

import { formKeyOf, formSessionReducer, initFormSession } from "./value-drafts";

export const MIN_STRUCTURE = "최소 구조 — 세부보장 1개 · 급부 1개는 있어야 한다";

const LEVEL_LABEL = { coverage: "담보", subCoverage: "세부보장", benefit: "급부" } as const;
type Level = keyof typeof LEVEL_LABEL;

function moved<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

interface SiblingControls {
  index: number;
  count: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

function Card({ editing, level, nodeKey, name, onName, issue, sibling, isTarget, scrollToCard, children, body }: {
  editing: boolean;
  level: Level;
  nodeKey: string;
  name: string;
  onName: (value: string) => void;
  issue?: string;
  sibling?: SiblingControls;
  isTarget: boolean;
  scrollToCard: boolean;
  /** 이름 줄 아래 한 줄 알림 (담보명의 담보속성 값 경고 · 삭제 예고). */
  children?: ReactNode;
  /** 값 폼 + 자식 카드. */
  body: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (isTarget && scrollToCard) ref.current?.scrollIntoView?.({ block: "start" });
  }, [isTarget, scrollToCard]);

  const what = LEVEL_LABEL[level];
  const shown = name.trim() || what;
  const ariaName = level === "coverage" ? NAME_LABEL.coverage : `${what}명 · ${(sibling?.index ?? 0) + 1}번`;
  return (
    <section ref={ref} className={`ts-cov-card${isTarget ? " is-target" : ""}`} data-level={level} data-node={nodeKey} aria-label={`${what} ${shown}`}>
      <div className="ts-cov-card-head">
        {editing && sibling ? (
          <IconButton className="ts-cov-remove" icon={<IconMinusCircle />} label={sibling.count <= 1 ? MIN_STRUCTURE : `${shown} 빼기`} danger disabled={sibling.count <= 1} onClick={sibling.onRemove} />
        ) : null}
        <span className="ts-cov-card-level">{sibling ? `${what} ${sibling.index + 1}` : what}</span>
        {editing ? (
          <input value={name} onChange={(e) => onName(e.target.value)} className="ts-field-direct ts-cov-card-input" aria-label={ariaName} aria-invalid={issue ? true : undefined} autoFocus={name === "" && level !== "coverage"} />
        ) : (
          <span className="ts-cov-card-name">{name}</span>
        )}
        {editing && issue ? <span className="ts-form-error ts-tree-issue">{issue}</span> : null}
        {editing && sibling && sibling.count > 1 ? (
          <span className="ts-row-actions">
            <IconButton icon={<IconUp />} label={`${shown} 위로`} disabled={sibling.index === 0} onClick={() => sibling.onMove(-1)} />
            <IconButton icon={<IconDown />} label={`${shown} 아래로`} disabled={sibling.index === sibling.count - 1} onClick={() => sibling.onMove(1)} />
          </span>
        ) : null}
      </div>
      {children}
      <div className="ts-cov-card-body">{body}</div>
    </section>
  );
}

export function CoverageCards({ coverageKey, formByNode, original, attributeValueLabels, target, highlightPath, showCodes }: {
  /** 담보 자신의 노드 키 (`encodeNodeKey("coverage", id)`). */
  coverageKey: string;
  formByNode: Record<string, FormModel>;
  /** 저장된 원본 구조 — 「저장 시 삭제 N개」 셈. */
  original: StructureSavedSub[];
  attributeValueLabels: string[];
  target?: string;
  highlightPath?: string;
  showCodes?: boolean;
}) {
  const label = useEditField<string>("label");
  const structure = useEditField<StructureDraftSub[]>("structure");
  const values = useEditField<Record<string, Submission>>("values");
  const editing = label.mode === "edit";

  // 폼 인스턴스 세대 — 취소하면 모든 폼을 새로 띄워 저장값을 보인다 (`value-drafts.ts`). 렌더 중 상태 조정 (StructForm 의 지문 reset 과 같은 패턴).
  const [session, dispatchSession] = useReducer(formSessionReducer, values.mode, initFormSession);
  if (session.mode !== values.mode) dispatchSession({ mode: values.mode, values: values.value });

  const nextKey = useRef(0);
  const fresh = (prefix: string) => `new:${prefix}${nextKey.current++}`;
  const subs = structure.value;
  const update = (next: StructureDraftSub[]) => structure.setValue(next);
  const updateSub = (key: string, change: (sub: StructureDraftSub) => StructureDraftSub) => update(subs.map((sub) => (sub.key === key ? change(sub) : sub)));
  const addSub = () => update([...subs, { key: fresh("s"), name: "", benefits: [{ key: fresh("b"), name: "" }] }]);
  const addBenefit = (subKey: string) => updateSub(subKey, (sub) => ({ ...sub, benefits: [...sub.benefits, { key: fresh("b"), name: "" }] }));

  const issues = editing ? structureIssues(subs) : [];
  const issueOf = (key: string) => issues.find((i) => i.key === key)?.message;
  const removed = editing ? structureRemovals(original, subs).length : 0;

  // Q-C — 담보속성은 상품에 탑재할 때 정한다. 경고까지만 하고 저장은 막지 않는다 (거부 아님).
  // 「기본계약」이 「기본」에 먼저 걸리지 않게 긴 값부터 본다. 이름을 고치는 자리에서만 띄운다.
  const hit = editing
    ? [...attributeValueLabels].sort((a, b) => b.length - a.length).find((value) => value && label.value.includes(value))
    : undefined;

  /** 노드의 값 폼 — 저장된 노드만. 필드가 없는 레벨은 폼 자리가 없다. */
  const formOf = (key: string, isNew: boolean): ReactNode => {
    if (isNew) return <p className="ts-muted ts-cov-card-note">새 카드 — 값은 저장한 뒤 입력한다.</p>;
    const form = formByNode[key];
    if (!form || form.fields.length === 0) return null;
    return (
      <StructForm
        key={formKeyOf(session, key)}
        model={form}
        embedded
        flat
        readOnly={!editing}
        showCodes={showCodes}
        highlightPath={key === target ? highlightPath : undefined}
        onChange={(submission) => values.update((current) => ({ ...current, [key]: submission }))}
      />
    );
  };

  const scrollToCard = !highlightPath;

  const benefitCard = (sub: StructureDraftSub, benefit: StructureDraftBenefit, benefitIndex: number) => (
    <Card
      key={benefit.key}
      editing={editing}
      level="benefit"
      nodeKey={benefit.key}
      name={benefit.name}
      onName={(name) => updateSub(sub.key, (s) => ({ ...s, benefits: s.benefits.map((b) => (b.key === benefit.key ? { ...b, name } : b)) }))}
      issue={issueOf(benefit.key)}
      sibling={{
        index: benefitIndex,
        count: sub.benefits.length,
        onMove: (delta) => updateSub(sub.key, (s) => ({ ...s, benefits: moved(s.benefits, benefitIndex, delta) })),
        onRemove: () => updateSub(sub.key, (s) => ({ ...s, benefits: s.benefits.filter((b) => b.key !== benefit.key) })),
      }}
      isTarget={benefit.key === target}
      scrollToCard={scrollToCard}
      body={formOf(benefit.key, !benefit.id)}
    />
  );

  const subCard = (sub: StructureDraftSub, subIndex: number) => (
    <Card
      key={sub.key}
      editing={editing}
      level="subCoverage"
      nodeKey={sub.key}
      name={sub.name}
      onName={(name) => updateSub(sub.key, (s) => ({ ...s, name }))}
      issue={issueOf(sub.key)}
      sibling={{ index: subIndex, count: subs.length, onMove: (delta) => update(moved(subs, subIndex, delta)), onRemove: () => update(subs.filter((s) => s.key !== sub.key)) }}
      isTarget={sub.key === target}
      scrollToCard={scrollToCard}
      body={
        <>
          {formOf(sub.key, !sub.id)}
          <div className="ts-cov-benefits">{sub.benefits.map((benefit, benefitIndex) => benefitCard(sub, benefit, benefitIndex))}</div>
          {editing ? (
            <button type="button" className="ts-linklike ts-cov-add" aria-label={`${sub.name.trim() || "세부보장"}에 급부 추가`} onClick={() => addBenefit(sub.key)}>
              <IconPlus /> 급부
            </button>
          ) : null}
        </>
      }
    />
  );

  return (
    <Card
      editing={editing}
      level="coverage"
      nodeKey={coverageKey}
      name={label.value}
      onName={label.setValue}
      isTarget={coverageKey === target}
      scrollToCard={scrollToCard}
      body={
        <>
          {formOf(coverageKey, false)}
          <div className="ts-cov-grid">
            {subs.map(subCard)}
            {editing ? (
              // 그리드 마지막 칸 — 점선 타일 (편집 모드만)
              <button type="button" className="ts-cov-add-tile" aria-label="세부보장 추가" onClick={addSub}>
                <IconPlus /> 세부보장
              </button>
            ) : null}
          </div>
        </>
      }
    >
      {hit ? <p className="ts-warn">담보명에 담보속성 값이 들어 있다 — 「{hit}」. 담보속성은 상품에 탑재할 때 정하므로 담보명에서 빼는 것이 좋다.</p> : null}
      {removed > 0 ? <p className="ts-warn">저장 시 삭제 {removed}개 — 영향을 확인한 뒤 저장된다 (관리자).</p> : null}
    </Card>
  );
}
