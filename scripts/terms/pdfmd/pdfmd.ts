/**
 * PDF 추출 `.md` → 파싱양식 `.md` (개발 도구 — 제품 기능 아님).
 *
 * 입력은 `scripts/terms/pdf/build_terms_md.py` 산출물(`docs/_자료/<상품>/00_주계약/*.md`)이다.
 *
 *   ## 제N관 제목 · ### 제N조(제목)   관 · 조          [N] 본문   항        ① 본문   호        1) 본문   목
 *   > 【제목】 본문 · > 본문           인용 박스        | a | b |    마크다운 표
 *   【제목】 · [제목] (한 줄 전체)      예시 · 그림 묶음의 제목      [그림 — 원문 PDF p.N]   그림 자리
 *   <!-- p.N -->                        쪽 주석 — 지우되 쪽 경계에서 끊긴 문장은 앞 줄에 잇는다
 *   ## N. 이름                          특약 하나의 시작 (주계약 특별약관 파일은 특약 수십 ~ 백여 개가 한 파일)
 *
 * 출력은 `parse.ts` 가 읽는 파싱양식(`docs/_자료/파싱양식.md`) — 2604 fixture(`tests/fixtures/terms/*.md`)를 만든 관례를 따른다.
 *
 * - 항 번호 없는 머리말 뒤에 항이 오면 머리말을 첫 항에 붙인다(2604 보통약관 제2조) — 항 번호가 밀리면 「제N항」 참조가 틀어진다.
 * - 인용 박스는 ```용어풀이 — 【제목】은 첫 줄, ① · 1. · 1) · 가. · - 줄은 `- `, 나머지 평문은 앞 평문 줄에 이어 쓴다.
 * - 【제목】 줄 아래의 그림은 ```그림(설명에 그 제목), 설명 줄은 그 제목의 박스, 표는 그 제목의 표 — 2604 는 그림을 사람이 표로
 *   다시 그렸지만 이 변환은 그림을 옮기지 않는다(그림 자리 표시만).
 * - 문장이 끝난 뒤 마커 없이 오는 줄(※ 주석 등)은 제목 없는 박스로 남긴다 — 본문에 섞지도, 버리지도 않는다.
 * - 원문 항 · 호 · 목 번호가 순서와 어긋나면 줄 끝에 `<!-- 원문번호: N -->`.
 */

export interface Unit {
  /** `## N.` 의 N — 보통약관처럼 문서 하나인 파일은 0. */
  no: number;
  title: string;
  startPage?: number;
  endPage?: number;
  /** 머리줄(`## N. 이름`)을 뺀 원문 줄. */
  lines: string[];
}

export interface SourceMeta {
  pdf: string;
  product: string;
  extracted: string;
}

export interface UnitMeta extends SourceMeta {
  kind: "보통약관" | "특별약관";
  /** 인쇄 쪽 = PDF 쪽 − offset. 알파Plus 2604 · 2607 모두 1(목차 「printed 99 · pdf 100」). */
  printOffset?: number;
}

const PAGE = /^<!--\s*p\.(\d+)\s*-->$/;
const UNIT = /^## (\d+)\.\s+(.*)$/;

export function readSourceMeta(md: string): SourceMeta {
  const m = /^> 원본:\s*(.+?\.pdf)\s*·.*?추출\s*(\d{4}-\d{2}-\d{2})/m.exec(md);
  if (!m) throw new Error("원본 줄(`> 원본: <PDF> · … · 추출 YYYY-MM-DD`)이 없다");
  return { pdf: m[1], product: m[1].replace(/약관\.pdf$/, "").trim(), extracted: m[2] };
}

/** 파일 하나를 특약 단위로 — `## N. 이름` 이 없으면 문서 하나(보통약관). */
export function splitUnits(md: string): { docTitle: string; units: Unit[] } {
  const all = md.split(/\r?\n/);
  const docTitle = (all.find((l) => l.startsWith("# ")) ?? "").slice(2).trim();
  const units: Unit[] = [];
  const multi = all.some((l) => UNIT.test(l));
  let page: number | undefined;
  let cur: Unit | undefined;
  if (!multi) {
    const head = all.findIndex((l) => l.startsWith("> 원본:"));
    cur = { no: 0, title: docTitle, lines: [] };
    units.push(cur);
    all.splice(0, head + 1);
  }
  for (const line of all) {
    const p = PAGE.exec(line.trim());
    if (p) {
      page = Number(p[1]);
      cur?.lines.push(line);
      continue;
    }
    const u = multi ? UNIT.exec(line) : null;
    if (u) {
      cur = { no: Number(u[1]), title: u[2].trim(), lines: [], ...(page !== undefined ? { startPage: page, endPage: page } : {}) };
      units.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.trim() !== "" || cur.lines.length > 0) cur.lines.push(line);
    if (line.trim() !== "" && page !== undefined) {
      cur.startPage ??= page;
      cur.endPage = page;
    }
  }
  return { docTitle, units };
}

/** fixture 파일명(확장자 없이) — 「특별약관」을 떼고 빈칸은 `_` (2604 관례). */
export function fixtureName(title: string): string {
  if (/보통약관$/.test(title)) return "보통약관";
  return title.replace(/\s*특별약관/, "").trim().replace(/\s+/g, "_").replace(/[/\\]/g, "_");
}

// ── 본문 변환 ─────────────────────────────────────────────────────────────

type TextKind = "lead" | "para" | "item" | "sub";
type El =
  | { k: "sec"; no: string; title: string }
  | { k: "art"; head: string }
  | { k: TextKind; text: string; note?: string }
  | { k: "box"; title?: string; lines: string[] }
  | { k: "table"; title?: string; rows: string[][]; headerRows: number }
  | { k: "fig"; desc: string };

const CIRCLED = /^([①-⑳])\s*(.*)$/;
const COLON_ITEM = /^[①-⑳]\s*:/;
const BOX_ITEM = /^(?:[①-⑳]|\d+\.|\d+\)|[가-하]\.|-)\s+(.*)$/;
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+\s*$/;

const isText = (e: El | undefined): e is Extract<El, { k: TextKind }> =>
  !!e && (e.k === "lead" || e.k === "para" || e.k === "item" || e.k === "sub");
/** 문장이 끝났나 — 끝나지 않은 줄 다음의 평문은 같은 문장이다. */
/** 통합형 특약의 소제목 머리 — 줄 머리의 「7.(보장의 해약환급금)…」 (본문 참조 「3.(보장의 소멸) 제3항」 · 「1.(…)에서 · 의 · 에 따라」는 머리가 아니다). */
const SUBSECTION_HEAD = /^\d+\.\((?:[^()]|\([^()]*\))*\)(?!\s*(?:제\d+항|에서|의|에 따라))/;
const terminal = (t: string) => /(?:[.。:]|다)$/.test(t.trim());
/** 두 조각을 잇는다 — 【 앞뒤는 붙이고 그 밖은 한 칸. */
const joinText = (a: string, b: string) => (b.startsWith("【") || a.endsWith("【") ? a.trimEnd() + b : `${a.trimEnd()} ${b}`);
const cells = (row: string) => {
  const inner = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
};

/**
 * 한 줄에 몰린 글머리를 가른다 — `… 있습니다. - 검표 … - 별표 …` · `· 가 · 나`.
 * `-` 는 문장 끝(. 다 】 :) 뒤에 처음 올 때만 글머리로 본다(`14일 - 1988년` 같은 셈은 두고).
 */
function splitBullets(text: string): string[] {
  if (/^·\s/.test(text)) return text.split(/\s*·\s+/).filter(Boolean).map((t) => `- ${t.trim()}`);
  const first = /[.다】:]\s*-\s+/.exec(text);
  if (!first) return [text];
  const head = text.slice(0, first.index + 1).trim();
  const rest = text.slice(first.index + 1).trim();
  return [...(head ? [head] : []), ...rest.split(/(?<=\D)\s+-\s+(?=\D)/).map((t) => `- ${t.replace(/^-\s+/, "").trim()}`)];
}

function addBoxLine(box: Extract<El, { k: "box" }>, text: string): void {
  const parts = splitBullets(text);
  if (parts.length > 1) {
    for (const p of parts) addBoxLine(box, p);
    return;
  }
  if (COLON_ITEM.test(text)) {
    box.lines.push(text);
    return;
  }
  const m = BOX_ITEM.exec(text);
  if (m) {
    box.lines.push(`- ${m[1]}`);
    return;
  }
  const last = box.lines[box.lines.length - 1];
  const standalone = (t: string) => t.startsWith("- ") || COLON_ITEM.test(t) || /^[※<]/.test(t);
  if (last !== undefined && !standalone(last) && !/^[※<]/.test(text)) box.lines[box.lines.length - 1] = joinText(last, text);
  else box.lines.push(text);
}

class Converter {
  out: El[] = [];
  warnings: string[] = [];
  /** 지금 조의 요소 시작 위치 — 머리말 합치기 · 번호 검사용. */
  private artStart = -1;
  private paraNo = 0;
  private itemNo = 0;
  private subNo = 0;
  private group: { title?: string } | null = null;
  private openBox: Extract<El, { k: "box" }> | null = null;
  private inTable = false;
  private pageBreak = false;

  private get last(): El | undefined {
    return this.out[this.out.length - 1];
  }

  private push(e: El): void {
    this.out.push(e);
    this.openBox = e.k === "box" ? e : null;
    if (e.k !== "table") this.inTable = false;
  }

  private finishArticle(): void {
    if (this.artStart < 0) return;
    const els = this.out.slice(this.artStart);
    const hasPara = els.some((e) => e.k === "para");
    for (const e of els) {
      if (e.k !== "lead") continue;
      if (hasPara) {
        (e as { k: TextKind }).k = "para";
        e.note = "원문번호: 없음";
        this.warnings.push(`항 번호 없는 머리말을 항으로 남김: ${e.text.slice(0, 30)}`);
      }
    }
    this.artStart = -1;
  }

  private newBox(title?: string): Extract<El, { k: "box" }> {
    const box: Extract<El, { k: "box" }> = { k: "box", ...(title ? { title } : {}), lines: [] };
    this.push(box);
    return box;
  }

  private text(k: TextKind, text: string, note?: string): void {
    this.push({ k, text, ...(note ? { note } : {}) });
  }

  line(raw: string): void {
    const line = raw.replace(/\\([.*_[\]()#>-])/g, "$1").trimEnd();
    const t = line.trim();
    if (t === "") {
      this.inTable = false;
      return;
    }
    if (PAGE.test(t)) {
      this.pageBreak = true;
      return;
    }
    const pageBreak = this.pageBreak;
    this.pageBreak = false;
    let m: RegExpExecArray | null;

    if ((m = /^#{2,3} 제(\d+)관\s+(.*)$/.exec(t))) {
      this.finishArticle();
      this.group = null;
      this.push({ k: "sec", no: m[1], title: m[2].trim() });
      return;
    }
    if ((m = /^#{2,4} (제\d+조(?:의\d+)?)\((.*)\)\s*$/.exec(t))) {
      this.finishArticle();
      this.group = null;
      this.push({ k: "art", head: `${m[1]}(${m[2]})` });
      this.artStart = this.out.length;
      this.paraNo = this.itemNo = this.subNo = 0;
      return;
    }
    if (t.startsWith("#")) {
      this.warnings.push(`옮기지 않은 머리줄: ${t}`);
      return;
    }
    if (this.artStart < 0) {
      this.warnings.push(`조 밖의 줄을 버림: ${t.slice(0, 40)}`);
      return;
    }

    // 표
    if (t.startsWith("|")) {
      if (SEPARATOR.test(t)) {
        const tb = this.last;
        if (tb?.k === "table" && this.inTable && tb.headerRows === 0) tb.headerRows = tb.rows.length;
        return;
      }
      const row = cells(t);
      const tb = this.last;
      if (tb?.k === "table" && this.inTable) {
        tb.rows.push(row);
        return;
      }
      if (tb?.k === "table" && pageBreak && tb.rows[0]?.length === row.length) {
        // 쪽 경계로 갈린 같은 표 — 머리가 되풀이되면 버리고, 아니면 이어 붙인다.
        this.inTable = true;
        if (tb.rows[0].join("|") !== row.join("|")) tb.rows.push(row);
        return;
      }
      this.push({ k: "table", ...(this.group?.title ? { title: this.group.title } : {}), rows: [row], headerRows: 0 });
      this.inTable = true;
      return;
    }
    this.inTable = false;

    // 인용 박스
    if ((m = /^>\s?(.*)$/.exec(t))) {
      const q = m[1].trim();
      if (q === "") return;
      const titled = /^【([^】]*)】\s*(.*)$/.exec(q);
      if (titled) {
        const box = this.newBox(titled[1]);
        if (titled[2]) addBoxLine(box, titled[2]);
        return;
      }
      const box = this.openBox ?? this.newBox(this.group?.title);
      addBoxLine(box, q);
      return;
    }

    // 그림
    if ((m = /^\[그림\s*[—-]\s*(.*?)\]$/.exec(t))) {
      this.push({ k: "fig", desc: this.group?.title ? `${this.group.title} — ${m[1]}` : m[1] });
      return;
    }

    // 항
    if ((m = /^\[(\d+)\]\s*(.*)$/.exec(t))) {
      this.group = null;
      const no = Number(m[1]);
      this.paraNo += 1;
      this.itemNo = this.subNo = 0;
      const note = no !== this.paraNo ? `원문번호: ${no}` : undefined;
      const prev = this.out.slice(this.artStart);
      if (prev.length === 1 && prev[0].k === "lead") {
        this.out.pop();
        this.text("para", joinText(prev[0].text, m[2]), note);
        return;
      }
      this.text("para", m[2], note);
      return;
    }

    // 묶음 제목 — 【제목】 · [제목] 한 줄 전체
    if ((m = /^【([^】]*)】$/.exec(t)) || (m = /^\[([^\]\d][^\]]*)\]$/.exec(t))) {
      this.group = { title: m[1].trim() };
      this.openBox = null;
      return;
    }

    // 호
    if ((m = CIRCLED.exec(t))) {
      if (this.group && COLON_ITEM.test(t)) {
        addBoxLine(this.openBox ?? this.newBox(this.group.title), t);
        return;
      }
      this.group = null;
      const no = m[1].codePointAt(0)! - 0x2460 + 1;
      this.itemNo += 1;
      this.subNo = 0;
      this.text("item", m[2], no !== this.itemNo ? `원문번호: ${no}` : undefined);
      return;
    }

    // 목
    if ((m = /^(\d+)\)\s*(.*)$/.exec(t))) {
      if (this.group) {
        addBoxLine(this.openBox ?? this.newBox(this.group.title), t);
        return;
      }
      const no = Number(m[1]);
      this.subNo += 1;
      this.text("sub", m[2], no !== this.subNo ? `원문번호: ${no}` : undefined);
      return;
    }

    // 평문 — 【별표…】 아닌 【제목】으로 시작하면 이어지는 문장이 아니라 박스다.
    const last = this.last;
    const boxHead = /^【(?!별표)[^】]*】/.test(t);
    // 통합형 특약의 소제목 머리(「7.(보장의 해약환급금)회사는 …」)는 앞 호 · 항 · 박스에 잇지 않는다 — 새 박스(뒤 형 머리 「[1형(…)]」는 그 박스에 든다)
    if (SUBSECTION_HEAD.test(t) && this.out.length > this.artStart) {
      this.group = {};
      addBoxLine(this.newBox(), t);
      return;
    }
    // 항 번호 없는 조(머리말뿐)의 다음 문단도 같은 단독 본문이다(2604 갱신형 수술비 제8조).
    if (!this.group && isText(last) && (pageBreak || last.k === "lead" || !terminal(last.text)) && !t.startsWith("※") && !boxHead) {
      last.text = joinText(last.text, t);
      return;
    }
    if (this.group) {
      addBoxLine(this.openBox ?? this.newBox(this.group.title), t);
      return;
    }
    const titled = /^【([^】]*)】\s*(.+)$/.exec(t);
    if (titled) {
      this.group = { title: titled[1] };
      addBoxLine(this.newBox(titled[1]), titled[2]);
      return;
    }
    if (this.out.length === this.artStart && !t.startsWith("※")) {
      this.text("lead", t);
      return;
    }
    this.group = {};
    addBoxLine(this.newBox(), t);
  }

  end(): void {
    this.finishArticle();
  }
}

interface Stats {
  관: number;
  조: number;
  항: number;
  호: number;
  목: number;
  표: number;
}

function render(els: El[]): { text: string; stats: Stats } {
  const stats: Stats = { 관: 0, 조: 0, 항: 0, 호: 0, 목: 0, 표: 0 };
  const blocks = els.map((e) => {
    const note = "note" in e && e.note ? ` <!-- ${e.note} -->` : "";
    switch (e.k) {
      case "sec":
        stats.관 += 1;
        return `# 제${e.no}관 ${e.title}`;
      case "art":
        stats.조 += 1;
        return `## ${e.head}`;
      case "lead":
        return `= ${e.text}${note}`;
      case "para":
        stats.항 += 1;
        return `@ ${e.text}${note}`;
      case "item":
        stats.호 += 1;
        return `  - ${e.text}${note}`;
      case "sub":
        stats.목 += 1;
        return `    - ${e.text}${note}`;
      case "box":
        return ["```용어풀이", ...(e.title ? [`【${e.title}】`] : []), ...e.lines, "```"].join("\n");
      case "fig":
        return ["```그림", `설명: ${e.desc}`, "```"].join("\n");
      case "table": {
        stats.표 += 1;
        const width = Math.max(...e.rows.map((r) => r.length));
        const row = (r: string[]) => `|${[...r, ...Array(width - r.length).fill("")].join("|")}|`;
        const header = e.headerRows || 1;
        const lines = e.rows.map(row);
        lines.splice(header, 0, `|${Array(width).fill("---").join("|")}|`);
        return ["```표", `제목: ${e.title ?? "(없음)"}`, ...lines, "```"].join("\n");
      }
    }
  });
  return { text: blocks.join("\n\n"), stats };
}

function convert(lines: string[]): { text: string; stats: Stats; warnings: string[] } {
  const c = new Converter();
  for (const l of lines) c.line(l);
  c.end();
  return { ...render(c.out), warnings: c.warnings };
}

/** 본문만 (머리 · 통계 없이). */
export function convertBody(lines: string[]): string {
  return convert(lines).text;
}

/** fixture 파일 하나 — 머리(제목 · 출처 · 상품) + 본문 + 통계. */
export function convertUnit(unit: Unit, meta: UnitMeta, warnings: string[] = []): string {
  const r = convert(unit.lines);
  warnings.push(...r.warnings);
  const off = meta.printOffset ?? 1;
  const { startPage: a, endPage: b } = unit;
  const pages =
    a === undefined || b === undefined ? "" : a === b ? ` PDF ${a}쪽(인쇄 ${a - off}쪽)` : ` PDF ${a}–${b}쪽(인쇄 ${a - off}–${b - off}쪽)`;
  const s = r.stats;
  return [
    `# ${unit.title}`,
    "",
    `> 출처: ${meta.pdf}${pages} · 추출일: ${meta.extracted}`,
    `> 상품: ${meta.product} · 문서종류: ${meta.kind}`,
    "",
    r.text,
    `> 통계: 관 ${s.관} · 조 ${s.조} · 항 ${s.항} · 호 ${s.호} · 목 ${s.목} · 표 ${s.표}`,
    "",
  ].join("\n");
}
