import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Discriminator } from "@/domain/catalog";
import { surgery } from "@/domain/coverage";
import { entered } from "@/domain/types";

import { buildConditionContext } from "./conditionContext";
import { ConditionDialog, isImplicitSubmitKey } from "./ConditionDialog";

const defs: Discriminator[] = [
  { code: "D0002", label: "감액여부", level: "benefit", expression: "exist(reduction.periods)", description: "" },
  { code: "D0007", label: "감액여부", level: "subCoverage", expression: "any(D0002)", description: "" },
  { code: "D0009", label: "감액여부", level: "coverage", expression: "any(D0002)", description: "" },
  { code: "D0001", label: "담보명", level: "coverage", expression: "coverage_basic.claim_name", description: "" },
];

function render(initial?: string) {
  const { tree } = surgery();
  const ctx = buildConditionContext({ coverage: tree, discriminators: defs, enums: [] });
  return renderToStaticMarkup(<ConditionDialog open context={ctx} initial={initial} onConfirm={() => {}} onCancel={() => {}} />);
}

describe("ConditionDialog — 정적 렌더 smoke", () => {
  it("좌변·연산자·우변·그리고 라벨과 트리의 세부보장 이름이 들어 있다", () => {
    const html = render("D0009 = true and D0001 = '수술비'");
    expect(html).toContain("좌변");
    expect(html).toContain("연산자");
    expect(html).toContain("우변");
    expect(html).toContain("그리고");
    expect(html).toContain("1종수술");
    expect(html).toContain("2종수술");
  });

  it("팝업이 못 여는 식(not)은 원문 읽기 전용 + 「다시 만들기」로 간다", () => {
    const html = render("not D0009 = true");
    expect(html).toContain("다시 만들기");
  });

  it("하위 감액 값이 있으면 상위 배지를 표시하고 잘못된 항상 거짓 경고를 없앤다", () => {
    const { tree, b22 } = surgery();
    const ctx = buildConditionContext({
      coverage: tree,
      values: { slots: new Map([[b22, new Map([["reduction.periods", entered([{ end: 12, rate: 50 }])]])]]) },
      discriminators: defs,
      enums: [],
    });
    const markup = (id: string) => renderToStaticMarkup(
      <ConditionDialog open context={ctx} initial={`D0007@${id} = true`} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const html = markup(tree.subCoverages[1].id);
    expect(html).not.toContain("항상 거짓");
    expect(html.match(/class="ts-badge">감액/g)).toHaveLength(3);
    expect(markup(tree.subCoverages[0].id)).toContain("항상 거짓");
  });

  it("반복 표 셀(`row`)에서만 맨 위 「현재 행」 가지 — 행 레벨 · 위 레벨 잎, 행보다 아래 레벨은 없다 (ADR-0070)", () => {
    const { tree } = surgery();
    const base = buildConditionContext({ coverage: tree, discriminators: defs, enums: [] });
    const plain = renderToStaticMarkup(<ConditionDialog open context={base} onConfirm={() => {}} onCancel={() => {}} />);
    expect(plain).not.toContain("현재 행");
    const inRow = { ...base, row: { levels: ["subCoverage" as const], readable: ["product" as const, "plan" as const, "coverage" as const, "subCoverage" as const] } };
    const html = renderToStaticMarkup(<ConditionDialog open context={inRow} onConfirm={() => {}} onCancel={() => {}} />);
    expect(html).toContain("현재 행");
    expect(html).toContain("세부보장마다");
    expect(html).toContain('aria-label="현재 행 감액여부"');
    // 「현재 행」 가지가 실제 노드 트리보다 먼저 선다
    expect(html.indexOf("현재 행")).toBeLessThan(html.indexOf("1종수술"));
    // 급부 레벨(D0002)은 세부보장 행에서 한정자 없이 읽을 수 없다 — 현재 행 잎은 세부보장 · 담보 둘뿐
    expect(html.match(/aria-label="현재 행 /g)).toHaveLength(3);
  });
});

describe("isImplicitSubmitKey — 다이얼로그가 감싸는 서버 액션 form 의 암시적 제출을 막을 자리인가", () => {
  it("input 위의 Enter 는 암시적 제출 — 막아야 한다", () => {
    expect(isImplicitSubmitKey({ key: "Enter", target: { tagName: "INPUT" } })).toBe(true);
  });

  it("button 위의 Enter 는 그 버튼의 정상 클릭이다 — 막지 않는다", () => {
    expect(isImplicitSubmitKey({ key: "Enter", target: { tagName: "BUTTON" } })).toBe(false);
  });

  it("select 위의 Enter 도 막지 않는다 (키보드 조작 유지)", () => {
    expect(isImplicitSubmitKey({ key: "Enter", target: { tagName: "SELECT" } })).toBe(false);
  });

  it("Enter 가 아닌 키는 target 과 무관하게 막지 않는다 (Escape 는 다이얼로그 네이티브 닫기)", () => {
    expect(isImplicitSubmitKey({ key: "a", target: { tagName: "INPUT" } })).toBe(false);
    expect(isImplicitSubmitKey({ key: "Escape", target: { tagName: "INPUT" } })).toBe(false);
  });

  it("target 이 없어도(널) 안전하다", () => {
    expect(isImplicitSubmitKey({ key: "Enter", target: null })).toBe(false);
  });
});
