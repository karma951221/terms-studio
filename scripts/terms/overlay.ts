/**
 * 담보속성 조건 오버레이 — 원문 한 벌에 조건 노드를 얹는다 (개발 도구 — 제품 기능 아님).
 *
 * 원문이 두 벌(예: 비갱신형 · 갱신형)로 갈릴 때, 차이가 나는 자리에만 `inlineCond`(문장 중간 어구) ·
 * `condBlock`(조 자리 on/off) 을 세워 **문서 하나 · 담보 하나**로 두 벌을 낸다 (ADR-0003).
 * 식(`when`)은 설정 데이터(`config.ts`)에 있고 여기서는 노드만 만든다 — 조건의 의미는 조립이 평가한다.
 *
 * 노드 id 는 결정적이다: 조 id + `-c<순번>` · 가지는 `-t`(참) / `-e`(else).
 */
import type { ArticleNode, DocumentNode, InlineNode } from "../../src/domain/document/nodes";
import type { Id } from "../../src/domain/types";
import type { ArticleCondOverlay, InlineCondOverlay } from "./config";

/** 조 id → 원문 조 번호 (오버레이가 조를 찾는 열쇠). */
export type NumberOf = ReadonlyMap<Id, string>;

/** 문서의 조를 순서대로 (관 안의 조 포함). */
export function* articlesOf(tree: DocumentNode): Generator<ArticleNode> {
  for (const c of tree.children) {
    if (c.kind === "article") yield c;
    else if (c.kind === "section") for (const a of c.children) if (a.kind === "article") yield a;
  }
}

/**
 * 조 하나에서 평문이 서는 자리 — 항·호·목 본문과 **조 직속 표**의 셀 (렌더 순서).
 * `children` 은 실제 배열이라 `splice` 로 제자리에서 고칠 수 있다. 조건 오버레이와 참조 변환이 같은 집합을 본다.
 */
export function inlineOwnersOf(a: ArticleNode): { id: Id; children: InlineNode[] }[] {
  const owners: { id: Id; children: InlineNode[] }[] = [];
  for (const c of a.children) {
    if (c.kind === "table") {
      c.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => owners.push({ id: `${c.id}-r${ri}c${ci}`, children: cell })));
      continue;
    }
    if (c.kind !== "paragraph") continue;
    owners.push(c);
    for (const it of c.items ?? []) {
      if (it.kind !== "item") continue;
      owners.push(it);
      for (const u of it.subitems ?? []) if (u.kind === "subitem") owners.push(u);
    }
  }
  return owners;
}

/** 지정 조를 찾는다 (오버레이의 원문 조 번호로). */
function articleByNumber(tree: DocumentNode, numberOf: NumberOf, number: string): ArticleNode | undefined {
  return [...articlesOf(tree)].find((x) => numberOf.get(x.id) === number);
}

/**
 * 조건 오버레이 ① — 지정 조에서 `find` 첫 등장을 `inlineCond` 로 쪼갠다 (**참조 변환 전**에 얹는다).
 * 가지 안은 평문으로 두고 `convertText` 가 참조를 푼다 — 가지마다 조 참조 나열이 통째로 갈리는 자리(준용규정)가 있다.
 * 바꾼 자리는 더 이상 텍스트 노드가 아니므로 같은 `find` 를 쓰는 다음 오버레이는 그 다음 등장을 집는다 (슬롯 오버레이와 같은 규약).
 */
export function applyInlineConds(tree: DocumentNode, numberOf: NumberOf, conds: readonly InlineCondOverlay[], report: string[]): void {
  const seq = new Map<Id, number>();
  for (const cond of conds) {
    const a = articleByNumber(tree, numberOf, cond.article);
    if (!a) {
      report.push(`조건 오버레이: 조 ${cond.article} 없음`);
      continue;
    }
    const owner = inlineOwnersOf(a).find((o) => o.children.some((n) => n.kind === "text" && n.text.includes(cond.find)));
    if (!owner) {
      report.push(`조건 오버레이: 조 ${cond.article} 에서 「${cond.find}」 을 찾지 못함`);
      continue;
    }
    const n = (seq.get(a.id) ?? 0) + 1;
    seq.set(a.id, n);
    const id = `${a.id}-c${n}`;
    const at = owner.children.findIndex((x) => x.kind === "text" && x.text.includes(cond.find));
    const node = owner.children[at] as Extract<InlineNode, { kind: "text" }>;
    const i = node.text.indexOf(cond.find);
    const before = node.text.slice(0, i);
    const after = node.text.slice(i + cond.find.length);
    owner.children.splice(at, 1, ...[
      ...(before ? [{ id: `${id}a`, kind: "text" as const, text: before }] : []),
      {
        id,
        kind: "inlineCond" as const,
        branches: [
          { id: `${id}-t`, when: cond.when, children: [{ id: `${id}-t-x0`, kind: "text" as const, text: cond.then }] },
          { id: `${id}-e`, children: [{ id: `${id}-e-x0`, kind: "text" as const, text: cond.else }] },
        ],
      },
      ...(after ? [{ id: `${id}b`, kind: "text" as const, text: after }] : []),
    ]);
  }
}

/**
 * 조건 오버레이 ② — 지정 조를 `condBlock` 으로 감싼다 (**맨 끝**에 얹는다 — 조 순회·참조 변환이 조를 그대로 보게).
 * 꺼진 가지의 조는 조립에서 빠지고 뒤 조 번호가 당겨진다. 그 조를 가리키는 참조가 있으면 조립이 `articleGone` 으로 잡는다.
 */
export function applyArticleConds(tree: DocumentNode, numberOf: NumberOf, conds: readonly ArticleCondOverlay[], report: string[]): void {
  for (const cond of conds) {
    const a = articleByNumber(tree, numberOf, cond.article);
    const lists: DocumentNode["children"][] = [tree.children, ...tree.children.filter((c) => c.kind === "section").map((c) => c.children as DocumentNode["children"])];
    const list = a && lists.find((l) => l.includes(a));
    if (!a || !list) {
      report.push(`조 조건 오버레이: 조 ${cond.article} 없음`);
      continue;
    }
    list.splice(list.indexOf(a), 1, { id: `${a.id}-c`, kind: "condBlock", branches: [{ id: `${a.id}-c-t`, when: cond.when, children: [a] }] });
  }
}
