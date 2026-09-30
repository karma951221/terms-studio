import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ParamsPane } from "./ParamsPane";

const discriminators = [{ code: "D0001", label: "담보명", level: "coverage" as const, type: { kind: "string" as const }, forms: [] }];
const params = [
  { name: "보험금명", type: { kind: "string" as const }, default: { kind: "discriminator" as const, code: "D0001" } },
  { name: "갱신형", type: { kind: "boolean" as const } },
];
const render = (editing: boolean, ps = params) =>
  renderToStaticMarkup(<ParamsPane params={ps} editing={editing} onChange={() => undefined} discriminators={discriminators} enums={[]} forms={[]} />);

describe("인자 (기능/함수조항 §4.3, 2026-10-01)", () => {
  it("편집 — 맨 위 추가 줄(이름 · 타입 · 기본 연결 · ⊕), 점선 「+ 인자 추가」 버튼은 없다", () => {
    const html = render(true);
    expect(html).toContain('aria-label="새 인자 이름"');
    expect(html).toContain('aria-label="새 인자 타입"');
    expect(html).toContain('aria-label="새 인자 기본 연결"');
    expect(html).toContain('aria-label="인자 추가"');
    expect(html).not.toContain("ts-cov-add-tile");
    expect(html.indexOf("새 인자 이름")).toBeLessThan(html.indexOf("인자 1 이름")); // 추가 줄이 카드 위
  });

  it("편집 — 인자마다 카드, 맨 앞 ⊖ 「인자 삭제 · 이름」, 선언 순서", () => {
    const html = render(true);
    expect(html.match(/class="ts-param-card is-editing"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="인자 삭제 · 보험금명"');
    expect(html.indexOf("인자 삭제 · 보험금명")).toBeLessThan(html.indexOf('aria-label="인자 1 이름"')); // ⊖ 가 카드 맨 앞
    expect(html.indexOf('value="보험금명"')).toBeLessThan(html.indexOf('value="갱신형"'));
    expect(html).toContain('aria-label="인자 2 기본 연결"');
    expect(render(true, [{ name: "", type: { kind: "boolean" } }])).toContain('aria-label="인자 삭제 · 인자 1"');
  });

  it("읽기 — 조작 없는 카드, 설명은 제목 옆 ⓘ, 인자가 없으면 「인자 없음」", () => {
    const html = render(false);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("인자 추가");
    expect(html.match(/class="ts-param-card"/g)).toHaveLength(2);
    expect(html).toContain("ts-infotip");
    expect(html).not.toContain("ts-clause-sec-note");
    expect(render(false, [])).toContain("인자 없음");
  });
});
