/**
 * 문서 링크 검사 — `npm run docs:links`.
 *
 * docs(`_archive` · `_자료` 제외)의 `.md` · `.html` 을 훑어
 * - 위키링크 `[[경로#절|별칭]]` 이 **docs 기준 전체 경로**로 풀리는지
 *   (`docs/<경로>.md`, 또는 확장자 있는 파일 · 폴더 `docs/<경로>`),
 * - 상대 마크다운 링크 `[글](../../src/…)` 가 실재하는지
 * 본다. 깨진 것이 하나라도 있으면 목록을 찍고 exit 1.
 *
 * 규칙 (docs/README.md 문서 규칙):
 * - 파일명만 · 상대 경로 위키링크는 풀리지 않으므로 깨진 링크로 잡힌다.
 * - 코드 블록 · 인라인 코드 안은 예시라 보지 않는다. `<feature>` 같은 자리표시자도 건너뛴다.
 * - `_archive/` · `_자료/` 는 gitignore 라 리포에 없다 — 로컬에 그 폴더가 있을 때만 검사한다.
 * - `docs/README.md` 는 다른 흐름이 다시 쓰는 중이라 **경고만** 한다 (exit 코드에 넣지 않음).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DOCS = path.join(ROOT, "docs");

/** 검사하지 않는 docs 하위 폴더 — 리포 밖(gitignore) 자료. */
const SKIP_DIRS = new Set(["_archive", "_자료"]);
/** 깨져도 경고만 하는 파일 (docs 기준). */
const WARN_ONLY = new Set(["README.md"]);

export interface Link {
  kind: "wiki" | "md";
  /** 원문 그대로 (`[[…]]` 또는 `[..](..)`). */
  raw: string;
  /** 절 · 별칭을 뗀 경로. */
  target: string;
  line: number;
}

export interface Broken extends Link {
  /** docs 기준 파일 경로. */
  file: string;
}

/** 코드 펜스 · 인라인 코드를 같은 길이의 공백으로 지운다 — 줄 번호를 지키려고. */
export function stripCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  const out = text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, blank);
  return out.replace(/``[^\n]*?``|`[^`\n]*`/g, blank);
}

const WIKI = /\[\[([^\[\]\n]+?)\]\]/g;
/** `[글](대상)` — 대상은 `<…>` 이거나 괄호 한 겹까지 허용 (`src/app/(app)/…`). */
const MD = /(?<![!\[])\[[^\[\]\n]*\]\((<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g;
const PLACEHOLDER = /<[^>]+>/;

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** 위키링크 안쪽에서 경로만 — `경로#절|별칭`, 표 안의 `\|` 도. */
export function wikiTarget(inner: string): string {
  return inner.split(/\\?\||#/)[0].trim().replace(/\/+$/, "");
}

export function extractLinks(text: string, isHtml = false): Link[] {
  const body = isHtml ? text : stripCode(text);
  const out: Link[] = [];
  for (const m of body.matchAll(WIKI)) {
    const inner = m[1];
    // HTML 속성값의 JSON 배열(`data-rows='[["a", "=", "b"]]'`) 은 링크가 아니다.
    if (/["']/.test(inner)) continue;
    out.push({ kind: "wiki", raw: m[0], target: wikiTarget(inner), line: lineOf(body, m.index) });
  }
  if (!isHtml) {
    for (const m of body.matchAll(MD)) {
      let target = m[1];
      if (target.startsWith("<")) target = target.slice(1, -1);
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue; // http: · mailto: · 앵커
      target = target.split("#")[0];
      if (target === "") continue;
      out.push({ kind: "md", raw: m[0], target, line: lineOf(body, m.index) });
    }
  }
  return out;
}

/** 위키링크 경로가 docs 안의 실물로 풀리는가. */
export function resolvesWiki(target: string, docs = DOCS): boolean {
  if (target === "" || PLACEHOLDER.test(target)) return true;
  const top = target.split("/")[0];
  if (SKIP_DIRS.has(top) && !existsSync(path.join(docs, top))) return true; // 클론에는 없다
  if (existsSync(path.join(docs, `${target}.md`))) return true;
  const bare = path.join(docs, target);
  if (!existsSync(bare)) return false;
  return statSync(bare).isDirectory() || path.extname(target) !== "";
}

export function resolvesMd(target: string, fromFile: string): boolean {
  let decoded = target;
  try {
    decoded = decodeURI(target);
  } catch {
    /* 그대로 */
  }
  return existsSync(path.resolve(path.dirname(fromFile), decoded));
}

export function listDocFiles(dir = DOCS): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (d === dir && SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (/\.(md|html)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

export function checkDocs(docs = DOCS): Broken[] {
  const broken: Broken[] = [];
  for (const file of listDocFiles(docs)) {
    const text = readFileSync(file, "utf8");
    for (const link of extractLinks(text, file.endsWith(".html"))) {
      const ok = link.kind === "wiki" ? resolvesWiki(link.target, docs) : resolvesMd(link.target, file);
      if (!ok) broken.push({ ...link, file: path.relative(docs, file) });
    }
  }
  return broken;
}

function main(): void {
  const all = checkDocs();
  const warned = all.filter((b) => WARN_ONLY.has(b.file));
  const broken = all.filter((b) => !WARN_ONLY.has(b.file));
  const print = (b: Broken) => console.log(`  docs/${b.file}:${b.line}  ${b.raw}`);

  if (warned.length > 0) {
    console.log(`⚠ 경고 ${warned.length}건 (검사 제외 파일):`);
    warned.forEach(print);
  }
  if (broken.length > 0) {
    console.log(`✗ 깨진 링크 ${broken.length}건:`);
    broken.forEach(print);
    process.exit(1);
  }
  console.log(`✓ 깨진 링크 0건 (${listDocFiles().length}개 문서)`);
}

// tsx 로 직접 실행할 때만 돈다.
if (process.argv[1]?.endsWith("check-links.ts")) main();
