/** 담보 화면 서버 액션의 입력 파싱 — 순수 함수. 구조 초안 · 계획은 도메인(`@/domain/coverage` plan.ts)으로 갔다. */
export { decodeNodeKey, encodeNodeKey } from "@/domain/coverage";

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** 삭제가 섞인 저장을 편집자가 시도했을 때의 배너 문장 (기능/담보 §4 「상세」 조작 · ADR-0052) — 상세 · 「구조 편집」 두 액션이 같은 문장. */
export const REMOVE_FORBIDDEN = "세부보장 · 급부 삭제는 관리자만 할 수 있다";
