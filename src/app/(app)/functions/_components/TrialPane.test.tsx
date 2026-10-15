/** 「시험」 탭 — 처음 시험 값으로 곧바로 출력을 보인다 (기능/함수조항 §3.7). 서버 렌더 문자열로 본다. */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Clause } from "@/domain/clause";

import { TrialPane } from "./TrialPane";

const clause = {
  code: "C0100",
  label: "기준일 문구",
  mode: "inline",
  required: { discriminators: [], attributes: [] },
  params: [{ name: "갱신", type: { kind: "boolean" } }],
  options: [],
  body: [{ id: "c", kind: "inlineCond", branches: [{ id: "b1", when: "arg.갱신", children: [{ id: "t1", kind: "text", text: "최초계약일" }] }, { id: "b2", children: [{ id: "t2", kind: "text", text: "계약일" }] }] }],
} as unknown as Clause;

describe("TrialPane", () => {
  it("인자마다 값 칸, 처음 값(참거짓 아니오)으로 펼친 출력", () => {
    const html = renderToStaticMarkup(<TrialPane clause={clause} enums={new Map()} />);
    expect(html).toContain('aria-label="인자 갱신 시험 값"');
    expect(html).toMatch(/시험 출력[\s\S]*계약일/);
    expect(html).not.toContain("최초계약일");
  });

  it("본문을 읽을 수 없으면 그 사유만", () => {
    const html = renderToStaticMarkup(<TrialPane clause={clause} enums={new Map()} problem="본문을 읽을 수 없어 시험하지 못했다" />);
    expect(html).toContain("본문을 읽을 수 없어 시험하지 못했다");
  });
});
