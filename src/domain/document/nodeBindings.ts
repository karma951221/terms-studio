/**
 * 함수조항 인자의 키 경로 연결 — 문서 저장 검사 (ADR-0087 결정 4 · 8 · 기능/함수조항 §3.4 · §3.7).
 *
 * 함수조항은 값(잎) 인자만 받고, 세부보장 · 급부 레벨 구분자는 담보약관이 키 경로(「세부보장 01 › …」) 또는 감싼 담보 트리 반복의
 * 현재 노드(「현재 세부보장 › …」)로 노드를 고른다. 기본 연결은 구분자만 적어 키 경로가 없다 — 사용처가 키를 고를 때까지 `argUnbound`,
 * 단 감싼 트리 반복의 현재 노드(또는 조상) 레벨이면 저절로 풀린다(결정 8). 보통약관(문맥 담보 없음)에는 키 경로 연결이 없다.
 */
import { effectiveBindings } from "../clause/params";
import { coveredByLoop, LEVEL_WORD, nodeByKeyPath, type KeyedLevel } from "../coverage/keys";
import type { Coordinate, Issue } from "../types";
import { treeLoopLevelsAt } from "./blockRepeat";
import type { ExpressionScope } from "./expressions";
import { coordinateOf, indexTree, type ClauseGate, type DocumentNode } from "./nodes";

/**
 * 한정 없는(키 경로 · 「현재」 없는) 하위 레벨 구분자 연결이 이 자리에서 비어 있는가 — 감싼 가장 안쪽 담보 트리 반복이
 * 그 레벨을 풀지(현재 노드 또는 조상) 않으면 비어 있다(결정 8). `loops` = 감싼 트리 반복(바깥 → 안쪽). 저장 검사 · 값 패널 공용.
 */
export function unqualifiedNodeArgUnbound(level: KeyedLevel, loops: readonly { level: KeyedLevel }[]): boolean {
  const inner = loops.at(-1);
  return !inner || !coveredByLoop(level, inner.level);
}

export function nodeBindingIssues(doc: DocumentNode, gate: ClauseGate | undefined, scope: ExpressionScope, base: Coordinate = {}): Issue[] {
  if (!gate?.clauseOf || !scope.levelOf) return [];
  const ix = indexTree(doc, base);
  const out: Issue[] = [];
  for (const e of ix.nodes.values()) {
    const n = e.node;
    if (n.kind !== "clauseBlockRef" && n.kind !== "clauseInlineRef") continue;
    const clause = gate.clauseOf(n.clauseCode);
    if (!clause) continue;
    const used = gate.usageOf ? gate.usageOf(n.clauseCode, n) : { options: n.options, ...(n.bindings ? { bindings: n.bindings } : {}) };
    const loops = treeLoopLevelsAt(ix, e);
    const at = coordinateOf(ix, e, base);
    for (const [name, b] of Object.entries(effectiveBindings(clause, used.bindings))) {
      if (b.kind !== "discriminator") continue;
      const here = { ...at, refPath: `arg.${name}` };
      const level = scope.levelOf(b.code);
      const own = used.bindings?.[name] !== undefined;
      // 레벨을 모르면(없는 구분자) 건너뛴다 — 없는 구분자는 식 · 게이트 검사가 알린다
      if (level === undefined) continue;
      if (level !== "subCoverage" && level !== "benefit") {
        if (b.node) out.push({ kind: "typeMismatch", message: `인자 ${name} — ${b.code} 는 ${level === "coverage" ? "담보" : "상품 · 세목"} 레벨 구분자라 키 경로가 없습니다`, at: here });
        continue;
      }
      if (!scope.coverage) {
        if (b.node) out.push({ kind: "structure", message: `인자 ${name} — 보통약관에는 키 경로 연결이 없습니다(문맥 담보가 없다)`, at: here });
        continue;
      }
      if (b.node && "path" in b.node) {
        const node = nodeByKeyPath(scope.coverage, b.node.path);
        if (!node) out.push({ kind: "brokenRef", message: `인자 ${name} — 문맥 담보에 키 경로 ${b.node.path} 가 없습니다 — 끊어진 참조`, at: here });
        else if (node.level !== level) out.push({ kind: "typeMismatch", message: `인자 ${name} — ${LEVEL_WORD[level]} 레벨 구분자 ${b.code} 를 ${LEVEL_WORD[node.level as KeyedLevel]} ${b.node.path} 에 연결할 수 없습니다`, at: here });
        continue;
      }
      if (b.node && "current" in b.node) {
        const current = b.node.current;
        const loop = loops.find((l) => l.loop === current);
        if (!loop) out.push({ kind: "structure", message: `인자 ${name} — 감싼 담보 트리 반복 밖에서 「현재 ${LEVEL_WORD[level]}」를 연결했습니다 — 그 반복 안에서만 쓴다`, at: here });
        else if (!coveredByLoop(level, loop.level)) out.push({ kind: "typeMismatch", message: `인자 ${name} — 「현재 ${LEVEL_WORD[loop.level]}」 반복에서 ${LEVEL_WORD[level]} 레벨 구분자는 읽을 수 없습니다 — 키 경로로 고른다`, at: here });
        continue;
      }
      if (!unqualifiedNodeArgUnbound(level, loops)) continue; // 결정 8 — 현재 노드(또는 조상)로 저절로
      out.push({
        kind: "argUnbound",
        message: own
          ? `함수조항 ${clause.code} 의 인자 ${name} 은(는) ${LEVEL_WORD[level]} 레벨 구분자 ${b.code} 라 키 경로가 필요합니다 — 「${LEVEL_WORD[level]} 01 › …」처럼 키를 고른다`
          : `함수조항 ${clause.code} 의 인자 ${name} 의 기본 연결이 ${LEVEL_WORD[level]} 레벨 구분자 ${b.code} 라 키 경로가 필요합니다 — 넣는 자리에서 키를 고른다`,
        at: here,
      });
    }
  }
  return out;
}
