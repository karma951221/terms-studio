/**
 * 대조기 — 조립 결과(`RenderedDoc`)를 파싱양식 텍스트로 되돌려 원문 `.md` 와 조 단위로 비교한다.
 *
 * 기준 (2026-09-07 실물 재현 설계):
 * - 가지번호를 쓰지 않으므로(기능/문면 §3.2) 조·관 번호 참조는 조 명 기준으로 정규화한다 — 「제27조의1(」 도 「제28조(」 도 「제§조(」.
 * - PDF 추출 공백 잡음을 피하려 공백을 전부 지운다. 별표 번호는 지운다 — 등장 순 자동 번호라 실물과 다를 수 있다 (ADR-0063 허용 차이).
 * - 단항 조는 `= `, 다항 조는 `@ `. 표·박스는 파싱양식의 fenced 블록 그대로.
 *
 * DB·React import 금지 (순수층). Node `fs` 도 쓰지 않는다 — 파일 읽기는 호출자 몫.
 */

import type { RenderedArticle, RenderedDoc, RenderedInline, RenderedParagraph, RenderedStatic } from "./types";

const inlineText = (list: readonly RenderedInline[]): string =>
  list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");

function staticLines(n: RenderedStatic): string[] {
  // 파싱양식 대칭: 그림은 ```그림 + 「설명: 」, 제목 없는 박스는 【】 줄 없이
  if (n.kind === "box" && n.title === "그림") return ["```그림", ...n.lines.map((l) => `설명: ${l}`), "```"];
  if (n.kind === "box") return ["```용어풀이", ...(n.title ? [`【${n.title}】`] : []), ...n.lines, "```"];
  const separator = `|${n.columns.map(() => "---").join("|")}|`;
  const out = ["```표", `제목: ${n.title ?? "(없음)"}`];
  let separated = false;
  for (const row of n.rows) {
    out.push(`|${row.cells.map(inlineText).join("|")}|`);
    if (row.header && !separated) {
      out.push(separator);
      separated = true;
    }
  }
  // 제목줄이 없는 표는 파싱양식(markdown)상 첫 행 뒤에 구분선이 온다
  if (!separated && n.rows.length > 0) out.splice(3, 0, separator);
  out.push("```");
  return out;
}

function articleLines(a: RenderedArticle): string[] {
  const out = [`## ${a.label}(${a.title})`];
  const paragraphs = a.children.filter((c): c is RenderedParagraph => c.kind === "paragraph");
  const marker = paragraphs.length === 1 ? "=" : "@";
  for (const c of a.children) {
    if (c.kind === "error") {
      out.push(`${marker} ⟦${c.issue.kind}⟧`);
      continue;
    }
    if (c.kind !== "paragraph") {
      out.push(...staticLines(c));
      continue;
    }
    out.push(`${marker} ${inlineText(c.children)}`);
    for (const it of c.items ?? []) {
      // 오류 노드는 어느 자리에 있든 흘리지 않는다 — 대조가 오류를 못 본 채 통과하면 안 된다 (2026-09-08 리뷰 9)
      if (it.kind === "error") {
        out.push(`  - ⟦${it.issue.kind}⟧`);
        continue;
      }
      if (it.kind !== "item") {
        out.push(...staticLines(it));
        continue;
      }
      out.push(`  - ${inlineText(it.children)}`);
      for (const s of it.subitems ?? []) out.push(s.kind === "subitem" ? `    - ${inlineText(s.children)}` : `    - ⟦${s.issue.kind}⟧`);
    }
  }
  return out;
}

/** 조립 결과 문서 → 파싱양식 줄. */
export function renderedToLines(doc: RenderedDoc): string[] {
  const out: string[] = [];
  for (const c of doc.children) {
    if (c.kind === "error") {
      out.push(`## ⟦${c.issue.kind}⟧`);
      continue;
    }
    if (c.kind === "section") {
      out.push(`# ${c.label} ${c.title}`);
      for (const a of c.children) out.push(...(a.kind === "article" ? articleLines(a) : [`## ⟦${a.issue.kind}⟧`]));
    } else {
      out.push(...articleLines(c));
    }
  }
  return out;
}

/** 원문 `.md` → 비교용 줄. 문서 제목(`# …` 첫 줄, 관 헤딩 제외) · `> ` 머리/통계 · HTML 주석 · 빈 줄을 버린다. */
export function sourceToLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((l) => l.replace(/<!--.*?-->/g, "").replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "" && !l.startsWith("> ") && !(l.startsWith("# ") && !/^# 제\d+관/.test(l)));
}

/** 참조 토큰 — 「제N조(명)」·「제N조의M(명)」·「제N항」·「제N호」·「제N목」. 번호 · 종류(가지번호 포함) 를 읽는다. */
const REF_KIND = String.raw`조(?:의\d+)?(?:\([^)]*\))?|항|호|목`;
const REF = String.raw`제(\d+)(${REF_KIND})`;
const REF_PLAIN = String.raw`제\d+(?:${REF_KIND})`;
/** 이미 구간인 것 「A부터 B까지」 — 나열의 원소로 보되 다시 묶지 않는다. */
const RANGE = String.raw`${REF_PLAIN}부터 ${REF_PLAIN}까지`;
const SEPARATOR = String.raw`(?:, | 및 | 또는 )`;
const ELEMENT = `(?:${RANGE}|${REF_PLAIN})`;
const ENUMERATION = new RegExp(`${ELEMENT}(?:${SEPARATOR}${ELEMENT})+`, "g");
/** 나열 안의 조각 — 1: 구간 · 2·3: 번호 · 종류 · 4: 구분자. */
const PIECE = new RegExp(`(${RANGE})|${REF}|(${SEPARATOR})`, "g");

/**
 * 참조 나열의 표기를 조립 규칙(기능/문면 §3.5 · `referenceChunkLabel`)으로 맞춘다 — QA/인수기준 허용 차이 ⑤.
 * 같은 종류의 번호가 잇달아 셋 이상이면 「A부터 C까지」, 세그먼트는 쉼표로 잇고 마지막 앞에만 연결어(원문이 쉼표뿐이면 「및」).
 * 원문 「제15조(…), 제17조(…), 제18조(…), 제19조(…) 및 제26조(…)」 → 「제15조(…), 제17조(…)부터 제19조(…)까지 및 제26조(…)」.
 * 조립 결과는 이미 이 꼴이라 다시 적용해도 그대로다. 법령 인용 등 평문 나열도 양쪽에 같게 적용되므로 판정에 영향이 없다.
 */
function normalizeEnumeration(text: string): string {
  const tokens: { text: string; n: number; kind: string; fixed: boolean }[] = [];
  const separators: string[] = [];
  for (const m of text.matchAll(PIECE)) {
    if (m[1] !== undefined) tokens.push({ text: m[0], n: 0, kind: "", fixed: true });
    else if (m[2] !== undefined) tokens.push({ text: m[0], n: Number(m[2]), kind: m[3][0], fixed: /^조의\d/.test(m[3]) });
    else separators.push(m[0]);
  }
  const runs: (typeof tokens)[] = [];
  for (const t of tokens) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run && last && !last.fixed && !t.fixed && last.kind === t.kind && t.n === last.n + 1) run.push(t);
    else runs.push([t]);
  }
  const segments = runs.flatMap((run) => (run.length >= 3 ? [`${run[0].text}부터 ${run[run.length - 1].text}까지`] : run.map((t) => t.text)));
  if (segments.length <= 1) return segments[0] ?? text;
  const connector = separators.at(-1) === " 또는 " ? " 또는 " : " 및 ";
  return `${segments.slice(0, -1).join(", ")}${connector}${segments.at(-1)}`;
}

/**
 * 조 번호 참조·관 번호·별표 번호를 지우고 공백을 전부 없앤다 (QA/인수기준 허용 차이 ① · ④ · ADR-0063).
 * 참조 나열은 먼저 조립 규칙의 표기로 맞춘다 (허용 차이 ⑤ · `normalizeEnumeration`).
 */
export function normalizeLine(line: string): string {
  return line
    .replace(ENUMERATION, (m) => normalizeEnumeration(m))
    .replace(/제\d+조(?:의\d+)?\(/g, "제§조(")
    .replace(/제\d+관/g, "제§관")
    .replace(/【별표\d+\(/g, "【별표§(")
    .replace(/\s+/g, "");
}

export interface ArticleDiff {
  /** 조 순번 (0부터). */
  index: number;
  title: string;
  expected: string[];
  actual: string[];
}

interface Chunk {
  title: string;
  lines: string[];
}

/** `## 제N조(제목)` 로 잘라 조 덩어리로. 조 앞의 관 헤딩은 직전 덩어리 끝에 붙는다 (양쪽 같은 규칙이라 대조에 무해). */
function chunks(lines: readonly string[]): Chunk[] {
  const out: Chunk[] = [];
  for (const l of lines) {
    const m = /^##\s*제[^(]*\((.*)\)\s*$/.exec(l);
    if (m) out.push({ title: m[1], lines: [] });
    else if (out.length === 0) out.push({ title: "(머리)", lines: [l] });
    else out[out.length - 1].lines.push(l);
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** 정규화 후 조 단위 비교 — 다른 조만. */
export function diffByArticle(expected: readonly string[], actual: readonly string[]): ArticleDiff[] {
  const e = chunks(expected);
  const a = chunks(actual);
  const n = Math.max(e.length, a.length);
  const out: ArticleDiff[] = [];
  for (let i = 0; i < n; i++) {
    const x = e[i];
    const y = a[i];
    const same = x !== undefined && y !== undefined && squash(x.title) === squash(y.title) && x.lines.map(normalizeLine).join("\n") === y.lines.map(normalizeLine).join("\n");
    if (!same) out.push({ index: i, title: x?.title ?? y?.title ?? "", expected: x?.lines ?? [], actual: y?.lines ?? [] });
  }
  return out;
}
