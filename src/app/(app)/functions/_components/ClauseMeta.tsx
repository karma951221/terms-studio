"use client";

/**
 * 함수조항 「기본정보」 — 접히는 구획 (기능/함수조항 §4.3, 2026-10-01 사용자 결정).
 *
 * - 접힌 줄이 곧 펼침 단추다: 쉐브론 · 코드 · 함수조항명 한 줄. 반환 타입 경고가 있으면 줄 끝에 경고 아이콘(건수는 tooltip).
 * - 펼치면 코드 → 함수조항명 → 반환 타입 → 요구 구분자.
 * - 열림은 브라우저마다 기억한다(저장소가 막혀 있으면 이 탭 안에서만). 기본 — 상세는 접힘(본문이 주인공), 생성은 늘 펼침(이름 · 유형을 정해야 한다).
 * - 「반환 타입」은 유형(문구 · 항 · 호 · 목)과 본문이 펴는 단위 수로 정한다(`returnTypeOf`) — 「유형」 · 「단위」 두 줄을 한 줄로 합쳤다.
 *   단위 규칙 경고(§3.1)는 그 값 아래 경고 줄로 붙는다. 저장은 막지 않는다.
 * 사용처는 이 화면에 두지 않는다 — 관계정보 메뉴의 질문이다(디자인원칙 §11.2).
 */
import { useSyncExternalStore } from "react";

import { IconChevron, IconWarn } from "@/app/_components/icons";
import { MODE_LABEL, MODE_OPTIONS, NAME_LABEL } from "@/app/_lib/labels";
import type { ClauseMode, RequiredRefs } from "@/domain/clause";

/** 반환 타입을 셀 때 보는 노드 모양 — 편집 트리(`DocumentNode`)의 블록 목록. */
type UnitNode = { kind: string; branches?: readonly { children: readonly UnitNode[] }[]; children?: readonly UnitNode[] };

const UNIT_KIND = { block: "paragraph", item: "item", subitem: "subitem" } as const;

/**
 * 본문이 펼 수 있는 단위 수의 최대 — 조건 블록은 가지 중 가장 많은 쪽, 반복 블록은 안에 단위가 있으면 둘 이상으로 편다.
 * (단위 규칙 경고의 「항이 하나뿐」은 조건 가지의 항을 모두 더해 센다 — 여기는 한 번에 펴질 수 있는 수라 가지는 하나만 친다.)
 */
function maxUnits(nodes: readonly UnitNode[], kind: string): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === kind) n += 1;
    else if (node.kind === "condBlock") n += Math.max(0, ...(node.branches ?? []).map((b) => maxUnits(b.children, kind)));
    else if (node.kind === "forBlock") n += maxUnits(node.children ?? [], kind) > 0 ? 2 : 0;
  }
  return n;
}

/**
 * 반환 타입 — 「문구」 · 「항」 · 「항 목록」 · 「호」 · 「호 목록」 · 「목」 · 「목 목록」.
 * `nodes` 는 유형의 자리 목록(항 — 조의 블록, 호 · 목 — 자리 항 · 호의 목록). 단위가 둘 이상 펴질 수 있으면 「목록」, 비었거나 하나면 단위 이름.
 */
export function returnTypeOf(mode: ClauseMode, nodes: readonly UnitNode[]): string {
  if (mode === "inline") return MODE_LABEL.inline;
  const word = MODE_LABEL[mode];
  return maxUnits(nodes, UNIT_KIND[mode]) > 1 ? `${word} 목록` : word;
}

// ── 열림 기억 — 브라우저마다. 저장소가 막혀 있으면 이 탭 안에서만 ──

const OPEN_KEY = "ts.clause.metaOpen";
const listeners = new Set<() => void>();
let chosen: boolean | undefined;

function readOpen(): boolean {
  if (chosen !== undefined) return chosen;
  try {
    return window.localStorage.getItem(OPEN_KEY) === "open";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useMetaOpen(): [boolean, (next: boolean) => void] {
  const open = useSyncExternalStore(subscribe, readOpen, () => false);
  const set = (next: boolean) => {
    chosen = next;
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "open" : "closed");
    } catch {
      /* 기억만 못 한다 */
    }
    listeners.forEach((l) => l());
  };
  return [open, set];
}

export interface ClauseMetaProps {
  /** 없으면 생성 화면 — 늘 펼치고 유형을 고른다. */
  code?: string;
  editing: boolean;
  /** 접힌 줄에 보이는 이름 — 생성 중이면 입력 중인 이름. */
  name: string;
  /** 저장된 이름 (읽기 모드 값). */
  savedLabel: string;
  label: string;
  onLabel: (next: string) => void;
  mode: ClauseMode;
  /** 생성 화면 — 본문을 쓰기 시작하면 잠긴다. */
  modeLocked: boolean;
  onMode: (next: ClauseMode) => void;
  /** 반환 타입을 셀 자리 목록 (`returnTypeOf`). */
  unitNodes: readonly UnitNode[];
  required?: RequiredRefs;
  /** 단위 규칙 경고 (저장된 정의 기준, §3.1). */
  warnings?: readonly string[];
}

export function ClauseMeta(props: ClauseMetaProps) {
  const { code, editing, mode } = props;
  const isNew = code === undefined;
  const [storedOpen, setOpen] = useMetaOpen();
  const open = isNew || storedOpen;
  const warnings = isNew ? [] : (props.warnings ?? []);
  const returnType = returnTypeOf(mode, props.unitNodes);
  const modeHint = MODE_OPTIONS.find((o) => o.value === mode)?.hint;

  return (
    <section className="ts-clause-meta ts-basics" aria-label="함수조항 기본정보">
      {isNew ? null : (
        <button type="button" className="ts-basics-head" aria-expanded={open} aria-controls="clause-meta-body" onClick={() => setOpen(!open)} title={open ? "기본정보 접기" : "기본정보 펼치기"}>
          <IconChevron className={open ? "is-open" : undefined} />
          <span className="ts-mono ts-muted">{code}</span>
          <span className="ts-basics-name">{props.name}</span>
          {!open && warnings.length > 0 ? (
            <span className="ts-clause-meta-warn" title={warnings.join("\n")}>
              <IconWarn />
              <span className="sr-only">경고 {warnings.length}건</span>
            </span>
          ) : null}
        </button>
      )}
      {open ? (
        <div id="clause-meta-body" className={isNew ? undefined : "ts-basics-body"}>
          {!isNew && (
            <div className="ts-form-row">
              <span className="ts-form-label">코드</span>
              <span className="ts-clause-meta-value ts-mono">{code}</span>
            </div>
          )}
          <div className="ts-form-row">
            <label htmlFor="clause-label">{NAME_LABEL.clause}</label>
            {editing ? (
              <input id="clause-label" className="ts-field-direct" value={props.label} onChange={(e) => props.onLabel(e.target.value)} placeholder="예: 특별약관의 소멸" autoFocus={isNew} />
            ) : (
              <span className="ts-clause-meta-value">{props.savedLabel}</span>
            )}
          </div>
          <div className="ts-form-row">
            <span className="ts-form-label" id="clause-mode-label">
              반환 타입
            </span>
            {isNew ? (
              <div className="ts-clause-mode" role="radiogroup" aria-labelledby="clause-mode-label">
                {MODE_OPTIONS.map((o) => (
                  <label key={o.value} className={`ts-clause-mode-option${mode === o.value ? " is-on" : ""}`}>
                    <input type="radio" name="clause-mode" value={o.value} checked={mode === o.value} disabled={props.modeLocked && mode !== o.value} onChange={() => props.onMode(o.value)} />
                    <span className="ts-clause-mode-name">{o.label}</span>
                    <span className="ts-clause-mode-hint">{o.hint}</span>
                  </label>
                ))}
                {props.modeLocked ? <p className="ts-muted ts-clause-sec-note">본문을 쓰기 시작해서 반환 타입이 잠겼다 — 바꾸려면 본문을 비운다.</p> : null}
              </div>
            ) : (
              <div className="ts-clause-meta-value">
                <span title={`반환 타입은 생성 때 정한 유형(${MODE_LABEL[mode]})과 본문이 펴는 단위 수로 정해진다 — ${modeHint ?? ""}`}>{returnType}</span>
                {warnings.length > 0 ? (
                  <ul className="ts-clause-warnings" aria-label="단위 규칙 경고">
                    {warnings.map((w) => (
                      <li key={w} className="ts-warn">
                        <IconWarn /> {w}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </div>
          {!isNew && (
            <div className="ts-form-row">
              <span className="ts-form-label">요구 구분자</span>
              <span className="ts-clause-meta-value ts-mono">
                {props.required && props.required.discriminators.length > 0 ? props.required.discriminators.join(" · ") : <span className="ts-muted">없음 — 저장 때 식에서 뽑는다</span>}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
