import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RenderedDoc as RenderedDocType } from "@/domain/assembly";

import { RenderedBlocksView, RenderedDoc, RenderedGroupView } from "./RenderedDoc";

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

  it("절 형태 블록 번호 머리 — 그룹 「Ⅰ. 뇌 관련 특별약관」 · 블록 「Ⅰ-1. 뇌졸중 특별약관」, 끄면 블록 「1.」만 (ADR-0090 결정 8)", () => {
    const block = { ...special, title: "뇌졸중 특별약관", head: "Ⅰ-1." };
    const html = renderToStaticMarkup(<RenderedGroupView group={{ id: "g1", head: "Ⅰ.", title: "뇌 관련 특별약관", docs: [block] }} />);
    expect(html).toContain('<h2 class="ts-doc-group-title">Ⅰ. 뇌 관련 특별약관</h2>');
    expect(html).toContain('<h2 class="ts-doc-title">Ⅰ-1. 뇌졸중 특별약관</h2>');
    const off = renderToStaticMarkup(<RenderedGroupView group={{ id: "g1", docs: [{ ...block, head: "1." }] }} />);
    expect(off).not.toContain("ts-doc-group-title");
    expect(off).toContain('<h2 class="ts-doc-title">1. 뇌졸중 특별약관</h2>');
  });

  it("「그룹 제목」이 비었으면 제목 줄 자리에 오류 마커(앵커 · 메시지)", () => {
    const issue = { kind: "notEntered" as const, message: "그룹 제목이 비었습니다 — 담보분류 「상해」의 「그룹 제목」", at: {} };
    const html = renderToStaticMarkup(<RenderedGroupView group={{ id: "category:V01", titleError: { kind: "error", id: "group-title-category:V01", issue }, docs: [special] }} />);
    expect(html).toMatch(/<h2 class="ts-doc-group-title"><span id="node-group-title-category:V01" class="ts-doc-error" role="alert"/);
  });
});

describe("절 형태의 제2절 보장조항 (기능/조립산출 §3.8) — 블록 그룹은 특약 그룹과 같은 부품", () => {
  const block = (id: string, head: string, title: string) => ({ ...doc([{ label: "", text: "본문" }]), document: "special" as const, ownerId: id, title, head });

  it("「제2절 보장조항」 머리 아래 블록 그룹 — 그룹 머리 · 블록 머리는 RenderedGroupView 규칙 그대로", () => {
    const html = renderToStaticMarkup(<RenderedBlocksView groups={[{ id: "u1", head: "Ⅰ.", title: "뇌 관련 특별약관", docs: [block("pc1", "Ⅰ-1.", "뇌졸중진단 특별약관")] }]} />);
    expect(html).toContain('<section class="ts-doc-part" aria-label="제2절 보장조항"><h2 class="ts-doc-title">제2절 보장조항</h2>');
    expect(html).toContain('<h2 class="ts-doc-group-title">Ⅰ. 뇌 관련 특별약관</h2>');
    expect(html).toContain('<h2 class="ts-doc-title">Ⅰ-1. 뇌졸중진단 특별약관</h2>');
  });

  it("블록이 없으면 「블록이 없다.」", () => {
    expect(renderToStaticMarkup(<RenderedBlocksView groups={[]} />)).toContain("블록이 없다.");
  });
});
