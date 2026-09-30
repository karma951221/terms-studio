/**
 * 마이그레이션 회귀 테스트 — `drizzle/*.sql` 을 실제로 PGlite 에 적용한다.
 *
 * 단위 테스트(`pushSchema`)와 E2E(새 시드)는 마이그레이션 파일을 실행하지 않으므로,
 * 옛 모양의 행에 0006(기능/마스터 §3.2 경로 전환)을 적용하는 경로는 여기서만 검증된다.
 * 0000~0005 로 옛 스키마를 만들고 옛 행을 넣은 뒤 0006 을 트랜잭션 안에서 적용한다
 * (drizzle migrator 도 마이그레이션 하나를 트랜잭션 하나로 돌린다).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const DRIZZLE = path.resolve(import.meta.dirname, "../../drizzle");
const journal = JSON.parse(readFileSync(path.join(DRIZZLE, "meta/_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[];
};
const statementsOf = (tag: string) =>
  readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
const tagOf = (idx: number) => journal.entries.find((e) => e.idx === idx)!.tag;

const OLD_TO_NEW: [string, string][] = [
  ["plan.waiver.applies", "waiver.applies"],
  ["plan.waiver.reasons", "waiver.reasons"],
  ["plan.no_surrender.type", "no_surrender.type"],
  ["plan.conversion.converts", "conversion.converts"],
  ["plan.business_type.applies", "business_type.applies"],
  ["coverage.claim_name", "coverage_basic.claim_name"],
  ["benefit.pay.exempt", "pay.exempt"],
  ["benefit.pay.rate", "pay.rate"],
];
const OWNER = "11111111-1111-4111-8111-111111111111";

let client: PGlite;
beforeEach(async () => {
  client = new PGlite();
  for (let idx = 0; idx <= 5; idx++) for (const s of statementsOf(tagOf(idx))) await client.exec(s);
});
afterEach(() => client.close());

/** 0006 을 한 트랜잭션으로 적용 — 실패하면 전체 롤백된다. */
async function apply0006() {
  await client.transaction(async (tx) => {
    for (const s of statementsOf(tagOf(6))) await tx.exec(s);
  });
}
async function insertValue(fieldPath: string, owner = OWNER) {
  await client.query(
    `INSERT INTO entity_values (owner_kind, owner_id, field_path, value) VALUES ('plan', $1, $2, 'true'::jsonb)`,
    [owner, fieldPath],
  );
}
async function insertDiscriminator(code: string, expression: string) {
  await client.query(
    `INSERT INTO discriminators (code, label, level, expression) VALUES ($1, $1, 'plan', $2)`,
    [code, expression],
  );
}
async function snapshot() {
  const values = await client.query<{ field_path: string }>(
    `SELECT field_path FROM entity_values ORDER BY field_path`,
  );
  const discs = await client.query<{ code: string; expression: string }>(
    `SELECT code, expression FROM discriminators ORDER BY code`,
  );
  return {
    values: values.rows.map((r) => r.field_path),
    discs: Object.fromEntries(discs.rows.map((r) => [r.code, r.expression])),
  };
}

const LITERAL_OK = "coverage.claim_name = '암 plan.waiverX' and benefit.pay.rate > 0";
const UNRELATED = "myplan.waiver.x = true and coverage.claim_name_extra = 'y'";

describe("0006_master_form_paths", () => {
  it("옛 경로 8개와 구분자 식을 새 경로로 옮기고, 리터럴·무관한 행은 그대로 두며, 두 번째 적용은 아무것도 바꾸지 않는다", async () => {
    for (const [oldPath] of OLD_TO_NEW) await insertValue(oldPath);
    await insertDiscriminator("D0001", "plan.waiver.applies = true and any(benefit.pay.exempt)");
    await insertDiscriminator("D0002", LITERAL_OK);
    await insertDiscriminator("D0003", UNRELATED);

    await apply0006();
    const after = await snapshot();
    expect(after.values).toEqual(OLD_TO_NEW.map(([, n]) => n).sort());
    expect(after.discs).toEqual({
      D0001: "waiver.applies = true and any(pay.exempt)",
      D0002: "coverage_basic.claim_name = '암 plan.waiverX' and pay.rate > 0",
      D0003: UNRELATED,
    });

    await apply0006();
    expect(await snapshot()).toEqual(after);
  });

  it("리터럴 안에 옛 경로가 든 식이 있으면 예외를 내고 아무것도 바꾸지 않는다 (사람이 봐야 한다)", async () => {
    await insertValue("plan.waiver.applies");
    await insertDiscriminator("D0001", "plan.waiver.applies = true");
    await insertDiscriminator("D0002", "coverage.claim_name = 'x plan.waiver.applies y'");
    const before = await snapshot();

    await expect(apply0006()).rejects.toThrow(/리터럴/);
    expect(await snapshot()).toEqual(before);
  });

  it("이스케이프(\\')가 든 리터럴과 옛 경로가 함께 있는 식은 가를 수 없으므로 예외를 낸다", async () => {
    await insertDiscriminator("D0001", "plan.waiver.applies = 'a\\'b'");
    const before = await snapshot();

    await expect(apply0006()).rejects.toThrow(/리터럴/);
    expect(await snapshot()).toEqual(before);
  });

  it("같은 소유자에 옛 경로와 새 경로가 함께 있으면 예외를 내고 아무것도 바꾸지 않는다", async () => {
    await insertValue("plan.waiver.applies");
    await insertValue("waiver.applies");
    await insertValue("plan.waiver.reasons");
    const before = await snapshot();

    await expect(apply0006()).rejects.toThrow(/혼재/);
    expect(await snapshot()).toEqual(before);
  });

  it("매핑에 없는 세 토막 field_path 가 있으면 예외를 내고 아무것도 바꾸지 않는다", async () => {
    await insertValue("plan.unknown.field");
    const before = await snapshot();

    await expect(apply0006()).rejects.toThrow(/미지/);
    expect(await snapshot()).toEqual(before);
  });
});

describe("0013_discriminator_description_doc_refs", () => {
  it("시드 원문 그대로인 설명에서만 문서 번호를 빼고, 사용자가 고친 설명은 두며, 두 번째 적용은 아무것도 바꾸지 않는다", async () => {
    for (let idx = 6; idx <= 12; idx++) for (const s of statementsOf(tagOf(idx))) await client.exec(s);
    const put = (code: string, description: string) =>
      client.query(
        `INSERT INTO discriminators (code, label, level, expression, description) VALUES ($1, $1, 'benefit', 'true', $2)`,
        [code, description],
      );
    await put("D0001", "문면이 담보 이름을 그대로 찍는 자리의 값 — 담보 레벨 마스터 필드의 투영 (ADR-0036 §2)");
    await put("D0002", "감액 폼을 열었나 — 급부 시드 폼 `reduction` 의 투영 (ADR-0065 §5)");
    await put("D0003", "사용자가 고친 설명 (ADR-0065 §5)");
    const read = async () =>
      Object.fromEntries(
        (await client.query<{ code: string; description: string }>(`SELECT code, description FROM discriminators ORDER BY code`)).rows.map(
          (r) => [r.code, r.description],
        ),
      );
    const apply0013 = async () => {
      for (const s of statementsOf(tagOf(13))) await client.exec(s);
    };

    await apply0013();
    const after = await read();
    expect(after).toEqual({
      D0001: "문면이 담보 이름을 그대로 찍는 자리의 값 — 담보 레벨 마스터 필드의 투영",
      D0002: "감액 폼을 열었나 — 급부 폼 「감액」의 투영",
      D0003: "사용자가 고친 설명 (ADR-0065 §5)",
    });
    await apply0013();
    expect(await read()).toEqual(after);
  });
});

describe("0015_coverage_code", () => {
  const upTo14 = async () => {
    for (let idx = 6; idx <= 14; idx++) for (const s of statementsOf(tagOf(idx))) await client.exec(s);
  };
  const apply0015 = async () =>
    client.transaction(async (tx) => {
      for (const s of statementsOf(tagOf(15))) await tx.exec(s);
    });
  const putCoverage = (id: string, name: string, createdAt: string) =>
    client.query(`INSERT INTO coverages (id, name, created_at) VALUES ($1, $2, $3)`, [id, name, createdAt]);

  it("기존 담보를 만든 순서대로 COV000001 부터 채우고, 순번은 그 다음에서 잇는다 (이름 · id 순이 아니다)", async () => {
    await upTo14();
    // 이름 가나다순 · id 순과 만든 순서를 일부러 어긋나게 둔다.
    await putCoverage("33333333-3333-4333-8333-333333333333", "가 담보", "2026-09-03T00:00:00Z");
    await putCoverage("11111111-1111-4111-8111-111111111111", "다 담보", "2026-09-01T00:00:00Z");
    await putCoverage("22222222-2222-4222-8222-222222222222", "나 담보", "2026-09-02T00:00:00Z");
    await apply0015();

    const rows = (await client.query<{ name: string; code: string }>(`SELECT name, code FROM coverages ORDER BY code`)).rows;
    expect(rows).toEqual([
      { name: "다 담보", code: "COV000001" },
      { name: "나 담보", code: "COV000002" },
      { name: "가 담보", code: "COV000003" },
    ]);
    const seq = await client.query<{ next: number }>(`SELECT next FROM code_sequences WHERE kind = 'coverage' AND scope = ''`);
    expect(seq.rows[0].next).toBe(4);
  });

  it("빈 DB 에도 적용되고 순번은 1 에서 시작한다 · 코드는 NOT NULL · 유일", async () => {
    await upTo14();
    await apply0015();
    const seq = await client.query<{ next: number }>(`SELECT next FROM code_sequences WHERE kind = 'coverage'`);
    expect(seq.rows[0].next).toBe(1);
    await expect(client.query(`INSERT INTO coverages (name) VALUES ('코드 없음')`)).rejects.toThrow();
    await client.query(`INSERT INTO coverages (name, code) VALUES ('하나', 'COV000001')`);
    await expect(client.query(`INSERT INTO coverages (name, code) VALUES ('둘', 'COV000001')`)).rejects.toThrow();
  });
});

describe("0016_drop_pay_first_only", () => {
  const upTo15 = async () => {
    for (let idx = 6; idx <= 15; idx++) for (const s of statementsOf(tagOf(idx))) await client.exec(s);
  };
  const apply0016 = async () =>
    client.transaction(async (tx) => {
      for (const s of statementsOf(tagOf(16))) await tx.exec(s);
    });
  const put = (ownerKind: string, owner: string, fieldPath: string, value: string) =>
    client.query(`INSERT INTO entity_values (owner_kind, owner_id, field_path, value) VALUES ($1, $2, $3, $4::jsonb)`, [ownerKind, owner, fieldPath, value]);
  const rows = async () =>
    (await client.query<{ owner_kind: string; field_path: string }>(`SELECT owner_kind, field_path FROM entity_values ORDER BY owner_kind, field_path`)).rows;

  it("담보 마스터 · 상품담보 스냅샷의 pay.first_only 값 행만 지운다 — 다른 경로는 그대로 · 두 번 돌려도 같다", async () => {
    await upTo15();
    const other = "22222222-2222-4222-8222-222222222222";
    await put("benefit", OWNER, "pay.first_only", "false");
    await put("benefit", OWNER, "pay.rate", "80");
    await put("productBenefit", other, "pay.first_only", "true");
    await put("productBenefit", other, "pay.exempt", "true");
    await apply0016();
    const after = await rows();
    expect(after).toEqual([
      { owner_kind: "benefit", field_path: "pay.rate" },
      { owner_kind: "productBenefit", field_path: "pay.exempt" },
    ]);
    await apply0016();
    expect(await rows()).toEqual(after);
  });
});

describe("0017_attribute_value_numeric_code", () => {
  const upTo16 = async () => {
    for (let idx = 6; idx <= 16; idx++) for (const s of statementsOf(tagOf(idx))) await client.exec(s);
  };
  const apply0017 = async () =>
    client.transaction(async (tx) => {
      for (const s of statementsOf(tagOf(17))) await tx.exec(s);
    });
  const KIND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const PC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const COVERAGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const ENUM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const tree = (when: string) =>
    JSON.stringify({ id: "root", kind: "document", title: "t", children: [{ id: "c", kind: "condBlock", branches: [{ id: "b", when, children: [] }] }] });

  async function seedOld() {
    await client.query(`INSERT INTO attribute_kinds (id, code, label, "order") VALUES ($1, 'A0001', '갱신유형', 0)`, [KIND]);
    await client.query(
      `INSERT INTO attribute_values (kind_id, code, label, "order", fragment) VALUES ($1, 'V01', '비갱신형', 1, ''), ($1, 'V02', '갱신형', 0, '갱신형'), ($1, 'V10', '혼합형', 2, '')`,
      [KIND],
    );
    await client.query(`INSERT INTO products (id, name) VALUES ($1, '상품')`, [PRODUCT]);
    await client.query(
      `INSERT INTO product_coverages (id, product_id, coverage_id, coverage_name, name, combination_key) VALUES ($1, $2, $3, '수술비', '갱신형 수술비', $4)`,
      [PC, PRODUCT, COVERAGE, `${COVERAGE}|A0001=V02`],
    );
    await client.query(`INSERT INTO product_coverage_attributes (product_coverage_id, kind_code, value_code) VALUES ($1, 'A0001', 'V02')`, [PC]);
    await insertDiscriminator("D0001", "exist(attr.A0001) and attr.A0001 = 'V02'");
    await insertDiscriminator("D0002", "attr.A0001 ≠ 'V10' or 'V01' = attr.A0001");
    // enum 값 비교 · 함수조항 옵션 선택 코드는 다른 기능 — 그대로
    await insertDiscriminator("D0003", "D0009 = 'V02'");
    await client.query(`INSERT INTO enums (id, code, label) VALUES ($1, 'E0001', '고지유형')`, [ENUM]);
    await client.query(`INSERT INTO enum_values (enum_id, code, label, "order") VALUES ($1, 'V01', '일반심사', 0)`, [ENUM]);
    await client.query(`INSERT INTO documents (kind, title, tree) VALUES ('general', '보통', $1::jsonb)`, [tree("attr.A0001 = 'V02' and D0003 = 'V01'")]);
    await client.query(
      `INSERT INTO clauses (code, label, mode, body, options, required_discriminators, required_attributes) VALUES ('C0001', '조항', 'block', $1::jsonb, $2::jsonb, '[]', '["A0001"]')`,
      [
        JSON.stringify([{ id: "cb", kind: "condBlock", branches: [{ id: "b", when: "attr.A0001 != 'V01'", children: [] }] }]),
        JSON.stringify([{ code: "O01", label: "사유", values: [{ code: "V02", label: "사망", body: [{ id: "x", kind: "inlineCond", branches: [{ id: "y", when: "attr.A0001 = 'V02'", children: [] }] }] }] }]),
      ],
    );
  }

  async function read() {
    const q = async <T,>(sql: string) => (await client.query<T>(sql)).rows;
    return {
      values: await q<{ code: string; label: string }>(`SELECT code, label FROM attribute_values ORDER BY label`),
      mounts: await q<{ value_code: string }>(`SELECT value_code FROM product_coverage_attributes`),
      keys: await q<{ combination_key: string }>(`SELECT combination_key FROM product_coverages`),
      discs: Object.fromEntries((await q<{ code: string; expression: string }>(`SELECT code, expression FROM discriminators`)).map((r) => [r.code, r.expression])),
      enumValues: await q<{ code: string }>(`SELECT code FROM enum_values`),
      docWhen: (await q<{ w: string }>(`SELECT tree #>> '{children,0,branches,0,when}' AS w FROM documents`))[0]!.w,
      clauseWhen: (await q<{ w: string }>(`SELECT body #>> '{0,branches,0,when}' AS w FROM clauses`))[0]!.w,
      optionValueCode: (await q<{ c: string }>(`SELECT options #>> '{0,values,0,code}' AS c FROM clauses`))[0]!.c,
      optionWhen: (await q<{ w: string }>(`SELECT options #>> '{0,values,0,body,0,branches,0,when}' AS w FROM clauses`))[0]!.w,
    };
  }

  it("유효값 코드 V0n → n 을 값 · 상품담보 조합 · 조합 키 · attr 식(구분자 · 문서 · 함수조항 본문 · 옵션)에서 함께 바꾸고, enum 값 · 옵션 선택지 코드는 두며, 순서 컬럼을 지운다 · 두 번 돌려도 같다", async () => {
    await upTo16();
    await seedOld();
    await apply0017();
    const after = await read();
    expect(after).toEqual({
      values: [
        { code: "2", label: "갱신형" },
        { code: "1", label: "비갱신형" },
        { code: "10", label: "혼합형" },
      ],
      mounts: [{ value_code: "2" }],
      keys: [{ combination_key: `${COVERAGE}|A0001=2` }],
      discs: {
        D0001: "exist(attr.A0001) and attr.A0001 = '2'",
        D0002: "attr.A0001 ≠ '10' or '1' = attr.A0001",
        D0003: "D0009 = 'V02'",
      },
      enumValues: [{ code: "V01" }],
      docWhen: "attr.A0001 = '2' and D0003 = 'V01'",
      clauseWhen: "attr.A0001 != '1'",
      optionValueCode: "V02",
      optionWhen: "attr.A0001 = '2'",
    });
    const cols = await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'attribute_values'`);
    expect(cols.rows.map((r) => r.column_name)).not.toContain("order");

    await apply0017();
    expect(await read()).toEqual(after);
  });

  it("바꾼 뒤 같은 유형에 같은 코드가 둘이 되면(V1 · V01) 예외를 내고 아무것도 바꾸지 않는다", async () => {
    await upTo16();
    await client.query(`INSERT INTO attribute_kinds (id, code, label, "order") VALUES ($1, 'A0001', '갱신유형', 0)`, [KIND]);
    await client.query(`INSERT INTO attribute_values (kind_id, code, label, "order") VALUES ($1, 'V1', '가', 0), ($1, 'V01', '나', 1)`, [KIND]);
    await expect(apply0017()).rejects.toThrow(/0017/);
    const codes = await client.query<{ code: string }>(`SELECT code FROM attribute_values ORDER BY code`);
    expect(codes.rows.map((r) => r.code)).toEqual(["V01", "V1"]);
  });
});

describe("0018_enum_fields", () => {
  it("옛 열거형 · 열거값 행은 필드 없음(fields = [] · {})을 받는다", async () => {
    for (let idx = 6; idx <= 17; idx++) for (const s of statementsOf(tagOf(idx))) await client.exec(s);
    const [{ id }] = (await client.query<{ id: string }>(`INSERT INTO enums (code, label) VALUES ('E0001', '납입면제사유') RETURNING id`)).rows as [{ id: string }];
    await client.query(`INSERT INTO enum_values (enum_id, code, label, "order") VALUES ($1, 'V01', '암', 0)`, [id]);
    await client.transaction(async (tx) => {
      for (const s of statementsOf(tagOf(18))) await tx.exec(s);
    });
    expect((await client.query<{ fields: unknown }>(`SELECT fields FROM enums`)).rows).toEqual([{ fields: [] }]);
    expect((await client.query<{ fields: unknown }>(`SELECT fields FROM enum_values`)).rows).toEqual([{ fields: {} }]);
  });
});
