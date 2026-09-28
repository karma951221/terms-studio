import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RenderedDoc as RenderedDocType } from "@/domain/assembly";

import { RenderedDoc } from "./RenderedDoc";

const doc = (paragraphs: { label: string; text: string }[]): RenderedDocType => ({
  kind: "document",
  id: "d",
  document: "general",
  ownerId: "g",
  title: "보통약관",
  children: [
    {
      kind: "article",
      id: "a1",
      number: 1,
      label: "제1조",
      title: "목적",
      children: paragraphs.map((p, i) => ({ kind: "paragraph", id: `p${i}`, number: i + 1, label: p.label, children: [{ kind: "text", id: `t${i}`, text: p.text }] })),
    },
  ],
});

describe("항 번호를 생략한 항 — 내어쓰기 없음 (기능/문면 §3.2, 2026-09-28)", () => {
  it("항이 하나뿐인 조(번호 없음)는 is-bare — 첫 줄만 내어 쓰지 않는다", () => {
    const html = renderToStaticMarkup(<RenderedDoc doc={doc([{ label: "", text: "이 계약은 …" }])} />);
    expect(html).toContain('class="ts-doc-paragraph is-bare"');
    expect(html).not.toContain("ts-doc-num");
  });

  it("번호가 있는 항(①②)은 매달린 들여쓰기 그대로", () => {
    const html = renderToStaticMarkup(<RenderedDoc doc={doc([{ label: "①", text: "가" }, { label: "②", text: "나" }])} />);
    expect(html).not.toContain("is-bare");
    expect(html.match(/class="ts-doc-paragraph"/g)).toHaveLength(2);
  });
});
