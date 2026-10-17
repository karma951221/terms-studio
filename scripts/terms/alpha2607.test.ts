import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALPHA2607_AUTO } from "./config";
import type { InlineNode } from "../../src/domain/document/nodes";
import { foldTitle } from "../../src/domain/document/title";

/**
 * 세 번째 실물 재현 상품 알파Plus2607 의 변환 결과(시드 JSON) — 2604 와 **공통화**한 모양 (QA/실물재현/알파플러스2607_모델명세).
 * - 보통약관은 2607 원문 한 벌이지만 조 id 체계를 2604 와 같이 쓴다 — 2604 담보약관 · 준용규정 함수조항이 두 보통약관에서 그대로 풀린다.
 * - 보통약관이 쓰는 함수조항(조째 · 납입면제 사유별 · 역할)은 2604 것을 그대로 쓴다 — 2607 전용 보통약관 함수조항이 없다.
 * - 상해 특약 10 은 2604 담보(템플릿)를 그대로 탑재한다. 질병 대표 5 만 새 담보 · 템플릿이다.
 * - 2607 이 더한 함수조항은 맨 뒤 코드다 — 앞 상품의 코드는 밀리지 않는다.
 * 원문과의 글자 대조는 `src/db/seed/real.test.ts`.
 */

const DATA = path.join(process.cwd(), "src/db/seed/data");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(DATA, file), "utf8")) as T;
type Json = Record<string, unknown> & { id?: string; kind?: string; children?: Json[] };
/** 조 제목 글 — 시드는 인라인 노드 목록이다 (ADR-0088). */
const titleOf = (x: Json): string => (Array.isArray(x.title) ? foldTitle(x.title as InlineNode[]) : String(x.title ?? ""));

const generals = read<{ code: string; tree: Json }[]>("generals.json");
const documents = read<{ code: string; ownerCoverage: string; general: string; tree: Json }[]>("documents.json");
const clauses = read<(Json & { code: string; label: string })[]>("clauses.json");
const boxes = read<{ code: string }[]>("boxes.json");
const coverages = read<{ key: string; code: string; name: string; category?: string }[]>("coverages.json");
const products = read<{ code: string; name: string; general: string; values: { path: string; value: unknown }[]; mounts: { coverage: string }[] }[]>("products.json");

const all = (n: unknown, pred: (x: Json) => boolean, out: Json[] = []): Json[] => {
  if (Array.isArray(n)) n.forEach((x) => all(x, pred, out));
  else if (n && typeof n === "object") {
    if (pred(n as Json)) out.push(n as Json);
    Object.values(n).forEach((v) => all(v, pred, out));
  }
  return out;
};
const articleIds = (tree: Json) => all(tree, (x) => x.kind === "article").map((a) => a.id as string);
const clauseCodes = (x: unknown) => new Set([...JSON.stringify(x).matchAll(/"clauseCode":"(C\d+)"/g)].map((m) => m[1]));
const codeOf = (label: string) => clauses.find((c) => c.label === label)?.code;

const alpha = generals.find((g) => g.code === "alpha-general")!;
const a2607 = generals.find((g) => g.code === "alpha2607-general");
const DISEASES = ["5대고액치료비암진단비보장", "양성뇌종양진단비Ⅱ보장", "만성당뇨합병증진단비보장", "중대한재생불량성빈혈진단비보장", "말기신부전증진단비보장"];

describe("알파Plus2607 보통약관 — 2607 원문 한 벌 · 2604 와 같은 조 id 체계 · 2604 함수조항을 함께 쓴다", () => {
  it("보통약관 「무배당 알파Plus보장보험2607 보통약관」이 있다", () => {
    expect(a2607?.tree.title).toBe("무배당 알파Plus보장보험2607 보통약관");
  });

  it("조 id 가 2604 보통약관과 같다 — 담보약관 · 준용규정의 보통약관 조 참조가 두 보통약관에서 같은 조를 가리킨다", () => {
    expect(articleIds(a2607!.tree)).toEqual(articleIds(alpha.tree));
  });

  it("쓰는 함수조항이 2604 보통약관과 같다 — 조째 · 납입면제 사유별 · 역할 함수조항 모두 공통, 2607 전용 없음", () => {
    expect([...clauseCodes(a2607!.tree)].sort()).toEqual([...clauseCodes(alpha.tree)].sort());
  });
});

describe("알파Plus2607 함수조항 — 더한 것은 맨 뒤 코드, 앞 상품의 코드는 그대로", () => {
  it("2604 · 통합간편의 준용규정은 C0068 · C0069 그대로다", () => {
    expect(codeOf("준용규정(알파Plus)")).toBe("C0068");
    expect(codeOf("준용규정(통합간편)")).toBe("C0069");
  });

  it("질병 특약이 함께 쓰는 둘 — 제3자 합의 세부규정 · 준용규정(알파Plus 질병)이 C0070 · C0071", () => {
    expect(codeOf("보험금 지급에 관한 세부규정(제3자 합의)")).toBe("C0070");
    expect(codeOf("준용규정(알파Plus 질병)")).toBe("C0071");
    // 그 뒤는 자동 탑재 특약에서 변환기가 찾아 묶은 함수조항뿐 — 「(알파Plus2607)」 · 「(알파Plus2607 N)」
    expect(clauses.slice(71).filter((c) => !/\(알파Plus2607( \d+)?\)$/.test(c.label)).map((c) => c.label)).toEqual([]);
  });

  it("준용규정(알파Plus 질병)도 「1종 … 제외」를 납입면제 있음 조건으로 감싼다(납입면제 없는 상품이면 빠진다)", () => {
    const c = clauses.find((x) => x.label === "준용규정(알파Plus 질병)")!;
    const conds = all(c.body, (x) => x.kind === "inlineCond");
    expect(conds).toHaveLength(1);
    const branches = conds[0].branches as { when?: string; children: Json[] }[];
    expect(branches.map((b) => b.when)).toEqual(["arg.납입면제_있음 = true", undefined]);
    expect(JSON.stringify(branches[1].children)).toContain("은 제외합니다.");
  });
});

describe("알파Plus2607 질병 대표 5 — 새 담보 · 템플릿(대응 보통약관 = 2607), 소멸 · 세부규정 · 준용규정은 함수조항", () => {
  it.each(DISEASES)("%s — 담보(담보분류 질병) · 템플릿", (name) => {
    const coverage = coverages.find((c) => c.name === name);
    expect(coverage?.category).toBe("V02");
    const doc = documents.find((d) => d.ownerCoverage === coverage!.key)!;
    expect(doc.general).toBe("alpha2607-general");
    const used = clauseCodes(doc.tree);
    for (const label of ["보험금 지급에 관한 세부규정(제3자 합의)", "특별약관의 소멸(지급사유 발생)", "준용규정(알파Plus 질병)"]) expect(used, label).toContain(codeOf(label));
  });
});

describe("알파Plus2607 상품 — 상해 특약 10 은 2604 담보 그대로, 질병 5 를 더한다", () => {
  const product = products.find((p) => p.code === "alpha2607");

  it("보통약관 2607 · 갱신형여부 아니오(세만기)", () => {
    expect(product?.general).toBe("alpha2607-general");
    expect(product?.values.find((v) => v.path === "feature.renewable")?.value).toBe(false);
  });

  it("탑재 = 2604 탑재(기본계약 + 특약 10) + 2604 담보의 갱신형 둘(일반상해사망 · 골절) + 질병 5 + 자동 탑재 특약(맨 뒤)", () => {
    const alphaMounts = products.find((p) => p.code === "alpha-plus")!.mounts.map((m) => m.coverage);
    const diseaseKeys = DISEASES.map((name) => coverages.find((c) => c.name === name)!.key);
    const hand = [...alphaMounts, "death", "fracture", ...diseaseKeys];
    const mounts = product!.mounts.map((m) => m.coverage);
    expect(mounts.slice(0, hand.length)).toEqual(hand);
    const autoKeys = new Set(ALPHA2607_AUTO.map((s) => s.ownerCoverage));
    expect(mounts.slice(hand.length).filter((k) => !autoKeys.has(k))).toEqual([]);
    expect(new Set(mounts.slice(hand.length))).toEqual(autoKeys);
  });
});

describe("통합형 특약 — 세부보장 안 「제N항」은 그 소제목(종형)의 N번째 항을 가리킨다(항 번호 무리, 2026-10-14)", () => {
  /** 조의 블록 자리를 무리로 — restart 항(또는 restart 를 단 함수조항 참조)이 새 무리를 연다. 무리마다 [P코드 …]. */
  const groupsOf = (article: Json) => {
    const groups: string[][] = [];
    for (const c of article.children ?? []) {
      if (c.kind !== "paragraph" && c.kind !== "clauseBlockRef") continue;
      if (c.restart || groups.length === 0) groups.push([]);
      groups.at(-1)!.push(c.code as string);
    }
    return groups;
  };
  const grouped = documents.flatMap((d) => all(d.tree, (x) => x.kind === "article" && (x.children ?? []).some((c) => c.restart)).map((a) => ({ d, a })));

  it("통합형 특약(세부보장 소제목) · 특약 자체 납입면제 조([2종] 머리)에 항 번호 무리가 있다", () => {
    const titles = new Set(grouped.map(({ d }) => d.tree.title as string));
    for (const t of ["4대양성종양진단비보장 특별약관", "암 주요치료비(연간1회한, 10년간)보장 특별약관", "특정호르몬약물허가치료비보장 특별약관", "2대질환 주요치료비(연간1회한, 10년간)보장 특별약관"]) expect(titles, t).toContain(t);
  });

  it("4대양성종양(갱신형 가지) — 둘째 세부보장 1.③ 의 「제1항 및 제2항」 · 「3.(보장의 소멸) 제3항」이 둘째 세부보장의 1.① · 1.② · 3.③ 을 가리킨다", () => {
    const d = documents.find((x) => x.tree.title === "4대양성종양진단비보장 특별약관")!;
    const a = all(d.tree, (x) => x.kind === "article" && titleOf(x) === "세부보장에 관한 사항" && String(x.id).endsWith("r-a3"))[0];
    const groups = groupsOf(a);
    // 세부보장 넷 × 소제목 셋(1. 지급사유 · 2. 정의 · 3. 소멸) — 무리 열둘
    expect(groups).toHaveLength(12);
    const second = groups[3];
    const p = (a.children ?? []).find((c) => c.code === second[2])!;
    const targets = all(p, (x) => x.kind === "articleRef").map((r) => (r.targets as { code: string }[]).map((t) => t.code));
    expect(targets).toEqual([[second[0], second[1]], [groups[5][2]]]);
    // 조 전체로 셌다면 「제1항」은 첫 세부보장의 1.① 이다 — 아니다
    expect(targets[0]).not.toContain(groups[0][0]);
  });

  it("무리 밖을 가리키는 조 없는 항 참조가 없다 — 같은 조 항 참조는 제 무리 또는 같은 세부보장의 이름 댄 소제목 무리 안", () => {
    for (const { d, a } of grouped) {
      const groups = groupsOf(a);
      const groupOf = (code: string) => groups.findIndex((g) => g.includes(code));
      // 코드(항 · 호 · 목) → 그것을 품은 항(또는 함수조항 참조)의 코드 — P코드는 단계마다 따로 매겨 위아래로 읽을 수 없다
      const holder = new Map<string, string>();
      for (const c of (a.children ?? []).filter((x) => x.kind === "paragraph" || x.kind === "clauseBlockRef")) for (const x of all(c, (n) => typeof n.code === "string")) holder.set(x.code as string, c.code as string);
      for (const p of (a.children ?? []).filter((c) => c.kind === "paragraph")) {
        for (const r of all(p, (x) => x.kind === "articleRef" && x.scope === "self")) {
          for (const t of r.targets as { articleId: string; code?: string }[]) {
            if (t.articleId !== a.id || !t.code) continue;
            const own = groupOf(p.code as string);
            const hit = groupOf(holder.get(t.code) ?? "");
            // 같은 무리 — 아니면 앞 글이 「N.(소제목)」(이름 댄 소제목)이어야 한다
            if (hit === own) continue;
            const kids = p.children ?? [];
            const before = kids[kids.indexOf(r) - 1] as Json | undefined;
            expect(String(before?.text ?? ""), `${d.tree.title} ${p.code} → ${t.code}`).toMatch(/\d+\.\((?:[^()]|\([^()]*\))*\)\s*(?:\[[^\]]*\]\s*)?$/);
          }
        }
      }
    }
  });
});

describe("특약 자체의 납입면제 — 「납입면제 있음」 IF 로 통째 감싼다(납입면제 없는 상품이면 빠진다, 2026-10-14)", () => {
  const WHEN = "D0002 = true"; // 구분자 「납입면제 있음」
  const ownIf = (x: Json) => x.kind === "condBlock" && String(x.id).endsWith("-if-own-waiver");

  it("조째 — 「보험료의 납입면제」 · 「납입면제에 관한 세부규정」 조는 모두 조 자리 IF 안에 있다", () => {
    const docs = documents.filter((d) => all(d.tree, (x) => x.kind === "article" && (titleOf(x) === "보험료의 납입면제" || titleOf(x) === "납입면제에 관한 세부규정")).length > 0);
    expect(docs.length).toBe(5);
    for (const d of docs) {
      const wrapped = all(d.tree, ownIf);
      const inside = new Set(wrapped.flatMap((w) => all(w, (x) => x.kind === "article").map((a) => a.id)));
      for (const a of all(d.tree, (x) => x.kind === "article" && (titleOf(x) === "보험료의 납입면제" || titleOf(x) === "납입면제에 관한 세부규정"))) expect(inside, `${d.tree.title} ${a.id}`).toContain(a.id);
      for (const w of wrapped) expect((w.branches as { when: string }[]).map((b) => b.when)).toEqual([WHEN]);
    }
  });

  it("통합형 특약 — 세부보장마다 납입면제 소제목 자리(머리 박스부터)가 조 안 IF 하나", () => {
    const d = documents.find((x) => x.tree.title === "암 주요치료비(연간1회한, 10년간)보장 특별약관")!;
    const article = all(d.tree, (x) => x.kind === "article" && titleOf(x) === "세부보장에 관한 사항")[0];
    const wrapped = (article.children ?? []).filter(ownIf);
    // 세부보장 둘 — 소제목 「보험료의 납입면제」 · 「납입면제에 관한 세부규정」이 잇닿아 세부보장마다 IF 하나
    expect(wrapped).toHaveLength(2);
    for (const w of wrapped) expect((w.branches as { when: string; children: Json[] }[])[0].children[0].kind).toBe("boxRef");
  });
});

describe("박스 — 쓰지 않는 박스가 없다", () => {
  it("모든 박스가 문면 · 함수조항 어딘가에 놓인다", () => {
    const text = JSON.stringify([generals, documents, clauses]);
    const used = new Set([...text.matchAll(/"boxCode":"(BX\d+)"/g)].map((m) => m[1]));
    expect(boxes.filter((b) => !used.has(b.code)).map((b) => b.code)).toEqual([]);
  });
});
