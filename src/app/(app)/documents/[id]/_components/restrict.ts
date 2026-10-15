import type { RefRestrict } from "@/domain/types";

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
