"use server";

/**
 * 담보 상세의 편집 흐름 서버 액션 — 「저장 하나」가 담보명 · 설명 · 구조(세부보장 · 급부) · 네 탭의 값을 다 담는다
 * (기능/담보 §4 「상세」 조작 · 디자인원칙 §2 L2).
 *
 * 구조(추가 · 이름 · 순서 · 삭제)는 ADR-0052 결정 1 — 미탑재 담보의 초안 `structure` 를 서비스 `applyStructurePlan` 이
 * 한 트랜잭션에 적용한다 (① 이름 → ② 추가 → ③ 삭제 → ④ 순서 · 결과 트리 한 번 저장). 「구조 편집」 화면(결정 2)과 같은 경로다.
 * 삭제가 섞이면 아무것도 저장하기 전에 `previewStructurePlan` 으로 영향을 모아 `ok:"confirm"`, 편집자면 서버가 거부한다
 * (ADR-0019 — 화면 숨김이 아니라 서버 거부). 담보명 · 주석 · 값은 서비스 호출 각각이라, 먼저 `dryRunStructurePlan` 으로
 * 계획을 메모리에서 끝까지 돌려 구조 거부를 담보명 저장보다 앞에 낸다. 확인의 **판정은 서비스**가 트랜잭션 안에서 다시 한다 —
 * 호출자의 `confirm` 을 그대로 넘긴다.
 * 탑재된 담보(탑재 상품담보 ≥ 1)의 구조 변경은 여기서 거부한다 — 그 경로는 별도 「구조 편집」 화면(`/coverages/[id]/structure`)이다.
 */
import { describeRejection } from "@/app/_lib/rejection";
import type { EditOutcome } from "@/app/_lib/edit";
import { assertCan } from "@/domain/auth";
import { decodeNodeKey, dryRunStructurePlan, hasRemoves, hasStructuralChange, isEmptyPlan, structurePlan, type CoverageNodeRef } from "@/domain/coverage";
import { usagesOf } from "@/domain/refs";
import type { Id, Result } from "@/domain/types";
import { currentActor, getServices } from "@/lib/services";

import type { CoverageEditData } from "./edit-types";
import { REMOVE_FORBIDDEN } from "./lib";

function failed<T>(result: Result<T>, token: string): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token };
  return { ok: false, message: describeRejection(result.rejection).message };
}

const CONFIRM_TITLE = "구조를 바꾸면 저장된 값이 사라질 수 있다";

/**
 * 구조 계획의 거부 → 화면 문구. 삭제 역할 거부는 기능/담보 §3.2 의 거부 문장 그대로. 서비스가 낸 `needsConfirmation` 은 그대로 confirm
 * 대화상자로 — 액션의 사전 확인이 못 본 삭제(그 사이 트리가 바뀐 경쟁)를 서비스가 트랜잭션 안에서 잡은 경우라, 삭제 수는 모른다.
 */
function structureFailed<T>(result: Result<T>): EditOutcome | undefined {
  if (result.ok) return undefined;
  if (result.rejection.reason === "forbidden" && result.rejection.action === "coverage.deleteNode") return { ok: false, message: REMOVE_FORBIDDEN };
  if (result.rejection.reason === "needsConfirmation") return { ok: "confirm", impact: result.rejection.impact, token: "structure", title: CONFIRM_TITLE, actionLabel: "세부보장·급부 삭제하고 저장" };
  return failed(result, "structure");
}

export async function saveCoverageEditAction(id: Id, input: CoverageEditData, confirm = false): Promise<EditOutcome> {
  const actor = await currentActor();
  const services = getServices();
  const current = await services.coverage.get(id);
  if (!current) return { ok: false, message: "담보를 찾을 수 없습니다." };

  const plan = structurePlan(current, input.structure);

  // 탑재된 담보의 구조는 여기서 못 고친다 — 화면이 조작을 숨기지만 서버가 다시 가른다 (탑재 수는 page 와 같은 셈).
  if (hasStructuralChange(plan)) {
    const mounted = usagesOf(await services.refs.graph(), { kind: "coverageNode", level: "coverage", id }, { via: ["mount"] }).length > 0;
    if (mounted) return { ok: false, message: "탑재된 담보의 구조는 여기서 고칠 수 없다" };
  }

  // 도메인 규칙 사전 검증 — 담보명을 저장하기 전에 계획 전체를 메모리에서 돌려 첫 거부를 낸다 (부분 저장 방지).
  const dry = dryRunStructurePlan(current, plan);
  if (!dry.ok) return failed(dry, "structure")!;

  // 값 초안 — ✕ 한 노드(와 그 아래 급부)의 값 초안은 버린다 — 초안에 남은 id 만 살아 있다.
  // 폼이 낸 issue 는 입력만 보는 검사라 어떤 쓰기보다 앞에서 낸다 — 담보명 · 구조가 저장된 뒤 값만 거부되는 부분 저장 방지.
  const liveIds = new Set<Id>([id, ...input.structure.flatMap((sub) => [...(sub.id ? [sub.id] : []), ...sub.benefits.flatMap((b) => (b.id ? [b.id] : []))])]);
  const liveValues = Object.entries(input.values).flatMap(([key, submission]) => {
    const owner = decodeNodeKey(key) as CoverageNodeRef | undefined;
    return owner && liveIds.has(owner.id) ? [{ key, owner, submission }] : [];
  });
  for (const { submission } of liveValues) if (submission.issues.length > 0) return { ok: false, message: submission.issues[0]!.message };

  // 삭제 영향 확인 — 다른 변경(이름 · 값)보다 먼저 두어 확인 전엔 아무것도 저장하지 않는다. 편집자는 여기서 거부된다.
  if (hasRemoves(plan) && !confirm) {
    const preview = await services.coverage.previewStructurePlan(actor, id, input.structure);
    if (!preview.ok) return structureFailed(preview)!;
    return {
      ok: "confirm",
      impact: preview.value,
      token: "structure",
      title: CONFIRM_TITLE,
      actionLabel: `세부보장·급부 ${plan.removes.length}개 삭제하고 저장`,
    };
  }

  // 삭제가 섞인 confirm — 역할을 담보명보다 앞에서 본다. 서비스도 forbidden 으로 거부하지만 그때는 담보명 · 주석이 이미 저장돼
  // 「확인 전엔 아무것도 저장하지 않는다」 가 깨진다 (화면은 편집자에게 confirm 을 안 주지만 액션은 직접 부를 수 있다).
  if (hasRemoves(plan) && !assertCan(actor, "coverage.deleteNode").ok) return { ok: false, message: REMOVE_FORBIDDEN };

  if (input.label !== current.name) {
    const error = failed(await services.coverage.rename(actor, id, input.label), "label");
    if (error) return error;
  }
  if (input.description !== current.description) {
    const error = failed(await services.coverage.setDescription(actor, id, input.description), "description");
    if (error) return error;
  }

  // 구조 — 계획 전체를 한 트랜잭션에. 위 사전 확인은 문구(삭제 수 · 편집자 배너)를 위한 것이고 **판정은 서비스가 한다** — 호출자의
  // `confirm` 을 그대로 넘겨, 사전 계획엔 없던 삭제가 트랜잭션 안 계획에 있으면(그 사이 트리가 바뀜) 서비스의 needsConfirmation 이
  // 대화상자로 돌아온다. 탑재 스냅샷의 이름 · 순서도 같은 트랜잭션에서 따라온다.
  if (!isEmptyPlan(plan)) {
    const applied = structureFailed(await services.coverage.applyStructurePlan(actor, id, input.structure, { confirm }));
    if (applied) return applied;
  }

  // 값 — 손댄 노드만 (issue 는 위에서 이미 걸렀다).
  for (const { key, owner, submission } of liveValues) {
    for (const entry of submission.values) {
      const result =
        entry.value === undefined
          ? await services.coverage.clearValue(actor, owner, entry.path)
          : await services.coverage.writeValue(actor, owner, entry.path, entry.value);
      const error = failed(result, key);
      if (error) return error;
    }
  }

  return { ok: true };
}

export async function removeCoverageEditAction(id: Id, confirm = false): Promise<EditOutcome> {
  return failed(await getServices().coverage.remove(await currentActor(), id, { confirm }), "delete") ?? { ok: true };
}
