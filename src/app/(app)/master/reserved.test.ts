import { describe, expect, it } from "vitest";

import { MASTER } from "@/domain/master";

/**
 * `/master/enums` 는 옛 주소 리다이렉트(→ `/enums`)로 남은 정적 세그먼트라 폼 상세 `/master/[key]` 보다 먼저 잡힌다 —
 * 폼키가 `enums` 면 그 폼 상세에 갈 길이 없다. 그래서 `enums` 는 폼키 예약어다 (기능/마스터 §3.1).
 */
const RESERVED = ["enums"] as const;

describe("마스터 정적 세그먼트는 폼키로 쓰지 않는다", () => {
  it("어떤 폼키도 예약어와 같지 않다", () => {
    for (const form of MASTER) expect(RESERVED, form.key).not.toContain(form.key);
  });
});
