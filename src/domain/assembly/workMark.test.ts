/**
 * 작업용 글자색(`TextNode.mark`)은 산출물 · 준용 비교에 뜻이 없다 (기능/문면 §3.2 「작업 표시」 · 기능/조립산출 §3.5).
 * 문장을 색으로 여러 조각으로 갈라 칠해도 조립 결과 · 생략/준용 판정 · 오류가 칠하지 않은 것과 같아야 한다.
 */
import { describe, expect, it } from "vitest";

import type { Id, WorkMark } from "../types";
import { assemble } from "./booklet";
import { alphaPlusFixture } from "./fixture";
import type { AssemblyInput, RenderedDoc, RenderedInline } from "./types";

const MARKS: WorkMark[] = ["red", "blue", "green", "orange"];

/** 두 글자 이상인 문장마다 둘로 갈라(짝수 salt 는 반, 홀수는 첫 글자) 앞은 색, 뒤는 다른 색(또는 색 없음)으로 — 문서 · 함수조항 본문 어디든. */
function markAll<T>(x: T, salt = 0): T {
  let k = salt;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.flatMap((n) => {
        const o = n as { kind?: string; id?: Id; text?: unknown };
        if (o && o.kind === "text" && typeof o.text === "string" && o.text.length >= 2) {
          const half = salt % 2 === 0 ? Math.floor(o.text.length / 2) : 1;
          k += 1;
          const tail = k % 2 === 0 ? { mark: MARKS[(k + 1) % 4] } : {};
          return [
            { ...o, text: o.text.slice(0, half), mark: MARKS[k % 4] },
            { ...o, id: `${o.id}~m`, text: o.text.slice(half), ...tail },
          ];
        }
        return [walk(n)];
      });
    }
    if (v instanceof Map) return new Map([...v].map(([key, value]) => [key, walk(value)]));
    if (v instanceof Set || v === null || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).map(([key, value]) => [key, walk(value)]));
  };
  return walk(x) as T;
}

function marked(input: AssemblyInput, salt: number): AssemblyInput {
  return {
    ...input,
    generalDocuments: markAll(input.generalDocuments, salt),
    specialDocuments: markAll(input.specialDocuments, salt + 1),
    clauses: markAll(input.clauses, salt + 2),
  };
}

const text = (doc: RenderedDoc): string => {
  const out: string[] = [];
  const inline = (list: readonly RenderedInline[]) => list.map((n) => (n.kind === "text" ? n.text : n.kind === "error" ? `⟦${n.issue.kind}⟧` : n.label)).join("");
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (v.every((n) => n && typeof n === "object" && "kind" in n && ["text", "slot", "articleRef", "appendixRef", "error"].includes((n as { kind: string }).kind)) && v.length > 0) {
        out.push(inline(v as RenderedInline[]));
        return;
      }
      v.forEach(walk);
      return;
    }
    if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(doc);
  return out.join("\n");
};

describe("작업용 글자색 — 산출물 · 준용 비교 제외", () => {
  const plain = assemble(alphaPlusFixture(), alphaPlusFixture());
  const input = marked(alphaPlusFixture(), 0);
  const colored = assemble(input, input);

  it("조립 산출물에 색이 실리지 않는다 — 어디에도 `mark` 가 없다", () => {
    expect(JSON.stringify(input.specialDocuments.get("cov-death"))).toContain('"mark"');
    expect(JSON.stringify(colored)).not.toContain('"mark"');
  });

  it("칠한 문장과 칠하지 않은 문장의 산출 글이 같다 — 보통약관 · 특약 모두", () => {
    expect(text(colored.general!)).toBe(text(plain.general!));
    expect(colored.specials.map((s) => s.docs.map(text))).toEqual(plain.specials.map((s) => s.docs.map(text)));
  });

  it("준용 · 생략 판정이 같다 — 같은 글을 서로 다른 색 · 다른 조각으로 칠해도 같은 글", () => {
    const other = marked(alphaPlusFixture(), 1);
    const mixedInput: AssemblyInput = { ...input, generalDocuments: other.generalDocuments };
    const mixed = assemble(mixedInput, mixedInput);
    const disposition = (b: typeof plain) => b.omitted.map(({ productCoverageId, articleId, disposition: d }) => [productCoverageId, articleId, d]);
    expect(disposition(colored)).toEqual(disposition(plain));
    expect(disposition(mixed)).toEqual(disposition(plain));
    expect(disposition(plain).some(([, , d]) => d === "omitted")).toBe(true);
  });

  it("오류 · 경고가 같다", () => {
    const kinds = (b: typeof plain) => b.issues.map((i) => i.kind).sort();
    expect(kinds(colored)).toEqual(kinds(plain));
  });
});
