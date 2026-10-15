import { isRepeatSource, isTreeSource, type TreeIndex } from "@/domain/document";
import type { Id, RefRestrict } from "@/domain/types";

import { loopsAround } from "./repeatSources";

/** 저장된 한정 → 칸 값 (`""` 없음 · `values` 해당 값들 · `keys` 해당 키들 · `current:<반복 id>` 현재). */
export function restrictMode(r: RefRestrict | undefined): string {
  if (!r) return "";
  if ("current" in r) return `current:${r.current}`;
  return "keys" in r ? "keys" : "values";
}

/** 폼 → 한정 (ADR-0077 결정 7 · ADR-0087 결정 10). `prefix` 는 인자 칸의 `arg:<이름>:`. */
export function restrictOfForm(fd: FormData, prefix: string): RefRestrict | undefined {
  const mode = String(fd.get(`${prefix}restrictMode`) ?? "");
  if (mode === "") return undefined;
  if (mode.startsWith("current:")) return { current: mode.slice("current:".length) };
  if (mode === "keys") return { keys: fd.getAll(`${prefix}restrictKey`).map(String) };
  if (mode === "values") return { values: fd.getAll(`${prefix}restrictValue`).map(String) };
  return undefined;
}

/**
 * 참조 자리를 감싼 담보 트리 반복 (바깥 → 안쪽) — 「현재 세부보장 / 현재 급부」 후보 (ADR-0087 결정 10).
 * `includeSelf` — 새로 넣는 자리면 부모(`id`)가 반복 블록 자신일 수 있다(그 본문에 넣는 것) · 가지(`ix.branches`)여도 된다.
 * 이미 있는 노드를 고칠 땐 그 노드 자신을 뺀다. 트리에 없는 자리(함수조항 편집기)면 없음.
 */
export function treeLoopsAt(ix: TreeIndex, id: Id | undefined, includeSelf: boolean): { id: Id; level: "subCoverage" | "benefit" }[] {
  if (id === undefined) return [];
  return loopsAround(ix, id).flatMap((f) => (isRepeatSource(f.source) && isTreeSource(f.source) && (includeSelf || f.id !== id) ? [{ id: f.id, level: f.source.kind === "subCoverages" ? ("subCoverage" as const) : ("benefit" as const) }] : []));
}

type TreeLevel = "subCoverage" | "benefit";

/**
 * 「해당 키들」 후보 — 대상 반복 레벨에 맞춘다 (ADR-0087 결정 10). 「세부보장마다」 대상은 세부보장 키만,
 * 급부 반복 대상은 급부 키 + 세부보장 키(그 아래 급부 전부를 고른다 — 「(급부 전부)」).
 */
export function keyChoicesFor(keys: readonly { path: string; label: string; level: TreeLevel }[], target: TreeLevel): { path: string; label: string }[] {
  return keys.flatMap((k) => {
    if (k.level === target) return [{ path: k.path, label: k.label }];
    return target === "benefit" && k.level === "subCoverage" ? [{ path: k.path, label: `${k.label} (급부 전부)` }] : [];
  });
}

/** 「현재 세부보장 / 현재 급부」 후보 — 급부 반복 대상은 감싼 세부보장 반복의 「현재」도 받는다(그 세부보장의 급부 전부). 세부보장 대상엔 급부 반복의 「현재」를 뺀다. */
export function treeLoopChoicesFor<T extends { level: TreeLevel }>(loops: readonly T[], target: TreeLevel): T[] {
  return loops.filter((l) => target === "benefit" || l.level === "subCoverage");
}
