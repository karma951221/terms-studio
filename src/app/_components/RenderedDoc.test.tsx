import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RenderedDoc as RenderedDocType } from "@/domain/assembly";

import { RenderedDoc, RenderedGroupView } from "./RenderedDoc";

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

describe("책자의 특약 그룹 (ADR-0090) — 제목은 사용자 그룹 이름 · 담보분류의 「그룹 제목」, 담보분류를 정할 수 없는 상품담보는 제목 없이", () => {
  const special = { ...doc([{ label: "", text: "보장합니다." }]), document: "special" as const, title: "골절 특별약관" };
  it("제목이 있으면 그룹 제목 줄, 없으면 제목 줄을 그리지 않는다", () => {
    expect(renderToStaticMarkup(<RenderedGroupView group={{ id: "category:V01", title: "상해 관련 특별약관", docs: [special] }} />)).toContain('<h2 class="ts-doc-group-title">상해 관련 특별약관</h2>');
    const html = renderToStaticMarkup(<RenderedGroupView group={{ id: "ungrouped", docs: [special] }} />);
    expect(html).not.toContain("ts-doc-group-title");
    expect(html).toContain("골절 특별약관");
  });

  it("「그룹 제목」이 비었으면 제목 줄 자리에 오류 마커(앵커 · 메시지)", () => {
    const issue = { kind: "notEntered" as const, message: "그룹 제목이 비었습니다 — 담보분류 「상해」의 「그룹 제목」", at: {} };
    const html = renderToStaticMarkup(<RenderedGroupView group={{ id: "category:V01", titleError: { kind: "error", id: "group-title-category:V01", issue }, docs: [special] }} />);
    expect(html).toMatch(/<h2 class="ts-doc-group-title"><span id="node-group-title-category:V01" class="ts-doc-error" role="alert"/);
  });
});
