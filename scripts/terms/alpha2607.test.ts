import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

const generals = read<{ code: string; tree: Json }[]>("generals.json");
const documents = read<{ code: string; ownerCoverage: string; general: string; tree: Json }[]>("documents.json");
const clauses = read<(Json & { code: string; label: string })[]>("clauses.json");
const boxes = read<{ code: string }[]>("boxes.json");
const coverages = read<{ key: string; code: string; name: string; specialGroup?: string }[]>("coverages.json");
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
    expect(clauses).toHaveLength(71);
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
  it.each(DISEASES)("%s — 담보(특약 그룹 질병) · 템플릿", (name) => {
    const coverage = coverages.find((c) => c.name === name);
    expect(coverage?.specialGroup).toBe("V02");
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

  it("탑재 = 2604 탑재(기본계약 + 특약 10) + 질병 5", () => {
    const alphaMounts = products.find((p) => p.code === "alpha-plus")!.mounts.map((m) => m.coverage);
    const diseaseKeys = DISEASES.map((name) => coverages.find((c) => c.name === name)!.key);
    expect(product?.mounts.map((m) => m.coverage)).toEqual([...alphaMounts, ...diseaseKeys]);
  });
});

describe("박스 — 쓰지 않는 박스가 없다", () => {
  it("모든 박스가 문면 · 함수조항 어딘가에 놓인다", () => {
    const text = JSON.stringify([generals, documents, clauses]);
    const used = new Set([...text.matchAll(/"boxCode":"(BX\d+)"/g)].map((m) => m[1]));
    expect(boxes.filter((b) => !used.has(b.code)).map((b) => b.code)).toEqual([]);
  });
});
