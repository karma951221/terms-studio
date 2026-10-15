/**
 * 0027(노드 키 백필) 회귀 — 옛 모양 행에 실제 SQL 을 적용한다 (migrations.test.ts 와 같은 방식).
 * 0028(문면 @노드 id → 키 경로)도 같은 방식으로 검증한다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const DRIZZLE = path.resolve(import.meta.dirname, "../../drizzle");
const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
const statementsOf = (idx: number) =>
  readFileSync(path.join(DRIZZLE, `${journal.entries.find((e) => e.idx === idx)!.tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
const apply = async (client: PGlite, idx: number) =>
  client.transaction(async (tx) => {
    for (const s of statementsOf(idx)) await tx.exec(s);
  });

const COV = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222221";
const S2 = "22222222-2222-4222-8222-222222222222";
const B1 = "33333333-3333-4333-8333-333333333331";
const B2 = "33333333-3333-4333-8333-333333333332";
const B3 = "33333333-3333-4333-8333-333333333333";
const PROD = "44444444-4444-4444-8444-444444444444";
const PC = "55555555-5555-4555-8555-555555555555";

let client: PGlite;
beforeEach(async () => {
  client = new PGlite();
  for (let idx = 0; idx <= 26; idx++) await apply(client, idx);
  await client.exec(`
    INSERT INTO coverages (id, code, name) VALUES ('${COV}', 'COV000001', '암');
    INSERT INTO sub_coverages (id, coverage_id, name, "order") VALUES ('${S2}', '${COV}', '둘째', 1), ('${S1}', '${COV}', '첫째', 0);
    INSERT INTO benefits (id, sub_coverage_id, name, "order") VALUES ('${B1}', '${S1}', 'a', 0), ('${B3}', '${S1}', 'c', 1), ('${B2}', '${S2}', 'b', 0);
    INSERT INTO products (id, name) VALUES ('${PROD}', '상품');
    INSERT INTO product_coverages (id, product_id, coverage_id, coverage_name, name, combination_key) VALUES ('${PC}', '${PROD}', '${COV}', '암', '암', 'k');
    INSERT INTO product_coverage_nodes (product_coverage_id, kind, master_node_id, parent_id, name, "order")
      VALUES ('${PC}', 'sub', '${S2}', NULL, '둘째', 1);
  `);
});
afterEach(() => client.close());

describe("0027_node_keys — 지금 형제 순서대로 키를 채운다 (ADR-0087 결정 11)", () => {
  it("세부보장 01 · 02, 급부 1 · 2, 스냅샷 노드는 마스터 키를 옮긴다", async () => {
    await apply(client, 27);
    const subs = await client.query<{ id: string; key: string }>(`SELECT id, key FROM sub_coverages ORDER BY "order"`);
    expect(subs.rows).toEqual([{ id: S1, key: "01" }, { id: S2, key: "02" }]);
    const bens = await client.query<{ id: string; key: string }>(`SELECT id, key FROM benefits ORDER BY sub_coverage_id, "order"`);
    expect(bens.rows).toEqual([{ id: B1, key: "1" }, { id: B3, key: "2" }, { id: B2, key: "1" }]);
    const snap = await client.query<{ key: string }>(`SELECT key FROM product_coverage_nodes`);
    expect(snap.rows).toEqual([{ key: "02" }]);
  });

  it("형제 키는 유일하다 — 같은 담보에 같은 키를 넣으면 거부", async () => {
    await apply(client, 27);
    await expect(client.exec(`INSERT INTO sub_coverages (coverage_id, name, "order", key) VALUES ('${COV}', '셋째', 2, '01')`)).rejects.toThrow();
  });
});

describe("0028_node_key_paths — 담보약관의 @<노드id> 를 키 경로로 (ADR-0087 결정 11)", () => {
  const DOC = "66666666-6666-4666-8666-666666666666";
  const OTHER = "77777777-7777-4777-8777-777777777777";
  it("제 담보의 노드만 바꾸고 문서 판을 1 올린다 — 다른 담보 문서 · 끊어진 옛 id 는 그대로", async () => {
    await apply(client, 27);
    const tree = { kind: "document", id: "d", title: "t", children: [{ kind: "article", id: "a", title: "제1조", children: [{ kind: "condBlock", id: "c", branches: [{ id: "br", when: `D0007@${S2} = true and D0002@${B3} = false and D0007@99999999-0000-4000-8000-000000000000 = true`, children: [] }] }] }] };
    await client.query(`INSERT INTO documents (id, kind, owner_id, title, tree) VALUES ($1, 'special', $2, 't', $3::jsonb)`, [DOC, COV, JSON.stringify(tree)]);
    await client.query(`INSERT INTO documents (id, kind, owner_id, title, tree) VALUES ($1, 'general', NULL, 'g', $2::jsonb)`, [OTHER, JSON.stringify({ ...tree, id: "g" })]);
    await apply(client, 28);
    const row = await client.query<{ tree: { children: { children: { branches: { when: string }[] }[] }[] }; version: number }>(`SELECT tree, version FROM documents WHERE id = $1`, [DOC]);
    expect(row.rows[0].tree.children[0].children[0].branches[0].when).toBe("D0007@02 = true and D0002@01.2 = false and D0007@99999999-0000-4000-8000-000000000000 = true");
    expect(row.rows[0].version).toBe(2); // 바뀐 노드가 둘이어도 문서 판은 1만 오른다
    const general = await client.query<{ tree: unknown; version: number }>(`SELECT tree, version FROM documents WHERE id = $1`, [OTHER]);
    expect(JSON.stringify(general.rows[0].tree)).toContain(`@${S2}`);
    expect(general.rows[0].version).toBe(1);
  });
});
