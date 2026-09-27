"use client";

/**
 * 조건 팝업의 「담보 구분자」 탭 — 담보 뿌리 → 세부보장 → 급부, 노드마다 그 레벨 구분자를 잎으로 (ADR-0066 §6).
 * 잎을 더블클릭하면 좌변이면 그 구분자, 우변이면 같은 참조를 노드 한정자(`@id`)로 문맥에 담아 고른다.
 *
 * 반복 표 템플릿 셀에서 열면(`context.row`) 맨 위에 **「현재 행」** 가지가 선다 (ADR-0070 · 설계 §3.1) —
 * 행 레벨과 그 위 레벨의 구분자를 **한정자 없이** 고른다(행마다 그 행 노드에서 읽힌다). 그 아래 실제 노드 트리는 그대로(`@노드` 고정).
 * `accept` 로 잎을 거를 수 있다 (슬롯은 string · enum 결과만).
 */
import type { ReactNode } from "react";

import type { DiscriminatorRef } from "@/domain/expression";
import { findForm } from "@/domain/master";
import { ATTACH_LEVEL_LABEL } from "@/domain/types";

import type { ConditionContext, CtxDiscriminator, CtxNode } from "./types";

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

const TREE_LEVELS = ["coverage", "subCoverage", "benefit"] as const;

export function DiscriminatorTree({
  context,
  query,
  onPick,
  accept = () => true,
}: {
  context: ConditionContext;
  query: string;
  onPick: (ref: DiscriminatorRef) => void;
  accept?: (d: CtxDiscriminator) => boolean;
}) {
  const nodes = context.coverage?.nodes ?? [];
  const q = query.trim();

  const childrenOf = (parentId: string | undefined) => nodes.filter((n) => n.parentId === parentId);
  const leavesOf = (node: CtxNode) => context.discriminators.filter((d) => d.level === node.level && accept(d));
  const badgesOf = (node: CtxNode) => (context.openedForms[node.id] ?? []).map((key) => findForm(key)?.label ?? key);

  const nodeMatches = (node: CtxNode): boolean => {
    if (q === "") return true;
    if (matches(node.name, q)) return true;
    if (leavesOf(node).some((d) => matches(d.label, q))) return true;
    return childrenOf(node.id).some((c) => nodeMatches(c));
  };

  const renderNode = (node: CtxNode): ReactNode => {
    if (!nodeMatches(node)) return null;
    const nodeHit = q === "" || matches(node.name, q);
    const leaves = leavesOf(node).filter((d) => nodeHit || matches(d.label, q));
    const kids = childrenOf(node.id).map(renderNode).filter((n): n is ReactNode => n !== null);
    return (
      <li key={node.id}>
        <div className="ts-cond-tree-node">
          <span>{node.name}</span>
          {badgesOf(node).map((b) => (
            <span key={b} className="ts-badge">
              {b}
            </span>
          ))}
        </div>
        {leaves.length > 0 && (
          <ul className="ts-cond-tree-leaves">
            {leaves.map((d) => (
              <li key={d.code}>
                <button
                  type="button"
                  className="ts-cond-tree-leaf"
                  onDoubleClick={() => onPick(node.level === "coverage" ? { kind: "discriminator", code: d.code } : { kind: "discriminator", code: d.code, node: { id: node.id } })}
                >
                  {d.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {kids.length > 0 && <ul>{kids}</ul>}
      </li>
    );
  };

  // 「현재 행」 가지 — 반복 표 셀에서만. 레벨마다 한정자 없는 잎 (바깥 레벨부터).
  const row = context.row;
  const rowGroups = row
    ? TREE_LEVELS.filter((l) => row.readable.includes(l))
        .map((level) => ({ level, leaves: context.discriminators.filter((d) => d.level === level && accept(d) && (q === "" || matches(d.label, q))) }))
        .filter((g) => g.leaves.length > 0)
    : [];
  const rowLabel = row ? row.levels.map((l) => ATTACH_LEVEL_LABEL[l]).join(" › ") : "";
  const rowBranch = row ? (
    <li key="__row" className="ts-cond-tree-row">
      <div className="ts-cond-tree-node" title="행마다 그 행의 노드에서 읽는다 — 한정자 없음">
        <span>현재 행</span>
        <span className="ts-badge">{rowLabel}마다</span>
      </div>
      {rowGroups.length === 0 ? (
        <p className="ts-muted">고를 구분자가 없다.</p>
      ) : (
        <ul>
          {rowGroups.map((g) => (
            <li key={g.level}>
              <div className="ts-cond-tree-node">
                <span>{ATTACH_LEVEL_LABEL[g.level]}</span>
              </div>
              <ul className="ts-cond-tree-leaves">
                {g.leaves.map((d) => (
                  <li key={d.code}>
                    <button type="button" className="ts-cond-tree-leaf" aria-label={`현재 행 ${d.label}`} onDoubleClick={() => onPick({ kind: "discriminator", code: d.code })}>
                      {d.label}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </li>
  ) : null;

  const root = nodes.find((n) => n.level === "coverage");
  if (!root) return <p className="ts-muted">담보 문맥이 없다.</p>;
  return (
    <ul className="ts-cond-tree-root">
      {rowBranch}
      {renderNode(root)}
    </ul>
  );
}
