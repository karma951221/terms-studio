-- 담보속성 유효값 코드 V01 → 1 · 순서 컬럼 삭제 (기능/담보속성 §3.1 · §6.2, 2026-09-28).
--
-- 유효값 코드는 순번 그대로(`1` · `2` …)이고 코드 순이 곧 표시 순서다 — 별도 `order` 는 없앤다.
-- V 뒤 숫자를 그대로 쓴다(V01 → 1, V10 → 10). 채번 순번(code_sequences kind 'attributeValue')은 숫자가 같으므로 그대로 둔다.
-- 옛 `order` 가 코드 순과 달랐던 유형은 이제 코드 순으로 보인다 (값 순서를 바꾸는 기능이 없어진다).
--
-- 유효값 코드를 담는 곳 전부를 같은 규칙으로 바꾼다:
--   attribute_values.code · product_coverage_attributes.value_code · product_coverages.combination_key(`담보id|A0001=V02`)
--   · 식 `attr.<유형코드> = 'V02'` / `≠` / `!=` (양쪽 어느 편이든) — discriminators.expression · documents.tree · clauses.body · clauses.options.
-- enum 값 코드(E0001 의 V01 …)와 공용조항 옵션 선택지 코드는 다른 기능이라 건드리지 않는다 — 식은 `attr.` 비교만 고친다.
--
-- [1] 사전 점검: 바꾼 뒤 같은 유형에 같은 코드가 둘이 되면(예: V1 과 V01 이 함께 있음) 유니크 인덱스에 걸린다 — 사람이 본다.
-- 두 번 돌려도 같다(멱등): 바꾼 뒤에는 어느 패턴에도 다시 걸리지 않는다.
DO $$
DECLARE hit text;
BEGIN
  SELECT string_agg(k.code || ':' || m.new_code, ', ') INTO hit
    FROM (
      SELECT kind_id, regexp_replace(code, '^V0*([1-9][0-9]*)$', '\1') AS new_code
        FROM "attribute_values"
    ) AS m
    JOIN "attribute_kinds" k ON k.id = m.kind_id
   GROUP BY k.code, m.new_code
  HAVING count(*) > 1;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0017: 바꾼 뒤 같은 유형에 같은 유효값 코드가 둘이 된다. 사람이 한쪽을 정리한 뒤 다시 적용한다: %', hit;
  END IF;
END $$;--> statement-breakpoint
UPDATE "attribute_values" SET "code" = regexp_replace("code", '^V0*([1-9][0-9]*)$', '\1')
 WHERE "code" ~ '^V0*[1-9][0-9]*$';--> statement-breakpoint
UPDATE "product_coverage_attributes" SET "value_code" = regexp_replace("value_code", '^V0*([1-9][0-9]*)$', '\1')
 WHERE "value_code" ~ '^V0*[1-9][0-9]*$';--> statement-breakpoint
UPDATE "product_coverages" SET "combination_key" = regexp_replace("combination_key", '(A[0-9]+=)V0*([1-9][0-9]*)', '\1\2', 'g')
 WHERE "combination_key" ~ 'A[0-9]+=V0*[1-9]';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace(regexp_replace("expression",
    '(attr\.A[0-9]+\s*(=|≠|!=)\s*)''V0*([1-9][0-9]*)''', '\1''\3''', 'g'),
    '''V0*([1-9][0-9]*)''(\s*(=|≠|!=)\s*attr\.A[0-9]+)', '''\1''\2', 'g')
 WHERE "expression" ~ 'attr\.A[0-9]+\s*(=|≠|!=)\s*''V' OR "expression" ~ '''V0*[1-9][0-9]*''\s*(=|≠|!=)\s*attr\.';--> statement-breakpoint
UPDATE "documents" SET "tree" = regexp_replace(regexp_replace("tree"::text,
    '(attr\.A[0-9]+\s*(=|≠|!=)\s*)''V0*([1-9][0-9]*)''', '\1''\3''', 'g'),
    '''V0*([1-9][0-9]*)''(\s*(=|≠|!=)\s*attr\.A[0-9]+)', '''\1''\2', 'g')::jsonb
 WHERE "tree"::text ~ 'attr\.A[0-9]+\s*(=|≠|!=)\s*''V' OR "tree"::text ~ '''V0*[1-9][0-9]*''\s*(=|≠|!=)\s*attr\.';--> statement-breakpoint
UPDATE "clauses" SET "body" = regexp_replace(regexp_replace("body"::text,
    '(attr\.A[0-9]+\s*(=|≠|!=)\s*)''V0*([1-9][0-9]*)''', '\1''\3''', 'g'),
    '''V0*([1-9][0-9]*)''(\s*(=|≠|!=)\s*attr\.A[0-9]+)', '''\1''\2', 'g')::jsonb
 WHERE "body"::text ~ 'attr\.A[0-9]+\s*(=|≠|!=)\s*''V' OR "body"::text ~ '''V0*[1-9][0-9]*''\s*(=|≠|!=)\s*attr\.';--> statement-breakpoint
UPDATE "clauses" SET "options" = regexp_replace(regexp_replace("options"::text,
    '(attr\.A[0-9]+\s*(=|≠|!=)\s*)''V0*([1-9][0-9]*)''', '\1''\3''', 'g'),
    '''V0*([1-9][0-9]*)''(\s*(=|≠|!=)\s*attr\.A[0-9]+)', '''\1''\2', 'g')::jsonb
 WHERE "options"::text ~ 'attr\.A[0-9]+\s*(=|≠|!=)\s*''V' OR "options"::text ~ '''V0*[1-9][0-9]*''\s*(=|≠|!=)\s*attr\.';--> statement-breakpoint
ALTER TABLE "attribute_values" DROP COLUMN IF EXISTS "order";
