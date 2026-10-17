/**
 * 동적표 저장 검사 (순수) — 기능/동적표 §3.6 「저장 검사(동적표 정의)」. 어기면 저장 거부.
 *
 * - 이름이 비지 않음. 인자 표는 함수조항의 검사 ①(`checkParams`)과 같다 — 단 값 인자만(조 참조 인자 불가, §3.1).
 * - 템플릿(머리글 네 벌 + 셀)은 인라인 노드 중 글 · 슬롯 · 문장 안 조건 · 값별 분기 · 조사만. 조 참조 · 별표 · 옵션 자리는 없다.
 * - 템플릿이 읽는 것은 인자(`arg.X`)와 표 슬롯(`builtin.table.*`)뿐 — 구분자 · 세목 필드 · 담보속성은 structure(§3.1 「동적표는 담보속성 · 세목 · 구분자를 직접 읽지 않는다」).
 *   셀 템플릿의 「해당보장의」 조건이 읽는 담보 구조 내장값(`count(builtin.subCoverage.name)` 등 `builtin.<레벨>.*`)은 조건에서만 허용한다(§3.3).
 * - 읽는 인자는 선언돼 있어야 하고(brokenRef), 표 슬롯은 그 템플릿에서 쓸 수 있는 것이어야 한다(`DYN_TABLE_ALLOWED_SLOTS`, structure).
 * - 값별 분기: 대상은 열거형 인자 하나, 칸 값은 그 열거형의 값(`env.enumValues` 를 줬을 때 — 함수조항 `switchValueIssues` 와 같은 규칙).
 * - 인라인 조건 · 분기의 중첩 금지 · else 가지는 마지막에만 · 노드 id 는 정의 전체에서 유일 (함수조항 본문과 같다).
 * - 열 기준 「없음」이어도 첫 · 가운데 · 마지막 템플릿은 검사한다(쓰이지 않을 뿐 — 기준을 바꾸면 바로 쓰인다).
 *
 * 좌표: `refPath` = 템플릿 자리(`headers.first` · `cell`) 또는 인자(`arg.X`), `nodePath` = 그 템플릿 안 노드 id 경로.
 */
import { switchValueIssues } from "../clause/body";
import type { Inline, InlineBranch } from "../clause/nodes";
import { checkParams, valueParamTypes, type BindingEnv, type ParamDef } from "../clause/params";
import { isParticlePreset, PARTICLE_PRESET_MESSAGE } from "../document/particles";
import { extractRefs, parse, refPath, type Expr } from "../expression";
import type { Coordinate, Id, Issue } from "../types";
import { DYN_TABLE_ALLOWED_SLOTS, DYN_TABLE_SLOT_LABEL, isDynTableSlotRef, type DynTable, type DynTableTemplateKey, type NewDynTable } from "./types";

export const DYN_TABLE_READS_MESSAGE = "동적표 템플릿은 인자와 표 슬롯만 읽는다";

const NODE_KINDS = new Set(["text", "slot", "inlineCond", "inlineSwitch", "particle"]);

export function checkDynTable(def: NewDynTable | DynTable, env: BindingEnv = {}, at: Coordinate = {}): Issue[] {
  const issues: Issue[] = [];
  const report = (kind: Issue["kind"], message: string, refPath: string, nodePath?: Id[]) => issues.push({ kind, message, at: { ...at, refPath, ...(nodePath ? { nodePath } : {}) } });

  // 1. 이름
  if (typeof def.label !== "string" || def.label.trim() === "") report("structure", "동적표 이름이 비어 있습니다", "label");

  // 2. 인자 표 — 함수조항 검사 ① + 값 인자만
  const params: readonly ParamDef[] = Array.isArray(def.params) ? def.params : [];
  issues.push(...checkParams(params, env, at));
  for (const p of params) if (p.type?.kind === "articleRef") report("structure", `인자 ${p.name} — 동적표의 인자는 값 인자뿐입니다(조 참조 인자 불가)`, `arg.${p.name}`);
  const declared = valueParamTypes(params);

  // 3. 템플릿
  const seen = new Set<Id>();
  const checkTemplate = (key: DynTableTemplateKey, inlines: readonly Inline[] | undefined) => {
    const where = key === "cell" ? "cell" : `headers.${key}`;
    const allowed = DYN_TABLE_ALLOWED_SLOTS[key];
    const here = (message: string, kind: Issue["kind"], path: Id[], refPathOverride?: string) => report(kind, message, refPathOverride ?? where, path);

    /** 식 하나 — 문법 · 읽는 참조(인자 선언 · 허용 종류). 파싱 결과를 돌려준다(값별 분기 대상 검사용). */
    const checkExpr = (src: string, role: "slot" | "condition" | "switch", path: Id[]): Expr | undefined => {
      const parsed = parse(src);
      if (!parsed.ok) {
        if (parsed.rejection.reason === "invalid") for (const i of parsed.rejection.issues) issues.push({ ...i, at: { ...at, refPath: where, nodePath: path } });
        return undefined;
      }
      for (const { ref, path: p } of extractRefs(parsed.value)) {
        switch (ref.kind) {
          case "param":
            if (!declared.has(ref.name)) here(`선언되지 않은 인자입니다: ${p} — 동적표의 인자 표에 먼저 선언한다`, "brokenRef", path);
            break;
          case "builtin":
            if (ref.level === "table") here(`표 슬롯 ${DYN_TABLE_SLOT_LABEL[p as keyof typeof DYN_TABLE_SLOT_LABEL] ?? p} 은(는) 슬롯으로만 쓴다 — ${role === "condition" ? "조건" : "값별 분기 대상"}에서 읽을 수 없습니다`, "structure", path);
            else if (role !== "condition") here(`${DYN_TABLE_READS_MESSAGE} — 담보 구조 내장값 ${p} 은(는) 조건에서만 읽는다`, "structure", path);
            break;
          default:
            here(`${DYN_TABLE_READS_MESSAGE} — ${p} 은(는) 읽을 수 없습니다 (구분자 · 세목 필드 · 담보속성은 인자로 받아 연결한다)`, "structure", path);
        }
      }
      return parsed.value;
    };

    const checkBranches = (branches: InlineBranch[], path: Id[]) => {
      if (!Array.isArray(branches) || branches.length === 0) return here("조건에는 가지가 하나 이상 있어야 합니다", "structure", path);
      branches.forEach((br, i) => {
        const bp = [...path, br.id];
        if (br.when === undefined) {
          if (i !== branches.length - 1) here("else 가지는 마지막에만 올 수 있습니다", "structure", bp);
        } else checkExpr(br.when, "condition", bp);
        for (const c of br.children ?? []) checkNode(c, bp, true);
      });
    };

    const checkNode = (n: Inline, path: Id[], inside: boolean) => {
      const p = [...path, n?.id];
      if (!n || typeof n !== "object" || !NODE_KINDS.has(n.kind)) {
        here(`동적표 템플릿에 둘 수 없는 노드입니다: ${n?.kind ?? "(없음)"} — 글 · 슬롯 · 문장 안 조건 · 값별 분기 · 조사만 둔다`, "structure", p);
        return;
      }
      if (seen.has(n.id)) here(`노드 id 가 중복됩니다: ${n.id}`, "structure", p);
      seen.add(n.id);
      switch (n.kind) {
        case "text":
          return;
        case "particle":
          if (!isParticlePreset(n.preset)) here(PARTICLE_PRESET_MESSAGE, "structure", p);
          return;
        case "slot":
          if (isDynTableSlotRef(n.ref)) {
            if (!allowed.includes(n.ref)) {
              const can = allowed.length === 0 ? "표 슬롯을 쓸 수 없습니다" : `${allowed.map((a) => `{${DYN_TABLE_SLOT_LABEL[a]}}`).join(" · ")} 만 쓸 수 있습니다`;
              here(`${where} 에는 표 슬롯 {${DYN_TABLE_SLOT_LABEL[n.ref]}} 을(를) 둘 수 없습니다 — ${can}`, "structure", p);
            }
            return;
          }
          checkExpr(n.ref, "slot", p);
          return;
        case "inlineCond":
          if (inside) return here("문장 안 조건 · 분기 안에 문장 안 조건을 둘 수 없습니다 (중첩 금지)", "structure", p);
          checkBranches(n.branches, p);
          return;
        case "inlineSwitch": {
          if (inside) return here("문장 안 조건 · 분기 안에 문장 안 분기를 둘 수 없습니다 (중첩 금지)", "structure", p);
          const on = checkExpr(n.on, "switch", p);
          for (const k of n.cases ?? []) for (const c of k.children ?? []) checkNode(c, [...p, k.id], true);
          if (!on) return;
          const t = on.kind === "ref" && on.ref.kind === "param" ? declared.get(on.ref.name) : undefined;
          if (on.kind !== "ref" || on.ref.kind !== "param") return here(`값별 분기의 대상은 열거형 인자 하나여야 합니다: ${n.on}`, "typeMismatch", p);
          if (!t) return; // 선언 없음은 위가 잡았다
          if (t.kind !== "enum") return here(`값별 분기의 대상은 목록값(enum) 인자여야 합니다: ${refPath(on.ref)} (${t.kind})`, "typeMismatch", p);
          const values = env.enumValues?.(t.enumCode);
          if (values) issues.push(...switchValueIssues(n, values, t.enumCode, { ...at, refPath: where, nodePath: p }));
          return;
        }
      }
    };

    for (const n of inlines ?? []) checkNode(n, [], false);
  };

  checkTemplate("first", def.headers?.first);
  checkTemplate("middle", def.headers?.middle);
  checkTemplate("last", def.headers?.last);
  checkTemplate("single", def.headers?.single);
  checkTemplate("cell", def.cell);

  return issues;
}
