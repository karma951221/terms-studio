/**
 * 조건식 표시명 — 소스 문자열을 구분자 표시명 + `@노드 이름`으로 바꾼다 (서버 · 클라 공용).
 *
 * `format` 이 소스 문법(연산자 · and/or · 리터럴)을 그대로 내므로 여기서는 바꾸지 않는다 —
 * 참조 자리의 표시명만 한글로 간다. 파싱에 실패하면(팝업이 못 여는 식 포함) 원문을 그대로 보인다.
 */
import { format, parse, refPath, type DisplayName, type MemberName, type Ref } from "@/domain/expression";

import type { ConditionContext } from "./types";

/** 표시명 훅 — 구분자는 라벨(+ `@노드 이름`), 그 밖의 참조는 코드 경로 그대로. `member` 는 열거값 필드 읽기 표시(`memberLabelOf`). */
export function refLabelOf(context: ConditionContext): DisplayName & { member: MemberName } {
  return Object.assign(refOnly(context), { member: memberLabelOf(context) });
}

function refOnly(context: ConditionContext): DisplayName {
  const nodeName = (id: string) => context.coverage?.nodes.find((n) => n.id === id)?.name;
  const labelOf = (code: string) => context.discriminators.find((d) => d.code === code)?.label ?? code;
  return (ref: Ref) => {
    // 함수조항 인자 — 편집기가 문맥에 `arg.<이름>` 칸으로 넣었으면 그 표시명(없으면 경로 그대로)
    if (ref.kind === "param" || ref.kind === "local") return context.discriminators.find((d) => (d.param || d.local) && d.code === refPath(ref))?.label ?? refPath(ref);
    if (ref.kind !== "discriminator") return refPath(ref);
    const label = labelOf(ref.code);
    return ref.node ? `${label} @${nodeName(ref.node.id) ?? "끊어진 노드"}` : label;
  };
}

/** 열거값 필드 읽기 표시 — 편집기가 문맥에 필드 칸(`arg.사유.F01`)을 넣었으면 그 표시명(「사유.약관표시명」). */
export function memberLabelOf(context: ConditionContext): MemberName {
  return (target, field) => (target.kind === "ref" ? context.discriminators.find((d) => d.code === `${refPath(target.ref)}.${field}`)?.label : undefined);
}

/** 소스 → 표시 문자열. 파싱 실패면 원문. */
export function chipDisplay(source: string, context: ConditionContext): string {
  if (!source) return "";
  const parsed = parse(source);
  if (!parsed.ok) return source;
  const hooks = refLabelOf(context);
  return format(parsed.value, hooks, hooks.member);
}
