import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ actor: { userId: "u1" } as { userId: string } | undefined, many: false }));

vi.mock("@/lib/services", () => ({
  currentActorOrNull: async () => state.actor,
  getServices: () => ({
    coverage: {
      listSummaries: async () =>
        state.many
          ? Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, code: `COV${String(i).padStart(6, "0")}`, name: `담보${i}` }))
          : [
              { id: "c1", code: "COV000001", name: "일반상해사망보장" },
              { id: "c2", code: "COV000008", name: "수술비" },
            ],
    },
  }),
}));

import { GET } from "./route";

const get = (q: string) => GET(new NextRequest(`http://localhost/api/lookup/coverages?q=${encodeURIComponent(q)}`));

describe("GET /api/lookup/coverages — 담보 찾기", () => {
  beforeEach(() => {
    state.actor = { userId: "u1" };
    state.many = false;
  });

  it("이름 · 담보코드로 거른다 — 값은 id, 보조 글자는 코드", async () => {
    expect(await (await get("사망")).json()).toEqual({ options: [{ value: "c1", label: "일반상해사망보장", hint: "COV000001" }], more: false });
    expect((await (await get("cov000008")).json()).options.map((o: { value: string }) => o.value)).toEqual(["c2"]);
  });

  it("50건까지, 넘으면 more", async () => {
    state.many = true;
    const body = await (await get("")).json();
    expect(body.options).toHaveLength(50);
    expect(body.more).toBe(true);
  });

  it("로그인하지 않으면 401", async () => {
    state.actor = undefined;
    expect((await get("")).status).toBe(401);
  });
});
