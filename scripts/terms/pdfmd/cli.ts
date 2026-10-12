/**
 * PDF 추출 `.md` → 파싱양식 fixture (개발 도구 — 제품 기능 아님). 변환 규칙은 `pdfmd.ts`.
 *
 *   npm run terms:pdfmd -- --preset 알파2607                    묶음(`presets.ts`)을 다시 만든다
 *   npm run terms:pdfmd -- <원문.md> --list                      특약 목록(번호 · 쪽 · 파일명)
 *   npm run terms:pdfmd -- <원문.md> --out <폴더> --only "이름1,이름2"   고른 특약만
 *   npm run terms:pdfmd -- <원문.md> --out <폴더> --only-file 이름목록.txt
 *   npm run terms:pdfmd -- <원문.md> --out <폴더> --all          파일 안의 특약 전부
 *
 * 이름은 원문 `## N. 이름` 의 이름, 「특별약관」을 뺀 이름, fixture 파일명, `#N`(번호) 중 하나. 못 찾은 이름은 오류다.
 * 만든 파일은 모두 `parseTerms` 로 다시 읽어 본다 — 양식을 어기면 쓰지 않고 멈춘다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseTerms } from "../parse";
import { convertUnit, fixtureName, readSourceMeta, splitUnits, type Unit } from "./pdfmd";
import { PRESETS } from "./presets";

export function selectUnits(units: Unit[], only: string[] | "all"): Unit[] {
  if (only === "all") return units;
  return only.map((name) => {
    const n = name.trim();
    const hit = units.find(
      (u) => u.title === n || fixtureName(u.title) === n || u.title.replace(/\s*특별약관/, "").trim() === n || `#${u.no}` === n,
    );
    if (!hit) throw new Error(`특약을 찾지 못함: ${n}`);
    return hit;
  });
}

/** 원문 하나에서 고른 특약을 fixture 로 쓴다 — 쓴 파일 경로들. */
export function generate(src: string, outDir: string, only: string[] | "all", log: (s: string) => void = console.log): string[] {
  const md = readFileSync(src, "utf8");
  const meta = readSourceMeta(md);
  const { units } = splitUnits(md);
  mkdirSync(outDir, { recursive: true });
  return selectUnits(units, only).map((u) => {
    const warnings: string[] = [];
    const kind = u.no === 0 && /보통약관$/.test(u.title) ? "보통약관" : "특별약관";
    const text = convertUnit(u, { ...meta, kind }, warnings);
    const doc = parseTerms(text);
    const file = path.join(outDir, `${fixtureName(u.title)}.md`);
    writeFileSync(file, text);
    const articles = doc.sections.reduce((n, s) => n + s.articles.length, 0);
    log(`${file} — 조 ${articles}${warnings.length ? ` · 경고 ${warnings.length}` : ""}`);
    for (const w of warnings) log(`  [경고] ${w}`);
    return file;
  });
}

function main(argv: string[]): void {
  const opt = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const preset = opt("--preset");
  if (preset) {
    const p = PRESETS[preset];
    if (!p) throw new Error(`없는 preset: ${preset} (있는 것: ${Object.keys(PRESETS).join(", ")})`);
    for (const job of p.jobs) generate(job.src, p.out, job.only);
    return;
  }
  const src = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
  if (!src) throw new Error("원문 .md 경로가 필요하다 — 사용법은 scripts/terms/pdfmd/cli.ts 머리 주석");
  if (argv.includes("--list")) {
    for (const u of splitUnits(readFileSync(src, "utf8")).units) {
      console.log(`#${u.no}\tp.${u.startPage ?? "?"}–${u.endPage ?? "?"}\t${fixtureName(u.title)}\t${u.title}`);
    }
    return;
  }
  const out = opt("--out");
  if (!out) throw new Error("--out <폴더> 가 필요하다");
  const onlyFile = opt("--only-file");
  const only = argv.includes("--all")
    ? "all"
    : (onlyFile ? readFileSync(onlyFile, "utf8").split(/\r?\n/) : (opt("--only") ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
  if (only !== "all" && only.length === 0) throw new Error("--only · --only-file · --all 중 하나가 필요하다");
  generate(src, out, only);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
