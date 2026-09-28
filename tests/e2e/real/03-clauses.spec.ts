import { test } from "../_lib/fixtures";
import { NO_COORD, login } from "./_lib/app";
import { ClauseAuthoringDriver } from "./_lib/driver";
import { ALL_GENERAL_ANCESTORS, BASE_CLAUSE_CODES, SEED } from "./_lib/seed";

/**
 * ★ 실물 재현(화면) ③ 공용조항 — 유형 · 이름 · 옵션 · 본문(글 · 별표 참조 · 보통약관 조 참조 · 옵션 자리 · 문장 안 조건). 모델명세 §4 · 메리츠_모델명세 §4.
 * 조 참조 · 별표 참조의 대상이 있어야 하므로 보통약관 · 별표(바탕 DB) 뒤, 담보약관 템플릿 앞 (명세 §1 ⑦).
 * 보통약관이 쓰는 공용조항(C0001~C0019)은 바탕 DB 가 보통약관과 함께 시드로 넣었다 — 그 뒤 코드(C0020~)부터 친다.
 * 준용규정(알파Plus)의 「갱신형이면」 조건은 조건 머리 줄의 담보속성 줄(있음 AND = 갱신형)로 친다 (2026-09-28 — 기능/문면 §3.3).
 * 준용규정(메리츠)의 조 참조는 메리츠 보통약관 조를 고른다 — 고르기 트리는 보통약관 두 벌을 다 보인다.
 */

const ancestors = ALL_GENERAL_ANCESTORS;

test.describe.serial("실물 재현(화면) ③ 공용조항", () => {
  for (const spec of SEED.clauses.filter((c) => !BASE_CLAUSE_CODES.has(c.code))) {
    test(`${spec.code} ${spec.label}`, NO_COORD, async ({ page, ev }) => {
      test.setTimeout(180_000);
      const driver = new ClauseAuthoringDriver(page, ancestors);
      await ev.action("실물화면#3.1", "관리자로 로그인한다", () => login(page));
      await ev.action("실물화면#3.2", `생성 화면 — 유형 ${spec.mode === "inline" ? "문구" : "항"} · 이름 「${spec.label}」`, () => driver.open(spec.mode, spec.label));
      if (spec.options.length > 0) await ev.action("실물화면#3.3", `옵션 ${spec.options.map((o) => o.label).join(" · ")}`, () => driver.options(spec.options));
      await ev.action("실물화면#3.4", "본문을 친다", () => driver.body(spec.mode, spec.body));
      await ev.action("실물화면#3.5", `저장 한 번 — ${spec.code} 로 만들어진다`, () => driver.save(spec.code));
    });
  }
});
