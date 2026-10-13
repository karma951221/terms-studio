import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RENEWABLE_COVERAGE, RENEWABLE_PRODUCT } from "./renewal";

/**
 * 계약일 ↔ 최초계약일은 데이터가 가른다 (ADR-0086 결정 6) — 변환 결과(시드 JSON).
 * 구분자 「갱신형 상품」(상품 레벨) · 「갱신형 담보」(담보 레벨), 문구 함수조항 「기준일 문구」와 그 사용처(알파Plus 수술비 담보약관).
 * 원문과의 글자 대조(비갱신형 「계약일」 · 갱신형 「최초계약일」)는 `src/db/seed/real.test.ts`.
 */

const DATA = path.join(process.cwd(), "src/db/seed/data");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(DATA, file), "utf8")) as T;
type Json = Record<string, unknown> & { id?: string; kind?: string; children?: Json[] };

const all = (n: unknown, pred: (x: Json) => boolean, out: Json[] = []): Json[] => {
  if (Array.isArray(n)) n.forEach((x) => all(x, pred, out));
  else if (n && typeof n === "object") {
    if (pred(n as Json)) out.push(n as Json);
    Object.values(n).forEach((v) => all(v, pred, out));
  }
  return out;
};

const discriminators = read<{ code: string; label: string; level: string; expression: string; resultType: unknown }[]>("discriminators.json");
const clauses = read<(Json & { code: string; label: string; mode: string })[]>("clauses.json");
const documents = read<{ code: string; tree: Json }[]>("documents.json");
const products = read<{ code: string; values: { path: string; value: unknown }[] }[]>("products.json");

describe("갱신형 구분자 둘 — 바탕 시드는 보통약관이 쓰는 구분자까지 앞 코드라 담보 → 상품 순", () => {
  it("D0005 갱신형 담보(담보 레벨 · 담보속성 갱신유형 = 갱신형) · D0006 갱신형 상품(상품 레벨 · 상품특성 갱신형여부)", () => {
    expect(discriminators.slice(4, 6).map((d) => [d.code, d.label, d.level, d.expression, d.resultType])).toEqual([
      [RENEWABLE_COVERAGE, "갱신형 담보", "coverage", "exist(attr.A0001) and attr.A0001 = '2'", { kind: "boolean" }],
      [RENEWABLE_PRODUCT, "갱신형 상품", "product", "feature.renewable", { kind: "boolean" }],
    ]);
  });

  it("상품 갱신형여부 — 알파Plus(세만기) 아니오 · 통합간편(연만기) 예", () => {
    const renewable = (code: string) => products.find((p) => p.code === code)!.values.find((v) => v.path === "feature.renewable")?.value;
    expect([renewable("alpha-plus"), renewable("meritz")]).toEqual([false, true]);
  });
});

describe("문구 함수조항 「기준일 문구」 (ADR-0086 결정 6)", () => {
  const basis = clauses.find((c) => c.label === "기준일 문구")!;

  it("인자 갱신(참거짓 · 기본 연결 갱신형 상품), 본문 IF 갱신 → 최초계약일 ELSE 계약일, 프리셋 ‘담보’(갱신 ← 갱신형 담보)", () => {
    expect(basis.mode).toBe("inline");
    expect(basis.params).toEqual([{ name: "갱신", type: { kind: "boolean" }, default: { kind: "discriminator", code: RENEWABLE_PRODUCT } }]);
    const body = basis.body as unknown as Json[];
    expect(body.map((n) => n.kind)).toEqual(["inlineCond"]);
    expect((body[0].branches as { when?: string; children: Json[] }[]).map((b) => [b.when, b.children.map((c) => c.text).join("")])).toEqual([
      ["arg.갱신 = true", "최초계약일"],
      [undefined, "계약일"],
    ]);
    expect(basis.options).toEqual([]);
    expect(basis.presets).toEqual([{ code: "S01", name: "담보", bindings: { 갱신: { kind: "discriminator", code: RENEWABLE_COVERAGE } } }]);
  });

  it("담보약관만 쓴다 — 보통약관이 쓰는 함수조항 뒤 첫 코드(담보약관 함수조항 맨 앞)", () => {
    const generals = read<{ tree: Json }[]>("generals.json");
    const usedByGenerals = new Set(generals.flatMap((g) => [...JSON.stringify(g.tree).matchAll(/"clauseCode":"(C\d+)"/g)].map((m) => m[1])));
    expect(usedByGenerals.has(basis.code)).toBe(false);
    expect(Number(basis.code.slice(1))).toBe(usedByGenerals.size + 1);
  });

  it("알파Plus 수술비 담보약관 — 갱신유형 조건 세 자리(제1조 ② · 예시표 둘의 행 머리)가 「기준일 문구」 프리셋 ‘담보’ 참조다", () => {
    const tree = documents.find((d) => d.code === "surgery17-doc")!.tree;
    const refs = all(tree, (x) => x.kind === "clauseInlineRef");
    expect(refs.map((r) => [r.clauseCode, r.preset, r.options, r.bindings])).toEqual(Array.from({ length: 3 }, () => [basis.code, "S01", {}, undefined]));
    expect(JSON.stringify(all(tree, (x) => x.kind === "inlineCond"))).not.toContain("최초계약일");
  });
});
