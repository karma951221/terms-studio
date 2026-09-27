import { describe, expect, it } from "vitest";

import type { Result } from "../types";
import { nodeBuilders, sequentialIds } from "./builders";
import { applyCommand } from "./commands";
import { applyEdit, envAt, generalRefsOf, removedIds, replayEdits, type DraftState, type EditEnv, type EditOp } from "./edit";
import type { ArticleNode, DocumentNode } from "./nodes";

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

function rejection<T>(r: Result<T>) {
  if (r.ok) throw new Error("기대: 거부, 실제: ok");
  return r.rejection;
}

/** 보통약관 두 벌(g · h) · 담보약관 하나. 담보약관: 제1조(n3 · 항 n2 · 문장 n1) · 제2조(n4) · 문서 n5. */
function fixture() {
  const b = nodeBuilders(sequentialIds("n"));
  const g = nodeBuilders(sequentialIds("g"));
  const h = nodeBuilders(sequentialIds("h"));
  const special = b.document("수술비 특별약관", [b.article("보험금의 지급사유", [b.paragraph([b.text("회사는 ")])]), b.article("보험기간", [])]);
  const general = g.document("보통약관", [g.article("계약의 성립", [g.paragraph([g.text("…")])])]); // text g1 · paragraph g2 · article g3 · document g4
  const other = h.document("다른 보통약관", [h.article("청약의 철회", [])]); // article h1 · document h2
  const generals = new Map<string, DocumentNode>([
    ["G", general],
    ["H", other],
  ]);
  const env: EditEnv = {
    env: { kind: "special" },
    generalRefs: (id) => {
      const tree = generals.get(id);
      return tree ? generalRefsOf(tree) : undefined;
    },
    newId: sequentialIds("c"),
  };
  return { b, special, env };
}

describe("ADR-0074 편집본 — 명령을 편집본에 적용하고 명령 목록으로 쌓는다", () => {
  it("트리 명령은 applyCommand 와 같은 결과 · 쌓이는 명령은 받은 그대로", () => {
    const { b, special, env } = fixture();
    const op: EditOp = { type: "setTitle", nodeId: "n4", title: "보험기간과 보험료 납입기간" };
    const r = unwrap(applyEdit({ tree: special }, op, env));
    expect(r.state.tree).toEqual(unwrap(applyCommand(special, op)));
    expect(r.op).toEqual(op);
    // 원본(시작 상태)은 바뀌지 않는다
    expect((special.children[1] as ArticleNode).title).toBe("보험기간");
    void b;
  });

  it("복제는 새로 매긴 사본 id 를 명령에 싣는다 — 서버가 같은 id 로 다시 적용한다", () => {
    const { special, env } = fixture();
    const r = unwrap(applyEdit({ tree: special }, { type: "duplicate", nodeId: "n3" }, env));
    expect(r.op).toEqual({ type: "duplicate", nodeId: "n3", ids: ["c1", "c2", "c3"] });
    expect(r.state.tree.children.map((c) => c.id)).toEqual(["n3", "c1", "n4"]);

    // 서버 쪽 재적용 — 다른 id 공급원을 줘도 실린 id 를 쓴다
    const serverEnv: EditEnv = { ...env, newId: sequentialIds("zz") };
    const replayed = unwrap(replayEdits({ tree: special }, [r.op, { type: "setTitle", nodeId: "c1", title: "사본 조" }], serverEnv));
    expect(replayed.tree.children.map((c) => c.id)).toEqual(["n3", "c1", "n4"]);
    expect((replayed.tree.children[1] as ArticleNode).title).toBe("사본 조");
  });

  it("실린 사본 id 수가 하위 트리와 다르면 거부한다", () => {
    const { special, env } = fixture();
    expect(rejection(applyEdit({ tree: special }, { type: "duplicate", nodeId: "n3", ids: ["x1"] }, env)).reason).toBe("invalid");
  });

  it("명령이 거부되면 편집본은 그대로 — 거부 사유를 돌려준다", () => {
    const { b, special, env } = fixture();
    const r = applyEdit({ tree: special }, { type: "insert", node: b.paragraph([]), at: { parentId: "n5" } }, env);
    expect(rejection(r).reason).toBe("invalid");
  });
});

describe("대응 보통약관 지정도 편집에 포함된다 (ADR-0074 결정 6)", () => {
  it("지정하면 그 보통약관의 조로 조연결 검사가 바뀐다", () => {
    const { special, env } = fixture();
    // 지정 전 — 대응 보통약관이 없으니 조연결 불가
    expect(rejection(applyEdit({ tree: special }, { type: "link", articleId: "n3", linkedArticleId: "g3" }, env)).reason).toBe("invalid");
    const withG = unwrap(applyEdit({ tree: special }, { type: "setGeneralDocument", generalDocumentId: "G" }, env)).state;
    expect(withG.generalDocumentId).toBe("G");
    const linked = unwrap(applyEdit(withG, { type: "link", articleId: "n3", linkedArticleId: "g3" }, env)).state;
    expect((linked.tree.children[0] as ArticleNode).linkedArticleId).toBe("g3");
    // 다른 보통약관(H)의 조로는 못 잇는다
    expect(rejection(applyEdit(withG, { type: "link", articleId: "n3", linkedArticleId: "h1" }, env)).reason).toBe("invalid");
  });

  it("해제는 조연결 · 보통약관 조 참조가 0건일 때만", () => {
    const { special, env } = fixture();
    const linked = unwrap(
      replayEdits(
        { tree: special },
        [
          { type: "setGeneralDocument", generalDocumentId: "G" },
          { type: "link", articleId: "n3", linkedArticleId: "g3" },
        ],
        env,
      ),
    );
    expect(rejection(applyEdit(linked, { type: "setGeneralDocument" }, env)).reason).toBe("invalid");
    const unlinked = unwrap(applyEdit(linked, { type: "link", articleId: "n3" }, env)).state;
    const cleared = unwrap(applyEdit(unlinked, { type: "setGeneralDocument" }, env)).state;
    expect(cleared.generalDocumentId).toBeUndefined();
  });

  it("없는 문서 · 보통약관이 아닌 문서는 notFound · 보통약관 템플릿에는 지정 불가", () => {
    const { special, env } = fixture();
    expect(rejection(applyEdit({ tree: special }, { type: "setGeneralDocument", generalDocumentId: "X" }, env)).reason).toBe("notFound");
    const generalEnv: EditEnv = { ...env, env: { kind: "general" } };
    expect(rejection(applyEdit({ tree: special }, { type: "setGeneralDocument", generalDocumentId: "G" }, generalEnv)).reason).toBe("invalid");
  });

  it("envAt — 담보약관은 지정한 보통약관의 조 집합, 미지정이면 빈 집합", () => {
    const { env } = fixture();
    expect([...(envAt(env, "G").generalArticleIds ?? [])]).toEqual(["g3"]);
    expect([...(envAt(env, "G").generalReferenceIds ?? [])].sort()).toEqual(["g2", "g3"]);
    expect(envAt(env, undefined).generalArticleIds?.size).toBe(0);
    expect(envAt({ ...env, env: { kind: "general" } }, "G").generalArticleIds).toBeUndefined();
  });
});

describe("replayEdits — 서버가 원본에 명령 목록을 다시 적용한다", () => {
  it("브라우저 편집본과 같은 결과", () => {
    const { b, special, env } = fixture();
    let state: DraftState = { tree: special };
    const ops: EditOp[] = [];
    for (const op of [
      { type: "insert", node: b.article("새 조", []), at: { parentId: "n5" } },
      { type: "duplicate", nodeId: "n4" },
      { type: "move", nodeId: "n3", to: { parentId: "n5", index: 3 } },
      { type: "remove", nodeId: "n4" },
    ] as EditOp[]) {
      const r = unwrap(applyEdit(state, op, env));
      state = r.state;
      ops.push(r.op);
    }
    const replayed = unwrap(replayEdits({ tree: special }, ops, { ...env, newId: sequentialIds("other") }));
    expect(replayed).toEqual(state);
  });

  it("중간 명령이 거부되면 전체를 거부한다", () => {
    const { special, env } = fixture();
    const r = replayEdits({ tree: special }, [{ type: "setTitle", nodeId: "n4", title: "x" }, { type: "remove", nodeId: "zz" }], env);
    expect(rejection(r).reason).toBe("notFound");
  });
});

describe("removedIds — 원본에 있고 결과에 없는 노드", () => {
  it("지운 조와 그 하위 id", () => {
    const { special, env } = fixture();
    const after = unwrap(replayEdits({ tree: special }, [{ type: "remove", nodeId: "n3" }], env));
    expect([...removedIds(special, after.tree)].sort()).toEqual(["n1", "n2", "n3"]);
  });
});
