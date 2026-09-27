/**
 * 담보 상세 값 폼의 편집 세션 세대 — 모든 노드의 폼이 한 화면에 동시에 뜨고, 인스턴스는 노드마다 · 세대마다 다르다.
 * 화면은 `formKeyOf` 를 StructForm 의 key 로 쓴다. 여기서는 그 상태 전이를 화면 없이 재현한다.
 */
import { describe, expect, it } from "vitest";

import { formKeyOf, formSessionReducer, initFormSession } from "./value-drafts";

const A = "benefit:b1";
const B = "benefit:b2";
const EDITED = { [A]: { issues: [], values: [{ path: "pay.rate", value: 70 }] } };

describe("값 폼 편집 세션 — 인스턴스를 언제 새로 띄우는가", () => {
  it("노드마다 다른 인스턴스 — 같은 마스터 폼 · 같은 저장값이어도 A 의 초안이 B 로 새지 않는다 (점검 H4 ①)", () => {
    const s = initFormSession("read");
    expect(formKeyOf(s, A)).not.toBe(formKeyOf(s, B));
  });

  it("편집에 들어갈 때는 세대를 올리지 않는다 — 읽기 화면의 폼이 그대로 입력기가 된다", () => {
    const read = initFormSession("read");
    const edit = formSessionReducer(read, { mode: "edit", values: {} });
    expect(edit.mode).toBe("edit");
    expect(formKeyOf(edit, A)).toBe(formKeyOf(read, A));
  });

  it("취소(값 초안이 시작 때로 돌아감)면 세대를 올려 모든 폼이 저장값으로 다시 선다", () => {
    const edit = formSessionReducer(initFormSession("read"), { mode: "edit", values: {} });
    const cancelled = formSessionReducer(edit, { mode: "read", values: {} });
    expect(cancelled.mode).toBe("read");
    expect(formKeyOf(cancelled, A)).not.toBe(formKeyOf(edit, A));
    expect(formKeyOf(cancelled, B)).not.toBe(formKeyOf(edit, B));
  });

  it("저장(값 초안이 시작 때와 다름)이면 세대를 두어 방금 저장한 값이 서버 값이 올 때까지 남는다", () => {
    const edit = formSessionReducer(initFormSession("read"), { mode: "edit", values: {} });
    const saved = formSessionReducer(edit, { mode: "read", values: EDITED });
    expect(formKeyOf(saved, A)).toBe(formKeyOf(edit, A));
  });

  it("같은 모드로의 전이는 무시한다", () => {
    const s = initFormSession("read");
    expect(formSessionReducer(s, { mode: "read", values: EDITED })).toBe(s);
  });
});
