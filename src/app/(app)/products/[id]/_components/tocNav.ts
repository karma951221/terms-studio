/**
 * 보통약관 세 패널의 목차 누름 — **서버를 다시 부르지 않는다** (2026-09-28 사용자 QA: 목차를 누르면 화면이 새로 고쳐졌다).
 *
 * 예전 목차는 `?tab=…&art=<조>` 링크라 누를 때마다 서버 렌더 한 바퀴(조립 재계산 포함)를 돌았다. 이제 서버는 관마다
 * 가운데 · 오른쪽 패널을 미리 그려 두고, 목차는 고른 조만 바꾼다(클라이언트 상태). 주소는 `history.replaceState` 로만
 * 맞춘다 — 새로고침 · 링크 복사 · 옵션 저장 뒤 돌아오기가 같은 조를 가리키고, 뒤로가기 기록은 쌓지 않는다
 * (Next 의 네이티브 History 연동이라 `useSearchParams` 도 따라온다).
 *
 * 새 창 · 새 탭(수정키 · 가운데 단추)은 브라우저에 맡긴다 — 링크 자체는 진짜 주소다.
 */
export interface TocClickEvent {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** 목차 링크 누름을 가로채 조를 고른다. 가로챘으면 true (브라우저 이동 없음). */
export function selectArticleOnClick(event: TocClickEvent, href: string, select: () => void, history: Pick<History, "replaceState"> | undefined = globalThis.window?.history): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  select();
  history?.replaceState(null, "", href);
  return true;
}
