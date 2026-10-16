/**
 * 함수조항 프리셋 (순수) — ADR-0084 · 기능/함수조항 §3.7.
 *
 * - 프리셋 = 인자 연결 · 옵션 선택의 **이름 붙은 조합**, 함수조항 안에 둔다(`presets: [{ 코드 S01, 이름, 연결, 옵션 선택 }]`).
 *   코드는 시스템 채번 · 불변(함수조항 안 유일), 이름은 함수조항 안 유일 · 바꿔도 참조가 안 깨진다(결정 1).
 * - 사용처는 함수조항 참조 노드의 `preset` 으로 가리킨다 — 원본 문장 · 프리셋 값 둘 다 전파된다(결정 2).
 * - 담는 것 = 옵션 선택 · 구분자 · 상수 · 원천 연결. 담지 않는 것 = 조 참조 인자 연결 · 반복의 현재 원소 — 사용처가 채운다(결정 3).
 *   기본 연결 있는 인자는 비워 두면 기본 연결. 기본 연결 없는 값 인자를 사용처가 「반복의 현재 원소」로 채우게 하려면
 *   `fromUsage` 에 **명시로** 적는다 — 그냥 비우면 저장 거부(결정 6 · 2026-10-12 사용자 결정).
 * - 사용처는 프리셋 값을 덮어쓰지 않는다 — 다르게 쓰려면 풀어 직접 연결(결정 4). 풀기 = 삭제 때의 사용처 풀기(결정 7).
 */

import type { Code, Coordinate, Issue } from "../types";
import { checkBinding, type BindingEnv, type Bindings } from "./params";
import type { Clause, OptionSelection } from "./types";

/** 프리셋 하나. 순서는 배열 순서(화면 카드 순서 · 넣기 목록 순서). */
export interface PresetDef {
  /** 함수조항 안에서 유일 (`S01`) — 시스템 채번 · 불변. */
  code: Code;
  name: string;
  /** 인자 연결 — 구분자 · 상수 · 원천만. 비운 인자는 기본 연결(없으면 `fromUsage` 에 있어야). */
  bindings?: Bindings;
  /** 옵션 선택 — 옵션마다 하나. */
  options?: OptionSelection;
  /** 사용처가 채우는 값 인자(반복의 현재 원소) — 명시로 고른 것만 비어도 된다. */
  fromUsage?: string[];
}

export const PRESET_CODE = /^S\d{2,}$/;

/** 사용처 참조 노드에서 프리셋이 보는 몫. */
export interface PresetUsageInput {
  preset?: Code;
  options: OptionSelection;
  bindings?: Bindings;
}

/** 프리셋을 쓰는 자리에서도 사용처가 대는 인자 — 조 참조 인자 · 프리셋이 「사용처가 채움」으로 둔 인자. */
function usageOwned(clause: Pick<Clause, "params">, preset: PresetDef): Set<string> {
  const out = new Set(preset.fromUsage ?? []);
  for (const p of clause.params ?? []) if (p.type?.kind === "articleRef") out.add(p.name);
  return out;
}

export function presetOf(clause: Pick<Clause, "presets">, code: Code | undefined): PresetDef | undefined {
  return code === undefined ? undefined : clause.presets?.find((p) => p.code === code);
}

/**
 * 사용처의 실제 옵션 선택 · 인자 연결 (결정 2 · 4) — 프리셋이 없으면 사용처 값 그대로. 프리셋이면 옵션 · 연결은 프리셋 값이고,
 * 사용처는 조 참조 인자 · 「사용처가 채움」 인자만 댄다. 그 밖의 값을 사용처가 들고 있으면 덮어쓰기 오류(값은 프리셋 것을 쓴다).
 * 없는 프리셋은 깨진 참조 — 값은 사용처 것을 그대로 돌려준다(뒤 검사가 미선택 · 미연결을 함께 알린다).
 */
export function presetUsage(clause: Clause, ref: PresetUsageInput, at: Coordinate = {}): { options: OptionSelection; bindings?: Bindings; preset?: PresetDef; issues: Issue[] } {
  const own = { options: ref.options, ...(ref.bindings ? { bindings: ref.bindings } : {}) };
  if (ref.preset === undefined) return { ...own, issues: [] };
  const preset = presetOf(clause, ref.preset);
  if (!preset) return { ...own, issues: [{ kind: "brokenRef", message: `함수조항 ${clause.code} 에 프리셋 ${ref.preset} 이(가) 없습니다 — 다른 프리셋을 고르거나 직접 연결로 바꾼다`, at: { ...at, refPath: ref.preset } }] };
  const issues: Issue[] = [];
  const owned = usageOwned(clause, preset);
  if (Object.keys(ref.options).length > 0) issues.push({ kind: "structure", message: `프리셋 ‘${preset.name}’ 을 쓰는 자리는 옵션 선택을 덮어쓰지 않습니다 — 다르게 쓰려면 프리셋을 풀어 직접 연결로 바꾼다`, at: { ...at, refPath: preset.code } });
  const extra = Object.keys(ref.bindings ?? {}).filter((name) => !owned.has(name));
  if (extra.length > 0) issues.push({ kind: "structure", message: `프리셋 ‘${preset.name}’ 을 쓰는 자리는 인자 연결을 덮어쓰지 않습니다(${extra.join(" · ")}) — 다르게 쓰려면 프리셋을 풀어 직접 연결로 바꾼다`, at: { ...at, refPath: preset.code } });
  const bindings: Bindings = { ...(preset.bindings ?? {}) };
  for (const [name, b] of Object.entries(ref.bindings ?? {})) if (owned.has(name)) bindings[name] = b;
  return { options: { ...(preset.options ?? {}) }, ...(Object.keys(bindings).length > 0 ? { bindings } : {}), preset, issues };
}

/** 프리셋 풀기 — 프리셋 값을 직접 연결 · 옵션 선택으로 옮긴다(출력 불변). 프리셋이 없거나 없는 프리셋이면 사용처 값 그대로. */
export function unfoldPreset(clause: Clause, ref: PresetUsageInput): { options: OptionSelection; bindings?: Bindings } {
  const r = presetUsage(clause, ref);
  if (!r.preset) return { options: ref.options, ...(ref.bindings ? { bindings: ref.bindings } : {}) };
  return { options: r.options, ...(r.bindings ? { bindings: r.bindings } : {}) };
}

/**
 * 검사 ① 프리셋 (결정 1 · 3 · 6) — 이름(비지 않음 · 겹치지 않음) · 코드(S + 숫자 · 겹치지 않음) · 옵션마다 유효한 선택 ·
 * 기본 연결 없는 값 인자마다 연결(또는 「사용처가 채움」) · 담는 연결은 구분자 · 상수 · 원천만(조 참조 · 반복의 현재 원소는 사용처 몫) ·
 * 없는 옵션 · 없는 인자 · 타입 불일치 거부. 좌표 refPath = 프리셋 코드.
 */
export function checkPresets(clause: Clause, env: BindingEnv = {}, base: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  const names = new Set<string>();
  const codes = new Set<string>();
  const params = clause.params ?? [];
  for (const preset of clause.presets ?? []) {
    const name = typeof preset.name === "string" ? preset.name.trim() : "";
    const at: Coordinate = { ...base, refPath: preset.code };
    const fail = (kind: Issue["kind"], message: string) => issues.push({ kind, message, at });
    if (name === "") {
      fail("structure", `프리셋 ${preset.code} 의 이름이 비어 있습니다`);
      continue;
    }
    if (names.has(name)) fail("structure", `프리셋 이름이 겹칩니다: ${name}`);
    names.add(name);
    if (typeof preset.code !== "string" || !PRESET_CODE.test(preset.code)) fail("structure", `프리셋 코드는 S 와 숫자입니다: ${String(preset.code)}`);
    else if (codes.has(preset.code)) fail("structure", `프리셋 코드가 겹칩니다: ${preset.code}`);
    codes.add(preset.code);
    const head = `프리셋 ‘${name}’ 에`;
    // 옵션 — 옵션마다 유효한 선택 하나
    const chosen = preset.options ?? {};
    for (const o of clause.options) {
      const v = chosen[o.code];
      if (v === undefined) fail("optionUnselected", `${head} 옵션 ${o.code} 선택이 비었습니다 (${o.label})`);
      else if (!o.values.some((x) => x.code === v)) fail("optionInvalid", `${head} 옵션 ${o.code} 의 없는 선택지가 있습니다: ${v}`);
    }
    for (const code of Object.keys(chosen)) if (!clause.options.some((o) => o.code === code)) fail("optionInvalid", `${head} 없는 옵션을 골랐습니다: ${code}`);
    // 인자 — 담는 연결만, 기본 연결 없는 값 인자는 연결 또는 「사용처가 채움」
    const bindings = preset.bindings ?? {};
    const fromUsage = new Set(preset.fromUsage ?? []);
    for (const p of params) {
      if (p.type?.kind === "articleRef") continue;
      if (bindings[p.name] === undefined && p.default === undefined && !fromUsage.has(p.name)) fail("argUnbound", `${head} 인자 ${p.name} 연결이 비었습니다 — 값을 대거나 「사용처가 채움」을 고른다`);
    }
    for (const [pname, b] of Object.entries(bindings)) {
      const p = params.find((x) => x.name === pname);
      if (!p) {
        fail("brokenRef", `${head} 없는 인자에 연결했습니다: ${pname}`);
        continue;
      }
      if (b.kind === "discriminator" && b.node) {
        fail("structure", `${head} 인자 ${pname} — 프리셋은 키 경로 · 「현재 세부보장」 연결을 담지 않습니다(함수조항은 담보를 모른다 — 하위 레벨 구분자 인자는 「사용처가 채움」으로 둔다)`);
        continue;
      }
      if (b.kind === "articleRef" || b.kind === "current") {
        fail("structure", `${head} 인자 ${pname} — 프리셋은 ${b.kind === "articleRef" ? "조 참조 인자 연결" : "반복의 현재 원소"}을 담지 않습니다(사용처가 넣을 때 채운다)`);
        continue;
      }
      for (const i of checkBinding(p, b, env, at, `프리셋 ‘${name}’ 연결`)) issues.push(i);
    }
    for (const pname of fromUsage) if (!params.some((p) => p.name === pname)) fail("brokenRef", `${head} 없는 인자를 「사용처가 채움」으로 골랐습니다: ${pname}`);
  }
  return issues;
}

