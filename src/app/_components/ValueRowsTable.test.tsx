/**
 * 값 행 표 (ValueRowsTable, 디자인원칙 §2 L2 「값 행 표」, 2026-10-01) — 행 앞 ⊖ · 끌기 손잡이 · 마지막 행 아래 ⊕.
 * DOM 없는 환경이라 조작 규칙(옮기기 · 키 · 새 행 찾기)은 순수 함수로, 모양은 서버 렌더 문자열로 본다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ValueRowsTable, addedRowKey, keyboardMoveTarget, moveItem, type ValueRowsTableProps } from "./ValueRowsTable";

type Row = { key: string; label: string };
const ROWS: Row[] = [{ key: "a", label: "암" }, { key: "b", label: "뇌졸중" }, { key: "c", label: "" }];

function html(props: Partial<ValueRowsTableProps<Row>> = {}) {
  return renderToStaticMarkup(<ValueRowsTable<Row>
    rows={ROWS}
    rowKey={(row) => row.key}
    rowName={(row) => row.label || "새 값"}
    editing
    order
    onMove={() => {}}
    onRemove={() => {}}
    onAdd={() => {}}
    columns={[{ key: "label", header: "값 이름", cell: (row) => <input aria-label={`값 이름 ${row.key}`} defaultValue={row.label} /> }]}
    {...props}
  />);
}

describe("moveItem — 끌어 놓기 · 키보드가 같이 쓰는 옮기기", () => {
  it("빼서 그 자리에 넣는다 (아래로 · 위로)", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });
  it("같은 자리 · 범위 밖은 그대로 (새 배열)", () => {
    const items = ["a", "b"];
    expect(moveItem(items, 1, 1)).toEqual(items);
    expect(moveItem(items, 0, 5)).toEqual(items);
    expect(moveItem(items, 0, 5)).not.toBe(items);
  });
});

describe("keyboardMoveTarget — 손잡이에서 ↑ ↓, 행 어디서나 Alt+↑ ↓", () => {
  it("손잡이: ↑ ↓ 로 한 칸 · 끝에서 돌지 않는다", () => {
    expect(keyboardMoveTarget("ArrowDown", false, true, 0, 3)).toBe(1);
    expect(keyboardMoveTarget("ArrowUp", false, true, 2, 3)).toBe(1);
    expect(keyboardMoveTarget("ArrowUp", false, true, 0, 3)).toBeNull();
    expect(keyboardMoveTarget("ArrowDown", false, true, 2, 3)).toBeNull();
  });
  it("입력칸: Alt 없이는 옮기지 않는다(글자 커서 이동) · Alt+↑ ↓ 는 옮긴다", () => {
    expect(keyboardMoveTarget("ArrowDown", false, false, 0, 3)).toBeNull();
    expect(keyboardMoveTarget("ArrowDown", true, false, 0, 3)).toBe(1);
    expect(keyboardMoveTarget("ArrowUp", true, false, 1, 3)).toBe(0);
  });
  it("다른 키는 옮기지 않는다", () => {
    expect(keyboardMoveTarget("Enter", true, true, 1, 3)).toBeNull();
  });
});

describe("addedRowKey — 새 행 찾기(그 행 첫 입력칸에 커서)", () => {
  it("처음 그릴 때는 없다 · 앞에 없던 키 중 마지막", () => {
    expect(addedRowKey(null, ["a", "b"])).toBeUndefined();
    expect(addedRowKey(new Set(["a", "b"]), ["a", "b", "new:1"])).toBe("new:1");
    expect(addedRowKey(new Set(["a", "b"]), ["b", "a"])).toBeUndefined();
    expect(addedRowKey(new Set(["a", "b"]), ["a"])).toBeUndefined();
  });
});

describe("ValueRowsTable — 모양", () => {
  it("편집: 행 맨 앞 ⊖ 「행 삭제 · 이름」, 이어서 손잡이 「순서 옮기기 · 이름」, 그다음 순서 칸 — 이름이 비면 자리 이름", () => {
    const out = html();
    const first = out.match(/<tbody>(.*?)<\/tr>/)![1]!;
    expect(first.indexOf('aria-label="행 삭제 · 암"')).toBeGreaterThan(-1);
    expect(first.indexOf('aria-label="행 삭제 · 암"')).toBeLessThan(first.indexOf('aria-label="순서 옮기기 · 암"'));
    expect(first.indexOf('aria-label="순서 옮기기 · 암"')).toBeLessThan(first.indexOf('<td class="col-num">1</td>'));
    expect(out).toContain('title="행 삭제 · 암"');
    expect(out).toContain('title="순서 옮기기 · 암 — 끌거나 ↑ ↓ 키"');
    expect(out).toContain('draggable="true"');
    expect(out).toContain('aria-label="행 삭제 · 새 값"');
    expect(out).toContain('role="status"');
  });

  it("편집: 마지막 행 아래(tfoot) ⊕ 「행 추가」 — 머리에 개수 · + 가 없다", () => {
    const out = html();
    expect(out).toMatch(/<tfoot><tr class="ts-vrows-add"><td class="ts-vrows-ctl"[^>]*><button[^>]*title="행 추가" aria-label="행 추가"/);
    expect(out.match(/<thead>.*<\/thead>/)![0]).not.toMatch(/button|>3</);
  });

  it("추가 이름을 붙일 수 있다 — 한 화면에 표가 둘일 때", () => {
    expect(html({ addLabel: "행 추가 · 필드" })).toContain('aria-label="행 추가 · 필드"');
  });

  it("onMove 가 없으면 손잡이가 없다 (순서가 곧 코드인 표)", () => {
    const out = html({ onMove: undefined, order: false });
    expect(out).not.toContain("순서 옮기기");
    expect(out).not.toContain("draggable");
    expect(out).toContain("행 삭제 · 암");
  });

  it("읽기: 조작 칸 · 손잡이 · ⊕ 가 없는 평범한 표", () => {
    const out = html({ editing: false });
    expect(out).not.toMatch(/행 삭제|순서 옮기기|행 추가|<tfoot|ts-vrows-ctl/);
    expect(out).toContain('<td class="col-num">3</td>');
  });

  it("행이 없으면 빈 줄 안내, 저장 중(disabled)이면 조작이 멈춘다", () => {
    expect(html({ rows: [], empty: "값을 추가하세요." })).toContain("값을 추가하세요.");
    const disabled = html({ disabled: true });
    expect(disabled).toMatch(/<button[^>]*disabled=""[^>]*aria-label="행 추가"|aria-label="행 추가"[^>]*disabled/);
  });
});
