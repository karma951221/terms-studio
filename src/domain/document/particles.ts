// src/domain/document/particles.ts
/**
 * 조사 칩 — 앞 글에 따라 모양이 바뀌는 조사 자리의 프리셋과 판정 (기능/문면 §3.11).
 * 프리셋은 코드 고정이다(관리 화면 없음). 저장은 키, 칩 글자는 `label`.
 */
import type { Id } from "../types";

export const PARTICLE_PRESETS = [
  { key: "eul-reul", label: "을/를", final: "을", open: "를" },
  { key: "i-ga", label: "이/가", final: "이", open: "가" },
  { key: "eun-neun", label: "은/는", final: "은", open: "는" },
  { key: "gwa-wa", label: "과/와", final: "과", open: "와" },
  { key: "euro-ro", label: "으로/로", final: "으로", open: "로", rieul: "로" },
  { key: "euroseo-roseo", label: "으로서/로서", final: "으로서", open: "로서", rieul: "로서" },
  { key: "eurosseo-rosseo", label: "으로써/로써", final: "으로써", open: "로써", rieul: "로써" },
  { key: "ina-na", label: "이나/나", final: "이나", open: "나" },
  { key: "ira-ra", label: "이라/라", final: "이라", open: "라" },
  { key: "iran-ran", label: "이란/란", final: "이란", open: "란" },
  { key: "imyeo-myeo", label: "이며/며", final: "이며", open: "며" },
  { key: "igo-go", label: "이고/고", final: "이고", open: "고" },
  { key: "ideunji-deunji", label: "이든지/든지", final: "이든지", open: "든지" },
  { key: "imyeon-myeon", label: "이면/면", final: "이면", open: "면" },
  { key: "ida-da", label: "이다/다", final: "이다", open: "다" },
] as const satisfies readonly { key: string; label: string; final: string; open: string; rieul?: string }[];

export type ParticlePresetKey = (typeof PARTICLE_PRESETS)[number]["key"];
export interface ParticlePreset {
  key: ParticlePresetKey;
  label: string;
  final: string;
  open: string;
  /** ㄹ 받침일 때 — 없으면 `final` (「으로」 류만 받침 없음 쪽). */
  rieul?: string;
}

export interface ParticleNode {
  id: Id;
  kind: "particle";
  preset: ParticlePresetKey;
}

const BY_KEY = new Map<string, ParticlePreset>(PARTICLE_PRESETS.map((p) => [p.key, p]));

export function isParticlePreset(x: unknown): x is ParticlePresetKey {
  return typeof x === "string" && BY_KEY.has(x);
}

export function particlePreset(key: ParticlePresetKey): ParticlePreset {
  return BY_KEY.get(key)!;
}

/** 받침 있음 · 없음 · ㄹ 받침. */
export type Coda = "final" | "open" | "rieul";

/** 끝자리 1~9 의 읽는 소리 — 일 · 이 · 삼 · 사 · 오 · 육 · 칠 · 팔 · 구. 0 으로 끝나면 십 · 백 · 천 · 만 · 영 — 모두 받침 있음. */
const DIGIT: Record<string, Coda> = { "0": "final", "1": "rieul", "2": "open", "3": "final", "4": "open", "5": "open", "6": "final", "7": "rieul", "8": "rieul", "9": "open" };
/** 건너뛰지 않고 그 안 마지막 글자로 보는 닫는 낫표 · 따옴표. */
const CLOSERS = new Set(["」", "』", "'", '"', "’", "”"]);

/** 앞 글의 마지막 글자로 받침을 판정한다. 판정할 수 없으면 undefined (기능/문면 §3.11 앞 글자 규칙). */
export function codaOf(before: string): Coda | undefined {
  const chars = [...before];
  const last = chars.at(-1);
  if (last === undefined) return undefined;
  if (last === ")") {
    let depth = 0;
    for (let i = chars.length - 1; i >= 0; i--) {
      if (chars[i] === ")") depth++;
      else if (chars[i] === "(" && --depth === 0) return codaOf(chars.slice(0, i).join(""));
    }
    return undefined;
  }
  if (CLOSERS.has(last)) return codaOf(chars.slice(0, -1).join(""));
  if (last === "%") return "open";
  if (last in DIGIT) return DIGIT[last];
  const code = last.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) {
    const jong = code % 28;
    return jong === 0 ? "open" : jong === 8 ? "rieul" : "final";
  }
  return undefined;
}

/** 프리셋과 앞 글로 조사를 고른다. 판정 불가면 「받침있음(받침없음)」 병기. */
export function chooseParticle(key: ParticlePresetKey, before: string): { text: string; resolved: boolean } {
  const p = particlePreset(key);
  const coda = codaOf(before);
  if (coda === undefined) return { text: `${p.final}(${p.open})`, resolved: false };
  return { text: coda === "open" ? p.open : coda === "rieul" ? (p.rieul ?? p.final) : p.final, resolved: true };
}
