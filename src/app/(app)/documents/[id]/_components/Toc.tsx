"use client";

/**
 * L3 좌측 목차 — **관 › 조** 두 단계 (기능/문면 §4.3). 항 · 호로 내려가지 않는다.
 *
 * - 조를 누르면 가운데에 그 조 하나가 열린다. 관을 누르면 그 관의 첫 조로 간다 — 조가 없는 관은 누를 수 없다.
 * - 관은 접고 편다. 현재 조는 주칠로 표시하고, 목차 스크롤이 현재 조를 따라간다(접힌 관이면 편다).
 * - 조건 블록은 투명하다 — 블록 안 조 · 관도 제자리 순서대로 싣는다.
 * - 편집 모드(`drag`)면 조 · 관 줄을 끌어 옮긴다 — Shift 를 누른 채 누르면 지금 조부터 그 조까지 고르고, 고른 것 하나를 끌면 전부 간다.
 *   본문에서 끈 항 · 호 · 표 …를 조 줄에 놓으면 그 조 끝으로 간다 (`useBlockDrag`, 2026-09-28).
 */
import { useEffect, useRef, useState } from "react";

import type { ArticleNode, DocumentNode, Node, NodeNumber, SectionNode } from "@/domain/document";
import type { Id } from "@/domain/types";

import type { BlockDrag } from "./useBlockDrag";

/** 조건 블록을 투명하게 펼쳐 조만 순서대로. */
export function articlesOf(tree: DocumentNode | SectionNode): ArticleNode[] {
  const out: ArticleNode[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind === "article") out.push(n);
      else if (n.kind === "section") walk(n.children);
      else if (n.kind === "condBlock") for (const br of n.branches) walk(br.children);
    }
  };
  walk(tree.children);
  return out;
}

export type TocEntry = { kind: "section"; section: SectionNode; articles: ArticleNode[] } | { kind: "article"; article: ArticleNode };

/** 목차 줄 — 관은 자기 조를 품고, 관 밖 조는 한 단계로 선다. */
export function tocOf(tree: DocumentNode): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (nodes: readonly Node[]): void => {
    for (const n of nodes) {
      if (n.kind === "article") out.push({ kind: "article", article: n });
      else if (n.kind === "section") out.push({ kind: "section", section: n, articles: articlesOf(n) });
      else if (n.kind === "condBlock") for (const br of n.branches) walk(br.children);
    }
  };
  walk(tree.children);
  return out;
}

export function Toc({
  tree,
  numbers,
  currentArticleId,
  onPick,
  drag,
}: {
  tree: DocumentNode;
  numbers: ReadonlyMap<Id, NodeNumber>;
  currentArticleId?: Id;
  /** 조를 누르면 — 가운데에 그 조를 연다. */
  onPick: (articleId: Id) => void;
  /** 편집 모드 — 조 · 관 끌어 옮기기 · 여러 조 고르기. */
  drag?: BlockDrag;
}) {
  const entries = tocOf(tree);
  const [folded, setFolded] = useState<ReadonlySet<Id>>(new Set());
  const navRef = useRef<HTMLElement>(null);

  // 현재 조가 접힌 관 안이면 편다 — 렌더 중 상태 조정 (현재 조가 바뀐 때만)
  const [seen, setSeen] = useState(currentArticleId);
  if (seen !== currentArticleId) {
    setSeen(currentArticleId);
    const owner = entries.find((e) => e.kind === "section" && e.articles.some((a) => a.id === currentArticleId));
    if (owner && owner.kind === "section" && folded.has(owner.section.id)) setFolded(new Set([...folded].filter((id) => id !== owner.section.id)));
  }

  useEffect(() => {
    navRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [currentArticleId, folded]);

  const picked = (id: Id) => (drag?.blockSel.includes(id) ? " is-block-sel" : "");
  /** 편집 모드의 줄 — 끌 수 있고(`data-drag`), 놓을 자리다(`data-toc-node`). Shift+누르기는 고르기만(가운데는 그대로). */
  const dragAttrs = (id: Id) => (drag ? { draggable: true, "data-drag": id, "data-toc-node": id } : {});
  const pick = (id: Id, go: () => void) => (e: { shiftKey: boolean }) => {
    if (drag && e.shiftKey) {
      // 처음 고르는 것이면 지금 조부터
      if (drag.blockSel.length === 0 && currentArticleId) drag.selectBlock(currentArticleId, false);
      drag.selectBlock(id, true);
      return;
    }
    drag?.clearSel();
    go();
  };

  const articleRow = (a: ArticleNode, nested: boolean) => {
    const label = `${numbers.get(a.id)?.label ?? "조"}(${a.title})`;
    return (
      <button
        key={a.id}
        type="button"
        className={`ts-toc-article${nested ? " is-nested" : ""}${picked(a.id)}`}
        title={drag ? `${label} — 끌어 옮기기 · Shift+누르기로 여럿 고르기` : label}
        aria-current={a.id === currentArticleId ? "true" : undefined}
        onClick={pick(a.id, () => onPick(a.id))}
        {...dragAttrs(a.id)}
      >
        {label}
      </button>
    );
  };

  return (
    <nav ref={navRef} className="ts-l3-toc" aria-label="관 · 조 목차" {...(drag ? drag.props : {})}>
      {entries.length === 0 ? (
        <p className="ts-muted">조 없음</p>
      ) : (
        entries.map((e) => {
          if (e.kind === "article") return articleRow(e.article, false);
          const s = e.section;
          const open = !folded.has(s.id);
          const label = `${numbers.get(s.id)?.label ?? "관"} ${s.title}`;
          const first = e.articles[0];
          return (
            <div key={s.id} className="ts-toc-section">
              <div className={`ts-toc-section-row${picked(s.id)}`} {...dragAttrs(s.id)}>
                <button
                  type="button"
                  className="ts-toc-fold"
                  aria-expanded={open}
                  aria-label={`${label} ${open ? "접기" : "펴기"}`}
                  onClick={() => setFolded(open ? new Set([...folded, s.id]) : new Set([...folded].filter((id) => id !== s.id)))}
                >
                  {open ? "▾" : "▸"}
                </button>
                <button type="button" className="ts-toc-section-name" title={first ? `${label} — 첫 조로` : `${label} — 조가 없다`} disabled={!first} onClick={pick(s.id, () => first && onPick(first.id))}>
                  {label}
                </button>
              </div>
              {open && e.articles.map((a) => articleRow(a, true))}
            </div>
          );
        })
      )}
    </nav>
  );
}
