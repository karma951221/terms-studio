import { describe, expect, it } from "vitest";

import {
  addAttributeValue,
  createAttributeKind,
  formatAttributeCode,
  formatAttributeValueCode,
  renameAttributeKind,
  renameAttributeValue,
  removeAttributeValue,
  reorderAttributeKinds,
  reviseAttributeKind,
  setNamingFragment,
  sortAttributeValues,
} from "./attributes";
import type { AttributeKind } from "./types";

/** 순번 흉내 — (kind, scope) 마다 1 부터. */
function seqSource() {
  const counters = new Map<string, number>();
  return async (kind: string, scope: string) => {
    const k = `${kind}:${scope}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return n;
  };
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

describe("담보속성탑재 S1 — 담보속성 카탈로그 편집 (ADR-0015)", () => {
  it("종류 코드는 A0001 · 유효값 코드는 종류 안에서 1 · 2 … 순번 그대로 (V01 · 0 채움 없음, 2026-09-28)", () => {
    expect(formatAttributeCode(1)).toBe("A0001");
    expect(formatAttributeCode(12345)).toBe("A12345");
    expect(formatAttributeValueCode(1)).toBe("1");
    expect(formatAttributeValueCode(100)).toBe("100");
    expect(() => formatAttributeValueCode(0)).toThrow(RangeError);
  });

  it("속성 종류 「갱신유형」 채번 → A0001, 유효값 0개, 적용 순서는 목록 끝", async () => {
    const seq = seqSource();
    const kind = unwrap(await createAttributeKind({ label: "갱신유형" }, [], seq));
    expect(kind).toEqual({ code: "A0001", label: "갱신유형", order: 0, values: [] });
    const second = unwrap(await createAttributeKind({ label: "부가유형" }, [kind], seq));
    expect(second.code).toBe("A0002");
    expect(second.order).toBe(1);
  });

  it("종류명 중복은 거부 · 빈 이름은 invalid", async () => {
    const seq = seqSource();
    const kind = unwrap(await createAttributeKind({ label: "갱신유형" }, [], seq));
    const dup = await createAttributeKind({ label: " 갱신유형 " }, [kind], seq);
    expect(dup).toEqual({ ok: false, rejection: { reason: "duplicate", what: "담보속성 종류 표시명 갱신유형" } });
    const empty = await createAttributeKind({ label: "  " }, [kind], seq);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.rejection.reason).toBe("invalid");
  });

  it("유효값 「갱신형」 추가 → 1, 상품담보명 표기 「갱신형」 — 앞뒤 공백은 저장 시 정리한다", async () => {
    const seq = seqSource();
    const kind = unwrap(await createAttributeKind({ label: "갱신유형" }, [], seq));
    const k2 = unwrap(await addAttributeValue(kind, { label: "갱신형", fragment: "갱신형 " }, seq));
    expect(k2.values).toEqual([{ code: "1", label: "갱신형", fragment: "갱신형" }]);
    const k3 = unwrap(await addAttributeValue(k2, { label: "비갱신형" }, seq));
    expect(k3.values[1]).toEqual({ code: "2", label: "비갱신형", fragment: "" });
  });

  it("같은 종류 안 유효값 표시명 중복은 거부", async () => {
    const seq = seqSource();
    const kind = unwrap(await createAttributeKind({ label: "부가유형" }, [], seq));
    const k2 = unwrap(await addAttributeValue(kind, { label: "추가" }, seq));
    const dup = await addAttributeValue(k2, { label: "추가" }, seq);
    expect(dup).toEqual({ ok: false, rejection: { reason: "duplicate", what: "담보속성 유효값 표시명 추가" } });
  });

  it("상품담보명 표기 등록·수정 — 「 추가」 → 「추가」. 빈 문자열은 표기 없음", async () => {
    const seq = seqSource();
    const kind = unwrap(await createAttributeKind({ label: "부가유형" }, [], seq));
    const k2 = unwrap(await addAttributeValue(kind, { label: "추가" }, seq));
    const k3 = unwrap(setNamingFragment(k2, "1", " 추가"));
    expect(k3.values[0].fragment).toBe("추가");
    const k4 = unwrap(setNamingFragment(k3, "1", "  "));
    expect(k4.values[0].fragment).toBe("");
    expect(setNamingFragment(k4, "99", "x")).toEqual({ ok: false, rejection: { reason: "notFound", what: "담보속성 유효값 99" } });
  });

  it("표시명 변경은 자유 — 코드 불변 (종류·유효값)", async () => {
    const seq = seqSource();
    const kind = unwrap(await createAttributeKind({ label: "갱신유형" }, [], seq));
    const k2 = unwrap(await addAttributeValue(kind, { label: "갱신형" }, seq));
    const k3 = unwrap(renameAttributeKind(k2, "갱신 유형", [k2]));
    expect(k3.code).toBe("A0001");
    expect(k3.label).toBe("갱신 유형");
    const k4 = unwrap(renameAttributeValue(k3, "1", "갱신형(재가입)"));
    expect(k4.values[0]).toMatchObject({ code: "1", label: "갱신형(재가입)" });
    expect(renameAttributeKind(k4, " ", [k4]).ok).toBe(false);
  });

  it("적용 순서 변경 — 카탈로그 전역 순서 하나 (D-P5-4). 전체 코드를 한 번씩 주어야 한다", async () => {
    const seq = seqSource();
    const a = unwrap(await createAttributeKind({ label: "갱신유형" }, [], seq));
    const b = unwrap(await createAttributeKind({ label: "부가유형" }, [a], seq));
    const reordered = unwrap(reorderAttributeKinds([a, b], ["A0002", "A0001"]));
    expect(reordered.map((k) => [k.code, k.order])).toEqual([
      ["A0002", 0],
      ["A0001", 1],
    ]);
    expect(reorderAttributeKinds([a, b], ["A0002"]).ok).toBe(false);
    expect(reorderAttributeKinds([a, b], ["A0002", "A0001", "A0001"]).ok).toBe(false);
  });

  it("유효값 순서 = 코드 순 — 별도 순서 값이 없고, 지운 번호는 다시 쓰지 않는다 (시퀀스)", async () => {
    const seq = seqSource();
    let kind: AttributeKind = unwrap(await createAttributeKind({ label: "부가유형" }, [], seq));
    kind = unwrap(await addAttributeValue(kind, { label: "기본" }, seq));
    kind = unwrap(await addAttributeValue(kind, { label: "추가" }, seq));
    kind = unwrap(removeAttributeValue(kind, "2"));
    kind = unwrap(await addAttributeValue(kind, { label: "특약" }, seq));
    expect(kind.values).toEqual([
      { code: "1", label: "기본", fragment: "" },
      { code: "3", label: "특약", fragment: "" },
    ]);
    expect(kind.values.every((v) => !("order" in v))).toBe(true);
  });

  it("코드 순 정렬은 숫자 순 — 10 은 9 뒤 (문자열 순이 아니다), 숫자가 아닌 코드는 맨 뒤", () => {
    const codes = sortAttributeValues([{ code: "10" }, { code: "2" }, { code: "x" }, { code: "9" }, { code: "1" }]).map((v) => v.code);
    expect(codes).toEqual(["1", "2", "9", "10", "x"]);
  });
});

describe("reviseAttributeKind — 담보속성 편집 화면 한 벌을 최종 상태로 (점검 2026-09-27 D1 · D2)", () => {
  const kind: AttributeKind = {
    code: "A0001",
    label: "갱신유형",
    order: 0,
    values: [
      { code: "1", label: "갱신형", fragment: "(갱신형)" },
      { code: "2", label: "비갱신형", fragment: "" },
    ],
  };
  const other: AttributeKind = { code: "A0002", label: "부가유형", order: 1, values: [] };
  const from3 = () => {
    let n = 2;
    return async () => ++n;
  };

  it("이름 A↔B 맞바꾸기 · 표기 · 새 값이 한 번에 — 빠진 값은 removed 로, 결과는 코드 순", async () => {
    const r = unwrap(
      await reviseAttributeKind(kind, [kind, other], { label: "갱신 유형", values: [{ label: "혼합형", fragment: "" }, { code: "2", label: "갱신형", fragment: " (갱신) " }] }, from3()),
    );
    expect(r.kind).toEqual({
      code: "A0001",
      label: "갱신 유형",
      order: 0,
      values: [
        { code: "2", label: "갱신형", fragment: "(갱신)" },
        { code: "3", label: "혼합형", fragment: "" },
      ],
    });
    expect(r.removed).toEqual(["1"]);
  });

  it("최종 상태에서 겹치면 duplicate · 빈 이름 invalid · 모르는 코드 notFound · 종류명 중복 duplicate — 거부면 채번하지 않는다", async () => {
    let calls = 0;
    const counting = async () => ++calls + 10;
    const reason = async (label: string, values: { code?: string; label: string; fragment: string }[]) => {
      const r = await reviseAttributeKind(kind, [kind, other], { label, values }, counting);
      return r.ok ? "ok" : r.rejection.reason;
    };
    expect(await reason("갱신유형", [{ code: "1", label: "비갱신형", fragment: "" }, { code: "2", label: "비갱신형", fragment: "" }])).toBe("duplicate");
    expect(await reason("갱신유형", [{ label: "새값", fragment: "" }, { code: "1", label: " ", fragment: "" }])).toBe("invalid");
    expect(await reason("갱신유형", [{ code: "9", label: "x", fragment: "" }])).toBe("notFound");
    expect(await reason("부가유형", [])).toBe("duplicate");
    expect(calls).toBe(0);
  });
});
