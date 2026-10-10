/**
 * 담보 트리 픽스처 — 여러 테스트가 같은 트리 모양을 공유한다 (children.test · condition/conditionContext.test).
 *
 * 수술비: 1종수술{수술보험금} · 2종수술{수술보험금, 입원보험금}.
 */
import { addBenefit, addSubCoverage, createCoverageTree } from "./tree";
import type { Coverage } from "./types";

function unwrap<T>(r: { ok: true; value: T } | { ok: false; rejection: unknown }): T {
  if (!r.ok) throw new Error(`기대: ok, 실제: ${JSON.stringify(r.rejection)}`);
  return r.value;
}

export function surgery(): { tree: Coverage; b11: string; b21: string; b22: string } {
  let seq = 0;
  const newId = () => `id-${++seq}`;
  let tree = unwrap(createCoverageTree({ name: "수술비", subCoverageName: "1종수술", benefitName: "수술보험금" }, newId, []));
  tree = unwrap(addSubCoverage(tree, { name: "2종수술", benefitName: "수술보험금" }, newId));
  tree = unwrap(addBenefit(tree, tree.subCoverages[1].id, "입원보험금", newId));
  const b11 = tree.subCoverages[0].benefits[0].id;
  const [b21, b22] = tree.subCoverages[1].benefits.map((b) => b.id);
  return { tree, b11, b21, b22 };
}
