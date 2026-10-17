import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "@/domain/document";
import { dynTableFixtureA, type NewDynTable } from "@/domain/dyntable";
import type { Actor, Rejection } from "@/domain/types";

import { insertDiscriminator } from "@/db/repo/catalog";
import { insertDocument } from "@/db/repo/document";
import { createTestDb, type TestDb } from "@/db/test-utils";
import { createServices, type Services } from "./container";

const admin: Actor = { userId: "00000000-0000-4000-8000-000000000001", role: "admin" };
const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
const 상해사망 = "22222222-2222-4222-8222-222222222222";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function rejection(r: { ok: true } | { ok: false; rejection: Rejection }): Rejection {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}

/** 정의 A 에서 갱신형 인자에 기본 연결(상수 true)을 둔 판 — 사용처가 연결하지 않아도 된다. */
function withDefault(): NewDynTable {
  const a = dynTableFixtureA();
  return { ...a, params: [{ name: "갱신형", type: { kind: "boolean" }, default: { kind: "const", value: true } }] };
}

describe("동적표 서비스 (기능/동적표 §3.1 · §3.6)", () => {
  let t: TestDb;
  let s: Services;
  beforeAll(async () => {
    t = await createTestDb();
    s = createServices(t.db);
    await insertDiscriminator(t.db, { code: "D0001", label: "갱신여부", description: "", level: "coverage", expression: "coverage_basic.claim_name ≠ ''", resultType: { kind: "boolean" } }, admin.userId);
  });
  afterAll(async () => {
    await t.close();
  });

  it("생성 — editor 도 가능, 코드 DT000001 채번, 목록 · 요약에 오른다", async () => {
    const created = unwrap(await s.dynTable.create(editor, withDefault()));
    expect(created.code).toBe("DT000001");
    expect(created.label).toBe("감액 지급금액 표");
    expect((await s.dynTable.list()).map((d) => d.code)).toEqual(["DT000001"]);
    expect((await s.dynTable.summaries()).map((d) => [d.code, d.columnBasis])).toEqual([["DT000001", "reduction"]]);
    expect((await s.dynTable.get("DT000001"))?.params[0]?.default).toEqual({ kind: "const", value: true });
  });

  it("저장 검사 — 선언되지 않은 인자를 읽는 템플릿은 invalid(brokenRef) 로 거부", async () => {
    const a = dynTableFixtureA();
    const bad: NewDynTable = { ...a, headers: { ...a.headers, single: [...a.headers.single, { id: "single-x", kind: "slot", ref: "arg.없는인자" }] } };
    const r = rejection(await s.dynTable.create(editor, bad));
    expect(r.reason).toBe("invalid");
    if (r.reason === "invalid") expect(r.issues.map((i) => [i.kind, i.at.refPath])).toEqual([["brokenRef", "headers.single"]]);
    expect((await s.dynTable.list()).map((d) => d.code)).toEqual(["DT000001"]);
  });

  it("문서 저장 검사 — 담보약관의 동적표 참조는 게이트로 존재 · 연결을 본다", async () => {
    const b = nodeBuilders(sequentialIds("x"));
    const doc = await insertDocument(t.db, { kind: "special", ownerId: 상해사망, title: "상해사망 특별약관", tree: b.document("상해사망 특별약관", [b.article("감액", [b.dynTableRef("DT000001")])]) }, admin.userId);
    expect(await s.document.validateTree(doc.id, doc.tree)).toEqual([]);
    const missing = b.document("상해사망 특별약관", [b.article("감액", [b.dynTableRef("DT999999")])]);
    expect((await s.document.validateTree(doc.id, missing)).map((i) => [i.kind, i.message])).toEqual([["brokenRef", "동적표 DT999999 이(가) 없습니다"]]);
    // 사용처 — 그 문서 · 그 노드
    const usages = await s.dynTable.usages("DT000001");
    expect(usages.map((u) => [u.documentId, u.ownerKind, u.ownerId, u.refNodeId])).toEqual([[doc.id, "coverage", 상해사망, "x1"]]);
  });

  it("저장 + 재검사 — 기본 연결을 지우면 연결하지 않은 사용처가 argUnbound 로 오른다", async () => {
    const { table, recheck } = unwrap(await s.dynTable.save(editor, "DT000001", dynTableFixtureA()));
    expect(table.params).toEqual([{ name: "갱신형", type: { kind: "boolean" } }]);
    expect(recheck).toHaveLength(1);
    expect(recheck[0].usage.ownerId).toBe(상해사망);
    expect(recheck[0].issues.map((i) => [i.kind, i.at.refPath, i.at.nodePath])).toEqual([["argUnbound", "arg.갱신형", ["x1"]]]);
    // 기본 연결을 되살리면 재검사는 비고, 없는 코드는 notFound
    expect(unwrap(await s.dynTable.save(editor, "DT000001", withDefault())).recheck).toEqual([]);
    expect(unwrap(await s.dynTable.recheck("DT000001"))).toEqual([]);
    expect(rejection(await s.dynTable.save(editor, "DT404040", withDefault())).reason).toBe("notFound");
  });

  it("삭제 — editor 금지 · admin 1차는 사용처를 든 needsConfirmation · confirm 으로 삭제", async () => {
    expect(rejection(await s.dynTable.remove(editor, "DT000001")).reason).toBe("forbidden");
    const first = rejection(await s.dynTable.remove(admin, "DT000001"));
    expect(first.reason).toBe("needsConfirmation");
    if (first.reason === "needsConfirmation") expect(first.impact.brokenRefs.map((c) => [c.ownerId, c.nodePath])).toEqual([[상해사망, ["x1"]]]);
    unwrap(await s.dynTable.remove(admin, "DT000001", { confirm: true }));
    expect(await s.dynTable.get("DT000001")).toBeUndefined();
    expect(rejection(await s.dynTable.remove(admin, "DT000001", { confirm: true })).reason).toBe("notFound");
  });
});
