/**
 * 함수조항 「기본정보」 — 접히는 구획 · 코드 먼저 · 「반환 타입」 한 줄(유형 · 단위를 합침) · 사용처 없음 (2026-10-01 사용자 결정).
 * 서버 렌더 문자열로 본다 — 서버 렌더의 열림은 기본값(상세는 접힘)이다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClauseMeta, RequiredList, resolveContextOf, returnTypeOf, type ClauseMetaProps } from "./ClauseMeta";

const p = { kind: "paragraph" };
const i = { kind: "item" };
const cond = (...branches: { kind: string }[][]) => ({ kind: "condBlock", branches: branches.map((children) => ({ children })) });

describe("returnTypeOf — 유형 + 본문이 펴는 단위 수", () => {
  it("문구 유형은 「문구」", () => {
    expect(returnTypeOf("inline", [])).toBe("문구");
  });
  it("항 하나 · 비었으면 「항」, 둘 이상이면 「항 목록」", () => {
    expect(returnTypeOf("block", [])).toBe("항");
    expect(returnTypeOf("block", [p])).toBe("항");
    expect(returnTypeOf("block", [p, p])).toBe("항 목록");
  });
  it("조건 블록은 가지 중 가장 많은 쪽 — 가지마다 항 하나면 「항」", () => {
    expect(returnTypeOf("block", [cond([p], [p])])).toBe("항");
    expect(returnTypeOf("block", [cond([p, p], [p])])).toBe("항 목록");
    expect(returnTypeOf("block", [p, cond([p])])).toBe("항 목록");
  });
  it("반복 블록 안의 단위는 여럿으로 편다", () => {
    expect(returnTypeOf("block", [{ kind: "forBlock", children: [p] }])).toBe("항 목록");
  });
  it("호 · 목 유형", () => {
    expect(returnTypeOf("item", [i])).toBe("호");
    expect(returnTypeOf("item", [i, i])).toBe("호 목록");
    expect(returnTypeOf("subitem", [{ kind: "subitem" }])).toBe("목");
  });
});

describe("resolveContextOf — 요구 구분자가 어느 문맥에서 해소되나 (§3.3 · 조립산출 §3.2)", () => {
  it("상품 · 세목 레벨은 조립 때", () => {
    expect(resolveContextOf("product")).toBe("조립 때 — 상품 값");
    expect(resolveContextOf("plan")).toBe("조립 때 — 상품의 세목 범위");
  });
  it("담보 · 세부보장 · 급부 레벨은 사용처 문서 — 담보약관은 문서 자신, 보통약관은 기본계약", () => {
    for (const level of ["coverage", "subCoverage", "benefit"] as const) {
      expect(resolveContextOf(level)).toBe("담보약관은 문서 자신 · 보통약관은 기본계약");
    }
  });
});

const base: ClauseMetaProps = {
  code: "C0001",
  editing: false,
  name: "특별약관의 소멸",
  savedLabel: "특별약관의 소멸",
  label: "특별약관의 소멸",
  onLabel: () => {},
  mode: "block",
  modeLocked: false,
  onMode: () => {},
  unitNodes: [p, p],
  warnings: ["한 곳에서만 씁니다"],
};

describe("ClauseMeta", () => {
  it("상세는 접힌 한 줄로 시작 — 쉐브론 · 코드 · 이름, 경고는 아이콘(tooltip)만", () => {
    const html = renderToStaticMarkup(<ClauseMeta {...base} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/C0001[\s\S]*특별약관의 소멸/);
    expect(html).toContain('title="한 곳에서만 씁니다"');
    expect(html).not.toContain("반환 타입");
    expect(html).not.toMatch(/사용처|관계정보에서 보기|>유형<|>단위</);
  });

  it("생성 화면은 늘 펼침 — 이름 · 반환 타입(유형 고르기), 코드 · 요구 구분자는 없다", () => {
    const html = renderToStaticMarkup(<ClauseMeta {...base} code={undefined} editing unitNodes={[]} warnings={undefined} />);
    expect(html).not.toContain("aria-expanded");
    expect(html).toContain("반환 타입");
    expect(html).toContain('role="radiogroup"');
    expect(html).not.toMatch(/요구 구분자|>코드</);
    expect(html.indexOf("clause-label")).toBeLessThan(html.indexOf("반환 타입"));
  });

});

describe("RequiredList — 요구 구분자 줄", () => {
  const discs = [
    { code: "D0001", label: "갱신형 상품", level: "product" as const },
    { code: "D0009", label: "감액 여부", level: "coverage" as const },
  ];
  it("줄마다 코드 · 표시명 · 해소 문맥", () => {
    const html = renderToStaticMarkup(<RequiredList codes={["D0001", "D0009"]} discriminators={discs} />);
    expect(html).toMatch(/D0001[\s\S]*갱신형 상품[\s\S]*조립 때 — 상품 값/);
    expect(html).toMatch(/D0009[\s\S]*감액 여부[\s\S]*담보약관은 문서 자신 · 보통약관은 기본계약/);
  });
  it("모르는 코드는 코드만 — 해소 문맥 없이", () => {
    const html = renderToStaticMarkup(<RequiredList codes={["D0404"]} discriminators={discs} />);
    expect(html).toContain("D0404");
    expect(html).not.toContain("조립 때");
  });
  it("비었으면 「없음」 — 요구 구분자는 읽는 인자의 기본 연결이다", () => {
    const html = renderToStaticMarkup(<RequiredList codes={[]} discriminators={discs} />);
    expect(html).toContain("없음 — 본문이 읽는 인자에 기본 연결 구분자가 없다");
    expect(html).not.toContain("식에서 뽑는다");
  });
});
