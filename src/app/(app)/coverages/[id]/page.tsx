import { Breadcrumb } from "@/app/_components/Breadcrumb";
import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { ENTITY_LABEL } from "@/app/_lib/labels";
import { decodeNodeKey, encodeNodeKey, nodesOf, structureDraftOf } from "@/domain/coverage";
import { buildForm, type FormModel } from "@/forms";
import { currentActor, getServices } from "@/lib/services";

import { CoverageEditor } from "./CoverageEditor";

export const dynamic = "force-dynamic";

/**
 * 담보 상세 — 탭 없는 한 화면 (기능/담보 §4 「상세」). `?node=<level>:<id>&field=<폼키.필드키>` 는 진입 좌표 — 그 카드(필드)로
 * 스크롤 · 강조한다. `?tab=` 은 옛 좌표라 읽지 않는다. 담보약관 템플릿은 이 화면에 없다 — 담보약관 템플릿 메뉴가 입구다 (2026-09-27).
 */
export default async function CoverageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; node?: string; field?: string }>;
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

  const [enumsList, attributeKinds] = await Promise.all([
    services.catalog.listEnums(),
    services.product.listAttributeKinds(),
  ]);
  const enumLookup = (code: string) => enumsList.find((e) => e.code === code);

  // 모든 카드가 한 화면에 뜨므로 값 폼은 노드마다 미리 짓는다.
  const nodes = nodesOf(tree);
  const formByNode: Record<string, FormModel> = {};
  await Promise.all(
    nodes.map(async (node) => {
      const form = await services.coverage.form({ level: node.level, id: node.id });
      formByNode[encodeNodeKey(node.level, node.id)] = form.ok
        ? buildForm(node.level, enumLookup, new Map(Object.entries(form.value.slots)))
        : buildForm(node.level, enumLookup, new Map());
    }),
  );

  // 진입 좌표 — `?node=` 가 이 담보의 노드면 그 카드, 없고 `?field=` 만 있으면 그 필드를 가진 첫 카드.
  const keys = Object.keys(formByNode);
  const target =
    sp.node && decodeNodeKey(sp.node) && keys.includes(sp.node)
      ? sp.node
      : sp.field
        ? nodes.map((n) => encodeNodeKey(n.level, n.id)).find((key) => formByNode[key]!.fields.some((f) => f.path === sp.field))
        : undefined;

  const attributeValueLabels = attributeKinds.flatMap((kind) => kind.values.map((value) => value.label));

  // 이름 · 구조가 바뀌면 초안을 새 진실로 다시 세운다 (EnumDetailPage 와 같은 패턴).
  const signature = [tree.name, ...nodes.map((n) => `${encodeNodeKey(n.level, n.id)}=${n.name}`)].join("|");

  return (
    <div>
      <ErrorBanner message={sp.error} />
      <CoverageEditor
        key={signature}
        id={tree.id}
        code={tree.code}
        initial={{ label: tree.name, description: tree.description, structure: structureDraftOf(tree), values: {} }}
        formByNode={formByNode}
        attributeValueLabels={attributeValueLabels}
        target={target}
        highlightPath={target ? sp.field : undefined}
        showCodes={actor.role === "admin"}
      />
    </div>
  );
}
