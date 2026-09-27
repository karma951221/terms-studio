"use client";

/**
 * 노드 삭제 확인 카드 — 우측 패널 전체를 차지한다 (디자인원칙 §9.5 · 리뷰 #33).
 *
 * ADR-0074: 지우는 것은 **편집본**이다 — 「저장하면 사라집니다」. 저장 전에는 `취소`(✕)로 되돌아온다.
 * - 함께 사라지는 것(항 2 · 호 5 …)은 편집본 트리에서 센다.
 * - 이 문서의 조 참조가 가리키면 지울 수 없다 — 참조처로 가는 버튼을 준다 (도메인 `remove` 가 거부하는 조건과 같다).
 * - 다른 문서의 조연결 · 보통약관 조 참조는 원본 기준으로 받아 보인다 — 저장 때 서버가 다시 세고 확인을 묻는다.
 */
import { useEffect, useState } from "react";

import { coordinateHref } from "@/app/_components/coordinateHref";
import { formatCoordinate } from "@/domain/coordinate";
import type { ArticleNode, DocumentNode, Node } from "@/domain/document";
import type { Coordinate, Id } from "@/domain/types";

import { articleUsagesAction } from "../../edit-actions";
import { cascadeOf, internalReferrers, subtreeIds } from "./loss";

export function RemoveCard({
  documentId,
  tree,
  node,
  what,
  articles,
  inOriginal,
  onRemove,
  onCancel,
  onGo,
}: {
  documentId: Id;
  /** 편집본 트리. */
  tree: DocumentNode;
  node: Node;
  /** 「제3조(면책)」 · 「제2항」. */
  what: string;
  articles: readonly ArticleNode[];
  /** 원본에도 있는 노드인가 — 새로 넣은 노드는 다른 문서가 가리킬 수 없다. */
  inOriginal: boolean;
  onRemove: () => void;
  onCancel: () => void;
  /** 참조처로 — 그 자리를 우측 패널에 싣는다. */
  onGo: (nodeId: Id) => void;
}) {
  const [outside, setOutside] = useState<Coordinate[] | undefined>(node.kind === "article" && inOriginal ? undefined : []);
  useEffect(() => {
    if (node.kind !== "article" || !inOriginal) return;
    let live = true;
    articleUsagesAction(documentId, node.id).then((found) => {
      if (live) setOutside(found);
    });
    return () => {
      live = false;
    };
  }, [documentId, node.id, node.kind, inOriginal]);

  const cascade = cascadeOf(node);
  const blockers = internalReferrers(tree, subtreeIds(node));
  const titleOf = (id: Id | undefined) => articles.find((a) => a.id === id)?.title;

  return (
    <section className="ts-confirm" aria-label={`${what} 삭제 확인`}>
      <p className="ts-confirm-title">{what} 삭제 — 저장하면 사라집니다</p>
      <ul className="ts-confirm-loss">
        <li>편집본에서 지운다. 「저장」해야 원본에서 사라지고, 저장 전에는 편집 취소(✕)로 되돌아온다.</li>
        {cascade.length > 0 ? (
          <li>
            함께 사라진다:
            <ul>
              {cascade.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </li>
        ) : null}
        {blockers.length > 0 && (
          <li>
            이 템플릿의 조 참조 {blockers.length}건이 가리키고 있어 지울 수 없다 — 참조를 먼저 고친다:
            <ul>
              {blockers.map((b, i) => (
                <li key={i}>
                  {b.what}
                  {b.articleId ? ` · ${titleOf(b.articleId) ?? "조"}` : ""}{" "}
                  {b.articleId && (
                    <button type="button" className="ts-doc-pick" onClick={() => onGo(b.articleId!)}>
                      그 자리로
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </li>
        )}
        {outside === undefined ? (
          <li className="ts-muted">다른 문서의 참조를 세는 중…</li>
        ) : outside.length > 0 ? (
          <li>
            저장하면 다른 문서의 참조 {outside.length}건이 깨진다 (저장 때 다시 확인한다):
            <ul>
              {outside.map((c, i) => {
                const href = coordinateHref(c);
                return (
                  <li key={i}>
                    {formatCoordinate(c, { source: true })}
                    {href && (
                      <>
                        {" "}
                        · <a href={href}>고치러 가기</a>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ) : null}
      </ul>
      <div className="ts-confirm-actions">
        {blockers.length === 0 && (
          <button type="button" className="danger" onClick={onRemove}>
            {what} 삭제
          </button>
        )}
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </section>
  );
}
