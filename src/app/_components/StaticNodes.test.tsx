/** 정적 표 렌더 — 반복 표 펼침 결과의 `spans` 가 rowSpan 으로 찍히는지 (ADR-0070 · 설계 §3.3). */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaticTable } from "./StaticNodes";

describe("StaticTable — rowSpan", () => {
  it("span n 은 rowSpan, 0 은 그리지 않는다 · spans 없으면 지금과 같다", () => {
    const html = renderToStaticMarkup(
      <StaticTable
        node={{
          id: "t",
          columns: [{}, {}],
          rows: [
            { header: true, cells: ["세부보장", "급부"] },
            { cells: ["1종", "급부 1"], spans: [1, 1] },
            { cells: ["2종", "급부 1"], spans: [2, 1] },
            { cells: ["2종", "급부 2"], spans: [0, 1] },
          ],
        }}
      />,
    );
    expect(html).toContain("<th>세부보장</th>");
    expect(html).toContain("<td rowSpan=\"2\">2종</td>");
    expect(html).toContain("<tr><td>급부 2</td></tr>");
    expect(html.match(/<td>1종<\/td>/g)).toHaveLength(1);
  });
});
