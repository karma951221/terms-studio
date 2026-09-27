/**
 * ADR-0074 — 저작 화면의 저장 한 번: 명령 목록 + 시작 판 → 판 확인 · 원본에 재적용 · 전체 검증 · 한 트랜잭션 반영 + 판 +1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds, type ArticleNode, type ClauseGate, type EditOp } from "@/domain/document";
import type { Actor, Id, Result } from "@/domain/types";

import { createTestDb, type TestDb } from "@/db/test-utils";
import { createDocumentService, type DocumentService } from "./document";

const editor: Actor = { userId: "00000000-0000-4000-8000-000000000002", role: "editor" };
const cov: Id = "11111111-1111-4111-8111-111111111111";
const cov2: Id = "22222222-2222-4222-8222-222222222222";

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}
function rejection<T>(r: Result<T>) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}

/** C001 만 있고 옵션 tone 이 필수 — 추가는 통과, 저장 검증은 미선택을 거부한다 (기능/공용조항 §3.2). */
const gate: ClauseGate = {
  clauseExists: (c) => c === "C001",
  requiredCodes: () => [],
  missingRequired: () => [],
  validateOptions: (_c, o) => (o.tone === undefined ? [{ kind: "optionUnselected", message: "옵션 tone 미선택", at: {} }] : []),
};

describe("document.save — 편집본 저장 (ADR-0074)", () => {
  let t: TestDb;
  let svc: DocumentService;
  const b = nodeBuilders(sequentialIds("s"));

  beforeAll(async () => {
    t = await createTestDb();
    svc = createDocumentService(t.db, { clauseGate: async () => gate, newId: sequentialIds("srv") });
  });
  afterAll(async () => {
    await t.close();
  });

  it("판이 같으면 원본에 명령 목록을 다시 적용해 한 번에 반영하고 판을 올린다", async () => {
    const g = unwrap(await svc.createGeneral(editor, "저장 한 번 보통약관"));
    expect(g.version).toBe(1);
    const art = b.article("목적", [b.paragraph([b.text("이 약관은 …")])]);
    const ops: EditOp[] = [
      { type: "insert", node: art, at: { parentId: g.tree.id } },
      { type: "duplicate", nodeId: art.id, ids: ["d1", "d2", "d3"] },
      { type: "setTitle", nodeId: "d1", title: "용어의 정의" },
    ];
    const saved = unwrap(await svc.save(editor, g.id, { baseVersion: 1, ops }));
    expect(saved.version).toBe(2);
    expect(saved.tree.children.map((c) => [c.id, (c as ArticleNode).title])).toEqual([
      [art.id, "목적"],
      ["d1", "용어의 정의"],
    ]);
    expect((await svc.get(g.id))!.tree).toEqual(saved.tree);
  });

  it("판이 다르면 「다른 사람이 먼저 저장했습니다」로 거부하고 원본은 그대로 — 잠금은 없다", async () => {
    const g = unwrap(await svc.createGeneral(editor, "판 충돌 보통약관"));
    // 다른 사람이 먼저 저장 (판 1 → 2)
    unwrap(await svc.save(editor, g.id, { baseVersion: 1, ops: [{ type: "insert", node: b.article("먼저", []), at: { parentId: g.tree.id } }] }));
    const r = await svc.save(editor, g.id, { baseVersion: 1, ops: [{ type: "insert", node: b.article("나중", []), at: { parentId: g.tree.id } }] });
    expect(rejection(r).reason).toBe("conflict");
    const now = (await svc.get(g.id))!;
    expect(now.version).toBe(2);
    expect(now.tree.children.map((c) => (c as ArticleNode).title)).toEqual(["먼저"]);
  });

  it("전체 검증 오류면 저장을 거부한다 — 명령 단위로는 통과한 옵션 미선택 (서버가 최종 검증자)", async () => {
    const g = unwrap(await svc.createGeneral(editor, "검증 보통약관"));
    const r = await svc.save(editor, g.id, {
      baseVersion: 1,
      ops: [{ type: "insert", node: b.article("준용", [b.clauseBlock("C001", {})]), at: { parentId: g.tree.id } }],
    });
    const rej = rejection(r);
    expect(rej.reason).toBe("invalid");
    if (rej.reason === "invalid") expect(rej.issues.map((i) => i.kind)).toEqual(["optionUnselected"]);
    const now = (await svc.get(g.id))!;
    expect(now.version).toBe(1);
    expect(now.tree.children).toEqual([]);
  });

  it("명령 하나가 거부되면 전체가 거부된다 — 원본 불변", async () => {
    const g = unwrap(await svc.createGeneral(editor, "명령 거부 보통약관"));
    const r = await svc.save(editor, g.id, {
      baseVersion: 1,
      ops: [
        { type: "insert", node: b.article("앞", []), at: { parentId: g.tree.id } },
        { type: "remove", nodeId: "없는-노드" },
      ],
    });
    expect(rejection(r).reason).toBe("notFound");
    expect((await svc.get(g.id))!.tree.children).toEqual([]);
  });

  it("템플릿 이름(루트 제목)도 편집에 포함 — 보통약관 이름 중복은 거부, 바뀌면 제목 칸도 같이", async () => {
    const g = unwrap(await svc.createGeneral(editor, "이름 보통약관"));
    expect(rejection(await svc.save(editor, g.id, { baseVersion: 1, ops: [{ type: "setTitle", nodeId: g.tree.id, title: "저장 한 번 보통약관" }] })).reason).toBe("duplicate");
    const saved = unwrap(await svc.save(editor, g.id, { baseVersion: 1, ops: [{ type: "setTitle", nodeId: g.tree.id, title: "새 이름 보통약관" }] }));
    expect(saved.title).toBe("새 이름 보통약관");
  });

  it("대응 보통약관 지정 · 조연결을 한 저장에 — 지정한 보통약관의 조로만 잇는다", async () => {
    const g = unwrap(await svc.createGeneral(editor, "대응 보통약관"));
    const gArt = b.article("계약의 성립", []);
    unwrap(await svc.save(editor, g.id, { baseVersion: 1, ops: [{ type: "insert", node: gArt, at: { parentId: g.tree.id } }] }));
    const s = unwrap(await svc.createSpecial(editor, cov, "수술비 특별약관"));
    const sArt = b.article("보험금의 지급사유", []);
    const saved = unwrap(
      await svc.save(editor, s.id, {
        baseVersion: 1,
        ops: [
          { type: "insert", node: sArt, at: { parentId: s.tree.id } },
          { type: "setGeneralDocument", generalDocumentId: g.id },
          { type: "link", articleId: sArt.id, linkedArticleId: gArt.id },
        ],
      }),
    );
    expect(saved.generalDocumentId).toBe(g.id);
    expect((saved.tree.children[0] as ArticleNode).linkedArticleId).toBe(gArt.id);

    // 조연결이 남은 채 해제는 거부
    expect(rejection(await svc.save(editor, s.id, { baseVersion: saved.version, ops: [{ type: "setGeneralDocument" }] })).reason).toBe("invalid");
  });

  it("다른 문서가 가리키는 조를 지우는 저장은 영향을 보이고 확인을 받는다 — 확인하면 저장, 그쪽은 깨진 참조", async () => {
    const g = unwrap(await svc.createGeneral(editor, "참조되는 보통약관"));
    const gArt = b.article("청약의 철회", []);
    const g1 = unwrap(await svc.save(editor, g.id, { baseVersion: 1, ops: [{ type: "insert", node: gArt, at: { parentId: g.tree.id } }] }));
    const s = unwrap(await svc.createSpecial(editor, cov2, "사망 특별약관"));
    const sArt = b.article("준용", []);
    unwrap(
      await svc.save(editor, s.id, {
        baseVersion: 1,
        ops: [
          { type: "setGeneralDocument", generalDocumentId: g.id },
          { type: "insert", node: sArt, at: { parentId: s.tree.id } },
          { type: "link", articleId: sArt.id, linkedArticleId: gArt.id },
        ],
      }),
    );

    const remove: EditOp[] = [{ type: "remove", nodeId: gArt.id }];
    const first = rejection(await svc.save(editor, g.id, { baseVersion: g1.version, ops: remove }));
    expect(first.reason).toBe("needsConfirmation");
    if (first.reason === "needsConfirmation") expect(first.impact.brokenRefs.map((c) => c.ownerId)).toEqual([cov2]);
    expect((await svc.get(g.id))!.version).toBe(g1.version);

    const saved = unwrap(await svc.save(editor, g.id, { baseVersion: g1.version, ops: remove, confirm: true }));
    expect(saved.tree.children).toEqual([]);
  });

  it("원본을 바꾸는 다른 경로(이름 수정 · 명령 적용 · 트리 적재)도 판을 올린다", async () => {
    const g = unwrap(await svc.createGeneral(editor, "다른 경로 보통약관"));
    const v2 = unwrap(await svc.setTitle(editor, g.id, "다른 경로 보통약관 2"));
    expect(v2.version).toBe(2);
    const v3 = unwrap(await svc.apply(editor, g.id, [{ type: "insert", node: b.article("x", []), at: { parentId: g.tree.id } }]));
    expect(v3.version).toBe(3);
    const v4 = unwrap(await svc.importTree(editor, g.id, { ...v3.tree, children: [] }));
    expect(v4.version).toBe(4);
  });
});
