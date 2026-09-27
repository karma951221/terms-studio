import { describe, expect, it } from "vitest";

import { parse } from "../expression/parser";
import { MASTER, allMasterFields } from "./index";

/**
 * 카탈로그 불변식 — 마스터의 모든 `폼키.필드키` 가 식 파서를 지나 **정확히 그 마스터 참조**가 된다.
 *
 * 파서는 `attr` · `builtin` 네임스페이스와 `and` · `or` · `any` 같은 예약어를 먼저 가른다 — 폼키 `attr` 은
 * 담보속성으로 파싱되고, 폼키 `builtin` 은 두 토막이라 문법 오류가 되며, 필드키 `and` 는 예약어라 참조할 수 없다.
 * 그런 폼 · 필드는 구분자 식에서 읽을 길이 없으니 카탈로그에 올라와서는 안 된다 (코덱스 리뷰 Minor 2).
 */
describe("마스터 카탈로그 불변식 — 파서와 충돌하지 않는다", () => {
  it("모든 필드 경로가 파서를 지나 같은 master ref 가 된다", () => {
    const fields = allMasterFields();
    expect(fields.length).toBeGreaterThan(0);
    for (const ref of fields) {
      const r = parse(ref.path);
      expect(r.ok, `${ref.path} 파싱 실패`).toBe(true);
      if (!r.ok) continue;
      expect(r.value, ref.path).toEqual({ kind: "ref", ref: { kind: "master", form: ref.form.key, field: ref.field.key } });
    }
  });

  it("폼키 · 필드키 는 예약 네임스페이스 · 예약어와 겹치지 않는다 (불변식이 잡아낼 사례)", () => {
    // 불변식 테스트가 실제로 충돌을 잡는지 — 가짜 카탈로그로 반례를 확인한다
    for (const bad of ["attr.x", "builtin.x", "form.and", "any.x"]) {
      const r = parse(bad);
      const same = r.ok && r.value.kind === "ref" && r.value.ref.kind === "master";
      expect(same, `${bad} 는 마스터 참조가 되면 안 된다`).toBe(false);
    }
    expect(MASTER.every((f) => !["attr", "builtin"].includes(f.key))).toBe(true);
  });
});
