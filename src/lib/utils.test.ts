import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn — 클래스 합치기", () => {
  it("거짓 값은 버리고, 같은 속성의 Tailwind 클래스는 뒤의 것이 이긴다", () => {
    expect(cn("h-8 px-3", false && "hidden", undefined, "px-2")).toBe("h-8 px-2");
  });
});
