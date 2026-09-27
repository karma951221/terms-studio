"use server";

/**
 * 조문 저작 화면의 서버 함수 (ADR-0074) — 편집 중의 명령은 브라우저 편집본에 적용되고, 서버로 오는 것은
 * `편집` 때 원본 받기 · 대응 보통약관 바꿀 때 그 보통약관 받기 · 삭제 확인 카드의 다른 문서 참조 · `저장` 하나뿐이다.
 */
import type { DocumentNode, EditOp } from "@/domain/document";
import type { Coordinate, Id, Impact, Issue } from "@/domain/types";
import { describeRejection } from "@/app/_lib/rejection";
import { currentActor, getServices } from "@/lib/services";

/** 편집 시작 — 원본 트리와 그 판 · 지금 대응 보통약관. */
export interface EditStart {
  title: string;
  tree: DocumentNode;
  version: number;
  generalDocumentId?: Id;
  general?: GeneralForEdit;
}

export interface GeneralForEdit {
  id: Id;
  title: string;
  tree: DocumentNode;
}

export type SaveDocumentOutcome =
  | { ok: true; version: number }
  /** 판 충돌 — 편집본은 브라우저에 그대로 둔다. */
  | { ok: "conflict"; message: string }
  /** 다른 문서의 참조가 깨지는 저장 — 영향을 보이고 `confirm` 으로 다시 부른다. */
  | { ok: "confirm"; impact: Impact }
  | { ok: false; message: string; issues?: Issue[] };

async function generalForEdit(id: Id): Promise<GeneralForEdit | undefined> {
  const g = await getServices().document.get(id);
  return g && g.kind === "general" ? { id: g.id, title: g.title, tree: g.tree } : undefined;
}

export async function startDocumentEditAction(id: Id): Promise<EditStart | undefined> {
  const doc = await getServices().document.get(id);
  if (!doc) return undefined;
  const general = doc.generalDocumentId ? await generalForEdit(doc.generalDocumentId) : undefined;
  return {
    title: doc.title,
    tree: doc.tree,
    version: doc.version,
    ...(doc.generalDocumentId ? { generalDocumentId: doc.generalDocumentId } : {}),
    ...(general ? { general } : {}),
  };
}

/** 편집 중 대응 보통약관을 고르면 — 그 보통약관의 조를 조연결 · 보통약관 조 참조 후보로 쓴다. */
export async function loadGeneralForEditAction(id: Id): Promise<GeneralForEdit | undefined> {
  return generalForEdit(id);
}

/** 삭제 확인 카드 — 원본에서 이 조를 가리키는 다른 문서의 참조(조연결 · 보통약관 조 참조). 저장 때 서버가 다시 센다. */
export async function articleUsagesAction(documentId: Id, articleId: Id): Promise<Coordinate[]> {
  const services = getServices();
  const doc = await services.document.get(documentId);
  if (!doc) return [];
  const usages = await services.refs.usages({ kind: "article", documentId, articleId });
  return usages.map((u) => u.at).filter((at) => at.ownerId !== (doc.ownerId ?? doc.id));
}

/** 저장 한 번 — 시작 판 + 명령 목록. 판 확인 · 재적용 · 전체 검증 · 한 트랜잭션 반영은 서비스가 한다. */
export async function saveDocumentEditAction(id: Id, input: { baseVersion: number; ops: EditOp[]; confirm?: boolean }): Promise<SaveDocumentOutcome> {
  if (!Array.isArray(input.ops) || !Number.isInteger(input.baseVersion)) return { ok: false, message: "저장 요청이 올바르지 않습니다." };
  const actor = await currentActor();
  let result;
  try {
    result = await getServices().document.save(actor, id, { baseVersion: input.baseVersion, ops: input.ops, confirm: input.confirm === true });
  } catch (error) {
    return { ok: false, message: `저장에 실패했습니다 — ${error instanceof Error ? error.message : String(error)}` };
  }
  if (result.ok) return { ok: true, version: result.value.version };
  const { rejection } = result;
  if (rejection.reason === "conflict") return { ok: "conflict", message: describeRejection(rejection).message };
  if (rejection.reason === "needsConfirmation") return { ok: "confirm", impact: rejection.impact };
  const view = describeRejection(rejection);
  return { ok: false, message: view.message, ...(view.issues ? { issues: view.issues } : {}) };
}
