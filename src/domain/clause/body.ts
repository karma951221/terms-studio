/**
 * 함수조항 본문 검사 · 식 수집 · 요구 구분자 추출 (순수).
 *
 * - `analyzeBody(mode, body, options)` : 허용 노드 규칙 검사 + 모든 식 파싱 + 요구 참조 추출.
 *   하나라도 어긋나면 `invalid` (저장 거부). 통과하면 `RequiredRefs`.
 * - 허용 규칙 (nodes.ts 머리말): inline 본문은 Inline 만 · block 본문은 항 자리 노드만 · item 본문은 호 목록(조건 블록 가지 안도) ·
 *   subitem 본문은 목 목록(조건 블록 가지 안도) ·
 *   조(article)·함수조항 참조(clause*Ref)·반복은 없다 · 인라인 조건 중첩 금지 · 블록 조건 중첩 허용 ·
 *   else 가지는 마지막에만 · 가지 없는 조건 불가 · 옵션 자리는 정의된 옵션만 · 노드 id 유일.
 * - 식 검사: `slot.ref` 는 참조 하나(경로)여야 하고, `when` 은 파싱한다. 참조 존재·boolean 여부는
 *   타입 조회(`resolveType`)가 있을 때만 검사한다 — 없으면 건너뛴다 (카탈로그 없이도 순수 검사가 되게).
 * - 조 참조·별표 참조 (기능/함수조항 §3.5): 함수조항의 조 참조는 셋 중 하나다 — 보통약관 마스터의 조·항·호·목(범위 없음) ·
 *   이 함수조항 본문의 항·호·목(`scope: "clause"`, 본문에 있어야) · 사용처의 위치(`scope: "host"`, 순번 경로).
 *   구조(대상 ≥1 · 연결어 · 별표 코드 · 위치 경로 모양)는 항상 검사하고, 보통약관 · 별표 대상 존재는
 *   `generalReferenceKeys` · `appendixExists` 를 줬을 때만 검사한다 — 문서 쪽 `validateTree` 와 같은 관례.
 */
import { checkTypes, extractRefs, parse } from "../expression";
import type { EnumInfo, Expr, ExprType, Ref, TypeResolver } from "../expression";
import { CONNECTOR_REPEAT_MESSAGE, CONNECTOR_REQUIRED_MESSAGE, isReferenceConnector, ok, reject } from "../types";
import type { Code, Coordinate, Id, Issue, Result } from "../types";
import { BLOCK_KINDS, HOST_PATH, INLINE_KINDS } from "./nodes";
import type { AnySwitchNode, Block, BoxRefNode, BulletListNode, ClauseNode, Inline, InlineBranch, BlockBranch, ItemBodyNode, ItemNode, SubitemBodyNode, SwitchCase } from "./nodes";
import { checkLocals, planFieldType, type LocalDef } from "./locals";
import { checkParams, type ParamDef } from "./params";
import { clauseCodeEntries, clauseCodeIssues } from "./pcode";
import { multiTarget, refKey } from "../document/pcode";
import type { ClauseBody, ClauseMode, OptionDef, RequiredRefs } from "./types";

// ───────────────────────────── 식 수집 ─────────────────────────────

export interface CollectedExpression {
  /** 식 원문. */
  source: string;
  /** 쓰임 — 슬롯 치환 · 조건 · 값별 분기의 대상. */
  role: "slot" | "condition" | "switch";
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
      case "inlineSwitch":
      case "switchBlock":
        out.push({ source: node.on, role: "switch", nodePath: here });
        for (const k of node.cases as { id: Id; children: ClauseNode[] }[]) for (const c of k.children ?? []) walk(c, [...here, k.id]);
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
    const n = node as { id?: Id; children?: unknown[]; items?: unknown[]; subitems?: unknown[]; branches?: unknown[]; cases?: unknown[] };
    if (typeof n.id === "string") ids.push(n.id);
    for (const key of ["children", "items", "subitems", "branches", "cases"] as const) {
      const list = n[key];
      if (Array.isArray(list)) for (const c of list) visit(c);
    }
  };
  for (const n of body) visit(n);
  return ids;
}

/** 본문의 항 · 호 · 목 id (조건 블록 안 포함) — 등장 순. 「이 함수조항」 조 참조가 가리킬 수 있는 노드. 유형 넷 모두. */
export function structuralIds(body: ClauseBody): Id[] {
  const out: Id[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { id?: Id; kind?: string; branches?: { children?: unknown[] }[]; cases?: { children?: unknown[] }[]; items?: unknown[]; subitems?: unknown[] };
    if (node.kind === "condBlock") {
      for (const br of node.branches ?? []) for (const c of br.children ?? []) visit(c);
      return;
    }
    if (node.kind === "switchBlock") {
      for (const k of node.cases ?? []) for (const c of k.children ?? []) visit(c);
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
  /** 오류 좌표의 기본값 (함수조항 코드 등). nodePath 는 검사기가 얹는다. */
  coordinate?: Coordinate;
  /** 참조 타입 조회 — 있으면 조건식이 boolean 인지까지 검사한다. */
  resolveType?: TypeResolver;
  /** 보통약관 마스터의 참조 대상 열쇠(조 id · 조#코드, `refKey`) — 있으면 조 참조 대상 존재를 검사한다. */
  generalReferenceKeys?: ReadonlySet<string>;
  /** 보통약관의 반복 블록 안 대상 열쇠 — 대상이 하나여도 연결어가 필요하다(결정 14 확장 · ADR-0077 결정 7). */
  generalRepeatedKeys?: ReadonlySet<string>;
  /** 별표 존재 조회 — 있으면 별표 참조 대상 존재를 검사한다. */
  appendixExists?: (code: Code) => boolean;
  /** 정적 마스터 박스 존재 조회 — 있으면 박스 참조 대상 존재를 검사한다. */
  boxExists?: (code: Code) => boolean;
  /** 열거형 값 조회 — 있으면 인자 기본 연결의 enum 상수를 그 열거형 값으로 검사한다. */
  enumValues?: (enumCode: Code) => readonly Code[] | undefined;
  /** 열거형 모양(값 · 유저 정의 필드) — 있으면 필드 읽기 · 있음 · 거르기를 검사한다(타입 조회와 함께). */
  enums?: EnumInfo;
}

/** 함수조항 참조 노드 종류 — 본문 안에 나타나면 중첩이라 거부. */
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
  locals: readonly LocalDef[] = [],
): Result<RequiredRefs> {
  const issues: Issue[] = [];
  const base = opts.coordinate ?? {};
  const optionCodes = new Set(options.map((o) => o.code));
  /** 본문의 항 · 호 · 목 코드 — 「이 함수조항」 조 참조의 대상 후보. 선택지 문구에는 구조가 없다. 코드 없는 자리는 저장 때 채워진다. */
  const structCodes = new Set(mode === "inline" ? [] : clauseCodeEntries(body).entries.flatMap((e) => (e.code !== undefined ? [e.code] : [])));
  const exprs: { expr: Expr; role: "slot" | "condition" | "switch"; path: Id[] }[] = [];
  /** 값별 분기 — 대상 참조(인자 · 내부 변수)가 읽혔으면 타입 · 값 배정 검사를 뒤(인자 · 내부 변수 표 뒤)에서 한다. */
  const switches: { node: AnySwitchNode; ref: Ref & { kind: "param" | "local" }; path: Id[]; expr: (typeof exprs)[number] }[] = [];

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

  const checkExpr = (source: string, role: "slot" | "condition" | "switch", path: Id[]) => {
    const parsed = parse(source, { ...base, nodePath: path });
    if (!parsed.ok) {
      if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      return;
    }
    // 슬롯 = 참조 하나, 또는 열거값 필드 읽기(`arg.사유.F01` — 함수조항 전용)
    if (role === "slot" && parsed.value.kind !== "ref" && parsed.value.kind !== "member") {
      report("typeMismatch", `슬롯의 참조는 경로 하나여야 합니다: ${source}`, path, source);
      return;
    }
    exprs.push({ expr: parsed.value, role, path });
  };

  /**
   * 값별 분기의 모양 (최종 결정 5) — 칸이 하나 이상 · 대상은 인자 · 내부 변수 하나 · 칸마다 값 하나 이상 ·
   * 「문구 없음」 칸은 본문 없음, 아닌 칸은 본문 있음(빈 칸을 말없이 두지 않는다). 칸 본문은 서 있는 자리의 규칙(`each`)으로.
   */
  const checkSwitch = <C>(node: { id: Id; on?: unknown; cases?: SwitchCase<C>[] }, path: Id[], each: (children: C[], cp: Id[]) => void) => {
    const here = [...path, node.id];
    if (typeof node.on !== "string" || node.on.trim() === "") report("structure", "값별 분기에는 대상(인자 · 내부 변수)이 있어야 합니다", here);
    else {
      const parsed = parse(node.on, { ...base, nodePath: here });
      if (!parsed.ok) {
        if (parsed.rejection.reason === "invalid") issues.push(...parsed.rejection.issues);
      } else if (parsed.value.kind !== "ref" || (parsed.value.ref.kind !== "param" && parsed.value.ref.kind !== "local")) {
        report("typeMismatch", `값별 분기의 대상은 인자 · 내부 변수 하나여야 합니다: ${node.on}`, here, node.on);
      } else {
        const expr = { expr: parsed.value, role: "switch" as const, path: here };
        exprs.push(expr);
        switches.push({ node: node as unknown as AnySwitchNode, ref: parsed.value.ref as Ref & { kind: "param" | "local" }, path: here, expr });
      }
    }
    if (!Array.isArray(node.cases) || node.cases.length === 0) {
      report("structure", "값별 분기에는 칸이 하나 이상 있어야 합니다", here);
      return;
    }
    for (const k of node.cases) {
      const cp = [...here, String(k?.id ?? "?")];
      const children = Array.isArray(k?.children) ? k.children : [];
      if (k?.empty && children.length > 0) report("structure", "「문구 없음」 칸은 본문을 가질 수 없습니다 — 본문을 지우거나 「문구 없음」을 끈다", cp);
      if (!k?.empty && children.length === 0) report("structure", "칸이 비었습니다 — 본문을 쓰거나 「문구 없음」으로 둡니다", cp);
      if (!Array.isArray(k?.values) || k.values.length === 0) report("structure", "값이 없는 칸입니다 — 값을 하나 이상 고른다", cp);
      each(children, cp);
    }
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
          // 제 항 · 호 · 목 — 본문(선택지 문구 아님)의 P코드 `{ code }`. 조건 가지 · 칸의 같은 자리는 코드를 공유한다(ADR-0072 결정 4). 펼치면 사용처 번호로 찍힌다
          for (const t of node.targets) {
            if (typeof t?.code !== "string" || t.articleId !== undefined || t.host !== undefined) report("structure", "「이 함수조항」 참조 대상은 제 항 · 호 · 목의 코드 하나여야 합니다", here);
            else if (!structCodes.has(t.code)) report("brokenRef", `이 함수조항 본문에 참조 대상 ${t.code} 가 없습니다 — 제 항 · 호 · 목만 가리킨다`, here, t.code);
          }
          return;
        }
        if (node.scope === "host") {
          for (const t of node.targets) {
            if (typeof t?.host !== "string" || !HOST_PATH.test(t.host)) report("structure", `사용처 위치는 「조[.항[.호[.목]]]」 순번이어야 합니다: ${String(t?.host)}`, here, t?.host);
          }
          return;
        }
        if (node.scope !== undefined) {
          report("structure", `조 참조 범위를 알 수 없습니다: ${String(node.scope)}`, here);
          return;
        }
        let repeated = false;
        for (const t of node.targets) {
          if (typeof t?.articleId !== "string" || t.host !== undefined) {
            report("structure", "보통약관 참조 대상은 조(와 항 · 호 · 목의 코드)여야 합니다", here);
            continue;
          }
          const key = refKey({ articleId: t.articleId, ...(t.code !== undefined ? { code: t.code } : {}) });
          if (opts.generalReferenceKeys && !opts.generalReferenceKeys.has(key)) report("brokenRef", `보통약관 참조 대상 ${key} 가 보통약관 마스터에 없습니다`, here, key);
          if (multiTarget(t as { articleId: string; code?: string; innerCode?: string; restrict?: unknown }, opts.generalRepeatedKeys)) repeated = true;
          if (t.innerCode !== undefined && (typeof t.innerCode !== "string" || t.code === undefined)) report("structure", "안쪽 코드는 보통약관의 함수조항 블록 참조(코드)와 함께 쓴다", here, key);
          const restrict = t.restrict as { values?: unknown; current?: unknown } | undefined;
          if (restrict !== undefined) {
            if (restrict.current !== undefined) report("structure", "함수조항 본문에는 반복이 없어 값 한정 「현재 값」을 쓸 수 없습니다 — 해당 값들로 고른다", here, key);
            else if (!Array.isArray(restrict.values) || restrict.values.length === 0) report("structure", "값 한정의 값을 하나 이상 고른다", here, key);
            else if (opts.generalRepeatedKeys && !opts.generalRepeatedKeys.has(key)) report("structure", "값 한정은 반복으로 생긴 노드에만 건다 — 이 보통약관 대상은 반복 안이 아닙니다", here, key);
          }
        }
        if (repeated && node.connector === undefined && node.targets.length < 2) report("structure", CONNECTOR_REPEAT_MESSAGE, here);
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
      case "inlineSwitch":
        // 문장 안 분기는 문장 안 조건과 같은 제약 — 서로 안에 두지 못한다 (최종 결정 5)
        if (insideCond) {
          report("typeMismatch", "문장 안 조건 · 분기 안에 문장 안 분기를 둘 수 없습니다 (중첩 금지)", here);
          return;
        }
        checkSwitch(node, path, (children, cp) => {
          for (const c of children) checkInline(c, cp, true);
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
      if (si?.kind === "switchBlock" && allowCond) {
        checkSwitch(si, path, (children, cp) => checkSubitemList(children, cp, true));
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
      if (it?.kind === "switchBlock" && allowCond) {
        checkSwitch(it, path, (children, cp) => checkItemList(children, cp, true));
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
    if (node.kind === "switchBlock") {
      checkSwitch(node, path, (children, cp) => {
        for (const c of children) checkBlock(c, cp);
      });
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

  // 3b. P코드 — 형식 · 공존 중복 (ADR-0072 결정 4 — 조건 가지 · switch 칸의 같은 자리만 같은 코드). 코드 없는 자리는 저장 때 채운다
  if (mode !== "inline") for (const { path, message } of clauseCodeIssues(body)) report("structure", message, path);

  // 4. 인자 (최종 결정 2) — 인자 표(이름 · 타입 · 기본 연결) + 본문이 읽는 인자는 선언돼 있어야 한다(타입 조회가 없어도)
  const resolveType = opts.resolveType;
  issues.push(
    ...checkParams(params, { ...(resolveType ? { discriminatorType: (code: Code) => resolveType({ kind: "discriminator", code }) } : {}), ...(opts.enumValues ? { enumValues: opts.enumValues } : {}) }, base),
  );
  const declared = new Map(params.map((p) => [p.name, p.type] as const));
  const paramTypes = (name: string) => declared.get(name);
  // 4b. 내부 변수 표 (최종 결정 2) — 이름 · 앞 이름만 · 직접 읽기 금지 · 타입(개수 연산 없음)
  const lc = checkLocals(locals, params, { coordinate: base, ...(resolveType ? { resolveType } : {}), ...(opts.enums ? { enums: opts.enums } : {}) });
  issues.push(...lc.issues);
  const localNames = new Set(locals.map((l) => l.name));
  let direct = false;
  /** 오류 난 내부 변수를 읽는 식 — 타입 검사를 건너뛴다(연쇄 오류 방지). */
  const tainted = new Set<(typeof exprs)[number]>();
  for (const e of exprs) {
    for (const { ref, path } of extractRefs(e.expr)) {
      if (ref.kind === "param" && !resolveType && !declared.has(ref.name)) report("brokenRef", `선언되지 않은 인자입니다: ${path} — 함수조항의 인자 표에 먼저 선언한다`, e.path, path);
      if (ref.kind === "local" && !resolveType && !localNames.has(ref.name)) report("brokenRef", `선언되지 않은 내부 변수입니다: ${path} — 내부 변수 표에 먼저 선언한다`, e.path, path);
      if (ref.kind === "local" && lc.failed.has(ref.name)) tainted.add(e);
      // 함수조항은 구분자를 직접 읽지 않고 인자만 읽는다 (최종 결정 2) — 인자를 선언하고 기본 연결로 그 구분자를 댄다
      if (ref.kind === "discriminator") {
        direct = true;
        report("typeMismatch", `함수조항은 구분자 ${path} 를 직접 읽을 수 없습니다 — 인자를 선언하고 기본 연결로 ${ref.code} 를 댄 뒤 arg.<이름> 으로 읽는다`, e.path, path);
      }
    }
  }

  // 5. 참조 존재·타입 (조회가 있을 때만 — 구분자 직접 읽기가 있으면 그 오류가 먼저다) — 조건은 boolean 이어야, 슬롯은 참조가 존재해야 한다. 인자는 선언 타입으로(문맥 플래그)
  if (resolveType && !direct) {
    const clauseCtx = { params: paramTypes, locals: (n: string) => lc.types.get(n), ...(opts.enums ? { enums: opts.enums } : {}), planField: planFieldType() };
    for (const e of exprs) {
      if (tainted.has(e)) continue;
      const at = { ...base, nodePath: e.path };
      const r = checkTypes(e.expr, resolveType, { coordinate: at, ...clauseCtx, ...(e.role === "condition" ? { expect: "boolean" as const } : {}) });
      if (!r.ok && r.rejection.reason === "invalid") {
        issues.push(...r.rejection.issues);
        if (e.role === "switch") tainted.add(e);
      } else if (e.role === "slot" && r.ok && r.value.kind !== "string" && r.value.kind !== "enum") {
        report("typeMismatch", `값 슬롯은 string·enum 만 허용합니다 (${r.value.kind} 불가)`, e.path, e.expr.kind === "ref" ? undefined : "");
      }
    }
  }

  // 5b. 값별 분기 — 대상 타입(목록값 하나) · 값마다 정확히 한 칸 · 지운 값(「없는 값」). 대상 타입을 모르면 건너뛴다(선언 없음은 위가 잡는다)
  const typeOf = (ref: Ref & { kind: "param" | "local" }) => (ref.kind === "param" ? declared.get(ref.name) : lc.failed.has(ref.name) ? undefined : lc.types.get(ref.name));
  for (const s of switches) {
    if (tainted.has(s.expr)) continue;
    const t = typeOf(s.ref) as ExprType | undefined;
    if (!t) continue;
    const where = s.ref.kind === "param" ? `arg.${s.ref.name}` : `var.${s.ref.name}`;
    if (t.kind === "list<enum>") {
      report("typeMismatch", `목록값(복수)은 값별 분기의 대상이 될 수 없습니다: ${where} — 목록은 내부 변수(있음 · 거르기) + 조건으로 나눈다`, s.path, where);
      continue;
    }
    if (t.kind !== "enum") {
      report("typeMismatch", `값별 분기의 대상은 목록값(enum)이어야 합니다: ${where} (${t.kind})`, s.path, where);
      continue;
    }
    const values = enumValuesOf(opts, t.enumCode);
    if (!values) continue;
    for (const issue of switchValueIssues(s.node, values, t.enumCode, { ...base, nodePath: s.path })) issues.push(issue);
  }

  if (issues.length > 0) return reject({ reason: "invalid", issues });

  // 6. 요구 참조 — 구분자는 본문이 읽는 인자의 기본 연결(처음 읽는 순) · 담보속성은 본문이 직접 읽는 것.
  //    읽지 않는 인자의 기본 연결은 정의 쪽 검사(definitionDiscriminators · 인자 표 검사)가 따로 본다
  const discriminators: Code[] = [];
  const attributes: Code[] = [];
  const defaultOf = new Map(params.flatMap((p) => (p.default?.kind === "discriminator" ? [[p.name, p.default.code] as const] : [])));
  const localExprs = locals.flatMap((l) => {
    const p = typeof l.expr === "string" ? parse(l.expr) : undefined;
    return p?.ok ? [p.value] : [];
  });
  for (const expr of [...exprs.map((e) => e.expr), ...localExprs]) {
    for (const { ref } of extractRefs(expr)) {
      const code = ref.kind === "param" ? defaultOf.get(ref.name) : undefined;
      if (code !== undefined && !discriminators.includes(code)) discriminators.push(code);
      if (ref.kind === "attr" && !attributes.includes(ref.code)) attributes.push(ref.code);
    }
  }
  return ok({ discriminators, attributes });
}

// ───────────────────────────── 값별 분기 (최종 결정 5) ─────────────────────────────

function enumValuesOf(opts: Pick<AnalyzeOptions, "enums" | "enumValues">, enumCode: Code): readonly Code[] | undefined {
  return opts.enums?.(enumCode)?.values ?? opts.enumValues?.(enumCode);
}

/**
 * 값별 분기의 값 배정 — 값마다 정확히 한 칸 (최종 결정 5).
 * - 두 칸에 같은 값 = structure(좌표 = 뒤 칸 · refPath 값) · 열거형에 없는 값(지운 값) = 「없는 값」 brokenRef(좌표 = 그 칸) ·
 *   칸이 없는 값 = `unassignedValue`(좌표 = 분기 · refPath 값, 값마다 하나).
 * 함수조항 저장(검사 ①)이 쓴다 — 열거값 추가로 생긴 미배정은 저장을 막지 않고 재검사 목록으로 드러난다(열거형 저장은 함수조항을 다시 검사하지 않는다).
 */
export function switchValueIssues(node: { cases: readonly { id: Id; values: readonly Code[] }[] }, values: readonly Code[], enumCode: Code, at: Coordinate): Issue[] {
  const out: Issue[] = [];
  const known = new Set(values);
  const seen = new Map<Code, Id>();
  const path = at.nodePath ?? [];
  for (const k of node.cases) {
    const cp: Coordinate = { ...at, nodePath: [...path, k.id] };
    for (const v of k.values ?? []) {
      if (!known.has(v)) {
        out.push({ kind: "brokenRef", message: `없는 값 ${v} — ${enumCode}에서 지워진 값입니다. 칸에서 빼거나 다른 값으로 바꾼다`, at: { ...cp, refPath: v } });
        continue;
      }
      if (seen.has(v)) {
        out.push({ kind: "structure", message: `값 ${v} 이(가) 두 칸에 있습니다 — 값마다 칸 하나`, at: { ...cp, refPath: v } });
        continue;
      }
      seen.set(v, k.id);
    }
  }
  for (const v of values) {
    if (!seen.has(v)) out.push({ kind: "unassignedValue", message: `값별 분기에 칸이 없는 값: ${v} — 칸에 배정하거나 「문구 없음」 칸에 넣는다`, at: { ...at, refPath: v } });
  }
  return out;
}

/** 값별 분기 대상의 열거형 코드 — 인자 선언 타입 · 내부 변수 타입으로. 목록값 하나가 아니면 undefined. */
export function switchEnumCode(on: string, params: readonly ParamDef[], localTypes: (name: string) => ExprType | undefined): Code | undefined {
  const parsed = parse(on);
  if (!parsed.ok || parsed.value.kind !== "ref") return undefined;
  const ref = parsed.value.ref;
  const t = ref.kind === "param" ? params.find((p) => p.name === ref.name)?.type : ref.kind === "local" ? localTypes(ref.name) : undefined;
  return t?.kind === "enum" ? t.enumCode : undefined;
}

/**
 * 값별 분기 칸 머리의 값 이름 — 대상(`arg.X` · `var.X`)의 열거형에서 찾는다. 값 코드(V01)는 열거형마다 겹치므로
 * 대상의 열거형을 먼저 안다. 대상 타입 · 값을 모르면 undefined — 호출부가 코드로 적는다 (사용처 상자, 최종 결정 8).
 * 내부 변수 타입은 인자 선언만으로 매긴다(담보속성 · 세목 필드를 읽는 내부 변수는 모름).
 */
export function switchValueLabeler(
  clause: { params?: readonly ParamDef[]; locals?: readonly LocalDef[] },
  enums: readonly { code: Code; values: readonly { code: Code; label: string }[]; fields?: readonly { key: Code; type: "string" | "boolean" }[] }[],
): (on: string, value: Code) => string | undefined {
  const params = clause.params ?? [];
  const byCode = new Map(enums.map((e) => [e.code, e] as const));
  const enumInfo: EnumInfo = (code) => {
    const def = byCode.get(code);
    return def ? { values: def.values.map((v) => v.code), fields: def.fields ?? [] } : undefined;
  };
  const lc = checkLocals(clause.locals ?? [], params, { resolveType: () => undefined, enums: enumInfo });
  return (on, value) => {
    const code = switchEnumCode(on, params, (name) => (lc.failed.has(name) ? undefined : lc.types.get(name)));
    return code ? byCode.get(code)?.values.find((v) => v.code === value)?.label : undefined;
  };
}

/**
 * 칸 순서 = 열거형 순서 — 저장할 때 맞춘다(첫 값 기준, 칸 안 값도 열거형 순서). 대상 타입 · 열거형을 모르면 그대로.
 * 본문 모양(유형)을 몰라도 걷는다 — 칸 안의 분기도 맞춘다.
 */
export function orderSwitchCases(body: ClauseBody, params: readonly ParamDef[], locals: readonly LocalDef[], opts: AnalyzeOptions = {}): ClauseBody {
  const lc = checkLocals(locals, params, { ...(opts.resolveType ? { resolveType: opts.resolveType } : {}), ...(opts.enums ? { enums: opts.enums } : {}) });
  const rank = (order: readonly Code[]) => (v: Code | undefined) => {
    const i = v === undefined ? -1 : order.indexOf(v);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  type Loose = { kind?: string; on?: string; cases?: { values: Code[]; children: unknown[] }[]; [key: string]: unknown };
  const visit = (n: unknown): unknown => {
    if (!n || typeof n !== "object") return n;
    let node = n as Loose;
    for (const key of ["children", "items", "subitems", "branches"] as const) {
      const list = node[key];
      if (Array.isArray(list)) node = { ...node, [key]: list.map(visit) };
    }
    if ((node.kind === "switchBlock" || node.kind === "inlineSwitch") && Array.isArray(node.cases)) {
      const code = typeof node.on === "string" ? switchEnumCode(node.on, params, (name) => (lc.failed.has(name) ? undefined : lc.types.get(name))) : undefined;
      const order = code ? enumValuesOf(opts, code) : undefined;
      const cases = node.cases.map((k) => ({ ...k, children: Array.isArray(k.children) ? k.children.map(visit) : k.children }));
      if (order) {
        const r = rank(order);
        for (const k of cases) if (Array.isArray(k.values)) k.values = [...k.values].sort((a, b) => r(a) - r(b));
        cases.sort((a, b) => r(a.values?.[0]) - r(b.values?.[0]));
      }
      node = { ...node, cases };
    }
    return node;
  };
  return (body as unknown[]).map(visit) as ClauseBody;
}
