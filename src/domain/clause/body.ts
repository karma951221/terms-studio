/**
 * 공용조항 본문 검사 · 식 수집 · 요구 구분자 추출 (순수).
 *
 * - `analyzeBody(mode, body, options)` : 허용 노드 규칙 검사 + 모든 식 파싱 + 요구 참조 추출.
 *   하나라도 어긋나면 `invalid` (저장 거부). 통과하면 `RequiredRefs`.
 * - 허용 규칙 (nodes.ts 머리말): inline 본문은 Inline 만 · block 본문은 항 자리 노드만 · item 본문은 호 목록(조건 블록 가지 안도) ·
 *   subitem 본문은 목 목록(조건 블록 가지 안도) ·
 *   조(article)·공용조항 참조(clause*Ref)·반복은 없다 · 인라인 조건 중첩 금지 · 블록 조건 중첩 허용 ·
 *   else 가지는 마지막에만 · 가지 없는 조건 불가 · 옵션 자리는 정의된 옵션만 · 노드 id 유일.
 * - 식 검사: `slot.ref` 는 참조 하나(경로)여야 하고, `when` 은 파싱한다. 참조 존재·boolean 여부는
 *   타입 조회(`resolveType`)가 있을 때만 검사한다 — 없으면 건너뛴다 (카탈로그 없이도 순수 검사가 되게).
 * - 조 참조·별표 참조 (기능/함수조항 §3.5): 공용조항의 조 참조는 셋 중 하나다 — 보통약관 마스터의 조·항·호·목(범위 없음) ·
 *   이 공용조항 본문의 항·호·목(`scope: "clause"`, 본문에 있어야) · 사용처의 위치(`scope: "host"`, 순번 경로).
 *   구조(대상 ≥1 · 연결어 · 별표 코드 · 위치 경로 모양)는 항상 검사하고, 보통약관 · 별표 대상 존재는
 *   `generalReferenceIds` · `appendixExists` 를 줬을 때만 검사한다 — 문서 쪽 `validateTree` 와 같은 관례.
 */
import { checkCondition, checkTypes, extractRefs, parse } from "../expression";
import type { Expr, TypeResolver } from "../expression";
import { CONNECTOR_REQUIRED_MESSAGE, isReferenceConnector, ok, reject } from "../types";
import type { Code, Coordinate, Id, Issue, Result } from "../types";
import { BLOCK_KINDS, HOST_PATH, INLINE_KINDS } from "./nodes";
import type { Block, BoxRefNode, BulletListNode, ClauseNode, Inline, InlineBranch, BlockBranch, ItemBodyNode, ItemNode, SubitemBodyNode } from "./nodes";
import { checkParams, type ParamDef } from "./params";
import type { ClauseBody, ClauseMode, OptionDef, RequiredRefs } from "./types";

// ───────────────────────────── 식 수집 ─────────────────────────────

export interface CollectedExpression {
  /** 식 원문. */
  source: string;
  /** 쓰임 — 슬롯 치환 또는 조건. */
  role: "slot" | "condition";
  /** 루트에서 이 식이 달린 노드(가지 포함)까지의 id 경로. */
  nodePath: Id[];
}

/**
 * 본문(유형 넷 어느 것이든)의 모든 식을 등장 순서대로. 노드 종류가 서로 달라(inlineCond · condBlock · 항 · 호 · 목 …) 유형을 몰라도 걷는다.
 * 박스는 고정 글이라 식이 없다.
 */
export function collectExpressions(body: ClauseBody, basePath: Id[] = []): CollectedExpression[] {
  const out: CollectedExpression[] = [];
  const walk = (node: ClauseNode, path: Id[]) => {
    const here = [...path, node.id];
    switch (node.kind) {
      case "slot":
        out.push({ source: node.ref, role: "slot", nodePath: here });
        return;
      case "inlineCond":
      case "condBlock":
        for (const br of node.branches as { id: Id; when?: string; children: ClauseNode[] }[]) {
          const bp = [...here, br.id];
          if (br.when !== undefined) out.push({ source: br.when, role: "condition", nodePath: bp });
          for (const c of br.children) walk(c, bp);
        }
        return;
      case "bulletList":
        // 글머리 목록은 번호가 없어 좌표에 목록 id 만 끼운다 — 항목 문장은 [..., 목록, 항목] 아래
        for (const b of node.children ?? []) for (const c of b.children ?? []) walk(c, [...here, b.id]);
        return;
      case "paragraph":
        for (const c of node.children) walk(c, here);
        for (const it of node.items ?? []) walk(it, here);
        return;
      case "item":
        for (const c of node.children) walk(c, here);
        for (const si of node.subitems ?? []) walk(si, here);
        return;
      case "subitem":
      case "bullet":
        for (const c of node.children) walk(c, here);
        return;
      default:
        return;
    }
  };
  for (const n of body as ClauseNode[]) walk(n, basePath);
  return out;
}

/** 본문의 모든 노드 id (가지 id 포함) — 등장 순. 검증을 거치지 않은 입력도 견딘다. */
export function allNodeIds(body: ClauseBody): Id[] {
  const ids: Id[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { id?: Id; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: unknown[] };
    if (typeof n.id === "string") ids.push(n.id);
    for (const key of ["children", "items", "subitems", "branches"] as const) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of body) visit(n);
  return ids;
}

/** 본문의 항 · 호 · 목 id (조건 블록 안 포함) — 등장 순. 「이 공용조항」 조 참조가 가리킬 수 있는 노드. 유형 넷 모두. */
export function structuralIds(body: ClauseBody): Id[] {
  const out: Id[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { id?: Id; kind?: string; branches?: { children?: unknown[] }[]; items?: unknown[]; subitems?: unknown[] };
    if (node.kind === "condBlock") {
      for (const br of node.branches ?? []) for (const c of br.children ?? []) visit(c);
      return;
    }
    // 글머리 목록 · 박스는 번호가 없어 가리킬 수 없다
    if (node.kind !== "paragraph" && node.kind !== "item" && node.kind !== "subitem") return;
    if (typeof node.id === "string") out.push(node.id);
    for (const c of node.items ?? []) visit(c);
    for (const c of node.subitems ?? []) visit(c);
  };
  for (const b of body ?? []) visit(b);
  return out;
}

/** inline 본문인지 (모드 판별을 호출부가 다시 하지 않게). 빈 본문은 inline 으로 본다. */
export function isInlineBody(body: ClauseBody): body is Inline[] {
  return (body as ClauseNode[]).every((node) => isInlineKind(node.kind));
}

function isBlockKind(kind: string): boolean {
  return (BLOCK_KINDS as readonly string[]).includes(kind);
}

function isInlineKind(kind: string): boolean {
  return (INLINE_KINDS as readonly string[]).includes(kind);
}

// ───────────────────────────── 검사 ─────────────────────────────

export interface AnalyzeOptions {
  /** 오류 좌표의 기본값 (공용조항 코드 등). nodePath 는 검사기가 얹는다. */
  coordinate?: Coordinate;
  /** 참조 타입 조회 — 있으면 조건식이 boolean 인지까지 검사한다. */
  resolveType?: TypeResolver;
  /** 보통약관 마스터의 조·항·호·목 id 집합 — 있으면 조 참조 대상 존재를 검사한다. */
  generalReferenceIds?: ReadonlySet<Id>;
  /** 별표 존재 조회 — 있으면 별표 참조 대상 존재를 검사한다. */
  appendixExists?: (code: Code) => boolean;
  /** 정적 마스터 박스 존재 조회 — 있으면 박스 참조 대상 존재를 검사한다. */
  boxExists?: (code: Code) => boolean;
  /** 열거형 값 조회 — 있으면 인자 기본 연결의 enum 상수를 그 열거형 값으로 검사한다. */
  enumValues?: (enumCode: Code) => readonly Code[] | undefined;
}

/** 공용조항 참조 노드 종류 — 본문 안에 나타나면 중첩이라 거부. */
const CLAUSE_REF_KINDS = new Set(["clauseInlineRef", "clauseBlockRef"]);

/**
 * 본문 + 옵션 선택지 본문을 한꺼번에 검사하고 요구 참조를 추출한다.
 * 옵션 선택지 본문은 인라인 규칙으로 검사한다 (옵션은 문구 수준 대안).
 */
export function analyzeBody(
  mode: ClauseMode,
  body: ClauseBody,
  options: readonly OptionDef[],
  opts: AnalyzeOptions = {},
  params: readonly ParamDef[] = [],
): Result<RequiredRefs> {
  const issues: Issue[] = [];
  const base = opts.coordinate ?? {};
  const optionCodes = new Set(options.map((o) => o.code));
  /** 본문의 항 · 호 · 목 id — 「이 공용조항」 조 참조의 대상 후보. 선택지 문구에는 구조가 없다. */
  const structIds = new Set(mode === "inline" ? [] : structuralIds(body));
  const exprs: { expr: Expr; role: "slot" | "condition"; path: Id[] }[] = [];

  const report = (kind: Issue["kind"], message: string, path: Id[], refPath?: string) => {
    issues.push({ kind, message, at: { ...base, nodePath: path, ...(refPath ? { refPath } : {}) } });
  };

  const kindError = (node: { id?: Id; kind?: string }, path: Id[], expected: string) => {
    const kind = String(node.kind);
    const why = CLAUSE_REF_KINDS.has(kind)
      ? "함수조항 안에 함수조항 참조를 둘 수 없습니다 (중첩 금지)"
      : kind === "article"
        ? "조(article)는 항상 사용처 소유입니다 — 함수조항 본문에 둘 수 없습니다"
        : `${expected} 자리에 올 수 없는 노드입니다: ${kind}`;
    report("typeMismatch", why, [...path, String(node.id ?? "?")]);
  };

  const checkExpr = (source: string, role: "slot" | "condition", path: Id[]) => {
    const parsed = parse(source, { ...base, nodePath: path });
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    if (role === "slot" && parsed.value.kind !== "ref") {
      report("typeMismatch", `슬롯의 참조는 경로 하나여야 합니다: ${source}`, path, source);
      return;
    }
    exprs.push({ expr: parsed.value, role, path });
  };

  const checkBranches = <B extends { id: Id; when?: string }>(branches: B[], path: Id[], each: (br: B, bp: Id[]) => void) => {
    if (!Array.isArray(branches) || branches.length === 0) {
      report("typeMismatch", "조건에는 가지가 하나 이상 있어야 합니다", path);
      return;
    }
    branches.forEach((br, i) => {
      const bp = [...path, br.id];
      const isLast = i === branches.length - 1;
      if (br.when === undefined) {
        if (!isLast) report("typeMismatch", "else 가지는 마지막에만 올 수 있습니다", bp);
      } else {
        checkExpr(br.when, "condition", bp);
      }
      each(br, bp);
    });
  };

  const checkInline = (node: Inline, path: Id[], insideCond: boolean) => {
    const here = [...path, node.id];
    if (!isInlineKind(String(node.kind))) return kindError(node, path, "인라인");
    switch (node.kind) {
      case "text":
        return;
      case "articleRef":
        if (!Array.isArray(node.targets) || node.targets.length === 0) {
          report("structure", "조 참조 슬롯에는 대상이 하나 이상 있어야 합니다", here);
          return;
        }
        if (node.connector === undefined) {
          if (node.targets.length >= 2) report("structure", CONNECTOR_REQUIRED_MESSAGE, here);
        } else if (!isReferenceConnector(node.connector)) {
          report("structure", `조 참조 연결어는 「및」·「또는」 중 하나여야 합니다: ${String(node.connector)}`, here);
        }
        if (node.scope === "clause") {
          // 제 항 · 호 · 목 — 본문(선택지 문구 아님)에 있어야 한다. 펼치면 사용처 번호로 찍힌다
          for (const { nodeId } of node.targets) {
            if (!structIds.has(nodeId)) report("brokenRef", `이 함수조항 본문에 참조 대상 ${nodeId} 가 없습니다 — 제 항 · 호 · 목만 가리킨다`, here, nodeId);
          }
          return;
        }
        if (node.scope === "host") {
          for (const { nodeId } of node.targets) {
            if (!HOST_PATH.test(nodeId)) report("structure", `사용처 위치는 「조[.항[.호[.목]]]」 순번이어야 합니다: ${nodeId}`, here, nodeId);
          }
          return;
        }
        if (node.scope !== undefined) {
          report("structure", `조 참조 범위를 알 수 없습니다: ${String(node.scope)}`, here);
          return;
        }
        if (opts.generalReferenceIds) {
          for (const { nodeId } of node.targets) {
            if (!opts.generalReferenceIds.has(nodeId)) {
              report("brokenRef", `보통약관 참조 대상 ${nodeId} 가 보통약관 마스터에 없습니다`, here, nodeId);
            }
          }
        }
        return;
      case "appendixRef":
        if (typeof node.appendixCode !== "string" || node.appendixCode.length === 0) {
          report("structure", "별표 참조 슬롯에는 별표 코드가 있어야 합니다", here);
          return;
        }
        if (opts.appendixExists && !opts.appendixExists(node.appendixCode)) {
          report("brokenRef", `별표 ${node.appendixCode} 가 별표 마스터에 없습니다`, here, node.appendixCode);
        }
        return;
      case "slot":
        return checkExpr(node.ref, "slot", here);
      case "optionSlot":
        if (!optionCodes.has(node.optionCode)) {
          report("brokenRef", `정의되지 않은 옵션입니다: ${node.optionCode}`, here, node.optionCode);
        }
        return;
      case "inlineCond":
        if (insideCond) {
          report("typeMismatch", "인라인 조건 안에 인라인 조건을 둘 수 없습니다 (중첩 금지)", here);
          return;
        }
        checkBranches(node.branches, here, (br, bp) => {
          for (const c of (br as InlineBranch).children ?? []) checkInline(c, bp, true);
        });
        return;
    }
  };

  const checkInlines = (list: Inline[], path: Id[]) => {
    for (const c of list ?? []) checkInline(c, path, false);
  };

  /** 글머리 목록 — 항목(한 줄 문장)이 하나 이상. 목록 안 조건 블록은 없다. */
  const checkBullets = (node: BulletListNode, path: Id[]) => {
    const here = [...path, node.id];
    if (!Array.isArray(node.children) || node.children.length === 0) report("structure", "글머리 목록에는 항목이 하나 이상 있어야 합니다", here);
    for (const b of node.children ?? []) {
      if (b?.kind !== "bullet") {
        kindError(b ?? {}, here, "글머리 항목");
        continue;
      }
      checkInlines(b.children, [...here, b.id]);
    }
  };

  /** 박스 참조 — 코드가 있어야 하고, 조회를 줬으면 박스가 있어야 한다. */
  const checkBoxRef = (node: BoxRefNode, path: Id[]) => {
    const here = [...path, node.id];
    if (typeof node.boxCode !== "string" || node.boxCode.length === 0) return report("structure", "박스 참조에는 박스 코드가 있어야 합니다", here);
    if (opts.boxExists && !opts.boxExists(node.boxCode)) report("brokenRef", `박스 ${node.boxCode} 가 정적 마스터에 없습니다`, here, node.boxCode);
  };

  /** 목 목록 — 목(과 목 유형 본문이면 조건 블록 — 가지 안도 목 목록). */
  const checkSubitemList = (list: readonly SubitemBodyNode[], path: Id[], allowCond: boolean) => {
    for (const si of list ?? []) {
      if (si?.kind === "condBlock" && allowCond) {
        const here = [...path, si.id];
        checkBranches(si.branches, here, (br, bp) => checkSubitemList(br.children ?? [], bp, true));
        continue;
      }
      if (si?.kind !== "subitem") {
        kindError(si ?? {}, path, "목");
        continue;
      }
      checkInlines(si.children, [...path, si.id]);
    }
  };

  const checkItem = (it: ItemNode, path: Id[]) => {
    const ip = [...path, it.id];
    checkInlines(it.children, ip);
    checkSubitemList(it.subitems ?? [], ip, false);
  };

  /** 호 목록 — 호 · 글머리 목록 · 박스 참조(와 호 유형 본문이면 조건 블록 — 가지 안도 호 목록). 항의 호 목록에는 조건 블록이 없다. */
  const checkItemList = (list: readonly ItemBodyNode[], path: Id[], allowCond: boolean) => {
    for (const it of list ?? []) {
      if (it?.kind === "boxRef") {
        checkBoxRef(it, path);
        continue;
      }
      if (it?.kind === "bulletList") {
        checkBullets(it, path);
        continue;
      }
      if (it?.kind === "condBlock" && allowCond) {
        checkBranches(it.branches, [...path, it.id], (br, bp) => checkItemList(br.children ?? [], bp, true));
        continue;
      }
      if (it?.kind !== "item") {
        kindError(it ?? {}, path, "호");
        continue;
      }
      checkItem(it, path);
    }
  };

  const checkBlock = (node: Block, path: Id[]) => {
    const here = [...path, node.id];
    if (!isBlockKind(String(node.kind))) return kindError(node, path, "블록(항)");
    if (node.kind === "boxRef") return checkBoxRef(node, path);
    if (node.kind === "bulletList") return checkBullets(node, path);
    if (node.kind === "paragraph") {
      checkInlines(node.children, here);
      checkItemList(node.items ?? [], here, false);
      return;
    }
    checkBranches(node.branches, here, (br, bp) => {
      for (const c of (br as BlockBranch).children ?? []) checkBlock(c, bp);
    });
  };

  // 1. 본문 — 유형(출력 모양)마다 그 목록 규칙
  switch (mode) {
    case "inline":
      checkInlines(body as Inline[], []);
      break;
    case "block":
      for (const b of body as Block[]) checkBlock(b, []);
      break;
    case "item":
      checkItemList(body as ItemBodyNode[], [], true);
      break;
    case "subitem":
      checkSubitemList(body as SubitemBodyNode[], [], true);
      break;
  }

  // 2. 옵션 선택지 본문 — 인라인 규칙
  for (const o of options) {
    for (const v of o.values) checkInlines(v.body, [o.code, v.code]);
  }

  // 3. 노드 id 유일성 (본문 + 선택지 본문)
  const seen = new Set<Id>();
  const ids = [...allNodeIds(body), ...options.flatMap((o) => o.values.flatMap((v) => allNodeIds(v.body)))];
  for (const id of ids) {
    if (seen.has(id)) report("typeMismatch", `노드 id 가 중복됩니다: ${id}`, [id]);
    seen.add(id);
  }

  // 4. 인자 (최종 결정 2) — 인자 표(이름 · 타입 · 기본 연결) + 본문이 읽는 인자는 선언돼 있어야 한다(타입 조회가 없어도)
  const resolveType = opts.resolveType;
  issues.push(
    ...checkParams(params, { ...(resolveType ? { discriminatorType: (code: Code) => resolveType({ kind: "discriminator", code }) } : {}), ...(opts.enumValues ? { enumValues: opts.enumValues } : {}) }, base),
  );
  const declared = new Map(params.map((p) => [p.name, p.type] as const));
  const paramTypes = (name: string) => declared.get(name);
  let direct = false;
  for (const e of exprs) {
    for (const { ref, path } of extractRefs(e.expr)) {
      if (ref.kind === "param" && !resolveType && !declared.has(ref.name)) report("brokenRef", `선언되지 않은 인자입니다: ${path} — 함수조항의 인자 표에 먼저 선언한다`, e.path, path);
      // 함수조항은 구분자를 직접 읽지 않고 인자만 읽는다 (최종 결정 2) — 인자를 선언하고 기본 연결로 그 구분자를 댄다
      if (ref.kind === "discriminator") {
        direct = true;
        report("typeMismatch", `함수조항은 구분자 ${path} 를 직접 읽을 수 없습니다 — 인자를 선언하고 기본 연결로 ${ref.code} 를 댄 뒤 arg.<이름> 으로 읽는다`, e.path, path);
      }
    }
  }

  // 5. 참조 존재·타입 (조회가 있을 때만 — 구분자 직접 읽기가 있으면 그 오류가 먼저다) — 조건은 boolean 이어야, 슬롯은 참조가 존재해야 한다. 인자는 선언 타입으로(문맥 플래그)
  if (resolveType && !direct) {
    for (const e of exprs) {
      const at = { ...base, nodePath: e.path };
      const r = e.role === "condition" ? checkCondition(e.expr, resolveType, at, paramTypes) : checkTypes(e.expr, resolveType, { coordinate: at, params: paramTypes });
      if (!r.ok && r.rejection.reason === "invalid") issues.push(...r.rejection.issues);
      else if (e.role === "slot" && r.ok && r.value.kind !== "string" && r.value.kind !== "enum") {
        report("typeMismatch", `값 슬롯은 string·enum 만 허용합니다 (${r.value.kind} 불가)`, e.path, e.expr.kind === "ref" ? undefined : "");
      }
    }
  }

  if (issues.length > 0) return reject({ reason: "invalid", issues });

  // 6. 요구 참조 — 구분자는 본문이 읽는 인자의 기본 연결(처음 읽는 순) · 담보속성은 본문이 직접 읽는 것.
  //    읽지 않는 인자의 기본 연결은 정의 쪽 검사(definitionDiscriminators · 인자 표 검사)가 따로 본다
  const discriminators: Code[] = [];
  const attributes: Code[] = [];
  const defaultOf = new Map(params.flatMap((p) => (p.default?.kind === "discriminator" ? [[p.name, p.default.code] as const] : [])));
  for (const e of exprs) {
    for (const { ref } of extractRefs(e.expr)) {
      const code = ref.kind === "param" ? defaultOf.get(ref.name) : undefined;
      if (code !== undefined && !discriminators.includes(code)) discriminators.push(code);
      if (ref.kind === "attr" && !attributes.includes(ref.code)) attributes.push(ref.code);
    }
  }
  return ok({ discriminators, attributes });
}
