import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { encodeNodeKey, nodesOf, structureDraftOf } from "@/domain/coverage";
import { usagesOf } from "@/domain/refs";
import { buildForm, type FormModel } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { CoverageEditor, type EditorNode } from "./CoverageEditor";

export const dynamic = "force-dynamic";

export default async function CoverageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; tab?: string; node?: string; field?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await currentActor();
  const services = getServices();
  const tree = await services.coverage.get(id);
  if (!tree) {
    return (
      <div>
        <Breadcrumb items={[{ label: ENTITY_LABEL.coverage, href: "/coverages" }, { label: id }]} />
        <p className="ts-error-banner">찾을 수 없습니다.</p>
      </div>
    );
  }

  const [enumsList, graph, attributeKinds] = await Promise.all([
    services.catalog.listEnums(),
    services.refs.graph(),
    services.product.listAttributeKinds(),
  ]);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);

  // 트리 순서대로 노드를 편다 — 순번 · 급부 수 · 소속 세부보장 이름을 화면이 그대로 쓴다.
  const nodes: EditorNode[] = [];
  for (const node of nodesOf(tree)) {
    const key = encodeNodeKey(node.level, node.id);
    if (node.level === "coverage") {
      nodes.push({ key, level: node.level, id: node.id, name: node.name });
      continue;
    }
    if (node.level === "subCoverage") {
      const sub = tree.subCoverages.find((s) => s.id === node.id);
      nodes.push({ key, level: node.level, id: node.id, name: node.name, order: (sub?.order ?? 0) + 1, benefitCount: sub?.benefits.length ?? 0 });
      continue;
    }
    const parent = tree.subCoverages.find((s) => s.benefits.some((b) => b.id === node.id));
    const benefit = parent?.benefits.find((b) => b.id === node.id);
    nodes.push({ key, level: node.level, id: node.id, name: node.name, order: (benefit?.order ?? 0) + 1, parentName: parent?.name });
  }

  // 네 탭이 한 화면이므로 값 폼은 노드마다 미리 짓는다 (탭을 옮겨도 서버에 다시 안 간다).
  const formByNode: Record<string, FormModel> = {};
  await Promise.all(
    nodes.map(async (node) => {
      const form = await services.coverage.form({ level: node.level, id: node.id });
      formByNode[node.key] = form.ok
        ? buildForm(node.level, enumLookup, new Map(Object.entries(form.value.slots)))
        : buildForm(node.level, enumLookup, new Map());
    }),
  );

  const usageCount = usagesOf(graph, { kind: "coverageNode", level: "coverage", id: tree.id }, { via: ["mount"] }).length;
  // 담보약관의 공용조항 옵션은 담보 마스터 안에서 다 정해야 한다 (기능/담보 §3.5) — 저장 검사와 같은 검증으로 남은 수를 센다.
  const unresolvedOptionCount = tree.documentId ? await services.document.unresolvedOptionCount(tree.documentId) : 0;
  const attributeValueLabels = attributeKinds.flatMap((kind) => kind.values.map((value) => value.label));

  // 이름 · 구조가 바뀌면 초안을 새 진실로 다시 세운다 (EnumDetailPage 와 같은 패턴).
  const signature = nodes.map((n) => `${n.key}=${n.name}`).join("|");

  return (
    <div>
      <ErrorBanner message={sp.error} />
      <CoverageEditor
        key={signature}
        id={tree.id}
        initial={{ label: tree.name, description: tree.description, structure: structureDraftOf(tree), values: {} }}
        nodes={nodes}
        formByNode={formByNode}
        usageCount={usageCount}
        documentId={tree.documentId}
        unresolvedOptionCount={unresolvedOptionCount}
        attributeValueLabels={attributeValueLabels}
        initialTab={sp.tab}
        initialNode={sp.node}
        highlightPath={sp.field}
        showCodes={actor.role === "admin"}
      />
    </div>
  );
}
