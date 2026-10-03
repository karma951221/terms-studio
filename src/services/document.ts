/**
 * 문면 서비스 — 모든 쓰기의 진입점. actor 검사 · 도메인 규칙 · repo 호출 (한 트랜잭션).
 *
 * - 문서 생성(담보약관 · 보통약관 마스터) · 조회 · 목록 · 제목 · 대응 보통약관 지정(D-P4-5) ·
 *   트리 커맨드 적용(저장 시 `validateTree` + `validateExpressions`) · 복제(D-P4-4·9) · 사전평가(문맥 주입) · 별표 CRUD.
 * - 저작 화면의 저장은 `save` 하나다 (ADR-0074) — 편집을 시작한 판 + 브라우저 편집본의 명령 목록을 받아
 *   판 확인 · 원본에 재적용 · 전체 검증 · 한 트랜잭션 반영(판 +1). 판은 repo 가 모든 저장에서 올린다.
 * - 파괴적 액션(문서 삭제 `document.delete` · 별표 삭제 `appendix.delete` · 박스 삭제 `box.delete`)은 `destructive()` 2단 프로토콜.
 *   영향의 「깨질 참조」 = 사용처 — 기본은 이 DB 의 문서들을 훑어 계산하고, 상품이 보통약관을 선택하는 사용처 등
 *   다른 영역(B4 · C1)의 것은 `UsageSource` 로 주입해 합친다.
 * - 함수조항 게이트(`ClauseGate`)는 B2 가, 담보 마스터 평가 문맥(`EvalContext`)은 B1 이 만든다 — 여기서는 주입만 받는다.
 * - 타입 조회(`TypeResolver`)는 기본으로 카탈로그 정의에서 만든다. 담보속성(attr.X)의 유효값은 B4 몫이라
 *   기본 조회는 「담보속성 타입(유효값 모름)」으로만 답한다 — 정밀 검사는 `typeResolver` 주입.
 */
import { destructive } from "@/domain/auth";
import {
  applyCommands,
  blockingIssues,
  catalogTypeResolver,
  cloneTree,
  collectRefs,
  createAppendix,
  createBox,
  generalRefsOf,
  numberTree,
  preEvaluate,
  removedIds,
  removedRefKeys,
  refKey,
  renameAppendix,
  replayEdits,
  reviseBox,
  requiredDiscriminators,
  setAppendixDescription,
  validateDocument,
  validateExpressions,
  validateTree,
  withCodes,
  type Appendix,
  type Box,
  type BoxRevision,
  type BranchEvaluation,
  type BranchState,
  type ClauseGate,
  type Command,
  type DocRef,
  type DocumentNode,
  type EditOp,
  type ExpressionScope,
  type GeneralRefs,
  type NewAppendix,
  type NewBox,
  type NodeNumber,
  type PreEvaluation,
  type TreeEnv,
} from "@/domain/document";
import type { EvalContext, TypeResolver } from "@/domain/expression";
import type { RowSource } from "@/domain/structure";
import type { Actor, Code, Coordinate, Id, Impact, Issue, Result } from "@/domain/types";
import { ok, reject } from "@/domain/types";

import * as catalogRepo from "@/db/repo/catalog";
import * as coverageRepo from "@/db/repo/coverage";
import * as repo from "@/db/repo/document";
import type { DocumentKind, DocumentRecord, DocumentSummary } from "@/db/repo/document";
import type { Db } from "@/db/repo/types";

export type { DocumentKind, DocumentRecord, DocumentSummary } from "@/db/repo/document";
/** 식 타입 조회 · 함수조항 게이트 구성은 도메인에 있다 (브라우저 편집본과 한 벌 — ADR-0074). */
export { catalogTypeResolver } from "@/domain/document";

/** 다른 영역이 아는 사용처 (상품의 보통약관 선택 등). 문서 안 참조는 서비스가 직접 훑는다. */
export interface UsageSource {
  documentUsages(tx: Db, documentId: Id): Promise<Coordinate[]>;
  appendixUsages(tx: Db, code: Code): Promise<Coordinate[]>;
  /** 함수조항 본문의 박스 참조 등 — 문서 밖에서 박스를 쓰는 곳. 없으면 문서 안만 센다. */
  boxUsages?(tx: Db, code: Code): Promise<Coordinate[]>;
}

export interface DocumentServiceDeps {
  /** 함수조항 게이트 (B2). 기본 전부 통과. */
  clauseGate?: (tx: Db) => Promise<ClauseGate>;
  /** 식 타입 조회. 기본 카탈로그 정의로 구성. */
  typeResolver?: (tx: Db) => Promise<TypeResolver>;
  /** 외부 사용처. 기본 없음. */
  usages?: UsageSource;
  /** 새 노드 id (복제용). 기본 uuid. */
  newId?: () => Id;
}

export interface Confirmable {
  confirm?: boolean;
}

export type DuplicateTarget = { coverageId: Id; title: string } | { title: string };

/** 저작 화면의 저장 한 번 (ADR-0074) — 편집을 시작한 판 + 편집본에 적용한 명령 목록. */
export interface SaveInput {
  baseVersion: number;
  ops: readonly EditOp[];
  /** 다른 문서의 참조를 깨는 저장 — 영향을 본 뒤 true 로 다시 부른다. */
  confirm?: boolean;
}

export interface DocumentService {
  // 조회
  get(id: Id): Promise<DocumentRecord | undefined>;
  findByCoverage(coverageId: Id): Promise<DocumentRecord | undefined>;
  list(kind?: DocumentKind): Promise<DocumentSummary[]>;
  validate(id: Id): Promise<Issue[]>;
  /** 저장되지 않은 트리를 문서 `id` 자리의 저장 검증(`validate` 와 같은 규칙 · 경고 포함)으로 — 상품 조 사본 검사 (ADR-0079). 없는 문서면 빈 목록. */
  validateTree(id: Id, tree: DocumentNode): Promise<Issue[]>;
  /**
   * 미결정 함수조항 옵션 수 — 저장 검사와 **같은** 검증(`validate`)의 `optionUnselected` 만 센다 (기능/담보 §3.5).
   * 저장은 미선택을 거부하므로(기능/함수조항 §3.2) 0 이 아닌 값은 「저장 뒤 정의에 옵션이 늘었다」는 뜻이다.
   * 담보약관은 담보 마스터 안에서 옵션이 다 정해져야 해서, 담보 상세가 이 수를 경고로 띄운다.
   */
  unresolvedOptionCount(id: Id): Promise<number>;
  numbering(id: Id, branchStates?: ReadonlyMap<Id, BranchState | BranchEvaluation>): Promise<Map<Id, NodeNumber>>;
  refs(id: Id): Promise<DocRef[]>;
  requiredDiscriminators(id: Id): Promise<Code[]>;
  /** `rows` = 반복 표 행 원천 (담보 약관이면 `coverageRowSource` — ADR-0070). */
  preEvaluate(id: Id, ctx: EvalContext, rows?: RowSource<EvalContext>): Promise<PreEvaluation>;
  documentUsages(id: Id): Promise<Coordinate[]>;

  // 문서 — 비파괴
  createSpecial(actor: Actor, coverageId: Id, title: string): Promise<Result<DocumentRecord>>;
  createGeneral(actor: Actor, title: string): Promise<Result<DocumentRecord>>;
  setTitle(actor: Actor, id: Id, title: string): Promise<Result<DocumentRecord>>;
  setGeneralDocument(actor: Actor, id: Id, generalDocumentId: Id | undefined): Promise<Result<DocumentRecord>>;
  apply(actor: Actor, id: Id, commands: readonly Command[]): Promise<Result<DocumentRecord>>;
  /**
   * 저장 한 번 (ADR-0074) — 판 확인(다르면 `conflict`) → 원본에 명령 목록 재적용 → 문서 전체 검증(오류면 `invalid`) →
   * 다른 문서가 가리키던 조가 사라지면 영향 확인(`needsConfirmation`, `confirm` 으로 재호출) → 한 트랜잭션 반영 + 판 +1.
   * 대응 보통약관 지정 · 템플릿 이름도 명령 목록에 든다.
   */
  save(actor: Actor, id: Id, input: SaveInput): Promise<Result<DocumentRecord>>;
  /**
   * 트리 통째 적재 — 루트 id·제목은 문서 것을 유지하고 자식만 받는다. 앞 조가 뒤 조를 가리켜도 되도록
   * 커맨드 단위가 아니라 **전체 트리를 한 번** 검증한다 (시드 · 원문 변환 · E2E 용).
   */
  importTree(actor: Actor, id: Id, tree: DocumentNode): Promise<Result<DocumentRecord>>;
  duplicate(actor: Actor, id: Id, target: DuplicateTarget): Promise<Result<DocumentRecord>>;
  // 문서 — 파괴적
  remove(actor: Actor, id: Id, opts?: Confirmable): Promise<Result<void>>;

  // 별표
  getAppendix(code: Code): Promise<Appendix | undefined>;
  listAppendices(): Promise<Appendix[]>;
  appendixUsages(code: Code): Promise<Coordinate[]>;
  appendixAudits(): ReturnType<typeof repo.appendixAudits>;
  createAppendix(actor: Actor, input: NewAppendix): Promise<Result<Appendix>>;
  renameAppendix(actor: Actor, code: Code, name: string): Promise<Result<Appendix>>;
  setAppendixDescription(actor: Actor, code: Code, description: string): Promise<Result<Appendix>>;
  removeAppendix(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;

  // 박스 (정적 마스터 — 기능/박스)
  getBox(code: Code): Promise<Box | undefined>;
  listBoxes(): Promise<Box[]>;
  boxUsages(code: Code): Promise<Coordinate[]>;
  boxAudits(): ReturnType<typeof repo.boxAudits>;
  createBox(actor: Actor, input: NewBox): Promise<Result<Box>>;
  /** 상세 저장 한 번 — 이름 · 제목 · 줄의 최종 상태를 한 트랜잭션에. */
  saveBox(actor: Actor, code: Code, input: BoxRevision): Promise<Result<Box>>;
  removeBox(actor: Actor, code: Code, opts?: Confirmable): Promise<Result<void>>;
}

// ───────────────────────────── 서비스 ─────────────────────────────

export function createDocumentService(db: Db, deps: DocumentServiceDeps = {}): DocumentService {
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  function notFound<T>(what: string): Result<T> {
    return reject({ reason: "notFound", what });
  }
  function invalid<T>(issues: Issue[]): Result<T> {
    return reject({ reason: "invalid", issues });
  }
  function bad<T>(message: string, at: Coordinate = {}): Result<T> {
    return invalid([{ kind: "structure", message, at }]);
  }

  /** 문서의 좌표 — ownerId 는 소유 실체(담보약관이면 담보 id), 문서 화면으로 가는 id 는 documentId 에. */
  function coordinateOf(doc: DocumentSummary): Coordinate {
    return { document: doc.kind, ownerId: doc.ownerId ?? doc.id, documentId: doc.id, ownerName: doc.title };
  }

  async function withDoc<T>(tx: Db, id: Id, fn: (doc: DocumentRecord) => Promise<Result<T>> | Result<T>): Promise<Result<T>> {
    const doc = await repo.loadDocument(tx, id);
    return doc ? fn(doc) : notFound(`문서 ${id}`);
  }

  async function generalTitleTaken(tx: Db, title: string, exceptId?: Id): Promise<boolean> {
    const list = await repo.listDocuments(tx, "general");
    return list.some((d) => d.title === title && d.id !== exceptId);
  }

  /** 보통약관 템플릿 한 벌의 조연결 · 보통약관 조 참조 대상. 없거나 보통약관이 아니면 undefined. */
  async function generalRefsFor(tx: Db, generalDocumentId: Id): Promise<GeneralRefs | undefined> {
    const g = await repo.loadDocument(tx, generalDocumentId);
    return g && g.kind === "general" ? generalRefsOf(g.tree) : undefined;
  }

  /** 대응 보통약관을 뺀 검증 환경 — 종류 · 별표 존재 · 함수조항 게이트 · 좌표. */
  async function baseEnvOf(tx: Db, doc: DocumentRecord): Promise<TreeEnv> {
    const appendixCodes = new Set((await repo.listAppendices(tx)).map((a) => a.code));
    const boxCodes = new Set((await repo.listBoxes(tx)).map((x) => x.code));
    const clauseGate = deps.clauseGate ? await deps.clauseGate(tx) : undefined;
    const enums = new Map((await catalogRepo.listEnums(tx)).map((e) => [e.code, e]));
    return {
      kind: doc.kind,
      enumOf: (c) => enums.get(c),
      appendixExists: (c) => appendixCodes.has(c),
      boxExists: (c) => boxCodes.has(c),
      ...(clauseGate ? { clauseGate } : {}),
      coordinate: coordinateOf(doc),
    };
  }

  /** 저장 검증 환경 — 대응 보통약관의 조 집합 · 별표 존재 · 함수조항 게이트 · 좌표. */
  async function envOf(tx: Db, doc: DocumentRecord): Promise<TreeEnv> {
    const env = await baseEnvOf(tx, doc);
    if (doc.kind !== "special") return env;
    const refs = doc.generalDocumentId ? await generalRefsFor(tx, doc.generalDocumentId) : undefined;
    return { ...env, generalArticleIds: refs?.articleIds ?? new Set(), generalReferenceKeys: refs?.referenceKeys ?? new Set(), ...(refs?.repeatedKeys ? { generalRepeatedKeys: refs.repeatedKeys } : {}) };
  }

  /** 식 검사 재료 — 타입 조회 + 한정자 검사 문맥(담보 약관이면 문맥 담보 트리 · 구분자 레벨). */
  async function scopeOf(tx: Db, doc: DocumentRecord): Promise<{ resolve: TypeResolver; scope: ExpressionScope }> {
    const defs = await catalogRepo.listDiscriminators(tx);
    const resolve = deps.typeResolver ? await deps.typeResolver(tx) : catalogTypeResolver(defs);
    const levelOf = (code: Code) => defs.find((d) => d.code === code)?.level;
    const coverage = doc.kind === "special" && doc.ownerId ? await coverageRepo.loadCoverage(tx, doc.ownerId) : undefined;
    return { resolve, scope: { ...(coverage ? { coverage } : {}), levelOf } };
  }

  /** 저장 시점 전체 검증 (경고 포함) — 브라우저 편집본의 검증 목록과 같은 `validateDocument`. */
  async function validateDoc(tx: Db, doc: DocumentRecord, tree: DocumentNode): Promise<Issue[]> {
    const env = await envOf(tx, doc);
    const { resolve, scope } = await scopeOf(tx, doc);
    return validateDocument(tree, { env, resolve, scope });
  }

  /**
   * `documentId` 에서 사라진 것을 가리키던 다른 문서의 조연결(지운 조 id) · 보통약관 조 참조(사라진 대상 열쇠 — 같은 코드의 분기 짝이 남으면 산다, ADR-0072).
   */
  async function brokenByRemoval(tx: Db, documentId: Id, removed: ReadonlySet<Id>, removedKeys: ReadonlySet<string>): Promise<Coordinate[]> {
    if (removed.size === 0 && removedKeys.size === 0) return [];
    const out: Coordinate[] = [];
    for (const d of await repo.listDocumentRecords(tx)) {
      if (d.id === documentId || d.generalDocumentId !== documentId) continue;
      for (const r of collectRefs(d.tree, coordinateOf(d))) {
        if (r.kind === "link" && removed.has(r.linkedArticleId)) out.push(r.at);
        else if (r.kind === "article" && r.scope === "general" && removedKeys.has(refKey(r))) out.push(r.at);
      }
    }
    return out;
  }

  /** 이 DB 의 문서들 중 `documentId` 를 쓰는 곳 — 대응 보통약관 지정 · 조연결 · 보통약관 조 참조. */
  async function scanDocumentUsages(tx: Db, documentId: Id): Promise<Coordinate[]> {
    const target = await repo.loadDocument(tx, documentId);
    if (!target) return [];
    const articleIds = new Set<Id>();
    for (const c of target.tree.children) {
      if (c.kind === "article") articleIds.add(c.id);
      else collectArticleIds(c, articleIds);
    }
    const out: Coordinate[] = [];
    for (const d of await repo.listDocumentRecords(tx)) {
      if (d.id === documentId) continue;
      if (d.generalDocumentId === documentId) out.push({ ...coordinateOf(d) });
      for (const r of collectRefs(d.tree, coordinateOf(d))) {
        if (r.kind === "link" && articleIds.has(r.linkedArticleId)) out.push(r.at);
        else if (r.kind === "article" && r.scope === "general" && articleIds.has(r.articleId)) out.push(r.at);
      }
    }
    return out;
  }

  async function scanAppendixUsages(tx: Db, code: Code): Promise<Coordinate[]> {
    const out: Coordinate[] = [];
    for (const d of await repo.listDocumentRecords(tx)) {
      for (const r of collectRefs(d.tree, coordinateOf(d))) {
        if (r.kind === "appendix" && r.appendixCode === code) out.push(r.at);
      }
    }
    return out;
  }

  async function boxUsages(tx: Db, code: Code): Promise<Coordinate[]> {
    const own: Coordinate[] = [];
    for (const d of await repo.listDocumentRecords(tx)) {
      for (const r of collectRefs(d.tree, coordinateOf(d))) if (r.kind === "box" && r.boxCode === code) own.push(r.at);
    }
    const external = deps.usages?.boxUsages ? await deps.usages.boxUsages(tx, code) : [];
    return [...own, ...external];
  }

  async function documentUsages(tx: Db, id: Id): Promise<Coordinate[]> {
    const own = await scanDocumentUsages(tx, id);
    const external = deps.usages ? await deps.usages.documentUsages(tx, id) : [];
    return [...own, ...external];
  }

  async function appendixUsages(tx: Db, code: Code): Promise<Coordinate[]> {
    const own = await scanAppendixUsages(tx, code);
    const external = deps.usages ? await deps.usages.appendixUsages(tx, code) : [];
    return [...own, ...external];
  }

  function emptyTree(title: string): DocumentNode {
    return { id: newId(), kind: "document", title, children: [] };
  }

  async function createDoc(tx: Db, actor: Actor, input: repo.NewDocumentRow): Promise<Result<DocumentRecord>> {
    // 복제본은 원본의 P코드를 그대로 쓴다 — 코드 없는 옛 자리만 채운다 (ADR-0072 결정 10)
    return ok(await repo.insertDocument(tx, { ...input, tree: withCodes(input.tree) }, actor.userId));
  }

  async function editAppendix(actor: Actor, code: Code, change: (a: Appendix) => Result<Appendix>): Promise<Result<Appendix>> {
    return db.transaction(async (tx) => {
      const a = await repo.loadAppendix(tx, code);
      if (!a) return notFound(`별표 ${code}`);
      const r = change(a);
      if (!r.ok) return r;
      await repo.saveAppendix(tx, r.value, actor.userId);
      return r;
    });
  }

  async function boxNames(tx: Db): Promise<string[]> {
    return (await repo.listBoxes(tx)).map((x) => x.name);
  }

  return {
    get: (id) => repo.loadDocument(db, id),
    findByCoverage: (coverageId) => repo.findByOwner(db, coverageId),
    list: (kind) => repo.listDocuments(db, kind),

    validate: (id) =>
      db.transaction(async (tx) => {
        const doc = await repo.loadDocument(tx, id);
        return doc ? validateDoc(tx, doc, doc.tree) : [];
      }),

    validateTree: (id, tree) =>
      db.transaction(async (tx) => {
        const doc = await repo.loadDocument(tx, id);
        return doc ? validateDoc(tx, doc, tree) : [];
      }),

    unresolvedOptionCount: (id) =>
      db.transaction(async (tx) => {
        const doc = await repo.loadDocument(tx, id);
        if (!doc) return 0;
        return (await validateDoc(tx, doc, doc.tree)).filter((i) => i.kind === "optionUnselected").length;
      }),

    numbering: async (id, branchStates) => {
      const doc = await repo.loadDocument(db, id);
      if (!doc) return new Map();
      const states = branchStates
        ? new Map([...branchStates].map(([k, v]) => [k, typeof v === "string" ? v : v.state] as [Id, BranchState]))
        : undefined;
      return numberTree(doc.tree, states ? { branchStates: states } : {});
    },

    refs: async (id) => {
      const doc = await repo.loadDocument(db, id);
      return doc ? collectRefs(doc.tree, coordinateOf(doc)) : [];
    },

    requiredDiscriminators: (id) =>
      db.transaction(async (tx) => {
        const doc = await repo.loadDocument(tx, id);
        if (!doc) return [];
        return requiredDiscriminators(doc.tree, deps.clauseGate ? await deps.clauseGate(tx) : undefined);
      }),

    preEvaluate: async (id, ctx, rows) => {
      const doc = await repo.loadDocument(db, id);
      if (!doc) return { branches: new Map(), slots: new Map(), issues: [], tables: new Map() };
      return preEvaluate(doc.tree, ctx, { coordinate: { ...coordinateOf(doc), ...(ctx.coordinate ?? {}) }, ...(rows ? { rows } : {}) });
    },

    documentUsages: (id) => db.transaction((tx) => documentUsages(tx, id)),

    createSpecial: (actor, coverageId, title) =>
      db.transaction(async (tx) => {
        if (await repo.findByOwner(tx, coverageId)) return reject({ reason: "duplicate", what: `담보 ${coverageId} 의 담보약관 템플릿` });
        return createDoc(tx, actor, { kind: "special", ownerId: coverageId, title, tree: emptyTree(title) });
      }),

    createGeneral: (actor, title) =>
      db.transaction(async (tx) => {
        if (await generalTitleTaken(tx, title)) return reject({ reason: "duplicate", what: `보통약관 템플릿 명 ${title}` });
        return createDoc(tx, actor, { kind: "general", title, tree: emptyTree(title) });
      }),

    setTitle: (actor, id, title) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if (doc.kind === "general" && (await generalTitleTaken(tx, title, id))) {
            return reject({ reason: "duplicate", what: `보통약관 템플릿 명 ${title}` });
          }
          const tree = { ...doc.tree, title };
          await repo.saveDocument(tx, id, { title, tree }, actor.userId);
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    setGeneralDocument: (actor, id, generalDocumentId) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if (doc.kind !== "special") return bad("대응 보통약관은 담보약관에만 지정합니다 (D-P4-5)");
          if (generalDocumentId === undefined) {
            const remaining = collectRefs(doc.tree, coordinateOf(doc)).filter(
              (r) => r.kind === "link" || (r.kind === "article" && r.scope === "general"),
            );
            if (remaining.length > 0) {
              return invalid(remaining.map((r) => ({ kind: "brokenRef", message: "조연결 · 보통약관 조 참조가 남아 있어 해제할 수 없습니다", at: r.at })));
            }
          } else {
            const g = await repo.loadDocument(tx, generalDocumentId);
            if (!g) return notFound(`문서 ${generalDocumentId}`);
            if (g.kind !== "general") return bad("대응 보통약관은 보통약관 템플릿이어야 합니다");
          }
          await repo.saveDocument(tx, id, { generalDocumentId: generalDocumentId ?? null }, actor.userId);
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    apply: (actor, id, commands) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          const env = await envOf(tx, doc);
          const applied = applyCommands(doc.tree, commands, { env, newId });
          if (!applied.ok) return applied;
          const tree = applied.value;
          const issues = validateTree(tree, env);
          const { resolve, scope } = await scopeOf(tx, doc);
          issues.push(...validateExpressions(tree, resolve, env.coordinate, scope));
          if (issues.length > 0) return invalid(issues);
          await repo.saveDocument(tx, id, { tree: withCodes(tree), title: tree.title }, actor.userId);
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    save: (actor, id, input) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if (doc.version !== input.baseVersion) {
            return reject({ reason: "conflict", what: `편집을 시작한 판 ${input.baseVersion} · 지금 판 ${doc.version}` });
          }
          // 편집 중 지정할 수 있는 보통약관은 명령 목록에 나온 것 + 지금 것 — 미리 읽어 순수 재적용에 넘긴다
          const generalIds = new Set<Id>(doc.generalDocumentId ? [doc.generalDocumentId] : []);
          for (const op of input.ops) if (op.type === "setGeneralDocument" && op.generalDocumentId) generalIds.add(op.generalDocumentId);
          const generals = new Map<Id, GeneralRefs>();
          for (const gid of generalIds) {
            const refs = await generalRefsFor(tx, gid);
            if (refs) generals.set(gid, refs);
          }
          const replayed = replayEdits(
            { tree: doc.tree, ...(doc.generalDocumentId ? { generalDocumentId: doc.generalDocumentId } : {}) },
            input.ops,
            { env: await baseEnvOf(tx, doc), generalRefs: (gid) => generals.get(gid), newId },
          );
          if (!replayed.ok) return replayed;
          const { tree, generalDocumentId } = replayed.value;
          const next: DocumentRecord = { ...doc, tree, title: tree.title, ...(generalDocumentId ? { generalDocumentId } : { generalDocumentId: undefined }) };
          if (doc.kind === "general" && tree.title !== doc.title && (await generalTitleTaken(tx, tree.title, id))) {
            return reject({ reason: "duplicate", what: `보통약관 템플릿 명 ${tree.title}` });
          }
          const errors = blockingIssues(await validateDoc(tx, next, tree));
          if (errors.length > 0) return invalid(errors);
          if (!input.confirm) {
            const broken = await brokenByRemoval(tx, id, removedIds(doc.tree, tree), removedRefKeys(doc.tree, tree));
            if (broken.length > 0) return reject({ reason: "needsConfirmation", impact: { valueRowsLost: 0, cascade: [], brokenRefs: broken } });
          }
          const saved = await repo.saveDocumentAt(tx, id, input.baseVersion, { tree: withCodes(tree), title: tree.title, generalDocumentId: generalDocumentId ?? null }, actor.userId);
          if (!saved) return reject({ reason: "conflict", what: "저장하는 사이에 다른 저장이 먼저 반영됐다" });
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    importTree: (actor, id, incoming) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          const tree: DocumentNode = { ...incoming, id: doc.tree.id, title: doc.title };
          const issues = await validateDoc(tx, doc, tree);
          if (issues.length > 0) return invalid(issues);
          await repo.saveDocument(tx, id, { tree: withCodes(tree), title: doc.title }, actor.userId);
          return ok((await repo.loadDocument(tx, id))!);
        }),
      ),

    duplicate: (actor, id, target) =>
      db.transaction((tx) =>
        withDoc(tx, id, async (doc) => {
          if ("coverageId" in target) {
            if (doc.kind !== "special") return bad("담보약관만 담보로 복제할 수 있습니다");
            if (await repo.findByOwner(tx, target.coverageId)) return reject({ reason: "duplicate", what: `담보 ${target.coverageId} 의 담보약관 템플릿` });
            return createDoc(tx, actor, {
              kind: "special",
              ownerId: target.coverageId,
              title: target.title,
              generalDocumentId: doc.generalDocumentId,
              tree: cloneTree(doc.tree, newId, target.title),
            });
          }
          if (doc.kind !== "general") return bad("보통약관 템플릿만 새 벌로 복제할 수 있습니다");
          if (await generalTitleTaken(tx, target.title)) return reject({ reason: "duplicate", what: `보통약관 템플릿 명 ${target.title}` });
          return createDoc(tx, actor, { kind: "general", title: target.title, tree: cloneTree(doc.tree, newId, target.title) });
        }),
      ),

    remove: (actor, id, opts = {}) =>
      db.transaction(async (tx) => {
        let loaded: DocumentRecord | undefined;
        return destructive<void>({
          actor,
          action: "document.delete",
          confirm: opts.confirm,
          precheck: async () => {
            loaded = await repo.loadDocument(tx, id);
            return loaded ? ok(undefined) : notFound(`문서 ${id}`);
          },
          computeImpact: async (): Promise<Impact> => ({
            valueRowsLost: 0,
            brokenRefs: await documentUsages(tx, id),
            // 관·조건 블록 안의 조까지 센다 — 실물 보통약관은 모든 조가 관 아래에 있다 (2026-09-08 리뷰 7)
            cascade: collectArticleTitles(loaded!.tree).map((title) => `조 ${title}`),
          }),
          execute: async () => {
            await repo.deleteDocument(tx, id);
            return ok(undefined);
          },
        });
      }),

    getAppendix: (code) => repo.loadAppendix(db, code),
    listAppendices: () => repo.listAppendices(db),
    appendixUsages: (code) => db.transaction((tx) => appendixUsages(tx, code)),

    appendixAudits: () => repo.appendixAudits(db),

    createAppendix: (actor, input) =>
      db.transaction(async (tx) => {
        // 코드는 시스템 채번 — 순번은 저장소가 준다 (기능/별표 §3.1).
        const r = await createAppendix(input, () => repo.nextAppendixSeq(tx));
        if (!r.ok) return r;
        await repo.insertAppendix(tx, r.value, actor.userId);
        return r;
      }),
    renameAppendix: (actor, code, name) => editAppendix(actor, code, (a) => renameAppendix(a, name)),
    setAppendixDescription: (actor, code, description) => editAppendix(actor, code, (a) => setAppendixDescription(a, description)),

    removeAppendix: (actor, code, opts = {}) =>
      db.transaction(async (tx) =>
        destructive<void>({
          actor,
          action: "appendix.delete",
          confirm: opts.confirm,
          precheck: async () => ((await repo.loadAppendix(tx, code)) ? ok(undefined) : notFound(`별표 ${code}`)),
          computeImpact: async (): Promise<Impact> => ({ valueRowsLost: 0, brokenRefs: await appendixUsages(tx, code), cascade: [] }),
          execute: async () => {
            await repo.deleteAppendix(tx, code);
            return ok(undefined);
          },
        }),
      ),

    getBox: (code) => repo.loadBox(db, code),
    listBoxes: () => repo.listBoxes(db),
    boxUsages: (code) => db.transaction((tx) => boxUsages(tx, code)),
    boxAudits: () => repo.boxAudits(db),

    createBox: (actor, input) =>
      db.transaction(async (tx) => {
        // 코드는 시스템 채번 — 검사(이름 유일 · 줄 하나 이상)를 먼저 하고 순번을 받는다 (기능/박스 §3.1)
        const r = await createBox(input, await boxNames(tx), () => repo.nextBoxSeq(tx));
        if (!r.ok) return r;
        await repo.insertBox(tx, r.value, actor.userId);
        return r;
      }),
    saveBox: (actor, code, input) =>
      db.transaction(async (tx) => {
        const x = await repo.loadBox(tx, code);
        if (!x) return notFound(`박스 ${code}`);
        const r = reviseBox(x, input, await boxNames(tx));
        if (!r.ok) return r;
        await repo.saveBox(tx, r.value, actor.userId);
        return r;
      }),
    removeBox: (actor, code, opts = {}) =>
      db.transaction(async (tx) =>
        destructive<void>({
          actor,
          action: "box.delete",
          confirm: opts.confirm,
          precheck: async () => ((await repo.loadBox(tx, code)) ? ok(undefined) : notFound(`박스 ${code}`)),
          // 참조가 남아도 지운다 — 그 참조는 깨진 참조로 저장 검증 · 조립에서 드러난다 (별표와 같은 규칙)
          computeImpact: async (): Promise<Impact> => ({ valueRowsLost: 0, brokenRefs: await boxUsages(tx, code), cascade: [] }),
          execute: async () => {
            await repo.deleteBox(tx, code);
            return ok(undefined);
          },
        }),
      ),
  };
}

/** 관·조건 블록(중첩 포함) 안의 조 제목을 등장 순으로 모은다 — 삭제 영향도 표시용. */
function collectArticleTitles(node: DocumentNode | DocumentNode["children"][number]): string[] {
  if (node.kind === "article") return [node.title];
  if (node.kind === "section" || node.kind === "document") return node.children.flatMap(collectArticleTitles);
  return node.branches.flatMap((branch) => (branch.children as DocumentNode["children"]).flatMap(collectArticleTitles));
}

/** 조건 블록(중첩 포함) 안의 조 id 를 모은다. */
function collectArticleIds(node: DocumentNode["children"][number], out: Set<Id>): void {
  if (node.kind === "article") {
    out.add(node.id);
    return;
  }
  if (node.kind === "section") {
    for (const c of node.children) collectArticleIds(c, out);
    return;
  }
  for (const br of node.branches) {
    for (const c of br.children) {
      if (c.kind === "article" || c.kind === "condBlock") collectArticleIds(c, out);
    }
  }
}
