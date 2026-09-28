"use client";

/**
 * 조 참조 대상 고르기 — 관 › 조 › 항 › 호 › 목 트리 (기능/문면 §4.3).
 *
 * - 처음엔 조까지만 보이고(접힘), 줄 앞 ▸ 로 하위를 편다. 고치기로 열면 이미 고른 대상의 조상이 펴져 있다.
 * - 조 · 항 · 호 · 목 어느 단계든 고를 수 있고 여럿 고른다. 고른 값은 숨은 `targets` 칸으로 문서 순서대로 폼에 실린다.
 * - 관은 묶음 머리(좌측 목차와 같은 「제N관 이름」)일 뿐 고를 수 없다.
 * - 키보드: ↑ ↓ 줄 이동 · → 펴기(펴져 있으면 첫 하위) · ← 접기(접혀 있으면 상위) · Space 고르기(체크박스 기본).
 * - 위 검색칸에 치면 번호 · 제목이 맞는 줄과 그 조상만 남고 조상은 펴진다. 맞은 글자는 검색 입력(콤보박스)과 같이 강조한다
 *   (디자인원칙 §2.6 — 여럿을 고르는 트리라 콤보박스 대신 같은 거르기 · 강조를 트리에 붙인다). 검색칸에서 ↓ 는 첫 줄로.
 */
import { useMemo, useState, type KeyboardEvent } from "react";

import { COMBO_EMPTY_TEXT, Highlight } from "@/app/_components/Combobox";
import { matchOption, tokensOf } from "@/app/_components/comboModel";

import { referenceAncestorIds, referenceOutline, type ReferenceOutlineNode, type ReferenceTarget } from "@/domain/document";
import type { Id } from "@/domain/types";

export interface RefTargetScope {
  key: string;
  /** 묶음 머리 — 범위가 하나뿐이면 생략. */
  label?: string;
  index: ReadonlyMap<Id, ReferenceTarget>;
}

export function RefTargetTree({
  id,
  scopes,
  defaultSelected,
  onCountChange,
}: {
  id: string;
  scopes: readonly RefTargetScope[];
  defaultSelected: readonly Id[];
  /** 고른 개수가 바뀔 때 — 연결어 라디오를 켜고 끈다. */
  onCountChange?: (count: number) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<Id>>(() => new Set(defaultSelected));
  const [open, setOpen] = useState<ReadonlySet<Id>>(() => new Set(scopes.flatMap((s) => [...referenceAncestorIds(s.index, defaultSelected)])));
  const [query, setQuery] = useState("");
  const outlines = useMemo(() => scopes.map((s) => ({ ...s, groups: referenceOutline(s.index) })), [scopes]);
  const searching = tokensOf(query).length > 0;
  const byId = useMemo(() => {
    const out = new Map<Id, ReferenceOutlineNode>();
    const walk = (n: ReferenceOutlineNode) => {
      out.set(n.id, n);
      n.children.forEach(walk);
    };
    for (const s of outlines) for (const g of s.groups) g.rows.forEach(walk);
    return out;
  }, [outlines]);
  /** 검색 중 남길 줄 — 제가 맞거나 후손이 맞는 줄. */
  const hits = useMemo(() => {
    const keep = new Set<Id>();
    if (!searching) return keep;
    const walk = (n: ReferenceOutlineNode): boolean => {
      const below = n.children.map(walk).some(Boolean);
      const hit = below || matchOption({ value: n.id, label: n.label }, query);
      if (hit) keep.add(n.id);
      return hit;
    };
    for (const s of outlines) for (const g of s.groups) g.rows.forEach(walk);
    return keep;
  }, [outlines, query, searching]);
  const shown = (n: ReferenceOutlineNode) => !searching || hits.has(n.id);
  /** 펴짐 — 직접 편 줄, 또는 검색 중 맞은 후손이 있는 줄. */
  const isOpen = (nodeId: Id) => open.has(nodeId) || (searching && (byId.get(nodeId)?.children.some((c) => hits.has(c.id)) ?? false));

  const toggleOpen = (nodeId: Id, next?: boolean) =>
    setOpen((prev) => {
      const on = next ?? !prev.has(nodeId);
      if (on === prev.has(nodeId)) return prev;
      const out = new Set(prev);
      if (on) out.add(nodeId);
      else out.delete(nodeId);
      return out;
    });
  const toggleSelected = (nodeId: Id) => {
    const out = new Set(selected);
    if (out.has(nodeId)) out.delete(nodeId);
    else out.add(nodeId);
    setSelected(out);
    onCountChange?.(out.size);
  };

  /** 접힌 줄 아래에 고른 것이 몇 개 숨어 있나 — 접어도 고른 사실이 보이게. */
  const hiddenPicked = (n: ReferenceOutlineNode): number => n.children.reduce((sum, c) => sum + (selected.has(c.id) ? 1 : 0) + hiddenPicked(c), 0);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const box = event.target as HTMLElement;
    const row = box.closest<HTMLElement>("[data-ref-row]");
    if (!row || box.tagName !== "INPUT") return;
    const nodeId = row.dataset.refRow as Id;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-ref-row]")];
    const at = rows.indexOf(row);
    const focus = (r?: HTMLElement) => r?.querySelector<HTMLInputElement>("input")?.focus();
    const expandable = row.dataset.refExpandable === "true";
    switch (event.key) {
      case "ArrowDown":
        focus(rows[at + 1]);
        break;
      case "ArrowUp":
        focus(rows[at - 1]);
        break;
      case "ArrowRight":
        if (expandable && !isOpen(nodeId)) toggleOpen(nodeId, true);
        else if (expandable) focus(rows[at + 1]);
        break;
      case "ArrowLeft":
        if (expandable && isOpen(nodeId)) toggleOpen(nodeId, false);
        else focus(event.currentTarget.querySelector<HTMLElement>(`[data-ref-row="${row.dataset.refParent}"]`) ?? undefined);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const renderRow = (n: ReferenceOutlineNode, depth: number, parentId?: Id) => {
    if (!shown(n)) return null;
    const expandable = n.children.length > 0;
    const rowOpen = expandable && isOpen(n.id);
    const hidden = expandable && !rowOpen ? hiddenPicked(n) : 0;
    return (
      <li key={n.id} role="none">
        <div
          className="ts-ref-row"
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected.has(n.id)}
          aria-expanded={expandable ? rowOpen : undefined}
          data-ref-row={n.id}
          data-ref-parent={parentId}
          data-ref-expandable={expandable}
          style={{ paddingLeft: depth * 16 }}
        >
          {expandable ? (
            <button type="button" className="ts-ref-fold" tabIndex={-1} aria-label={`${n.label} ${rowOpen ? "접기" : "펴기"}`} onClick={() => toggleOpen(n.id)}>
              {rowOpen ? "▾" : "▸"}
            </button>
          ) : (
            <span className="ts-ref-fold" aria-hidden />
          )}
          <label className="ts-ref-pick">
            <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggleSelected(n.id)} />
            <Highlight text={n.label} query={query} />
          </label>
          {hidden > 0 && <span className="ts-ref-hidden">고름 {hidden}</span>}
        </div>
        {rowOpen && (
          <ul role="group" className="ts-ref-list">
            {n.children.map((c) => renderRow(c, depth + 1, n.id))}
          </ul>
        )}
      </li>
    );
  };

  const empty = outlines.every((s) => s.groups.length === 0);
  const scopeShown = (s: (typeof outlines)[number]) => s.groups.some((g) => g.rows.some(shown));
  return (
    <>
      {!empty && (
        <input
          type="search"
          className="ts-ref-search"
          aria-label="참조 대상 검색"
          aria-controls={id}
          placeholder="조 번호 · 제목으로 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter 는 폼을 내지 않는다 · ↓ 는 첫 줄로
            if (e.key === "Enter") e.preventDefault();
            if (e.key !== "ArrowDown") return;
            e.preventDefault();
            document.getElementById(id)?.querySelector<HTMLInputElement>("[data-ref-row] input")?.focus();
          }}
        />
      )}
      <div id={id} className="ts-ref-tree" role="tree" aria-multiselectable="true" aria-label="참조 대상" onKeyDown={onKeyDown}>
        {outlines.map((s) =>
          // 숨은 칸 — 문서 순서대로 (예전 다중 선택 목록과 같은 순서)
          [...s.index.keys()].filter((nodeId) => selected.has(nodeId)).map((nodeId) => <input key={`${s.key}:v:${nodeId}`} type="hidden" name="targets" value={nodeId} />),
        )}
        {empty && <p className="ts-muted">고를 조가 없다.</p>}
        {searching && hits.size === 0 && <p className="ts-muted">{COMBO_EMPTY_TEXT}</p>}
        {outlines.map((s) => (
          <div key={s.key} role="none" hidden={searching && !scopeShown(s)}>
            {s.label && <div className="ts-ref-scope">{s.label}</div>}
            {s.groups.map((g, i) => (
              <div key={g.section?.id ?? `${s.key}:free:${i}`} role="none" hidden={searching && !g.rows.some(shown)}>
                {g.label && <div className="ts-ref-section">{g.label}</div>}
                <ul role="group" className="ts-ref-list">
                  {g.rows.map((r) => renderRow(r, 0))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
