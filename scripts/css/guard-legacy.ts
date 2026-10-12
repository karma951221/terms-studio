/**
 * 레거시 요소 선택자 가두기 — globals.css 의 a · button · input · select · textarea · :focus-visible 규칙이
 * shadcn 위젯(data-slot 이 붙는다)에 닿지 않게 `:where(:not([data-slot]))` 를 붙인다 (ADR-0085).
 * `:where` 는 특이도 0 이라 레거시 규칙끼리의 우선순위는 그대로다.
 *
 *   npx tsx scripts/css/guard-legacy.ts src/app/globals.css   # 파일을 고쳐 쓴다
 */
import { readFileSync, writeFileSync } from "node:fs";
import postcss, { type Rule } from "postcss";
import selectorParser from "postcss-selector-parser";

const TAGS = new Set(["a", "button", "input", "select", "textarea"]);
const GUARD = ":where(:not([data-slot]))";

function isGuard(node: selectorParser.Node | undefined): boolean {
  return node?.type === "pseudo" && String(node) === GUARD;
}

/**
 * 주어(마지막 compound)만 가둔다. 조상 · 앞 형제 자리나 `:has()` · `:not()` · `:is()` · `:where()` 인자 안의 요소에
 * 가드를 붙이면 뜻이 바뀐다 — 예: `.x:has(input:checked)` 는 shadcn 의 네이티브 input(data-slot)을 품은 줄도 골라야 한다.
 */
function subjectCompound(selector: selectorParser.Selector): selectorParser.Node[] {
  const compound: selectorParser.Node[] = [];
  for (let i = selector.nodes.length - 1; i >= 0; i--) {
    const node = selector.nodes[i]!;
    if (node.type === "combinator") break;
    compound.unshift(node);
  }
  return compound;
}

function guardOne(root: selectorParser.Root): void {
  root.each((selector) => {
    const compound = subjectCompound(selector);
    if (compound.some(isGuard)) return;
    const tag = compound.find((n): n is selectorParser.Tag => n.type === "tag" && TAGS.has(n.value.toLowerCase()));
    if (tag) {
      selector.insertAfter(tag, selectorParser.pseudo({ value: GUARD }));
      return;
    }
    const focus = compound.find((n): n is selectorParser.Pseudo => n.type === "pseudo" && n.value === ":focus-visible");
    if (focus) selector.insertBefore(focus, selectorParser.pseudo({ value: GUARD }));
  });
}

export function guardSelector(selector: string): string {
  return selectorParser(guardOne).processSync(selector, { lossless: true });
}

function inKeyframes(rule: Rule): boolean {
  const parent = rule.parent;
  return parent?.type === "atrule" && /keyframes$/i.test((parent as postcss.AtRule).name);
}

export function unguardedSelectors(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    if (inKeyframes(rule)) return;
    if (guardSelector(rule.selector) !== rule.selector) found.push(rule.selector);
  });
  return found;
}

export function guardCss(css: string): string {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (inKeyframes(rule)) return;
    rule.selector = guardSelector(rule.selector);
  });
  return root.toString();
}

if (process.argv[1]?.endsWith("guard-legacy.ts")) {
  const file = process.argv[2];
  if (!file) throw new Error("사용법: npx tsx scripts/css/guard-legacy.ts <css 파일>");
  writeFileSync(file, guardCss(readFileSync(file, "utf8")));
}
