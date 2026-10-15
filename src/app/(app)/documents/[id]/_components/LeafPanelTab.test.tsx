import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeafRows } from "./LeafPanelTab";

describe("「구분자」 탭 (ADR-0087 결정 6)", () => {
  it("값 줄 · ⚠ 문제 줄 · ⓘ 주석", () => {
    const html = renderToStaticMarkup(
      <LeafRows
        rows={[
          { label: "세부보장 01 · 유사암 › 급부 1 · 진단비 › 지급률", code: "D0003", path: "01.1", value: "20%", description: "보험금 지급률", at: { nodePath: ["a", "p"] } },
          { label: "세부보장 09 › 감액 여부", code: "D0007", path: "09", problem: "brokenKey", at: { nodePath: ["a", "q"] } },
        ]}
        go={() => {}}
      />,
    );
    expect(html).toContain("세부보장 01 · 유사암 › 급부 1 · 진단비 › 지급률");
    expect(html).toContain("20%");
    expect(html).toContain("⚠");
    expect(html).toContain("끊어진 키");
    expect(html).toContain("고칠 자리로");
    expect(html).toContain("보험금 지급률");
  });
});
