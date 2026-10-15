import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { nodeBuilders, numberTree, referenceTargetIndex, sequentialIds } from "@/domain/document";

import { RefTargetTree } from "./RefTargetTree";

describe("화면의 코드 표시 — 대상 고르기 줄 끝 (ADR-0072 · 기능/문면 §6.2)", () => {
  it("대상 고르기 줄 끝에 흐린 글씨 「P0200 · 호」 — 조 줄에는 없다", () => {
    const b = nodeBuilders(sequentialIds("t"));
    const item = b.item([b.text("호")]);
    item.code = "P0200";
    const para = b.paragraph([b.text("항")], [item]);
    para.code = "P0100";
    const doc = b.document("d", [b.article("조", [para])]);
    const index = referenceTargetIndex(doc, numberTree(doc));
    // 고른 대상의 조상이 펴져 있어 항 · 호 줄이 그려진다
    const html = renderToStaticMarkup(<RefTargetTree id="t" scopes={[{ key: "self", index }]} defaultSelected={[item.id]} />);
    expect(html).toContain('<span class="ts-ref-code">P0100 · 항</span>');
    expect(html).toContain('<span class="ts-ref-code">P0200 · 호</span>');
    expect(html.match(/ts-ref-code/g)).toHaveLength(2);
  });

});
