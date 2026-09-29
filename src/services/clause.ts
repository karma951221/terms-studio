/**
 * 공용조항 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출.
 *
 * - 비파괴 액션(채번 · 표시명 · 본문 · 모드 · 옵션 추가/수정/삭제 · 순서 · 복제)은 editor 도 가능.
 *   본문·옵션이 바뀌는 저장은 ① 요구 구분자 재추출 ② 사용처 전부 재검사 → `{ clause, recheck }` 를 돌려준다.
 *   저장 자체는 미부착이 생겨도 차단하지 않는다 (D-P3-8).
 * - 파괴적 액션은 `clause.delete` 하나 — `destructive()` 2단: editor → forbidden ·
 *   admin 1차 → needsConfirmation(Impact: brokenRefs = 사용처) · `{ confirm: true }` → 삭제.
 *   (옵션·선택지 삭제는 정의 수정으로 두고 깨진 선택은 재검사 목록이 드러낸다 — 기능/공용조항 §3.2.)
 * - 사용처 역인덱스(`UsageSource`)는 C1/B3 몫 — 주입한다. 부착은 없다 (ADR-0037).
 *   기본값: 사용처 없음 · 부착기 없음(수락 거부).
 * - 카탈로그(구분자 정의)는 catalog repo 에서 읽어 조건식 타입 검사·부착 검사에 쓴다.
 */
import { destructive } from "@/domain/auth";
import type { Discriminator } from "@/domain/catalog";
import { discriminatorResultType } from "@/domain/catalog/expression";
import {
  addOption,
  addOptionValue,
  checkAttachmentForReference,
  createClause,
  duplicateClause,
  recheckUsages,
  removeOption,
  removeOptionValue,
  renameClause,
  renameOption,
  renameOptionValue,
  reorderOptions,
  reorderOptionValues,
  setBody,
  setMode,
  setOptionValueBody,
  usageCoordinate,
  type AttachmentCheck,
  type Clause,
  type ClauseBody,
  type ClauseContext,
  type ClauseMode,
  type ClauseSummary,
  type DiscriminatorLookup,
  type NewClause,
  type NewOption,
  type NewOptionValue,
  type RecheckEntry,
  type RequiredRefs,
  type Usage,
} from "@/domain/clause";
import type { Inline } from "@/domain/clause/nodes";
import { indexTree } from "@/domain/document";
import type { TypeResolver } from "@/domain/expression";
import type { Actor, Code, Id, Result } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import { listDiscriminators } from "@/db/repo/catalog";
import * as repo from "@/db/repo/clause";
import * as documentRepo from "@/db/repo/document";
import type { Db } from "@/db/repo/types";
import type { ValueOwner } from "@/db/repo/values";

// ───────────────────────────── 주입 인터페이스 ─────────────────────────────

/** 사용처 역인덱스 — 이 공용조항을 참조하는 문서들. C1(refs)/B3(document) 가 구현한다. */
export interface UsageSource {
  documentsReferencing(clauseCode: Code): Promise<Usage[]>;
}

export const NO_USAGES: UsageSource = { documentsReferencing: async () => [] };

export interface ClauseServiceDeps {
  usage?: UsageSource;
}

export interface Confirmable {
  confirm?: boolean;
}

/** 본문·옵션이 바뀌는 저장의 결과 — 저장된 정의 + 사용처 재검사 목록. */
export interface SaveOutcome {
  clause: Clause;
  recheck: RecheckEntry[];
}

export interface ClauseService {
  // 조회
  get(code: Code): Promise<Clause | undefined>;
  list(): Promise<Clause[]>;
  summaries(): Promise<ClauseSummary[]>;
  required(code: Code): Promise<RequiredRefs | undefined>;
  usages(code: Code): Promise<Usage[]>;
  audit(code: Code): ReturnType<typeof repo.clauseAudit>;

  // 정의 — 비파괴
  create(actor: Actor, input: NewClause): Promise<Result<Clause>>;
  rename(actor: Actor, code: Code, label: string): Promise<Result<Clause>>;
  setBody(actor: Actor, code: Code, body: ClauseBody): Promise<Result<SaveOutcome>>;
  setMode(actor: Actor, code: Code, mode: ClauseMode, body: ClauseBody): Promise<Result<SaveOutcome>>;
  duplicate(actor: Actor, code: Code): Promise<Result<Clause>>;

  // 옵션 — 비파괴 (선택지·옵션 삭제의 사용처 영향은 recheck 로)
  addOption(actor: Actor, code: Code, input: NewOption): Promise<Result<SaveOutcome>>;
  renameOption(actor: Actor, code: Code, optionCode: Code, label: string): Promise<Result<Clause>>;
  addOptionValue(actor: Actor, code: Code, optionCode: Code, input: NewOptionValue): Promise<Result<SaveOutcome>>;
  renameOptionValue(actor: Actor, code: Code, optionCode: Code, valueCode: Code, label: string): Promise<Result<Clause>>;
  setOptionValueBody(actor: Actor, code: Code, optionCode: Code, valueCode: Code, body: Inline[]): Promise<Result<SaveOutcome>>;
  reorderOptions(actor: Actor, code: Code, order: Code[]): Promise<Result<Clause>>;
  reorderOptionValues(actor: Actor, code: Code, optionCode: Code, order: Code[]): Promise<Result<Clause>>;
  removeOptionValue(actor: Actor, code: Code, optionCode: Code, valueCode: Code): Promise<Result<SaveOutcome>>;
  removeOption(actor: Actor, code: Code, optionCode: Code): Promise<Result<SaveOutcome>>;

  // 파괴적 (admin · 2단)
  remove(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;

  // 참조 쪽
  /** 사용처(담보)가 참조를 추가하려는 순간의 부착 검사 — 미부착 목록(부착 제안). */
  checkReference(code: Code, owner: ValueOwner): Promise<Result<AttachmentCheck>>;
  /** 정의 수정 후 사용처 전부 재검사 — 문제 있는 사용처만. */
  recheck(code: Code): Promise<Result<RecheckEntry[]>>;
}

// ───────────────────────────── 카탈로그 타입 조회 ─────────────────────────────

/**
 * 카탈로그 정의로 만드는 식 타입 조회 — 조건식 boolean 검사용.
 * 공용조항 본문은 문면과 같은 규칙을 따른다 (ADR-0037) — 구분자만 보고, 그 타입은 식에서 추론한다.
 * 마스터 필드 직접 참조는 타입을 주지 않아 brokenRef 로 걸린다.
 */
function typeResolverFrom(catalog: ReadonlyMap<Code, Discriminator>): TypeResolver {
  return (ref) => {
    switch (ref.kind) {
      case "attr":
        return { kind: "attribute" };
      case "builtin":
        return { kind: "string" }; // 뼈대 속성(이름) — MVP 는 문자열
      case "master":
        return undefined;
      case "discriminator": {
        const def = catalog.get(ref.code);
        return def ? discriminatorResultType(def, undefined, catalog) : undefined;
      }
    }
  };
}

// ───────────────────────────── 서비스 ─────────────────────────────

export function createClauseService(db: Db, deps: ClauseServiceDeps = {}): ClauseService {
  const usage = deps.usage ?? NO_USAGES;

  /** 카탈로그 전체 — 구분자 참조를 타고 결과 타입을 풀려면 맵이 필요하다 (기능/구분자 §3.2). */
  async function catalogOf(tx: Db): Promise<ReadonlyMap<Code, Discriminator>> {
    return new Map((await listDiscriminators(tx)).map((d) => [d.code, d]));
  }

  function lookupIn(catalog: ReadonlyMap<Code, Discriminator>): DiscriminatorLookup {
    return (code) => catalog.get(code);
  }

  async function lookupOf(tx: Db): Promise<DiscriminatorLookup> {
    return lookupIn(await catalogOf(tx));
  }

  /**
   * 조 참조 대상 집합 — 보통약관 마스터의 조·항·호·목 id (기능/공용조항 §3.5). 보통약관이 여러 벌이면 합집합
   * (MVP 는 1벌 — 2벌 이상은 기능/공용조항 §5 미결). 문서 서비스 `envOf` 의 `generalReferenceIds` 와 같은 기준.
   */
  async function generalReferenceIdsOf(tx: Db): Promise<ReadonlySet<Id>> {
    const ids = new Set<Id>();
    for (const summary of await documentRepo.listDocuments(tx, "general")) {
      const doc = await documentRepo.loadDocument(tx, summary.id);
      if (!doc) continue;
      for (const entry of indexTree(doc.tree).nodes.values()) {
        if (["article", "paragraph", "item", "subitem"].includes(entry.node.kind)) ids.add(entry.node.id);
      }
    }
    return ids;
  }

  async function context(tx: Db, catalog?: ReadonlyMap<Code, Discriminator>): Promise<ClauseContext> {
    const cat = catalog ?? (await catalogOf(tx));
    const existing = (await repo.listClauses(tx)).map((c) => ({ code: c.code, label: c.label }));
    const generalReferenceIds = await generalReferenceIdsOf(tx);
    const appendixCodes = new Set((await documentRepo.listAppendices(tx)).map((a) => a.code));
    const boxCodes = new Set((await documentRepo.listBoxes(tx)).map((x) => x.code));
    return {
      nextSeq: repo.clauseSeqSource(tx),
      existing,
      analyze: { resolveType: typeResolverFrom(cat), generalReferenceIds, appendixExists: (c) => appendixCodes.has(c), boxExists: (c) => boxCodes.has(c) },
    };
  }

  function notFound<T>(code: Code): Result<T> {
    return reject({ reason: "notFound", what: `공용조항 ${code}` });
  }

  async function withClause<T>(tx: Db, code: Code, fn: (def: Clause) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const def = await repo.loadClause(tx, code);
    if (!def) return notFound(code);
    return fn(def);
  }

  /** 사용처 재검사 — 요구 구분자 존재 + 옵션 선택 (부착은 없다 — ADR-0037). */
  async function recheckOf(clause: Clause, lookup: DiscriminatorLookup): Promise<RecheckEntry[]> {
    const usages = await usage.documentsReferencing(clause.code);
    if (usages.length === 0) return [];
    return recheckUsages(clause, usages, lookup);
  }

  /** 비파괴 변경 (본문·옵션 무관) — 읽기 → 도메인 → 저장. */
  function edit(actor: Actor, code: Code, change: (def: Clause, ctx: ClauseContext) => Promise<Result<Clause>> | Result<Clause>): Promise<Result<Clause>> {
    return db.transaction((tx) =>
      withClause(tx, code, async (def) => {
        const r = await change(def, await context(tx));
        if (!r.ok) return r;
        await repo.saveClause(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  /**
   * 본문·옵션이 바뀌는 변경 — 저장(트랜잭션) 후 사용처 재검사.
   * 재검사는 주입된 UsageSource 를 부르므로 트랜잭션 **밖**에서 한다 (같은 연결을 다시 잡으면 막힌다).
   */
  async function editAndRecheck(
    actor: Actor,
    code: Code,
    change: (def: Clause, ctx: ClauseContext) => Promise<Result<Clause>> | Result<Clause>,
  ): Promise<Result<SaveOutcome>> {
    let catalog: ReadonlyMap<Code, Discriminator> | undefined;
    const saved = await db.transaction((tx) =>
      withClause<Clause>(tx, code, async (def) => {
        catalog = await catalogOf(tx);
        const r = await change(def, await context(tx, catalog));
        if (!r.ok) return r;
        await repo.saveClause(tx, r.value, actor.userId);
        return r;
      }),
    );
    if (!saved.ok) return saved as Result<SaveOutcome>;
    return ok({ clause: saved.value, recheck: await recheckOf(saved.value, lookupIn(catalog!)) });
  }

  return {
    get: (code) => repo.loadClause(db, code),
    list: () => repo.listClauses(db),
    summaries: async () => {
      const all = await repo.listClauses(db);
      const audits = await repo.clauseAudits(db);
      const out: ClauseSummary[] = [];
      for (const c of all) {
        const audit = audits.get(c.code);
        out.push({
          code: c.code,
          label: c.label,
          mode: c.mode,
          usageCount: (await usage.documentsReferencing(c.code)).length,
          updatedAt: audit?.updatedAt ?? new Date(0),
          updatedBy: audit?.updatedBy ?? "",
        });
      }
      return out;
    },
    required: async (code) => (await repo.loadClause(db, code))?.required,
    usages: (code) => usage.documentsReferencing(code),
    audit: (code) => repo.clauseAudit(db, code),

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createClause(input, await context(tx));
        if (!r.ok) return r;
        await repo.insertClause(tx, r.value, actor.userId);
        return r;
      }),
    rename: (actor, code, label) => edit(actor, code, (def, ctx) => renameClause(def, label, ctx.existing)),
    setBody: (actor, code, body) => editAndRecheck(actor, code, (def, ctx) => setBody(def, body, ctx.analyze)),
    setMode: (actor, code, mode, body) => editAndRecheck(actor, code, (def, ctx) => setMode(def, mode, body, ctx.analyze)),
    duplicate: (actor, code) =>
      db.transaction((tx) =>
        withClause(tx, code, async (def) => {
          const r = await duplicateClause(def, await context(tx));
          if (!r.ok) return r;
          await repo.insertClause(tx, r.value, actor.userId);
          return r;
        }),
      ),

    addOption: (actor, code, input) => editAndRecheck(actor, code, (def, ctx) => addOption(def, input, ctx)),
    renameOption: (actor, code, optionCode, label) => edit(actor, code, (def) => renameOption(def, optionCode, label)),
    addOptionValue: (actor, code, optionCode, input) => editAndRecheck(actor, code, (def, ctx) => addOptionValue(def, optionCode, input, ctx)),
    renameOptionValue: (actor, code, optionCode, valueCode, label) =>
      edit(actor, code, (def) => renameOptionValue(def, optionCode, valueCode, label)),
    setOptionValueBody: (actor, code, optionCode, valueCode, body) =>
      editAndRecheck(actor, code, (def, ctx) => setOptionValueBody(def, optionCode, valueCode, body, ctx.analyze)),
    reorderOptions: (actor, code, order) => edit(actor, code, (def) => reorderOptions(def, order)),
    reorderOptionValues: (actor, code, optionCode, order) => edit(actor, code, (def) => reorderOptionValues(def, optionCode, order)),
    removeOptionValue: (actor, code, optionCode, valueCode) =>
      editAndRecheck(actor, code, (def, ctx) => removeOptionValue(def, optionCode, valueCode, ctx.analyze)),
    removeOption: (actor, code, optionCode) => editAndRecheck(actor, code, (def, ctx) => removeOption(def, optionCode, ctx.analyze)),

    remove: async (actor, code, opts = {}) => {
      // 사용처는 주입 소스가 자기 저장소를 볼 수 있어 트랜잭션 밖에서 미리 읽는다.
      const referencing = opts.confirm ? [] : await usage.documentsReferencing(code);
      return db.transaction(async (tx) => {
        let loaded: Clause | undefined;
        return destructive<void>({
          actor,
          action: "clause.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadClause(tx, code);
            return loaded ? ok(undefined) : notFound(code);
          },
          computeImpact: () => ({
            valueRowsLost: 0,
            brokenRefs: referencing.map(usageCoordinate),
            cascade: loaded!.options.map((o) => `옵션 ${o.label}(${o.code})`),
          }),
          execute: async () => {
            await repo.deleteClause(tx, code);
            return ok(undefined);
          },
        });
      });
    },

    checkReference: (code, owner) =>
      withClause(db, code, async (def) =>
        ok(checkAttachmentForReference(def, await lookupOf(db), { ownerId: owner.id })),
      ),

    recheck: (code) => withClause(db, code, async (def) => ok(await recheckOf(def, await lookupOf(db)))),
  };
}
