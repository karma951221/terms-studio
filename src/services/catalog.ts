/**
 * 카탈로그 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출.
 *
 * - 비파괴 액션(채번 · 표시명 · 설명 · 식 · enum 값 추가 · 순서)은 editor 도 가능.
 *   도메인 함수가 새 정의를 돌려주면 그대로 저장한다.
 * - 파괴적 액션(구분자 삭제 · enum 값/정의 삭제)은 `destructive()` 2단 프로토콜:
 *   editor → forbidden · admin 1차 → needsConfirmation(Impact) · `{ confirm: true }` → 실행.
 * - 구분자에는 **값 행이 없다** (식이라서 — ADR-0037). 삭제의 영향은 「문면 사용처가 깨진다」뿐이고
 *   그 목록은 참조 역인덱스(C1)가 `ImpactSource.findBrokenRefs` 로 준다.
 * - 값 저장소·참조 역인덱스는 다른 영역(B1·B4·C1) — `ImpactSource` 로 주입한다.
 *   주입이 없으면 `NO_VALUE_STORE` (값 행 0 · 참조 없음).
 */
import { destructive } from "@/domain/auth";
import {
  addEnumValue,
  cascadeOf,
  checkDependents,
  checkDiscriminatorExpression,
  computeImpact,
  createDiscriminator,
  createEnum,
  discriminatorResultType,
  discriminatorWarnings,
  enumReferences,
  inspectExpression,
  NO_VALUE_STORE,
  removeEnumValue,
  renameDiscriminator,
  renameEnum,
  renameEnumValue,
  reorderEnumValues,
  reviseEnum,
  setDescription,
  setExpression,
  setResultType,
  type CatalogContext,
  type Discriminator,
  type DiscriminatorResultType,
  type DiscriminatorSummary,
  type EnumDef,
  type EnumRevision,
  type ImpactSource,
  type ImpactTarget,
  type Inspection,
  type NewDiscriminator,
  type NewEnum,
  type NewEnumValue,
} from "@/domain/catalog";
import { formatCoordinate } from "@/domain/coordinate";
import type { ExprType } from "@/domain/expression";
import { transitiveUsages, type RefGraph } from "@/domain/refs";
import type { Actor, AttachLevel, Code, Coordinate, FieldType, Issue, Result } from "@/domain/types";
import { mergeImpacts, ok, reject } from "@/domain/types";

import * as repo from "@/db/repo/catalog";
import type { Db } from "@/db/repo/types";

import { rollbackUnless } from "./txContext";

export interface CatalogServiceDeps {
  /** 값 행 수 · 깨질 참조 · 값 행 삭제. 기본 NO_VALUE_STORE. */
  impact?: ImpactSource;
  /** 담보속성 유효값 조회 — 식의 `attr.X = '값'` 리터럴 검사에 쓴다. 기본은 유효값을 모름. */
  attributeValues?: () => Promise<(kindCode: Code) => string[] | undefined>;
  /** 참조 그래프 — 「검사」가 문면 사용처(슬롯 · 조건식)가 깨질지 볼 때 쓴다. 없으면 사용처 판정은 건너뛴다. */
  graph?: () => Promise<RefGraph>;
}

/** 「검사」 입력 — 편집 중인 값. `code` 는 수정 화면에서만 (생성은 아직 코드가 없다). */
export interface InspectInput {
  code?: Code;
  expression: string;
  level: AttachLevel;
  resultType?: DiscriminatorResultType;
}

/** 「검사」 결과 — 도메인의 오류 · 경고 · 추론에 **저장하면 깨질 사용처**(경고 · `warnings` 에도 같이 실린다)를 더한 것. */
export interface InspectResult extends Inspection {
  breaks: Issue[];
}

/** 파괴적 액션의 2단 프로토콜 옵션. */
export interface Confirmable {
  confirm?: boolean;
}

export interface CatalogService {
  // 조회
  get(code: Code): Promise<Discriminator | undefined>;
  list(): Promise<Discriminator[]>;
  audit(code: Code): ReturnType<typeof repo.discriminatorAudit>;
  /** 목록용 — 코드 → 최종수정(언제 · 누가). */
  audits(): ReturnType<typeof repo.discriminatorAudits>;
  getEnum(code: Code): Promise<EnumDef | undefined>;
  listEnums(): Promise<EnumDef[]>;
  /** 목록용 — enum 코드 → 최종수정(언제 · 누가). */
  enumAudits(): ReturnType<typeof repo.enumAudits>;

  // 구분자 — 비파괴
  create(actor: Actor, input: NewDiscriminator): Promise<Result<Discriminator>>;
  rename(actor: Actor, code: Code, label: string): Promise<Result<Discriminator>>;
  setDescription(actor: Actor, code: Code, description: string): Promise<Result<Discriminator>>;
  setExpression(actor: Actor, code: Code, expression: string): Promise<Result<Discriminator>>;
  /** 명시 결과 타입 지정/해제 — 현재 식의 추론 타입과 대조 (기능/구분자 §3.1). */
  setResultType(actor: Actor, code: Code, resultType: DiscriminatorResultType | undefined): Promise<Result<Discriminator>>;
  /** 저장 전 식 검사 — 편집기가 미리 부르는 자리. 통과하면 추론된 결과 타입 (화면이 표시에 쓴다). */
  checkExpression(expression: string, level: AttachLevel): Promise<Result<ExprType>>;
  /**
   * 「검사」 — 오류(저장 막음) · 경고(저장되고 배지) · 추론 타입 + 저장하면 깨질 사용처 (기능/구분자 §3.3).
   * `code` 가 있으면 참조하는 구분자 재검사(오류)와 문면 사용처(슬롯 · 조건식) 판정(경고)까지. 저장은 하지 않는다.
   */
  inspect(input: InspectInput): Promise<InspectResult>;
  /** 목록용 — 코드 → 경고 (별칭만 · 가벼운 것). 「깨질 사용처」는 사용처마다 그래프를 봐야 해서 목록에 넣지 않는다. */
  listWarnings(): Promise<Map<Code, Issue[]>>;

  // 구분자 — 파괴적 (admin · 2단)
  remove(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;

  // enum — 비파괴
  createEnum(actor: Actor, input: NewEnum): Promise<Result<EnumDef>>;
  renameEnum(actor: Actor, code: Code, label: string): Promise<Result<EnumDef>>;
  addEnumValue(actor: Actor, code: Code, input: NewEnumValue): Promise<Result<EnumDef>>;
  renameEnumValue(actor: Actor, code: Code, valueCode: Code, label: string): Promise<Result<EnumDef>>;
  reorderEnumValues(actor: Actor, code: Code, order: Code[]): Promise<Result<EnumDef>>;
  /**
   * 열거형변수 편집 화면 한 벌 저장 — 이름 · 주석 · 최종 값 목록을 **최종 상태로 한 번에** 검사해 한 번 저장한다
   * (점검 2026-09-27 H2 ① · D1 — 맞바꾸기 · 비운 이름 받기). 빠진 값이 있으면 `enum.deleteValue` 2단(편집자 forbidden ·
   * 관리자 1차 needsConfirmation — 빠진 값 전부의 영향을 합쳐서 · confirm 이면 저장 + 값 행 purge, D2).
   * 거부 · 확인 필요면 트랜잭션을 롤백한다 — 채번한 순번도 타지 않는다.
   */
  reviseEnum(actor: Actor, code: Code, revision: EnumRevision, opts?: Confirmable): Promise<Result<EnumDef>>;

  // enum — 파괴적 (admin · 2단)
  removeEnumValue(actor: Actor, code: Code, valueCode: Code, opts?: Confirmable): Promise<Result<EnumDef>>;
  removeEnum(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
}

export function createCatalogService(db: Db, deps: CatalogServiceDeps = {}): CatalogService {
  const impact = deps.impact ?? NO_VALUE_STORE;
  const loadAttributeValues = deps.attributeValues ?? (async () => () => undefined);

  function catalogOf(defs: readonly Discriminator[]): ReadonlyMap<Code, Discriminator> {
    return new Map(defs.map((d) => [d.code, d]));
  }

  /** 저장 전 검사 — 구분자 참조를 풀려면 카탈로그가 필요하다 (기능/구분자 §3.2). */
  async function checkExpression(expression: string, level: AttachLevel): Promise<Result<ExprType>> {
    const [attributeValues, defs] = await Promise.all([loadAttributeValues(), repo.listDiscriminators(db)]);
    return checkDiscriminatorExpression(expression, level, { attributeValues, catalog: catalogOf(defs) });
  }

  const catalogAt = (def: Discriminator): Coordinate => ({ document: "catalog", ownerId: def.code, ownerName: def.label });

  const sameFieldType = (a: FieldType | undefined, b: FieldType): boolean =>
    a !== undefined && a.kind === b.kind && ("enumCode" in a ? a.enumCode : undefined) === ("enumCode" in b ? b.enumCode : undefined);

  /**
   * 문면 사용처가 **타입 변경**으로 깨지는지 — 저장은 하지 않고 경고만 (기능/구분자 §3.3 「식 · 타입 변경으로 깨질 사용처」).
   * - 슬롯(`slot`)은 string · enum 만 찍는다 (기능/문면 §3.4) — 새 타입이 그 밖이면 깨진다.
   * - 조건식(`when`)은 그 구분자를 지금 타입으로 두고 쓰였다 (`D` · `D = '값'` · `D > 0`) — 타입(kind · 열거형변수)이
   *   바뀌면 그 비교가 더는 서지 않는다. 조건식 원문은 간선에 없으니 「바뀌었는가」로 판정한다 (같은 타입이면 그대로 선다).
   * 새 타입은 명시 타입이 있으면 그것 (슬롯 규칙이 명시 타입을 본다 — 결정 1), 없으면 추론.
   * - 참조하는 구분자를 **거쳐** 닿는 사용처(ADR-0049 §2 「구분자 → 구분자 → 문면」)는 그 구분자의 결과 타입이 정한다 —
   *   명시 타입이 있으면 변경 전후가 같아 안 깨지고(어긋나면 `checkDependents` 가 오류), 없으면 추론 타입이 원천을 따라 바뀌므로
   *   바뀐 카탈로그로 다시 추론해 같은 규칙으로 본다.
   */
  function usageBreaks(graph: RefGraph, current: Discriminator, next: Discriminator, catalog: ReadonlyMap<Code, Discriminator>): Issue[] {
    const candidate = new Map(catalog);
    candidate.set(next.code, next);
    const out: Issue[] = [];
    for (const { edge, via } of transitiveUsages(graph, current.code)) {
      const read = via.length > 0 ? catalog.get(via[via.length - 1]!) : current;
      if (!read) continue;
      const before = discriminatorResultType(read, undefined, catalog);
      const after = discriminatorResultType(candidate.get(read.code) ?? read, undefined, candidate); // 직접 읽는 자리는 바뀐 정의 자체
      if (!after) continue;
      const where = formatCoordinate(edge.at, { source: true });
      const through = via.length > 0 ? ` (${read.code} 를 거쳐)` : "";
      if (edge.via === "slot" && after.kind !== "string" && after.kind !== "enum") {
        out.push({ kind: "typeMismatch", severity: "warning", message: `슬롯 사용처 ${where}${through} 가 깨집니다 (string·enum 만 허용 — 이 식은 ${after.kind})`, at: edge.at, source: catalogAt(current) });
      } else if (edge.via === "when" && !sameFieldType(before, after)) {
        out.push({ kind: "typeMismatch", severity: "warning", message: `조건식 사용처 ${where}${through} 가 깨질 수 있습니다 (타입 ${before?.kind ?? "모름"} → ${after.kind})`, at: edge.at, source: catalogAt(current) });
      }
    }
    return out;
  }

  async function inspect(input: InspectInput): Promise<InspectResult> {
    const ctx = await context(db);
    const catalog = ctx.catalog!;
    const attributeValues = await loadAttributeValues();
    const current = input.code === undefined ? undefined : catalog.get(input.code);
    const at: Coordinate = current ? catalogAt(current) : { document: "catalog" };
    const base = inspectExpression(input, { catalog, attributeValues }, at);
    const breaks: Issue[] = [];
    const errors = [...base.errors];
    if (current) {
      const next: Discriminator = { ...current, expression: input.expression };
      if (input.resultType) next.resultType = input.resultType;
      else delete next.resultType;
      errors.push(...checkDependents(next, ctx));
      // 문법이 안 서면 사용처 판정은 없다 (추론 타입이 없다)
      if (base.inferred && deps.graph) breaks.push(...usageBreaks(await deps.graph(), current, next, catalog));
    }
    return { ...base, errors, warnings: [...base.warnings, ...breaks], breaks };
  }

  async function listWarnings(): Promise<Map<Code, Issue[]>> {
    const defs = await repo.listDiscriminators(db);
    const out = new Map<Code, Issue[]>();
    for (const def of defs) {
      const warnings = discriminatorWarnings(def, {}, catalogAt(def));
      if (warnings.length > 0) out.set(def.code, warnings);
    }
    return out;
  }

  // ───────── 공통 헬퍼 ─────────

  async function context(tx: Db): Promise<CatalogContext> {
    const [defs, enumDefs, attributeValues] = await Promise.all([
      repo.listDiscriminators(tx),
      repo.listEnums(tx),
      loadAttributeValues(),
    ]);
    const existing: DiscriminatorSummary[] = defs.map((d) => ({ code: d.code, label: d.label, level: d.level }));
    const enumByCode = new Map(enumDefs.map((e) => [e.code, e]));
    const catalog = catalogOf(defs);
    return {
      nextSeq: repo.seqSource(tx),
      existing,
      catalog,
      findEnum: (c) => enumByCode.get(c),
      existingEnumLabels: enumDefs.map((e) => e.label),
      checkExpression: (expression, level, override) => checkDiscriminatorExpression(expression, level, { attributeValues, catalog: override ?? catalog }),
    };
  }

  function notFound<T>(what: string): Result<T> {
    return reject({ reason: "notFound", what });
  }

  /** 비파괴 변경 — 읽기 → 도메인 → 저장, 한 트랜잭션. */
  function edit(
    actor: Actor,
    code: Code,
    change: (def: Discriminator, ctx: CatalogContext) => Promise<Result<Discriminator>> | Result<Discriminator>,
  ): Promise<Result<Discriminator>> {
    return db.transaction(async (tx) => {
      const def = await repo.loadDiscriminator(tx, code);
      if (!def) return notFound<Discriminator>(`구분자 ${code}`);
      const r = await change(def, await context(tx));
      if (!r.ok) return r;
      await repo.saveDiscriminator(tx, r.value, actor.userId);
      return r;
    });
  }

  async function withEnum<T>(tx: Db, code: Code, fn: (def: EnumDef) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const def = await repo.loadEnum(tx, code);
    if (!def) return notFound(`enum ${code}`);
    return fn(def);
  }

  function editEnum(
    actor: Actor,
    code: Code,
    change: (def: EnumDef, ctx: CatalogContext) => Promise<Result<EnumDef>> | Result<EnumDef>,
  ): Promise<Result<EnumDef>> {
    return db.transaction((tx) =>
      withEnum(tx, code, async (def) => {
        const r = await change(def, await context(tx));
        if (!r.ok) return r;
        await repo.saveEnum(tx, r.value, actor.userId);
        return r;
      }),
    );
  }

  // ───────── 서비스 ─────────

  return {
    get: (code) => repo.loadDiscriminator(db, code),
    list: () => repo.listDiscriminators(db),
    audit: (code) => repo.discriminatorAudit(db, code),
    audits: () => repo.discriminatorAudits(db),
    getEnum: (code) => repo.loadEnum(db, code),
    listEnums: () => repo.listEnums(db),
    enumAudits: () => repo.enumAudits(db),
    checkExpression,
    inspect,
    listWarnings,

    create: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createDiscriminator(input, await context(tx));
        if (!r.ok) return r;
        await repo.insertDiscriminator(tx, r.value, actor.userId);
        return r;
      }),

    rename: (actor, code, label) => edit(actor, code, (def, ctx) => renameDiscriminator(def, label, ctx.existing)),
    setDescription: (actor, code, description) => edit(actor, code, (def) => setDescription(def, description)),
    setExpression: (actor, code, expression) => edit(actor, code, (def, ctx) => setExpression(def, expression, ctx)),
    setResultType: (actor, code, resultType) => edit(actor, code, (def, ctx) => setResultType(def, resultType, ctx)),

    remove: (actor, code, opts = {}) =>
      db.transaction(async (tx) => {
        let loaded: Discriminator | undefined;
        const target: ImpactTarget = { kind: "discriminator", code };
        return destructive<void>({
          actor,
          action: "catalog.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadDiscriminator(tx, code);
            return loaded ? ok(undefined) : notFound(`구분자 ${code}`);
          },
          computeImpact: () => computeImpact(target, impact, { cascade: cascadeOf(loaded!) }),
          execute: async () => {
            await repo.deleteDiscriminator(tx, code);
            await impact.purgeValueRows(target);
            return ok(undefined);
          },
        });
      }),

    createEnum: (actor, input) =>
      db.transaction(async (tx) => {
        const r = await createEnum(input, await context(tx));
        if (!r.ok) return r;
        await repo.insertEnum(tx, r.value, actor.userId);
        return r;
      }),
    renameEnum: (actor, code, label) => editEnum(actor, code, (def, ctx) => renameEnum(def, label, ctx.existingEnumLabels ?? [])),
    addEnumValue: (actor, code, input) => editEnum(actor, code, (def, ctx) => addEnumValue(def, input, ctx.nextSeq)),
    renameEnumValue: (actor, code, valueCode, label) => editEnum(actor, code, (def) => renameEnumValue(def, valueCode, label)),
    reorderEnumValues: (actor, code, order) => editEnum(actor, code, (def) => reorderEnumValues(def, order)),
    reviseEnum: (actor, code, revision, opts = {}) =>
      rollbackUnless(
        db,
        (tx) =>
          withEnum(tx, code, async (def) => {
            const ctx = await context(tx);
            const revised = await reviseEnum(def, revision, { existingEnumLabels: ctx.existingEnumLabels ?? [], nextSeq: ctx.nextSeq });
            if (!revised.ok) return revised as Result<EnumDef>;
            const { def: next, removed } = revised.value;
            const targets = removed.map((valueCode): ImpactTarget => ({ kind: "enumValue", enumCode: code, valueCode }));
            const save = async (): Promise<Result<EnumDef>> => {
              await repo.saveEnum(tx, next, actor.userId);
              for (const target of targets) await impact.purgeValueRows(target);
              return ok(next);
            };
            if (targets.length === 0) return save();
            return destructive<EnumDef>({
              actor,
              action: "enum.deleteValue",
              confirm: opts.confirm,
              computeImpact: async () => mergeImpacts(await Promise.all(targets.map((target) => computeImpact(target, impact)))),
              execute: save,
            });
          }),
        (r) => r.ok,
      ),

    removeEnumValue: (actor, code, valueCode, opts = {}) =>
      db.transaction(async (tx) => {
        let changed: Result<EnumDef> | undefined;
        const target: ImpactTarget = { kind: "enumValue", enumCode: code, valueCode };
        return destructive<EnumDef>({
          actor,
          action: "enum.deleteValue",
          confirm: opts.confirm,
          precheck: () =>
            withEnum(tx, code, (def) => {
              changed = removeEnumValue(def, valueCode);
              return changed.ok ? ok(undefined) : (changed as Result<void>);
            }),
          computeImpact: () => computeImpact(target, impact),
          execute: async () => {
            if (!changed?.ok) throw new Error("precheck 없이 execute 호출");
            await repo.saveEnum(tx, changed.value, actor.userId);
            await impact.purgeValueRows(target);
            return changed;
          },
        });
      }),

    removeEnum: (actor, code, opts = {}) =>
      db.transaction(async (tx) => {
        let loaded: EnumDef | undefined;
        const target: ImpactTarget = { kind: "enum", enumCode: code };
        return destructive<void>({
          actor,
          action: "enum.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadEnum(tx, code);
            return loaded ? ok(undefined) : notFound(`enum ${code}`);
          },
          computeImpact: async () =>
            computeImpact(target, impact, {
              cascade: cascadeOf(loaded!),
              brokenRefs: enumReferences(code),
            }),
          execute: async () => {
            await repo.deleteEnum(tx, code);
            await impact.purgeValueRows(target);
            return ok(undefined);
          },
        });
      }),
  };
}
