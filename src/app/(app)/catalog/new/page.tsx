import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { MASTER } from "@/domain/master";
import { ATTACH_LEVELS, type AttachLevel } from "@/domain/types";
import { getServices } from "@/lib/services";

import { createDiscriminatorAction } from "../actions";
import { insertPanelData } from "../lib";
import { CreateForm } from "./CreateForm";

export const dynamic = "force-dynamic";

/** 시드 구분자는 담보 레벨이 최다다 (리뷰 #2) — 구조 선택지라 프리필한다. */
const DEFAULT_LEVEL: AttachLevel = "coverage";

export default async function NewCatalogPage({ searchParams }: { searchParams: Promise<{ error?: string; level?: string }> }) {
  const { error, level = DEFAULT_LEVEL } = await searchParams;
  const initialLevel = ATTACH_LEVELS.includes(level as AttachLevel) ? (level as AttachLevel) : DEFAULT_LEVEL;
  const services = getServices();
  const [enums, defs] = await Promise.all([services.catalog.listEnums(), services.catalog.list()]);
  // 넣기 패널 재료 — 마스터 필드 트리와 구분자 목록 (기능/구분자 §4.3). 생성은 자기 코드가 없어 제외할 것이 없다.
  const panel = insertPanelData(MASTER, defs);

  return <CreateForm action={createDiscriminatorAction} banner={<ErrorBanner message={error} />} initialLevel={initialLevel} enums={enums} panel={panel} />;
}
