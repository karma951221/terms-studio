/**
 * 편집 화면의 「저장 한 번」 = 한 트랜잭션 (디자인원칙 §2 L2 공통 인수 문구 ① · 점검 2026-09-27 H1 · D1).
 *
 * 저장 액션은 서비스를 여러 번 부른다 (이름 → 주석 → 값 …). 서비스는 저마다 트랜잭션을 열지만, 여기서 바깥 트랜잭션을 먼저 열면
 * 문맥 프록시(`services.db`) 덕에 안쪽 것은 세이브포인트가 된다. 결과가 `{ ok: true }` 가 아니면 — 거부든 영향 확인(`confirm`)이든 —
 * 앞 단계에서 쓴 것까지 전부 롤백한다. 그래서 거부된 저장은 DB 에 아무 흔적도 남기지 않고, 확인 대화상자가 떠 있는 동안에도
 * 아무것도 저장돼 있지 않다. 서버 전용 — 클라이언트 컴포넌트에서 import 하지 않는다.
 */
import type { Services } from "@/services/container";
import { rollbackUnless } from "@/services/txContext";

import type { EditOutcome } from "./edit";

export function saveOnce(services: Services, run: () => Promise<EditOutcome>): Promise<EditOutcome> {
  return rollbackUnless(services.db, () => run(), (outcome) => outcome.ok === true);
}
