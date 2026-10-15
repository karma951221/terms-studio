import { describe, expect, it } from "vitest";

import { restrictMode, restrictOfForm } from "./restrict";

describe("키 한정 칸 (ADR-0087 결정 10)", () => {
  it("「해당 키들」 체크 → { keys }, 「현재 세부보장」 → { current }", () => {
    const fd = new FormData();
    fd.set("restrictMode", "keys");
    fd.append("restrictKey", "01");
    fd.append("restrictKey", "03");
    expect(restrictOfForm(fd, "")).toEqual({ keys: ["01", "03"] });
    const cur = new FormData();
    cur.set("restrictMode", "current:f");
    expect(restrictOfForm(cur, "")).toEqual({ current: "f" });
    expect(restrictMode({ keys: ["01"] })).toBe("keys");
  });

  it("값 한정 · 없음 · 인자 접두", () => {
    const fd = new FormData();
    fd.set("arg:x:restrictMode", "values");
    fd.append("arg:x:restrictValue", "D1");
    expect(restrictOfForm(fd, "arg:x:")).toEqual({ values: ["D1"] });
    expect(restrictOfForm(new FormData(), "")).toBeUndefined();
    expect(restrictMode(undefined)).toBe("");
    expect(restrictMode({ values: [] })).toBe("values");
    expect(restrictMode({ current: "f" })).toBe("current:f");
  });
});
