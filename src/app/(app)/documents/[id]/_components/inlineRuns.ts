/**
 * 가운데 본문의 문장 편집기(`InlineEditor`) → `setInlines` 명령 (순수 — React · DOM 없음. `inlineRuns.test.ts`).
 *
 * 편집기는 문장 자리 하나(항 · 호 · 목의 문장, 문장 안 조건의 가지, 표 셀)를 contentEditable 하나로 그린다.
 * 문장은 글자로, 칩(슬롯 · 참조 · 문장 안 조건 …)은 고칠 수 없는 덩어리로 들어 있다. 편집을 마치면(초점이 떠나면)
 * DOM 을 조각(`Token`) 목록으로 읽고, 여기서 지금 목록과 맞춰 `InlineRun` 목록을 만든다.
 *
 * - 칩 사이의 글자 구간마다 지금 목록의 문장 id 를 다시 쓴다 — 명령 목록이 같은 문장을 가리켜 저장 재적용이 흔들리지 않는다.
 * - 지워진 칩(Backspace)은 목록에서 빠진다 — 칩 양옆 글자는 한 구간으로 합쳐진다.
 * - 커서 자리(`caret`)에 새 칩을 넣으면 그 구간의 문장이 둘로 갈린다 (오른쪽 클릭 › 넣기).
 */
import type { IdSource, InlineNode, InlineRun } from "@/domain/document";
import type { Id } from "@/domain/types";

export type Token = { text: string } | { chip: Id } | { caret: true };

/** contentEditable 이 끼워 넣는 글자를 문면 글자로 — nbsp 는 공백, 폭 없는 공백 · 줄바꿈은 버린다. */
export function cleanText(raw: string): string {
  return raw.replace(/ /g, " ").replace(/[​\r\n]/g, "");
}

/** 지금 목록을 그대로 둘 때의 조각 — 바뀐 것이 없는지 견줄 때 쓴다. */
export function identityRuns(current: readonly InlineNode[]): InlineRun[] {
  return current.flatMap((n): InlineRun[] => (n.kind === "text" ? (n.text === "" ? [] : [{ id: n.id, text: n.text }]) : [{ keep: n.id }]));
}

export function sameRuns(a: readonly InlineRun[], b: readonly InlineRun[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * DOM 조각 → 조각 목록. `insert` 를 주면 커서 자리에 그 노드를 넣는다(커서가 없으면 끝에).
 * 지금 목록에 없는 칩 조각은 버린다(붙여넣기로 딸려 온 것 등).
 */
export function runsFromTokens(current: readonly InlineNode[], tokens: readonly Token[], newId: IdSource, insert?: InlineNode): InlineRun[] {
  const chipIds = new Set(current.filter((n) => n.kind !== "text").map((n) => n.id));
  const kept = tokens.flatMap((t) => ("chip" in t && chipIds.has(t.chip) ? [t.chip] : []));
  const keptSet = new Set(kept);

  // 지금 목록을 남는 칩으로 가른 글자 구간 — 구간마다 다시 쓸 문장 id (지워진 칩 양옆은 한 구간)
  const pools: Id[][] = [[]];
  for (const n of current) {
    if (n.kind === "text") pools[pools.length - 1].push(n.id);
    else if (keptSet.has(n.id)) pools.push([]);
  }

  const runs: InlineRun[] = [];
  let gap = 0;
  let buffer = "";
  let inserted = false;
  const used = new Set<Id>();
  const flush = () => {
    if (buffer === "") return;
    const pool = pools[Math.min(gap, pools.length - 1)];
    const id = pool.shift() ?? newId();
    runs.push({ id, text: buffer });
    buffer = "";
  };
  for (const t of tokens) {
    if ("text" in t) buffer += cleanText(t.text);
    else if ("caret" in t) {
      flush();
      if (insert && !inserted) {
        runs.push({ node: insert });
        inserted = true;
      }
    } else if (keptSet.has(t.chip) && !used.has(t.chip)) {
      flush();
      used.add(t.chip);
      runs.push({ keep: t.chip });
      gap += 1;
    }
  }
  flush();
  if (insert && !inserted) runs.push({ node: insert });
  return runs;
}

/** 칩 하나를 뺀 목록 (칩 메뉴의 「삭제」). */
export function runsWithout(current: readonly InlineNode[], chipId: Id): InlineRun[] {
  return identityRuns(current.filter((n) => n.id !== chipId));
}

/** 칩 하나를 노드 목록으로 바꾼 목록 (문장 안 조건 「풀기」 — 가지 내용을 그 자리에 꺼낸다). */
export function runsReplacing(current: readonly InlineNode[], chipId: Id, nodes: readonly InlineNode[]): InlineRun[] {
  return current.flatMap((n): InlineRun[] => (n.id === chipId ? nodes.map((node) => ({ node })) : n.kind === "text" ? (n.text === "" ? [] : [{ id: n.id, text: n.text }]) : [{ keep: n.id }]));
}

/**
 * 표에 붙여넣은 글(엑셀 · 탭 구분)을 격자로 — 줄 = 행, 탭 = 셀. 끝의 빈 줄은 버린다.
 * 탭도 줄바꿈도 없으면 한 칸짜리 글이라 undefined (그냥 문장으로 넣는다).
 */
export function parseGrid(text: string): string[][] | undefined {
  if (!/[\t\n]/.test(text)) return undefined;
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t").map((cell) => cell.trim()));
}
