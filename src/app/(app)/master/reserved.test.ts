import { describe, expect, it } from "vitest";

import { BASICS_TABS } from "@/app/_lib/menu";
import { MASTER } from "@/domain/master";

/**
 * `/master/<탭>` 의 정적 세그먼트(`enums`)는 폼 상세 `/master/[key]` 보다 먼저 잡힌다 —
 * 폼키가 탭 세그먼트와 같으면 그 폼 상세에 갈 길이 없다. 그래서 탭 세그먼트는 폼키 예약어다 (기능/마스터 §3.1).
 */
describe("마스터 탭 세그먼트는 폼키로 쓰지 않는다", () => {
  const reserved = BASICS_TABS.filter(({ href }) => href.startsWith("/master/")).map(({ href }) => href.split("/")[2]);

  it("예약어에 enums 가 있다", () => {
    expect(reserved).toContain("enums");
  });

  it("어떤 폼키도 예약어와 같지 않다", () => {
    for (const form of MASTER) expect(reserved, form.key).not.toContain(form.key);
  });
});
