/**
 * 조건식 표시명 — 소스 문자열을 구분자 표시명 + `@노드 이름`으로 바꾼다 (서버 · 클라 공용).
 *
 * `format` 이 소스 문법(연산자 · and/or · 리터럴)을 그대로 내므로 여기서는 바꾸지 않는다 —
 * 참조 자리의 표시명만 한글로 간다. 파싱에 실패하면(팝업이 못 여는 식 포함) 원문을 그대로 보인다.
 */
import { format, parse, refPath, type DisplayName, type Ref } from "@/domain/expression";

import type { ConditionContext } from "./types";

/** 표시명 훅 — 구분자는 라벨(+ `@노드 이름`), 그 밖의 참조는 코드 경로 그대로. */
export function refLabelOf(context: ConditionContext): DisplayName {
  const nodeName = (id: string) => context.coverage?.nodes.find((n) => n.id === id)?.name;
  const labelOf = (code: string) => context.discriminators.find((d) => d.code === code)?.label ?? code;
  return (ref: Ref) => {
    if (ref.kind !== "discriminator") return refPath(ref);
    const label = labelOf(ref.code);
    return ref.node ? `${label} @${nodeName(ref.node.id) ?? "끊어진 노드"}` : label;
  };
}

/** 소스 → 표시 문자열. 파싱 실패면 원문. */
export function chipDisplay(source: string, context: ConditionContext): string {
  if (!source) return "";
  const parsed = parse(source);
  if (!parsed.ok) return source;
  return format(parsed.value, refLabelOf(context));
}
