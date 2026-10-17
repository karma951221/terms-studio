/**
 * 동적표 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙(`checkDynTable`) · repo 호출. 기능/동적표 §3.1 · §3.6.
 *
 * - 생성 · 저장은 editor 도 가능. 저장 검사(§3.6 「저장 검사(동적표 정의)」)에 걸리면 `invalid` 로 거부한다 —
 *   인자 표 · 템플릿이 읽는 것 · 표 슬롯 자리 · 값별 분기. 연결 검사 재료(구분자 타입 · 열거형 값)는 카탈로그에서 읽는다.
 * - 저장 뒤 사용처(이 동적표를 넣은 담보약관의 `dynTableRef`) 를 재검사해 `{ table, recheck }` 로 돌려준다 —
 *   인자를 더하거나 기본 연결을 지우면 연결이 빈 사용처가 `argUnbound` 로, 인자를 지우면 그 이름에 연결한 사용처가 `brokenRef` 로 오른다
 *   (함수조항 저장의 재검사와 같은 결 — 저장 자체는 막지 않는다).
 * - 파괴적 액션은 `dynTable.delete` 하나 — `destructive()` 2단: editor → forbidden · admin 1차 → needsConfirmation(brokenRefs = 사용처) ·
 *   `{ confirm: true }` → 삭제.
 * - 사용처 역인덱스(`DynTableUsageSource`)는 refs 영역 몫 — 주입한다. 기본값: 사용처 없음.
 */
import { destructive } from "@/domain/auth";
import type { BindingEnv, RecheckEntry, Usage } from "@/domain/clause";
import { usageCoordinate } from "@/domain/clause";
import { catalogTypeResolver, dynTableGateFrom } from "@/domain/document";
import { checkDynTable, type DynTable, type DynTableSummary, type NewDynTable } from "@/domain/dyntable";
import type { Actor, Code, Issue, Result } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import { listDiscriminators, listEnums } from "@/db/repo/catalog";
import * as repo from "@/db/repo/dyntable";
import type { Db } from "@/db/repo/types";

// ───────────────────────────── 주입 인터페이스 ─────────────────────────────

/** 사용처 역인덱스 — 이 동적표를 참조하는 문서들(참조 노드 단위 — 연결을 싣는다). refs 가 구현한다. */
export interface DynTableUsageSource {
  documentsReferencing(tableCode: Code): Promise<Usage[]>;
}

export const NO_DYN_TABLE_USAGES: DynTableUsageSource = { documentsReferencing: async () => [] };

export interface DynTableServiceDeps {
  usage?: DynTableUsageSource;
}

export interface Confirmable {
  confirm?: boolean;
}

/** 저장 결과 — 저장된 정의 + 사용처 재검사 목록(문제 있는 사용처만). */
export interface DynTableSaveOutcome {
  table: DynTable;
  recheck: RecheckEntry[];
}

export interface DynTableService {
  // 조회
  get(code: Code): Promise<DynTable | undefined>;
  list(): Promise<DynTable[]>;
  summaries(): Promise<DynTableSummary[]>;
  usages(code: Code): Promise<Usage[]>;

  // 정의 — 비파괴
  create(actor: Actor, input: NewDynTable): Promise<Result<DynTable>>;
  /** 정의 전체 교체(편집 화면 저장 한 번) — 저장 검사 뒤 사용처 재검사. */
  save(actor: Actor, code: Code, input: NewDynTable): Promise<Result<DynTableSaveOutcome>>;
  /** 정의 수정 없이 사용처만 다시 검사 — 문제 있는 사용처만. */
  recheck(code: Code): Promise<Result<RecheckEntry[]>>;

  // 파괴적 (admin · 2단)
  remove(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
}

// ───────────────────────────── 서비스 ─────────────────────────────

export function createDynTableService(db: Db, deps: DynTableServiceDeps = {}): DynTableService {
  const usage = deps.usage ?? NO_DYN_TABLE_USAGES;

  /** 연결 검사 재료 — 구분자 결과 타입(식에서 추론) · 열거형 값. 문서 저장 검사의 동적표 게이트와 같은 재료(container `dynTableGateOf`). */
  async function bindingEnvOf(tx: Db): Promise<BindingEnv> {
    const [defs, enums] = await Promise.all([listDiscriminators(tx), listEnums(tx)]);
    const resolve = catalogTypeResolver(defs);
    const codes = new Set(defs.map((d) => d.code));
    const enumValues = new Map(enums.map((e) => [e.code, e.values.map((v) => v.code)]));
    return {
      discriminatorType: (c) => resolve({ kind: "discriminator", code: c }),
      discriminatorExists: (c) => codes.has(c),
      enumValues: (c) => enumValues.get(c),
    };
  }

  function notFound<T>(code: Code): Result<T> {
    return reject({ reason: "notFound", what: `동적표 ${code}` });
  }

  /** 입력 정규화 — 인자 없음은 빈 목록, 구분 칸 머리글 공백은 그대로 둔다(검사가 이름만 본다). */
  function normalize(input: NewDynTable): NewDynTable {
    return { ...input, params: Array.isArray(input.params) ? input.params : [] };
  }

  async function checked(tx: Db, input: NewDynTable): Promise<Result<NewDynTable>> {
    const def = normalize(input);
    const issues: Issue[] = checkDynTable(def, await bindingEnvOf(tx));
    return issues.length > 0 ? reject({ reason: "invalid", issues }) : ok(def);
  }

  /** 사용처 재검사 — 새 정의로 만든 게이트에 사용처의 연결을 다시 댄다. 자리의 반복(loops)은 모르므로 「반복의 현재 원소」 연결은 건너뛴다. */
  function recheckOf(table: DynTable, usages: readonly Usage[], env: BindingEnv): RecheckEntry[] {
    if (usages.length === 0) return [];
    const gate = dynTableGateFrom([table], env);
    const out: RecheckEntry[] = [];
    for (const u of usages) {
      const at = usageCoordinate(u);
      const issues = (gate.validateBindings?.(table.code, u.bindings) ?? []).map((i) => ({ ...i, at: { ...at, ...i.at } }));
      if (issues.length > 0) out.push({ usage: u, missing: [], issues });
    }
    return out;
  }

  return {
    get: (code) => repo.getDynTable(db, code),
    list: () => repo.listDynTables(db),
    summaries: async () =>
      (await repo.listDynTables(db)).map((d) => ({
        code: d.code,
        label: d.label,
        columnBasis: d.columnBasis,
        ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}),
        ...(d.updatedBy ? { updatedBy: d.updatedBy } : {}),
      })),
    usages: (code) => usage.documentsReferencing(code),

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await checked(tx, input);
        if (!r.ok) return r as Result<DynTable>;
        const code = await repo.allocateDynTableCode(tx);
        return ok(await repo.insertDynTable(tx, code, r.value, actor.userId));
      }),

    save: async (actor, code, input) => {
      let env: BindingEnv | undefined;
      const saved = await db.transaction(async (tx): Promise<Result<DynTable>> => {
        if (!(await repo.getDynTable(tx, code))) return notFound(code);
        const r = await checked(tx, input);
        if (!r.ok) return r as Result<DynTable>;
        env = await bindingEnvOf(tx);
        return ok(await repo.updateDynTable(tx, code, r.value, actor.userId));
      });
      if (!saved.ok) return saved as Result<DynTableSaveOutcome>;
      // 재검사는 주입된 사용처 소스를 부르므로 트랜잭션 밖에서 (같은 연결을 다시 잡으면 막힌다)
      const usages = await usage.documentsReferencing(code);
      return ok({ table: saved.value, recheck: recheckOf(saved.value, usages, env ?? (await bindingEnvOf(db))) });
    },

    recheck: async (code) => {
      const table = await repo.getDynTable(db, code);
      if (!table) return notFound(code);
      const usages = await usage.documentsReferencing(code);
      return ok(recheckOf(table, usages, await bindingEnvOf(db)));
    },

    remove: async (actor, code, opts = {}) => {
      // 사용처는 주입 소스가 자기 저장소를 볼 수 있어 트랜잭션 밖에서 미리 읽는다.
      const referencing = opts.confirm ? [] : await usage.documentsReferencing(code);
      return db.transaction((tx) =>
        destructive<void>({
          actor,
          action: "dynTable.delete",
          confirm: opts.confirm,
          precheck: async () => ((await repo.getDynTable(tx, code)) ? ok(undefined) : notFound(code)),
          computeImpact: () => ({ valueRowsLost: 0, brokenRefs: referencing.map(usageCoordinate), cascade: [] }),
          execute: async () => {
            await repo.deleteDynTable(tx, code);
            return ok(undefined);
          },
        }),
      );
    },
  };
}
