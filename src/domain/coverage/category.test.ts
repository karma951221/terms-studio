import { describe, expect, it } from "vitest";

import type { EnumDef } from "../catalog/types";

import { COVERAGE_CATEGORY_ENUM, CATEGORY_TITLE_FIELD, categoryGroupTitle, coverageCategoryLabel, setCoverageCategory } from "./category";
import type { Coverage } from "./types";

const categoryEnum: EnumDef = {
  code: COVERAGE_CATEGORY_ENUM,
  label: "담보분류",
  fields: [{ key: CATEGORY_TITLE_FIELD, label: "그룹 제목", type: "string", order: 0 }],
  values: [
    { code: "V01", label: "상해", order: 0, fields: { F01: "상해 관련 특별약관" } },
    { code: "V02", label: "질병", order: 1 },
  ],
} as EnumDef;

const tree: Coverage = { id: "cov-1", name: "일반상해사망", description: "", subCoverages: [] };

describe("담보의 담보분류 — 열거형 「담보분류」 값 하나, 필수 (ADR-0090 결정 1)", () => {
  it("열거형 코드는 E0009 · 그룹 제목 필드는 F01 이다 (E0008 은 다시 쓰지 않는다)", () => {
    expect(COVERAGE_CATEGORY_ENUM).toBe("E0009");
    expect(CATEGORY_TITLE_FIELD).toBe("F01");
  });

  it("열거형의 값을 고르면 담보가 그 값 코드를 갖는다", () => {
    const r = setCoverageCategory(tree, "V02", categoryEnum);
    expect(r.ok && r.value.category).toBe("V02");
  });

  it("비울 수 없다 — notEntered, 좌표는 담보의 담보분류 칸", () => {
    const r = setCoverageCategory({ ...tree, category: "V01" }, undefined, categoryEnum);
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0]).toMatchObject({ kind: "notEntered", message: "담보분류를 고르세요", at: { document: "coverageMaster", ownerId: "cov-1", refPath: "category" } });
  });

  it("열거형에 없는 값은 거부한다", () => {
    const r = setCoverageCategory(tree, "V09", categoryEnum);
    if (r.ok || r.rejection.reason !== "invalid") throw new Error("기대: invalid");
    expect(r.rejection.issues[0]).toMatchObject({ kind: "brokenRef", at: { refPath: "category" } });
    expect(r.rejection.issues[0].message).toContain("V09");
    expect(setCoverageCategory(tree, "V01", undefined).ok).toBe(false);
  });

  it("표시명 — 값 이름, 지운 값은 「없는 값 V09」, 미입력은 undefined", () => {
    expect(coverageCategoryLabel("V01", categoryEnum)).toBe("상해");
    expect(coverageCategoryLabel("V09", categoryEnum)).toBe("없는 값 V09");
    expect(coverageCategoryLabel(undefined, categoryEnum)).toBeUndefined();
  });

  it("기본 그룹 제목 — 값의 「그룹 제목」 필드, 비었거나 없는 값이면 undefined", () => {
    expect(categoryGroupTitle(categoryEnum, "V01")).toBe("상해 관련 특별약관");
    expect(categoryGroupTitle(categoryEnum, "V02")).toBeUndefined();
    expect(categoryGroupTitle(categoryEnum, "V09")).toBeUndefined();
    expect(categoryGroupTitle(undefined, "V01")).toBeUndefined();
  });
});
