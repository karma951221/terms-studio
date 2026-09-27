import type { Issue } from "@/domain/types";

/**
 * 조립 검사 · 내용 검토 한 줄 (디자인원칙 §9.2) — 미리보기 머리에 선다.
 *
 * 「오류 a · 경고 b」 두 수 뒤에, 오류·경고가 있든 없든 「분기 미결로 미검사 범위가 있을 수 있음」 을 붙인다 —
 * 지금 조립은 밟지 않은 가지 안쪽을 세지 않으므로 「오류 0」 이 「전부 검사했다」 로 읽히면 안 된다(디자인원칙 §9.2 「평가 대기」).
 * 「내용 검토: 미실시」 는 MVP 고정 문구 — 자동 검사를 사람의 검토 완료로 확대하지 않는다(결정 5).
 */
export function AssemblyCheckLine({ issues }: { issues: readonly Issue[] }) {
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const errors = issues.length - warnings;
  return (
    <p className="ts-count">
      조립 검사: 오류 <b>{errors}</b> · 경고 {warnings} — 분기 미결로 미검사 범위가 있을 수 있음 (밟지 않은 가지 안쪽은 검사하지 않는다) · 내용 검토: 미실시
    </p>
  );
}
