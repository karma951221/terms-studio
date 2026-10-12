/**
 * jsdom 컴포넌트 테스트용 — Radix 가 부르는데 jsdom 에 없는 API 를 채운다.
 * 파일 첫 줄에 `// @vitest-environment jsdom` 을 단 테스트만 jsdom 으로 돈다. 나머지는 node 그대로.
 */
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  // jsdom 은 getBoundingClientRect 가 DOMRect 가 아닌 일반 객체를 준다 — 브라우저처럼 DOMRect 로 맞춘다.
  const rect = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const r = rect.call(this);
    return new window.DOMRect(r.x, r.y, r.width, r.height);
  };
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
