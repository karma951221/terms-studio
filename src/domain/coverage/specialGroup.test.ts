import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";

import { SPECIAL_GROUP_ENUM, setCoverageSpecialGroup, specialGroupLabel } from "./specialGroup";
import type { Coverage } from "./types";

const groupEnum: EnumDef = {
  code: SPECIAL_GROUP_ENUM,
  label: "특약 그룹",
  values: [
    { code: "V01", label: "상해 관련 특별약관" },
    { code: "V02", label: "질병 관련 특별약관" },
  ],
} as EnumDef;

const tree: Coverage = { id: "cov-1", name: "일반상해사망", description: "", subCoverages: [] };

describe("담보의 특약 그룹 — 열거형 「특약 그룹」 값 하나 또는 없음 (ADR-0080)", () => {
  it("열거형 코드는 E0008 이다", () => {
    expect(SPECIAL_GROUP_ENUM).toBe("E0008");
  });

  it("열거형의 값을 고르면 담보가 그 값 코드를 갖는다", () => {
    const r = setCoverageSpecialGroup(tree, "V02", groupEnum);
    expect(r.ok && r.value.specialGroup).toBe("V02");
  });

  it("없음(undefined)이면 그룹 칸이 빠진다 — 그룹 없이 찍힌다", () => {
    const r = setCoverageSpecialGroup({ ...tree, specialGroup: "V01" }, undefined, groupEnum);
    expect(r.ok && "specialGroup" in r.value).toBe(false);
  });

  it("열거형에 없는 값은 거부한다 — 좌표는 담보의 그룹 칸", () => {
    const r = setCoverageSpecialGroup(tree, "V09", groupEnum);
    expect(r.ok).toBe(false);
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0]).toMatchObject({ kind: "brokenRef", at: { document: "coverageMaster", ownerId: "cov-1", refPath: "specialGroup" } });
    expect(r.rejection.issues[0].message).toContain("V09");
  });

  it("열거형 「특약 그룹」이 없으면 값을 고를 수 없다 — 없음은 된다", () => {
    expect(setCoverageSpecialGroup(tree, "V01", undefined).ok).toBe(false);
    expect(setCoverageSpecialGroup(tree, undefined, undefined).ok).toBe(true);
  });

  it("표시명 — 값 이름, 지운 값은 「없는 값 V09」, 없음은 undefined", () => {
    expect(specialGroupLabel("V01", groupEnum)).toBe("상해 관련 특별약관");
    expect(specialGroupLabel("V09", groupEnum)).toBe("없는 값 V09");
    expect(specialGroupLabel(undefined, groupEnum)).toBeUndefined();
  });
});
