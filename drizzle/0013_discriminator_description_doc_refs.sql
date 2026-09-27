-- Custom SQL migration file, put your code below! --
-- 시드 구분자 설명에서 내부 문서 번호를 뺀다 — 화면(구분자 조회 · 상세)에 그대로 보이던 문자열이다.
-- 시드 원문과 글자까지 같은 행만 바꾼다: 사용자가 고친 설명은 건드리지 않는다. 두 번 돌려도 같다(멱등).
UPDATE "discriminators" SET "description" = '문면이 담보 이름을 그대로 찍는 자리의 값 — 담보 레벨 마스터 필드의 투영'
  WHERE "description" = '문면이 담보 이름을 그대로 찍는 자리의 값 — 담보 레벨 마스터 필드의 투영 (ADR-0036 §2)';
--> statement-breakpoint
UPDATE "discriminators" SET "description" = '감액 폼을 열었나 — 급부 폼 「감액」의 투영'
  WHERE "description" = '감액 폼을 열었나 — 급부 시드 폼 `reduction` 의 투영 (ADR-0065 §5)';
