/**
 * 함수조항 에디터 · 저장 액션이 같이 쓰는 순수 함수 (`lib.test.ts`).
 *
 * - 선택지 문구는 평문만 받는다(기능/함수조항 §6.2) — 화면은 글 한 줄, 저장은 텍스트 노드 하나.
 * - 새 옵션은 저장 전까지 `new:*` 코드라, 본문의 옵션 자리를 저장 때 실제 코드로 바꾼다.
 */
import { isInlineBody, type Block, type BulletListNode, type ClauseBody, type Inline, type PresetInput } from "@/domain/clause";
import type { Id } from "@/domain/types";

import type { ClauseEditOption, ClauseEditPreset } from "./edit-types";

export const isNewCode = (code: string) => code.startsWith("new:");

/** 선택지 본문 → 평문 — 글 노드만 잇는다 (평문 규칙 이전에 만든 선택지의 슬롯 등은 글로 보이지 않는다). */
export function valueText(body: readonly Inline[]): string {
  return body.map((node) => (node.kind === "text" ? node.text : "")).join("");
}

/** 평문 → 선택지 본문 (빈 글이면 빈 본문). */
export function textBody(text: string, id: Id): Inline[] {
  return text === "" ? [] : [{ id, kind: "text", text }];
}

function mapInlines(body: ClauseBody, fn: (nodes: readonly Inline[]) => Inline[]): ClauseBody {
  const bullets = (list: BulletListNode): BulletListNode => ({ ...list, children: list.children.map((b) => ({ ...b, children: fn(b.children) })) });
  const blocks = (nodes: readonly Block[]): Block[] =>
    nodes.map((node) => {
      if (node.kind === "condBlock") return { ...node, branches: node.branches.map((branch) => ({ ...branch, children: blocks(branch.children) })) };
      if (node.kind === "switchBlock") return { ...node, cases: node.cases.map((k) => ({ ...k, children: blocks(k.children) })) };
      if (node.kind === "bulletList") return bullets(node);
      if (node.kind === "boxRef") return node;
      return {
        ...node,
        children: fn(node.children),
        ...(node.items
          ? {
              items: node.items.map((item) => item.kind === "bulletList" ? bullets(item) : item.kind === "boxRef" ? item : ({
                ...item,
                children: fn(item.children),
                ...(item.subitems ? { subitems: item.subitems.map((sub) => ({ ...sub, children: fn(sub.children) })) } : {}),
              })),
            }
          : {}),
      };
    });
  if (isInlineBody(body)) return fn(body);
  return blocks(body as Block[]);
}

/** 본문의 옵션 자리에 박힌 임시 코드를 실제 코드로 바꾼다. */
export function remapOptionSlots(body: ClauseBody, codes: ReadonlyMap<string, string>): ClauseBody {
  const remap = (nodes: readonly Inline[]): Inline[] =>
    nodes.map((node) => {
      if (node.kind === "optionSlot") {
        const next = codes.get(node.optionCode);
        return next ? { ...node, optionCode: next } : node;
      }
      if (node.kind === "inlineCond") return { ...node, branches: node.branches.map((branch) => ({ ...branch, children: remap(branch.children) })) };
      if (node.kind === "inlineSwitch") return { ...node, cases: node.cases.map((k) => ({ ...k, children: remap(k.children) })) };
      return node;
    });
  return mapInlines(body, remap);
}

/** 본문이 쓰는 옵션 코드 — 쓰이는 옵션은 뺄 수 없다(기능/함수조항 §3.2). */
export function usedOptionCodes(body: ClauseBody): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: readonly Inline[]): Inline[] => {
    for (const node of nodes) {
      if (node.kind === "optionSlot") out.add(node.optionCode);
      if (node.kind === "inlineCond") for (const branch of node.branches) walk(branch.children);
      if (node.kind === "inlineSwitch") for (const k of node.cases) walk(k.children);
    }
    return [...nodes];
  };
  mapInlines(body, walk);
  return out;
}

/**
 * 프리셋 저장 모양 (ADR-0084) — 편집 코드를 옵션 · 선택지를 저장한 **뒤**의 실제 코드로 바꾼다. 새 옵션은 `added`(편집 코드 → 만든 코드),
 * 새 선택지는 그 옵션에 새로 생긴 코드를 순서대로(저장은 남긴 선택지 뒤에 새 선택지를 차례로 붙인다). 새 프리셋(`new:*`)은 코드 없이 — 채번은 서비스가 한다.
 * 빈 옵션 선택 · 연결 · 「사용처가 채움」 키는 싣지 않는다.
 */
export function presetsForSave(
  presets: readonly ClauseEditPreset[],
  edit: readonly ClauseEditOption[],
  saved: readonly { code: string; values: readonly { code: string }[] }[],
  added: ReadonlyMap<string, string>,
): PresetInput[] {
  const optionCode = new Map<string, string>();
  const valueCode = new Map<string, Map<string, string>>();
  for (const o of edit) {
    const real = isNewCode(o.code) ? added.get(o.code) : o.code;
    if (!real) continue;
    optionCode.set(o.code, real);
    const finalValues = saved.find((x) => x.code === real)?.values.map((v) => v.code) ?? [];
    const kept = new Set(o.values.filter((v) => !isNewCode(v.code)).map((v) => v.code));
    const fresh = finalValues.filter((c) => !kept.has(c));
    const map = new Map<string, string>();
    let k = 0;
    for (const v of o.values) map.set(v.code, isNewCode(v.code) ? (fresh[k++] ?? v.code) : v.code);
    valueCode.set(o.code, map);
  }
  return presets.map((p) => {
    const options = Object.fromEntries(Object.entries(p.options).flatMap(([o, v]) => (optionCode.has(o) && v ? [[optionCode.get(o)!, valueCode.get(o)?.get(v) ?? v]] : [])));
    return {
      ...(isNewCode(p.code) ? {} : { code: p.code }),
      name: p.name.trim(),
      ...(Object.keys(options).length > 0 ? { options } : {}),
      ...(Object.keys(p.bindings).length > 0 ? { bindings: p.bindings } : {}),
      ...(p.fromUsage.length > 0 ? { fromUsage: [...p.fromUsage] } : {}),
    };
  });
}
