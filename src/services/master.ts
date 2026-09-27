/**
 * 마스터 서비스 — 마스터 화면 S2 사용처 패널의 데이터원 (기능/마스터 §4.3). 읽기 전용.
 *
 * - `fieldUsage`     : 2단 역인덱스 (기능/마스터 §4.3 사용처) — 마스터 필드 → 구분자(`expression`) → 문면(`when` · `slot`).
 *                      refs 그래프 한 번 로딩으로 끝낸다. 문면 좌표는 `at` 만 주고 href 는 화면이 만든다 (`coordinateHref`).
 * - `valueNodes`     : 그 필드 레벨의 값 노드 **전부** — 미입력을 포함한다. 어디가 비었느냐가 추적에서 더 중요하다.
 *                      라벨 오름차순 · 20건 페이저 — 요청 페이지가 마지막을 넘으면 마지막 페이지로 죈다 (총수를 아는 곳이 여기라서).
 *                      href 는 값 자리로 바로 서는 화면 주소 (`?field=`).
 * - `formNodeCount`  : 폼이 서는 노드 수 — 「값 노드 N 중 M 입력」의 분모 (디자인원칙 §9.6).
 *
 * 세목 레벨은 다른 레벨과 달리 노드가 폼을 고른다 — 세목 선택지는 제 세목유형(`planTypeCode` = 폼키) 폼의 값만 갖는다
 * (`domain/product/plans`). 그래서 세목 폼의 값 노드는 그 폼키의 선택지만이다.
 *
 * 존재하지 않는 경로는 거부하지 않는다 — 빈 결과를 주고 화면이 「없는 항목」 배너를 낸다.
 */
import { nodesOf } from "@/domain/coverage/tree";
import { findMasterField, type MasterForm, type MasterPath } from "@/domain/master";
import { planOptionLabel } from "@/domain/product/plans";
import { describeKey, usagesOf, type EdgeVia, type RefGraph } from "@/domain/refs";
import type { AttachLevel, Code, Coordinate, Id, Value } from "@/domain/types";

import type { Db } from "@/db/repo/types";
import { readSlotsMany, type ValueOwnerKind } from "@/db/repo/values";

import type { CatalogService } from "./catalog";
import type { CoverageService } from "./coverage";
import type { ProductService } from "./product";
import type { RefsService } from "./refs";

// ───────────────────────────── 타입 ─────────────────────────────

export interface FieldUsageDiscriminator {
  code: Code;
  label: string;
  expression: string;
  level: AttachLevel;
  /** 이 구분자를 읽는 문면 — 조건식(`when`) · 슬롯(`slot`). 좌표만 준다. */
  documents: { at: Coordinate; via: EdgeVia; label: string }[];
  /** 이 구분자를 식에서 읽는 다른 구분자 (ADR-0037 은 금지하지만 그래프에 있으면 보인다). */
  referencedBy: { code: Code; label: string }[];
}

export interface FieldUsage {
  path: MasterPath;
  discriminators: FieldUsageDiscriminator[];
}

export interface ValueNodeRow {
  ownerKind: ValueOwnerKind;
  ownerId: Id;
  label: string;
  /** 명시 입력 값. 없으면 미입력. */
  value?: Value;
  href: string;
}

export interface ValueNodesPage {
  total: number;
  entered: number;
  notEntered: number;
  page: number;
  pageSize: 20;
  rows: ValueNodeRow[];
}

export interface MasterService {
  fieldUsage(path: MasterPath): Promise<FieldUsage>;
  valueNodes(path: MasterPath, page?: number): Promise<ValueNodesPage>;
  formNodeCount(form: MasterForm): Promise<number>;
}

export interface MasterServiceDeps {
  refs: RefsService;
  catalog: CatalogService;
  coverage: CoverageService;
  product: ProductService;
}

// ───────────────────────────── 구현 ─────────────────────────────

const PAGE_SIZE = 20;

/** 값 노드 — 소유자 + 화면 라벨 + 값 자리로 서는 href. */
interface ValueNode {
  ownerKind: ValueOwnerKind;
  ownerId: Id;
  label: string;
  href: (path: MasterPath) => string;
}

function fieldParam(path: MasterPath): string {
  return `field=${encodeURIComponent(path)}`;
}

/** 문면 → 구분자 참조 형태. 구분자 → 구분자는 `expression` 이라 따로 가른다. */
const DOCUMENT_VIA: readonly EdgeVia[] = ["when", "slot"];

export function createMasterService(db: Db, deps: MasterServiceDeps): MasterService {
  const { refs, catalog, coverage, product } = deps;

  // ───────── 값 노드 소유자 ─────────

  async function productNodes(): Promise<ValueNode[]> {
    const products = await product.listProducts();
    return products.map((p) => ({ ownerKind: "product", ownerId: p.id, label: p.name, href: (path) => `/products/${p.id}?${fieldParam(path)}` }));
  }

  /** 세목 = 모든 상품의 세목 선택지 중 **이 폼을 세목유형으로 고른 것**. 라벨 「상품명 › 제1종(…)」. */
  async function planNodes(formKey: Code): Promise<ValueNode[]> {
    const out: ValueNode[] = [];
    for (const p of await product.listProducts()) {
      for (const o of await product.listPlanOptions(p.id)) {
        if (o.planTypeCode !== formKey) continue;
        // 선택지 좌표(option)를 실어 상품 화면이 그 선택지의 값 폼에서 필드를 강조한다 (코덱스 리뷰 Important 2)
        out.push({ ownerKind: "plan", ownerId: o.id, label: `${p.name} › ${planOptionLabel(o)}`, href: (path) => `/products/${p.id}?option=${o.id}&${fieldParam(path)}` });
      }
    }
    return out;
  }

  /** 담보 트리를 펴서 그 레벨만 — 라벨 「담보명 › 세부보장명 › 급부명」. */
  async function coverageNodes(level: "coverage" | "subCoverage" | "benefit"): Promise<ValueNode[]> {
    const out: ValueNode[] = [];
    for (const tree of await coverage.list()) {
      const nodes = nodesOf(tree);
      const nameOf = new Map(nodes.map((n) => [`${n.level}:${n.id}`, n.name]));
      for (const n of nodes) {
        if (n.level !== level) continue;
        const label = [...n.ancestors.map((a) => nameOf.get(`${a.level}:${a.id}`) ?? a.id), n.name].join(" › ");
        out.push({
          ownerKind: n.level,
          ownerId: n.id,
          label,
          href: (path) => `/coverages/${tree.id}?tab=${n.level}&node=${n.level}:${n.id}&${fieldParam(path)}`,
        });
      }
    }
    return out;
  }

  /** 폼이 서는 노드 전부 — 레벨이 정하고, 세목만 폼키까지 본다. */
  function nodesOfForm(form: MasterForm): Promise<ValueNode[]> {
    switch (form.level) {
      case "product":
        return productNodes();
      case "plan":
        return planNodes(form.key);
      default:
        return coverageNodes(form.level);
    }
  }

  // ───────── 사용처 ─────────

  function documentsOf(graph: RefGraph, code: Code): FieldUsageDiscriminator["documents"] {
    return usagesOf(graph, { kind: "discriminator", code }, { via: DOCUMENT_VIA }).map((e) => ({ at: e.at, via: e.via, label: describeKey(e.from, graph) }));
  }

  async function fieldUsage(path: MasterPath): Promise<FieldUsage> {
    if (!findMasterField(path)) return { path, discriminators: [] };
    const [graph, defs] = await Promise.all([refs.graph(), catalog.list()]);
    const byCode = new Map(defs.map((d) => [d.code, d]));
    const seen = new Set<Code>();
    const discriminators: FieldUsageDiscriminator[] = [];
    for (const e of usagesOf(graph, { kind: "masterField", path }, { via: ["expression"] })) {
      if (e.from.kind !== "discriminator" || seen.has(e.from.code)) continue;
      const def = byCode.get(e.from.code);
      if (!def) continue;
      seen.add(def.code);
      const referencedBy = usagesOf(graph, { kind: "discriminator", code: def.code }, { via: ["expression"] }).flatMap((r) =>
        r.from.kind === "discriminator" ? [{ code: r.from.code, label: describeKey(r.from, graph) }] : [],
      );
      discriminators.push({ code: def.code, label: def.label, expression: def.expression, level: def.level, documents: documentsOf(graph, def.code), referencedBy });
    }
    return { path, discriminators };
  }

  // ───────── 값 노드 ─────────

  async function valueNodes(path: MasterPath, requestedPage = 1): Promise<ValueNodesPage> {
    const field = findMasterField(path);
    const empty: ValueNodesPage = { total: 0, entered: 0, notEntered: 0, page: 1, pageSize: PAGE_SIZE, rows: [] };
    if (!field) return empty;

    const nodes = (await nodesOfForm(field.form)).sort((a, b) => a.label.localeCompare(b.label, "ko"));
    if (nodes.length === 0) return empty;
    // 페이지는 1 이상 · 마지막 페이지 이하로 죈다 — 삭제로 줄어든 목록의 북마크가 빈 페이지에 서지 않게.
    const pages = Math.ceil(nodes.length / PAGE_SIZE);
    const page = Math.min(Math.max(1, Math.floor(requestedPage)), pages);

    // 값은 소유자 종류마다 한 번에 읽는다 — 한 레벨은 한 종류다.
    const kind = nodes[0].ownerKind;
    const slots = await readSlotsMany(db, kind, nodes.map((n) => n.ownerId));
    const rows: ValueNodeRow[] = nodes.map((n) => {
      const slot = slots.get(n.ownerId)?.get(path);
      const row: ValueNodeRow = { ownerKind: n.ownerKind, ownerId: n.ownerId, label: n.label, href: n.href(path) };
      if (slot?.entered) row.value = slot.value;
      return row;
    });
    const entered = rows.filter((r) => r.value !== undefined).length;
    const start = (page - 1) * PAGE_SIZE;
    return { total: rows.length, entered, notEntered: rows.length - entered, page, pageSize: PAGE_SIZE, rows: rows.slice(start, start + PAGE_SIZE) };
  }

  return {
    fieldUsage,
    valueNodes,
    formNodeCount: async (form) => (await nodesOfForm(form)).length,
  };
}
